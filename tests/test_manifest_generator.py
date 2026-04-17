"""
Tests for generate-manifest.py — specifically the token extraction logic.

Run with:  python3 -m pytest tests/test_manifest_generator.py -v
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

from generate_manifest import extract_tokens_flat


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
