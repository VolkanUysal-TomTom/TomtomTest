# TomTom Navigation Design System — Base Token Library

This repository is the single source of truth for design tokens used across the TomTom Navigation product suite. Tokens are managed in [Token Studio](https://tokens.studio/) and committed directly to this repo via the Token Studio GitHub sync.

---

## What are design tokens?

Design tokens are named keys that represent design decisions — colours, spacing, typography, and more. This repo defines the **keys and their default values**. Clients consume the keys and assign their own brand values on top.

---

## Token architecture

Tokens are organized in three layers. Each layer references the one above it — never skipping layers.

```
1-Global        Raw primitives — colour hex values, numeric sizes, font families
     ↓
2-System        Semantic mappings — what a colour means (e.g. "surface", "brand", "feedback")
     ↓
3-Component     Applied tokens — what a specific UI component uses
```

A fourth category, **Figma Only**, contains tokens used exclusively inside Figma for panel position modes and locale simulation. These are not distributed to clients.

### Naming convention

| Layer | Prefix | Example |
|---|---|---|
| Global | `tt_glb_` | `tt_glb_color_blue_400` |
| System | `tt_sys_` | `tt_sys_color_brand_primary` |
| Component | `tt_cmp_` | `tt_cmp_color_containedButton_primary_surface` |
| Figma Only | `fo_` | `fo_locale_unit_distance_long` |

### Theme and screen variants

| Dimension | Variants |
|---|---|
| Colour mode | Light, Dark |
| Screen size | Large, Medium, Small |
| Aspect ratio | Wide, Narrow, Tall, Short |
| Locale | EU, US, Japan, Korea |

---

## Folder structure

```
tokens/
├── $metadata.json          Token set load order
├── $themes.json            Theme configurations
├── 1-Global/               Raw primitives
│   ├── Colours/HEXs.json
│   ├── Sizes/Sizes.json
│   ├── Fonts/Family.json
│   └── Effects/Opacity.json
├── 2-System/               Semantic tokens (Light/Dark, screen sizes)
│   ├── Colours/
│   ├── Sizes/
│   ├── Spacing/
│   ├── Fonts/
│   └── Effects/
├── 3-Component/            Component-level tokens
│   ├── Colours/
│   ├── Screens/
│   ├── Fonts/
│   └── Effects/
└── Figma Only/             Figma-internal only, not distributed
    ├── Panel Position/
    └── Locale/

migration/                  Per-release token change manifests (for clients and dev intake)
figma-changelog/            Per-release Figma layout and variable change notes
CHANGELOG.md                Consumer-facing release notes
CLIENTS.md                  Guide for clients on how to consume and stay in sync
```

---

## Releases and versioning

This library uses [Semantic Versioning](https://semver.org/).

- **Patch** (1.0.x) — value adjustments, no key changes
- **Minor** (1.x.0) — new tokens added, existing tokens unchanged (safe to upgrade)
- **Major** (x.0.0) — tokens renamed or removed (requires migration)

Each release is published as a [GitHub Release](../../releases) with a version tag. **Clients should watch this repo** (Watch → Custom → Releases) to receive notifications when new versions are published.

See [`CHANGELOG.md`](CHANGELOG.md) for the full release history.

---

## For clients

See [`CLIENTS.md`](CLIENTS.md) for step-by-step instructions on how to set up Token Studio, consume these tokens, and stay in sync with new releases.

---

## For the DS team

See the [contributing guidelines](.github/PULL_REQUEST_TEMPLATE.md) for the PR checklist to follow when adding or changing tokens.
