# TomTom Design System Token Distribution — Project Context

## Overview

This repo (TomtomTest) is the **TomTom Navigation Design System base token repo**. It serves as the source of truth for design tokens used across multiple client products (JLR, etc.). Each client has their own repo with the **same token structure and keys** but **different brand values**.

## Architecture

### Single-set token architecture
- **TomtomTest** (this repo): TomTom brand values. Tokens in `tokens/1-Global/`, `tokens/2-System/`, `tokens/3-Component/`
- **Client repos** (e.g. `VolkanUysal-TomTom/JLRTest`): Same file structure, same keys, different values
- Both repos sync to Figma via **Token Studio** (Figma plugin with GitHub sync)
- Clients use **RRO (Realtime Resource Overlay)** for theming — requires the full token file structure

### Token layers
```
1-Global/    → raw values (HEX colours, sizes, font families)
2-System/    → semantic tokens referencing Global (e.g. tt_sys_color_brand_primary)
3-Component/ → component-specific tokens referencing System
Figma Only/  → Figma-specific tokens (panel positions, locales) — excluded from distribution
```

### Naming convention
- `tt_glb_` → Global tokens
- `tt_sys_` → System tokens
- `tt_cmp_` → Component tokens
- `fo_`     → Figma Only tokens

### Mode structure
- **Colour tokens**: `Light.json` and `Dark.json` in each colour folder
- **Size tokens**: `Large.json`, `Medium.json`, `Small.json`
- **Spacing tokens**: `Tall.json`/`Short.json` (vertical), `Wide.json`/`Narrow.json` (horizontal)
- **Screen-level component tokens**: `Large Tall Wide.json`, `Medium Short Narrow.json`, etc.

---

## Release & Distribution Flow

```
1. TomTom designer modifies tokens in Figma → Token Studio pushes to TomtomTest branch
2. Designer merges branch to TomtomTest main via GitHub PR
   (repeat steps 1–2 as many times as needed — clients see nothing yet)
3. When ready to release: open the Release page → enter version + notes → click Release
4. Release workflow runs automatically:
   a. Detects last release tag
   b. Runs generate-manifest.py → commits migration/vX.Y.Z.json
   c. Creates GitHub Release + tag vX.Y.Z
   d. Reads clients.json → dispatches to every client repo
5. Each client repo's sync workflow runs:
   - Fetches manifest from TomtomTest
   - Edits client token files (inject added, remove deprecated, rename renamed)
   - Creates PR on client repo
   - Posts bot comment with review tool link
6. Client designer opens review tool link from the PR comment:
   - Sees each new token with TomTom's value resolved against their own tokens
   - Accept / Modify / Reject each token
   - Submit writes decisions into client JSON files on the PR branch
7. Client merges PR → pulls from Token Studio into Figma
```

---

## Designer Workflow (no terminal needed)

### Making token changes
1. Open TomTom Figma file → Token Studio plugin
2. Create a branch in Token Studio
3. Add / modify tokens
4. Push via Token Studio → creates branch in TomtomTest
5. Open GitHub → create PR → merge to main
6. Repeat as many times as needed before releasing

### Triggering a release
1. Open **`https://volkanuysal-tomtom.github.io/TomtomTest/release.html`**
2. Sign in with GitHub (OAuth)
3. See all commits since last release
4. Enter version number (e.g. `1.5.0`) and release notes
5. Click **🚀 Release to all clients**
6. Watch live status — done in ~30 seconds

---

## Key Files

### TomtomTest (this repo)
| File | Purpose |
|------|---------|
| `tokens/` | Token JSON files (1-Global, 2-System, 3-Component, Figma Only) |
| `clients.json` | Registry of all client repos — add new clients here |
| `migration/vX.Y.Z.json` | Migration manifests — lists added/renamed/deprecated tokens per release |
| `scripts/generate-manifest.py` | Auto-generates migration manifests by diffing token files between git refs |
| `scripts/generate_manifest.py` | Importable copy of above (underscore name, used by tests) |
| `docs/index.html` | GitHub Pages token review app — HTML structure |
| `docs/app.js` | Review app logic — auth, token loading, review UI, submit |
| `docs/release.html` | GitHub Pages release page — designer triggers releases here |
| `docs/release.js` | Release page logic — OAuth, commit list, workflow dispatch, status polling |
| `docs/style.css` | Shared styles for both GitHub Pages apps |
| `.github/workflows/release.yml` | Release workflow — triggered by release page via workflow_dispatch |
| `.github/workflows/tests.yml` | CI — runs test suite on every push to main and PRs |
| `client-template/.github/workflows/sync-tokens.yml` | Template for client repo sync workflow |
| `cloudflare-worker/oauth-proxy.js` | Cloudflare Worker code for GitHub OAuth token exchange |
| `tests/` | Test suite (pytest) |
| `CLIENTS.md` | Client onboarding guide |

### Client repos (e.g. JLRTest)
| File | Purpose |
|------|---------|
| `tokens/` | Same structure as TomtomTest but with client brand values |
| `tokens/$metadata.json` | Token Studio set order |
| `.github/workflows/sync-tokens.yml` | Sync workflow — triggered by repository_dispatch |

---

## clients.json — Adding a new client

```json
[
  { "name": "JLR",  "owner": "VolkanUysal-TomTom", "repo": "JLRTest" },
  { "name": "Ford", "owner": "VolkanUysal-TomTom", "repo": "FordTest" }
]
```

Every entry gets dispatched automatically on each release. To add a new client:
1. Add entry to `clients.json`
2. Set up the client repo (see **Client Repo Setup** below)

---

## Migration Manifest Format

```json
{
  "version": "1.5.0",
  "changes": {
    "added": [
      {
        "token": "tt_sys_color_parking_full",
        "type": "color",
        "description": "Indicates a full parking area",
        "file": "2-System/Colours",
        "group": "POI Categories",
        "modes": {
          "Light": { "value": "{Extended Colour Collection.tt_glb_color_red_300}" },
          "Dark":  { "value": "{Extended Colour Collection.tt_glb_color_red_400}" }
        }
      }
    ],
    "renamed": [
      {
        "oldToken": "tt_sys_color_old_name",
        "newToken": "tt_sys_color_new_name",
        "migration": "Renamed from old_name"
      }
    ],
    "deprecated": [
      {
        "token": "tt_sys_color_removed_token",
        "migration": "Removed in v1.5.0"
      }
    ]
  }
}
```

Fields:
- `file`: directory within `tokens/` (e.g. `2-System/Colours`)
- `group`: **full** nested path (e.g. `Surfaces/Primary`, `Brand/Primary`). Use `""` for root level.
- `modes`: keys are the JSON filenames without `.json` (e.g. `Light`, `Dark`, `Large`)

**Important**: `group` must use the full path with `/` separators. The sync workflow splits on `/` and navigates each level. A single-level group like `Brand` and a nested group like `Brand/Primary` are both valid.

---

## Auto-generating Manifests

The release workflow runs this automatically. For manual use:

```bash
cd /path/to/TomtomTest
python3 scripts/generate-manifest.py <old-tag> <new-ref> --version X.Y.Z
```

Example:
```bash
python3 scripts/generate-manifest.py v1.4.2 main --version 1.5.0
```

**Best practice**: Tag BEFORE making Token Studio changes, so the diff only includes real token changes and not structural repo changes.

---

## Sync Workflow Details

The workflow (`client-template/.github/workflows/sync-tokens.yml`):
1. Triggered by `repository_dispatch` event `tomtom-token-release`
2. Fetches manifest from `raw.githubusercontent.com/<owner>/<repo>/main/migration/v<version>.json`
3. Runs embedded Python script that processes in this order:
   - **DEPRECATED first**: removes tokens by key name from any file
   - **RENAMED next**: renames keys, preserving existing client values
   - **ADDED last**: injects new tokens at the correct nested group path
   - **Cleanup pass**: removes any empty group shells left behind
4. Commits and pushes to `sync/vX.Y.Z` branch
5. Creates PR with token summary
6. Posts bot comment with review tool link

**Processing order matters**: deprecated runs before added so tokens being moved to a new group are removed first, allowing the added step to re-inject at the correct location.

---

## GitHub Pages Apps

### Token Review Tool
- **URL**: `https://volkanuysal-tomtom.github.io/TomtomTest/`
- **Used by**: Client designers (e.g. JLR) to review incoming token changes
- **Auth**: PAT entered manually (OAuth upgrade planned)
- **URL params**: `version`, `pr`, `owner`, `repo`, `branch`, `tomtom_owner`, `tomtom_repo`

### Release Page
- **URL**: `https://volkanuysal-tomtom.github.io/TomtomTest/release.html`
- **Used by**: TomTom designers to trigger releases to all clients
- **Auth**: GitHub OAuth via Cloudflare Worker proxy
- **Worker URL**: `https://plain-wave-5669.volkan-uysal.workers.dev`
- **OAuth App**: Client ID `Ov23liEnfBzfWKcryH7j` (registered under Volkan's GitHub account)

---

## GitHub Actions Secrets Required

### TomtomTest repo
| Secret | Purpose |
|--------|---------|
| `RELEASE_PAT` | PAT with `repo` + `workflow` scope — used by release.yml to dispatch to client repos |

### Cloudflare Worker (plain-wave-5669)
| Variable | Value |
|----------|-------|
| `GITHUB_CLIENT_ID` | `Ov23liEnfBzfWKcryH7j` |
| `GITHUB_CLIENT_SECRET` | (secret — set in Cloudflare dashboard) |

---

## Tests

```bash
# First time setup
python3 -m venv .venv
source .venv/bin/activate
pip install pytest

# Run tests
python3 -m pytest tests/ -v
```

33 tests covering:
- `inject_token` — nested group path injection, no literal slash keys
- `find_and_remove_token` — recursive removal, preserves siblings
- `find_and_rename_token` — preserves value, works at any depth
- `remove_empty_groups` — cleans up empty shells after removal
- `token_exists` — finds tokens at any depth, ignores groups
- Processing order — deprecated before added allows correct re-injection
- `extract_tokens_flat` — full group path preserved (the key manifest generator fix)

Tests run automatically on every push to main and every PR via `.github/workflows/tests.yml`.

---

## Client Repo Setup

To onboard a new client:
1. Client creates a repo with same token structure as TomtomTest (same files, their own brand values)
2. Copy `client-template/.github/workflows/sync-tokens.yml` to client's `.github/workflows/`
3. In client repo **Settings → Actions → General**:
   - Workflow permissions: **Read and write**
   - **Allow GitHub Actions to create and approve pull requests** ✓
4. Add the client to `clients.json` in TomtomTest
5. Push — the next release will automatically include the new client

---

## Known Issues & Future Improvements

### Not yet implemented
- **Value change propagation**: When TomTom changes the value of an existing token, JLR doesn't see it (by design — JLR has own brand values). A `changed` category in the manifest + review tool card would let client designers choose to follow TomTom's semantic updates.
- **OAuth for review tool**: Token review tool (`index.html`) still uses PAT input. The OAuth plumbing from `release.html` could be reused.
- **Dry run mode**: A way to preview what a release would change without actually dispatching.

### Known limitations
- Manifest generator can produce false positives if there were structural (non-token) commits between the last tag and current main. Best practice: tag right before Token Studio changes.
- Review tool loads all ~56 token files sequentially via GitHub API — can be slow on first load.

---

## GitHub Repos

- **TomtomTest**: `https://github.com/VolkanUysal-TomTom/TomtomTest`
- **JLRTest**: `https://github.com/VolkanUysal-TomTom/JLRTest`
- **Review tool**: `https://volkanuysal-tomtom.github.io/TomtomTest/`
- **Release page**: `https://volkanuysal-tomtom.github.io/TomtomTest/release.html`
