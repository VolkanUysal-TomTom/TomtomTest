"""
Tests for the token sync functions used in sync-tokens.yml.

Run with:  python3 -m pytest tests/test_sync_tokens.py -v
"""

import json
import copy
import pytest

# ── The functions under test (copied from sync-tokens.yml) ───────────────────

def load_json(path):
    with open(path) as f:
        return json.load(f)

def save_json(path, data):
    with open(path, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write('\n')

def find_and_remove_token(data, token_name):
    if isinstance(data, dict):
        if token_name in data and isinstance(data.get(token_name), dict) and 'value' in data[token_name]:
            del data[token_name]
            return True
        for k, v in data.items():
            if isinstance(v, dict) and find_and_remove_token(v, token_name):
                return True
    return False

def find_and_rename_token(data, old_name, new_name):
    if isinstance(data, dict):
        if old_name in data and isinstance(data.get(old_name), dict) and 'value' in data[old_name]:
            data[new_name] = data.pop(old_name)
            return True
        for k, v in data.items():
            if isinstance(v, dict) and find_and_rename_token(v, old_name, new_name):
                return True
    return False

def inject_token(data, group, token_name, token_def):
    current = data
    if group:
        for level in group.split('/'):
            if level not in current or not isinstance(current[level], dict):
                current[level] = {}
            current = current[level]
    current[token_name] = token_def

def remove_empty_groups(data):
    if not isinstance(data, dict):
        return
    for key in list(data.keys()):
        if isinstance(data[key], dict) and 'value' not in data[key]:
            remove_empty_groups(data[key])
            if not data[key]:
                del data[key]

def token_exists(data, token_name):
    if isinstance(data, dict):
        if token_name in data and isinstance(data.get(token_name), dict) and 'value' in data[token_name]:
            return True
        for v in data.values():
            if isinstance(v, dict) and token_exists(v, token_name):
                return True
    return False


# ── inject_token tests ────────────────────────────────────────────────────────

class TestInjectToken:
    def test_simple_group(self):
        """Token injected into single-level group."""
        data = {}
        inject_token(data, 'Brand', 'my_token', {'value': '#fff', 'type': 'color'})
        assert data == {'Brand': {'my_token': {'value': '#fff', 'type': 'color'}}}

    def test_nested_group(self):
        """Token injected into nested group path (Surfaces/Primary)."""
        data = {}
        inject_token(data, 'Surfaces/Primary', 'tt_sys_color_surface_primary', {'value': '#eee', 'type': 'color'})
        assert data['Surfaces']['Primary']['tt_sys_color_surface_primary']['value'] == '#eee'

    def test_deeply_nested_group(self):
        """Token injected 3 levels deep."""
        data = {}
        inject_token(data, 'A/B/C', 'my_token', {'value': 'x', 'type': 'color'})
        assert data['A']['B']['C']['my_token']['value'] == 'x'

    def test_no_group(self):
        """Token injected at root level when group is empty string."""
        data = {}
        inject_token(data, '', 'root_token', {'value': '#000', 'type': 'color'})
        assert data == {'root_token': {'value': '#000', 'type': 'color'}}

    def test_preserves_existing_siblings(self):
        """Injecting into existing group preserves other tokens."""
        data = {'Surfaces': {'Primary': {'existing': {'value': '#aaa', 'type': 'color'}}}}
        inject_token(data, 'Surfaces/Primary', 'new_token', {'value': '#bbb', 'type': 'color'})
        assert 'existing' in data['Surfaces']['Primary']
        assert 'new_token' in data['Surfaces']['Primary']

    def test_creates_missing_group_levels(self):
        """Missing intermediate groups are created automatically."""
        data = {'Surfaces': {}}
        inject_token(data, 'Surfaces/Primary', 'my_token', {'value': '#ccc', 'type': 'color'})
        assert data['Surfaces']['Primary']['my_token']['value'] == '#ccc'

    def test_no_literal_slash_key(self):
        """Group path must NOT create a literal 'Surfaces/Primary' key."""
        data = {}
        inject_token(data, 'Surfaces/Primary', 'my_token', {'value': '#ddd', 'type': 'color'})
        assert 'Surfaces/Primary' not in data  # The old bug


# ── find_and_remove_token tests ───────────────────────────────────────────────

class TestFindAndRemoveToken:
    def test_removes_top_level_token(self):
        data = {'my_token': {'value': '#fff', 'type': 'color'}}
        assert find_and_remove_token(data, 'my_token') is True
        assert 'my_token' not in data

    def test_removes_nested_token(self):
        data = {'Surfaces': {'Primary': {'tt_sys_color': {'value': '#fff', 'type': 'color'}}}}
        assert find_and_remove_token(data, 'tt_sys_color') is True
        assert 'tt_sys_color' not in data['Surfaces']['Primary']

    def test_returns_false_if_not_found(self):
        data = {'other_token': {'value': '#aaa', 'type': 'color'}}
        assert find_and_remove_token(data, 'missing_token') is False

    def test_does_not_remove_groups(self):
        """Groups (dicts without 'value') should not be removed."""
        data = {'Surfaces': {'Primary': {}}}
        assert find_and_remove_token(data, 'Surfaces') is False
        assert 'Surfaces' in data

    def test_preserves_siblings(self):
        data = {'Brand': {'keep_me': {'value': '#aaa', 'type': 'color'}, 'remove_me': {'value': '#bbb', 'type': 'color'}}}
        find_and_remove_token(data, 'remove_me')
        assert 'keep_me' in data['Brand']
        assert 'remove_me' not in data['Brand']


# ── find_and_rename_token tests ───────────────────────────────────────────────

class TestFindAndRenameToken:
    def test_renames_top_level(self):
        data = {'old_name': {'value': '#fff', 'type': 'color'}}
        assert find_and_rename_token(data, 'old_name', 'new_name') is True
        assert 'new_name' in data
        assert 'old_name' not in data

    def test_preserves_value(self):
        data = {'old': {'value': '#abc', 'type': 'color', 'description': 'test'}}
        find_and_rename_token(data, 'old', 'new')
        assert data['new']['value'] == '#abc'

    def test_renames_nested(self):
        data = {'Surfaces': {'Primary': {'old_token': {'value': '#fff', 'type': 'color'}}}}
        find_and_rename_token(data, 'old_token', 'new_token')
        assert 'new_token' in data['Surfaces']['Primary']
        assert 'old_token' not in data['Surfaces']['Primary']

    def test_returns_false_if_not_found(self):
        data = {'other': {'value': '#fff', 'type': 'color'}}
        assert find_and_rename_token(data, 'missing', 'new') is False


# ── remove_empty_groups tests ─────────────────────────────────────────────────

class TestRemoveEmptyGroups:
    def test_removes_empty_top_level_group(self):
        data = {'Surfaces': {}, 'Brand': {'tt_sys': {'value': '#fff', 'type': 'color'}}}
        remove_empty_groups(data)
        assert 'Surfaces' not in data
        assert 'Brand' in data

    def test_removes_literal_slash_key(self):
        """The old bug: 'Surfaces/Primary' literal key left empty."""
        data = {'Surfaces/Primary': {}, 'Surfaces': {'Primary': {'t': {'value': 'x', 'type': 'color'}}}}
        remove_empty_groups(data)
        assert 'Surfaces/Primary' not in data

    def test_does_not_remove_token(self):
        data = {'my_token': {'value': '#fff', 'type': 'color'}}
        remove_empty_groups(data)
        assert 'my_token' in data

    def test_removes_nested_empty_group(self):
        data = {'Surfaces': {'Primary': {}}}
        remove_empty_groups(data)
        assert 'Surfaces' not in data  # Primary empty → Surfaces becomes empty → removed


# ── token_exists tests ────────────────────────────────────────────────────────

class TestTokenExists:
    def test_finds_top_level(self):
        data = {'my_token': {'value': '#fff', 'type': 'color'}}
        assert token_exists(data, 'my_token') is True

    def test_finds_nested(self):
        data = {'Surfaces': {'Primary': {'tt_sys': {'value': '#fff', 'type': 'color'}}}}
        assert token_exists(data, 'tt_sys') is True

    def test_returns_false_for_missing(self):
        data = {'other': {'value': '#fff', 'type': 'color'}}
        assert token_exists(data, 'missing') is False

    def test_does_not_match_groups(self):
        data = {'Surfaces': {'Primary': {}}}
        assert token_exists(data, 'Surfaces') is False


# ── Integration: deprecated + added ordering ──────────────────────────────────

class TestProcessingOrder:
    def test_deprecated_before_added_allows_reinjection(self):
        """
        Simulates the v1.4.1 scenario:
        Token exists at wrong location → deprecated removes it → added re-injects at correct location.
        Processing order must be: deprecated first, then added.
        """
        # Initial state: token wrongly at 'Surfaces/Primary' literal key
        data = {
            'Surfaces/Primary': {'Test': {'value': '#db0000', 'type': 'color'}},
            'Surfaces': {'Primary': {}}
        }

        # Step 1: DEPRECATED removes 'Test' (from wherever it is)
        find_and_remove_token(data, 'Test')
        remove_empty_groups(data)

        # Step 2: ADDED injects at correct path
        assert not token_exists(data, 'Test')  # Must be gone before re-adding
        inject_token(data, 'Surfaces/Primary', 'Test', {'value': '#db0000', 'type': 'color'})

        # Verify correct nesting
        assert data['Surfaces']['Primary']['Test']['value'] == '#db0000'
        assert 'Surfaces/Primary' not in data
