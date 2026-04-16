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
- `fo_` → Figma Only tokens

### Mode structure
- **Colour tokens**: `Light.json` and `Dark.json` in each colour folder
- **Size tokens**: `Large.json`, `Medium.json`, `Small.json`
- **Spacing tokens**: `Tall.json`/`Short.json` (vertical), `Wide.json`/`Narrow.json` (horizontal)
- **Screen-level component tokens**: `Large Tall Wide.json`, `Medium Short Narrow.json`, etc.

## Release & Distribution Flow

```
1. TomTom designer modifies tokens in Figma → Token Studio pushes to TomtomTest main
2. Run manifest generator: python3 scripts/generate-manifest.py <old-tag> main --version X.Y.Z
3. Review and commit migration/vX.Y.Z.json → push to main
4. Create GitHub Release with tag vX.Y.Z
5. Trigger dispatch to each client repo (curl command)
6. Client repo workflow:
   - Fetches manifest from TomtomTest (via raw.githubusercontent.com)
   - Python script edits client token files (inject added, remove deprecated, rename renamed)
   - Creates PR on client repo
   - Posts bot comment with review tool link
7. Client designer opens review tool (GitHub Pages):
   - Sees each new token with TomTom's value resolved against their own token files
   - Accept (keep as-is) / Modify (set different value) / Reject (remove)
   - Submit writes decisions directly into client JSON files on PR branch
8. Client merges PR → pulls from Token Studio into Figma
```

## Key Files

### TomtomTest (this repo)
| File | Purpose |
|------|---------|
| `tokens/` | Token JSON files (1-Global, 2-System, 3-Component, Figma Only) |
| `migration/vX.Y.Z.json` | Migration manifests — lists added/renamed/deprecated tokens per release |
| `scripts/generate-manifest.py` | Auto-generates migration manifests by diffing token files between git refs |
| `docs/index.html` | GitHub Pages review app — HTML structure |
| `docs/app.js` | Review app logic — auth, token loading, review UI, submit |
| `docs/style.css` | Review app styles |
| `.github/workflows/release.yml` | Release workflow (triggered on vX.Y.Z tags) |
| `client-template/` | Template files for setting up new client repos |
| `client-template/.github/workflows/sync-tokens.yml` | Client sync workflow template |
| `CLIENTS.md` | Client onboarding guide |

### Client repos (e.g. JLRTest)
| File | Purpose |
|------|---------|
| `tokens/` | Same structure as TomtomTest but with client brand values |
| `tokens/$metadata.json` | Token Studio set order (no tomtom-base or client-theme prefixes) |
| `.github/workflows/sync-tokens.yml` | Sync workflow — triggered by repository_dispatch |

## Migration Manifest Format

```json
{
  "version": "1.4.0",
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
        "migration": "Removed in v1.4.0"
      }
    ]
  }
}
```

Fields:
- `file`: directory within `tokens/` (e.g. `2-System/Colours`) — combined with mode name to get full path like `tokens/2-System/Colours/Light.json`
- `group`: JSON group key where the token is nested (e.g. `POI Categories`, `Surfaces/Primary`, `Brand`). Use `""` for root level.
- `modes`: keys are the JSON file names without `.json` (e.g. `Light`, `Dark`, `Large`, `Tall`)

## Auto-generating Manifests

```bash
cd /path/to/TomtomTest
python3 scripts/generate-manifest.py <old-tag> <new-ref> --version X.Y.Z
```

**Important**: The `<old-tag>` must be the tag right before the Token Studio changes. If there were code/restructuring commits between the tag and the Token Studio changes, the diff will include false positives. Best practice:
1. Tag BEFORE making Token Studio changes
2. Make Token Studio changes
3. Run the script comparing old-tag to main

Example:
```bash
python3 scripts/generate-manifest.py v1.3.0 main --version 1.4.0
```

## Dispatch Commands

### Create a release
```bash
curl -X POST \
  -H "Authorization: Bearer <PAT>" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/VolkanUysal-TomTom/TomtomTest/releases" \
  -d '{"tag_name":"vX.Y.Z","target_commitish":"main","name":"vX.Y.Z","body":"Release notes","draft":false,"prerelease":false}'
```

### Trigger client sync
```bash
curl -X POST \
  -H "Authorization: Bearer <PAT>" \
  -H "Accept: application/vnd.github+json" \
  -H "Content-Type: application/json" \
  "https://api.github.com/repos/VolkanUysal-TomTom/JLRTest/dispatches" \
  -d '{"event_type":"tomtom-token-release","client_payload":{"version":"X.Y.Z","review_url":"https://volkanuysal-tomtom.github.io/TomtomTest/","tomtom_owner":"VolkanUysal-TomTom","tomtom_repo":"TomtomTest"}}'
```

### Update sync-tokens.yml on a client repo (via API)
```bash
SHA=$(curl -s -H "Authorization: Bearer <PAT>" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/VolkanUysal-TomTom/JLRTest/contents/.github/workflows/sync-tokens.yml" | python3 -c "import sys,json; print(json.load(sys.stdin)['sha'])")

curl -s -X PUT \
  -H "Authorization: Bearer <PAT>" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/VolkanUysal-TomTom/JLRTest/contents/.github/workflows/sync-tokens.yml" \
  -d "{\"message\":\"update sync workflow\",\"sha\":\"$SHA\",\"content\":\"$(base64 -i client-template/.github/workflows/sync-tokens.yml | tr -d '\n')\"}"
```

## GitHub Pages Review Tool

- **URL**: `https://volkanuysal-tomtom.github.io/TomtomTest/`
- **Source**: `docs/` folder on `main` branch
- **Auth**: GitHub OAuth popup + PAT dev fallback (stored in sessionStorage as `gh_token`)
- **URL params**: `version`, `pr`, `owner`, `repo`, `branch`, `tomtom_owner`, `tomtom_repo`

### How the review tool works
1. Authenticates via GitHub PAT (dev mode) or OAuth
2. Fetches migration manifest from TomtomTest via `raw.githubusercontent.com`
3. Builds a flat token map by loading ALL client token files from the PR branch
4. For each token reference (e.g. `{tt_sys_color_brand_primary}`), resolves it against the client's own token values
5. Presents tokens one at a time: Accept / Modify / Reject
6. On submit: writes decisions directly into the client's JSON files on the PR branch via GitHub Contents API

## Sync Workflow Details

The workflow (`client-template/.github/workflows/sync-tokens.yml`):
1. Triggered by `repository_dispatch` event `tomtom-token-release`
2. Fetches manifest from `raw.githubusercontent.com/<owner>/<repo>/main/migration/v<version>.json`
3. Runs embedded Python script that:
   - **Added tokens**: reads `tokens/<file>/<mode>.json`, finds/creates the group, injects the token
   - **Deprecated tokens**: walks all `tokens/**/*.json`, recursively finds and removes the key
   - **Renamed tokens**: walks all files, renames the key preserving the existing value
4. Stages with `git add -A tokens/`, commits, pushes
5. Creates PR with truncated body (max 60000 chars for GitHub limit)
6. Posts bot comment with review tool link

## Known Issues & TODOs

### Current issues
- The manifest generator script can detect false positives if there were structural changes between tags — need to tag right before Token Studio changes
- Review tool loads all 56 token files sequentially via API — can be slow (could batch or use raw URLs)
- GitHub OAuth not yet set up — using PAT dev fallback (needs Cloudflare Worker proxy for OAuth code→token exchange)
- The `scripts/generate-manifest.py` doesn't handle nested group paths perfectly — `Surfaces/Primary` vs `Primary` depends on the JSON nesting depth

### Future improvements
- Wire up the actual dispatch in TomtomTest's `release.yml` (currently curl commands are manual)
- Set up GitHub OAuth App + Cloudflare Worker proxy for production auth
- Add a "dry run" mode to the sync workflow for testing
- Batch token file loading in the review tool for better performance
- Add validation that all mode files exist before injecting

## Client Repo Setup

To set up a new client repo:
1. Client creates a repo with same token structure as TomtomTest (same files, their brand values)
2. Copy `client-template/.github/workflows/sync-tokens.yml` to client's `.github/workflows/`
3. In client repo Settings → Actions → General → Workflow permissions: "Read and write" + "Allow GitHub Actions to create and approve pull requests"
4. Add the dispatch curl command to TomtomTest's release process

## GitHub Repos

- **TomtomTest**: `https://github.com/VolkanUysal-TomTom/TomtomTest`
- **JLRTest**: `https://github.com/VolkanUysal-TomTom/JLRTest`
- **Review tool**: `https://volkanuysal-tomtom.github.io/TomtomTest/`
