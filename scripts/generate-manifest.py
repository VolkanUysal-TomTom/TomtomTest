#!/usr/bin/env python3
"""
Auto-generate a migration manifest by comparing token files between two git refs.

Usage:
  python3 scripts/generate-manifest.py v1.3.0 main --version 1.4.0

This compares the token JSON files at v1.3.0 (old) vs main (new) and outputs
migration/v1.4.0.json with all added, deprecated, and renamed tokens detected.
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import shutil


def run_git(args):
    """Run a git command and return stdout."""
    result = subprocess.run(['git'] + args, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"git error: {result.stderr.strip()}", file=sys.stderr)
        return None
    return result.stdout.strip()


def get_token_files_at_ref(ref):
    """Get list of token JSON files at a given git ref."""
    output = run_git(['ls-tree', '-r', '--name-only', ref, 'tokens/'])
    if not output:
        return []
    return [
        f for f in output.split('\n')
        if f.endswith('.json')
        and '/$' not in f
        and not os.path.basename(f).startswith('$')
        and 'Figma Only' not in f
    ]


def get_file_content_at_ref(ref, path):
    """Get file content at a given git ref."""
    content = run_git(['show', f'{ref}:{path}'])
    if content is None:
        return None
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return None


def extract_tokens_flat(obj, path=""):
    """
    Recursively extract all tokens from a JSON structure.
    Returns dict of { token_name: { value, type, description, group, path_in_json } }
    """
    tokens = {}
    if not isinstance(obj, dict):
        return tokens

    for key, val in obj.items():
        if isinstance(val, dict) and 'value' in val and isinstance(val.get('value'), str):
            # This is a token leaf
            tokens[key] = {
                'value': val['value'],
                'type': val.get('type', ''),
                'description': val.get('description', ''),
                'group': path,
            }
        elif isinstance(val, dict):
            # This is a group — recurse
            child_path = key if not path else f"{path}/{key}"
            tokens.update(extract_tokens_flat(val, child_path))

    return tokens


def detect_file_dir(filepath):
    """
    Extract the directory part relative to tokens/, without the filename.
    e.g. 'tokens/2-System/Colours/Light.json' -> '2-System/Colours'
    """
    rel = filepath.replace('tokens/', '', 1)
    return os.path.dirname(rel)


def detect_mode(filepath):
    """
    Extract the mode name from the filename.
    e.g. 'tokens/2-System/Colours/Light.json' -> 'Light'
    """
    return os.path.splitext(os.path.basename(filepath))[0]


def detect_changed_tokens(old_by_file, new_by_file, exclude, old_all, new_all):
    """
    Detect tokens present in BOTH old and new refs whose value changed in any mode.

    Returns a list of { token, type, file, group, modes: { mode: { oldValue, newValue } } }.
    Skips tokens that are matched as renames (in `exclude`).
    """
    changed = []
    common = (old_all & new_all) - exclude

    for token_name in sorted(common):
        # Collect per-mode values from old and new, keyed by (file_dir, mode)
        old_values = {}  # (file_dir, mode) -> value
        new_values = {}

        old_info = None
        new_info = None

        for file_dir, modes in old_by_file.items():
            for mode, tokens in modes.items():
                if token_name in tokens:
                    old_values[(file_dir, mode)] = tokens[token_name]['value']
                    old_info = tokens[token_name]

        for file_dir, modes in new_by_file.items():
            for mode, tokens in modes.items():
                if token_name in tokens:
                    new_values[(file_dir, mode)] = tokens[token_name]['value']
                    new_info = tokens[token_name]

        # Find modes where both refs have the token AND the value differs
        mode_diffs = {}
        new_file_dir = ''
        for (file_dir, mode), new_val in new_values.items():
            old_val = old_values.get((file_dir, mode))
            if old_val is not None and old_val != new_val:
                mode_diffs[mode] = {
                    'oldValue': old_val,
                    'newValue': new_val,
                }
                new_file_dir = new_file_dir or file_dir

        if not mode_diffs:
            continue

        entry = {
            'token': token_name,
            'type': (new_info or {}).get('type', ''),
            'file': new_file_dir,
            'group': (new_info or {}).get('group', ''),
            'modes': mode_diffs,
        }
        changed.append(entry)

    return changed


def main():
    parser = argparse.ArgumentParser(description='Generate migration manifest from git diff')
    parser.add_argument('old_ref', help='Old git ref (e.g. v1.3.0)')
    parser.add_argument('new_ref', help='New git ref (e.g. main)')
    parser.add_argument('--version', required=True, help='Version string for the manifest (e.g. 1.4.0)')
    parser.add_argument('--output', help='Output path (default: migration/v{version}.json)')
    args = parser.parse_args()

    output_path = args.output or f'migration/v{args.version}.json'

    print(f"Comparing {args.old_ref} → {args.new_ref}")
    print()

    old_files = get_token_files_at_ref(args.old_ref)
    new_files = get_token_files_at_ref(args.new_ref)

    # Build per-file token maps for both refs
    # Structure: { file_dir: { mode: { token_name: token_info } } }
    old_tokens_by_file = {}
    new_tokens_by_file = {}

    for f in old_files:
        content = get_file_content_at_ref(args.old_ref, f)
        if content is None:
            continue
        file_dir = detect_file_dir(f)
        mode = detect_mode(f)
        tokens = extract_tokens_flat(content)
        if file_dir not in old_tokens_by_file:
            old_tokens_by_file[file_dir] = {}
        old_tokens_by_file[file_dir][mode] = tokens

    for f in new_files:
        content = get_file_content_at_ref(args.new_ref, f)
        if content is None:
            continue
        file_dir = detect_file_dir(f)
        mode = detect_mode(f)
        tokens = extract_tokens_flat(content)
        if file_dir not in new_tokens_by_file:
            new_tokens_by_file[file_dir] = {}
        new_tokens_by_file[file_dir][mode] = tokens

    # Flatten to get all token names across all modes
    def all_token_names(tokens_by_file):
        names = set()
        for file_dir, modes in tokens_by_file.items():
            for mode, tokens in modes.items():
                names.update(tokens.keys())
        return names

    old_all = all_token_names(old_tokens_by_file)
    new_all = all_token_names(new_tokens_by_file)

    added_names = new_all - old_all
    removed_names = old_all - new_all

    # Detect renames: removed + added with same value in at least one mode
    renamed = []
    matched_added = set()
    matched_removed = set()

    for old_name in removed_names:
        # Find value of old token in any mode
        old_values = {}
        old_info = None
        for file_dir, modes in old_tokens_by_file.items():
            for mode, tokens in modes.items():
                if old_name in tokens:
                    old_values[mode] = tokens[old_name]['value']
                    old_info = tokens[old_name]

        for new_name in added_names:
            if new_name in matched_added:
                continue
            # Check if new token has same value in any shared mode
            for file_dir, modes in new_tokens_by_file.items():
                for mode, tokens in modes.items():
                    if new_name in tokens and mode in old_values:
                        if tokens[new_name]['value'] == old_values[mode]:
                            renamed.append({
                                'oldToken': old_name,
                                'newToken': new_name,
                                'migration': f'Renamed from {old_name}',
                            })
                            matched_added.add(new_name)
                            matched_removed.add(old_name)
                            break
                if new_name in matched_added:
                    break

    # Build added list (excluding those matched as renames)
    added = []
    for token_name in sorted(added_names - matched_added):
        # Find file_dir, group, type, and per-mode values
        token_entry = {
            'token': token_name,
            'type': '',
            'description': '',
            'file': '',
            'group': '',
            'modes': {},
        }

        for file_dir, modes in new_tokens_by_file.items():
            for mode, tokens in modes.items():
                if token_name in tokens:
                    info = tokens[token_name]
                    token_entry['type'] = token_entry['type'] or info['type']
                    token_entry['description'] = token_entry['description'] or info['description']
                    token_entry['file'] = token_entry['file'] or file_dir

                    # Preserve the full group path (e.g. "Surfaces/Primary", not just "Surfaces")
                    group_path = info.get('group', '')
                    token_entry['group'] = token_entry['group'] or group_path

                    token_entry['modes'][mode] = {
                        'value': info['value'],
                    }
                    if info.get('description'):
                        token_entry['modes'][mode]['description'] = info['description']

        if token_entry['modes']:
            added.append(token_entry)

    # Build deprecated list (excluding those matched as renames)
    deprecated = []
    for token_name in sorted(removed_names - matched_removed):
        dep_entry = {
            'token': token_name,
            'migration': 'Token removed in this version.',
        }

        # Try to find a replacement heuristic (same group, similar name)
        # For now just mark as deprecated without a specific replacement
        deprecated.append(dep_entry)

    # Build changed list — tokens present in BOTH refs whose value differs in any mode
    changed = detect_changed_tokens(
        old_tokens_by_file, new_tokens_by_file,
        exclude=matched_added | matched_removed,
        old_all=old_all, new_all=new_all,
    )

    # Build manifest
    manifest = {
        'version': args.version,
        'changes': {
            'added': added,
            'renamed': renamed,
            'deprecated': deprecated,
            'changed': changed,
        }
    }

    # Write output
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w') as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write('\n')

    # Print summary
    print(f"Added:      {len(added)} tokens")
    print(f"Renamed:    {len(renamed)} tokens")
    print(f"Deprecated: {len(deprecated)} tokens")
    print(f"Changed:    {len(changed)} tokens")
    print()

    if added:
        print("Added tokens:")
        for t in added:
            modes_str = ', '.join(t['modes'].keys())
            print(f"  + {t['token']} ({t['file']}/{{{modes_str}}})")

    if renamed:
        print("Renamed tokens:")
        for t in renamed:
            print(f"  ~ {t['oldToken']} → {t['newToken']}")

    if deprecated:
        print("Deprecated tokens:")
        for t in deprecated:
            print(f"  - {t['token']}")

    if changed:
        print("Changed tokens (TomTom value updates):")
        for t in changed:
            modes_str = ', '.join(t['modes'].keys())
            print(f"  ≈ {t['token']} ({t['file']}/{{{modes_str}}})")

    print()
    print(f"Written to {output_path}")


if __name__ == '__main__':
    main()
