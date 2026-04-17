"""
Tests for generate-manifest.py — specifically the token extraction logic.

Run with:  python3 -m pytest tests/test_manifest_generator.py -v
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

from generate_manifest import extract_tokens_flat, detect_changed_tokens


class TestExtractTokensFlat:
    def test_extracts_top_level_token(self):
        data = {'my_token': {'value': '#fff', 'type': 'color'}}
        tokens = extract_tokens_flat(data)
        assert 'my_token' in tokens
        assert tokens['my_token']['group'] == ''

    def test_extracts_single_level_group(self):
        data = {'Brand': {'tt_sys_color_brand': {'value': '#red', 'type': 'color'}}}
        tokens = extract_tokens_flat(data)
        assert 'tt_sys_color_brand' in tokens
        assert tokens['tt_sys_color_brand']['group'] == 'Brand'

    def test_extracts_nested_group_full_path(self):
        """The key fix: group must be 'Surfaces/Primary', not just 'Surfaces'."""
        data = {
            'Surfaces': {
                'Primary': {
                    'tt_sys_color_surface_primary': {'value': '#eee', 'type': 'color'}
                }
            }
        }
        tokens = extract_tokens_flat(data)
        assert 'tt_sys_color_surface_primary' in tokens
        # Must be the full path, not just the first segment
        assert tokens['tt_sys_color_surface_primary']['group'] == 'Surfaces/Primary'

    def test_extracts_deeply_nested_group(self):
        data = {'A': {'B': {'C': {'deep_token': {'value': 'x', 'type': 'color'}}}}}
        tokens = extract_tokens_flat(data)
        assert tokens['deep_token']['group'] == 'A/B/C'

    def test_extracts_value_and_type(self):
        data = {'Brand': {'my_token': {'value': '#123', 'type': 'color', 'description': 'A token'}}}
        tokens = extract_tokens_flat(data)
        assert tokens['my_token']['value'] == '#123'
        assert tokens['my_token']['type'] == 'color'
        assert tokens['my_token']['description'] == 'A token'

    def test_skips_non_token_dicts(self):
        """Dicts without 'value' key are groups, not tokens."""
        data = {'Surfaces': {'Primary': {}}}
        tokens = extract_tokens_flat(data)
        assert len(tokens) == 0

    def test_multiple_tokens_same_group(self):
        data = {
            'Brand': {
                'Primary': {
                    'token_a': {'value': '#aaa', 'type': 'color'},
                    'token_b': {'value': '#bbb', 'type': 'color'},
                }
            }
        }
        tokens = extract_tokens_flat(data)
        assert tokens['token_a']['group'] == 'Brand/Primary'
        assert tokens['token_b']['group'] == 'Brand/Primary'

    def test_fixture_file(self):
        """Test against the real fixture file."""
        import json
        fixture_path = os.path.join(os.path.dirname(__file__), 'fixtures', 'Light.json')
        with open(fixture_path) as f:
            data = json.load(f)
        tokens = extract_tokens_flat(data)

        # Check specific tokens
        assert 'tt_sys_color_surface_primary' in tokens
        assert tokens['tt_sys_color_surface_primary']['group'] == 'Surfaces/Primary'

        assert 'tt_sys_color_surface_secondary' in tokens
        assert tokens['tt_sys_color_surface_secondary']['group'] == 'Surfaces/Secondary'

        assert 'tt_sys_color_brand_primary' in tokens
        assert tokens['tt_sys_color_brand_primary']['group'] == 'Brand/Primary'


# ── detect_changed_tokens tests ──────────────────────────────────────────────

def _token(value, type_='color', description=''):
    return {'value': value, 'type': type_, 'description': description, 'group': ''}


class TestDetectChangedTokens:
    def test_detects_value_change_in_single_mode(self):
        """Token present in both refs with a different Light value → reported as changed."""
        old = {'2-System/Colours': {'Light': {'tt_sys_color_surface_primary': _token('{Grey.tt_glb_color_grey_100}')}}}
        new = {'2-System/Colours': {'Light': {'tt_sys_color_surface_primary': _token('{Grey.tt_glb_color_grey_200}')}}}
        changed = detect_changed_tokens(
            old, new, exclude=set(),
            old_all={'tt_sys_color_surface_primary'},
            new_all={'tt_sys_color_surface_primary'},
        )
        assert len(changed) == 1
        entry = changed[0]
        assert entry['token'] == 'tt_sys_color_surface_primary'
        assert entry['modes']['Light']['oldValue'] == '{Grey.tt_glb_color_grey_100}'
        assert entry['modes']['Light']['newValue'] == '{Grey.tt_glb_color_grey_200}'

    def test_ignores_unchanged_tokens(self):
        """Same value in both refs → not emitted."""
        old = {'2-System/Colours': {'Light': {'my_token': _token('#fff')}}}
        new = {'2-System/Colours': {'Light': {'my_token': _token('#fff')}}}
        changed = detect_changed_tokens(
            old, new, exclude=set(),
            old_all={'my_token'}, new_all={'my_token'},
        )
        assert changed == []

    def test_reports_multiple_mode_changes(self):
        """Token changed in Light AND Dark → both modes listed."""
        old = {
            '2-System/Colours': {
                'Light': {'my_token': _token('#eee')},
                'Dark':  {'my_token': _token('#111')},
            }
        }
        new = {
            '2-System/Colours': {
                'Light': {'my_token': _token('#ddd')},
                'Dark':  {'my_token': _token('#222')},
            }
        }
        changed = detect_changed_tokens(
            old, new, exclude=set(),
            old_all={'my_token'}, new_all={'my_token'},
        )
        assert len(changed) == 1
        modes = changed[0]['modes']
        assert modes['Light']['oldValue'] == '#eee'
        assert modes['Light']['newValue'] == '#ddd'
        assert modes['Dark']['oldValue']  == '#111'
        assert modes['Dark']['newValue']  == '#222'

    def test_only_reports_modes_that_changed(self):
        """Light changed, Dark unchanged → only Light appears in modes."""
        old = {
            '2-System/Colours': {
                'Light': {'my_token': _token('#aaa')},
                'Dark':  {'my_token': _token('#222')},
            }
        }
        new = {
            '2-System/Colours': {
                'Light': {'my_token': _token('#bbb')},
                'Dark':  {'my_token': _token('#222')},
            }
        }
        changed = detect_changed_tokens(
            old, new, exclude=set(),
            old_all={'my_token'}, new_all={'my_token'},
        )
        assert list(changed[0]['modes'].keys()) == ['Light']

    def test_excludes_renamed_tokens(self):
        """Tokens in exclude set (already matched as renames) must not be re-reported."""
        old = {'2-System/Colours': {'Light': {'old_name': _token('#aaa')}}}
        new = {'2-System/Colours': {'Light': {'new_name': _token('#bbb')}}}
        changed = detect_changed_tokens(
            old, new, exclude={'old_name', 'new_name'},
            old_all={'old_name'}, new_all={'new_name'},
        )
        assert changed == []

    def test_ignores_added_only_tokens(self):
        """Token only in new → not a 'changed' (it's an 'added')."""
        old = {'2-System/Colours': {'Light': {}}}
        new = {'2-System/Colours': {'Light': {'new_only': _token('#fff')}}}
        changed = detect_changed_tokens(
            old, new, exclude=set(),
            old_all=set(), new_all={'new_only'},
        )
        assert changed == []

    def test_ignores_removed_only_tokens(self):
        """Token only in old → not a 'changed' (it's a 'deprecated')."""
        old = {'2-System/Colours': {'Light': {'old_only': _token('#fff')}}}
        new = {'2-System/Colours': {'Light': {}}}
        changed = detect_changed_tokens(
            old, new, exclude=set(),
            old_all={'old_only'}, new_all=set(),
        )
        assert changed == []

    def test_entry_includes_file_and_type(self):
        """Changed entry must include file dir and type for sync/review tool."""
        old = {'2-System/Colours': {'Light': {'my_token': _token('#aaa', type_='color')}}}
        new = {'2-System/Colours': {'Light': {'my_token': _token('#bbb', type_='color')}}}
        changed = detect_changed_tokens(
            old, new, exclude=set(),
            old_all={'my_token'}, new_all={'my_token'},
        )
        assert changed[0]['file'] == '2-System/Colours'
        assert changed[0]['type'] == 'color'
