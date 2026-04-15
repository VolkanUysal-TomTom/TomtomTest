# Changelog

All notable changes to the TomTom Navigation Design System — Base Token Library are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). This library uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] — 2026-04-15

### Added

- **`tt_sys_color_evCharging_available`** (System / Colours / Light & Dark)
  Semantic colour token for EV charging stations that have at least one available connector. Resolves to `Mint 300` (`#03bf95`) in Light mode and `Mint 400` (`#027c61`) in Dark mode. Replaces ad-hoc usage of global green tokens on EV map pins and availability pills.

- **`tt_sys_spacing_panel_safeArea_bottom`** (System / Spacing / Vertical)
  Bottom safe-area inset for floating and bottom-docked panels. Set to `48 dp` on large screens and `40 dp` on small screens to clear the Android gesture navigation bar and iOS home indicator reliably. Previously this was a hard-coded value inside component frames.

### Changed

- **`tt_sys_color_nip_accent` → `tt_sys_color_guidance_accent`** (System / Colours)
  Renamed to reflect the broader semantic scope of this accent colour. It was already applied to the NIP, lane guidance overlay, speed shields, and the ETA panel — all guidance-state surfaces. The resolved value (`Blue 400`, `#1988cf` / `Blue 350`, `#53A5DD` in Dark) is **unchanged**; this is a name-only migration.
  _Migration:_ find-and-replace all references to `tt_sys_color_nip_accent` with `tt_sys_color_guidance_accent`.

### Deprecated

- **`tt_cmp_color_routeMessage_warningLegacy`** (Component / Colours)
  This component-scoped token directly references a global colour (`Orange 200`) instead of a system-level semantic token, making it brittle when brand colours change. Use `tt_sys_color_feedback_warning` instead. The legacy token will continue to resolve correctly until **v2.0.0**, at which point it will be removed.
  _Migration:_ replace with `tt_sys_color_feedback_warning` and validate visual parity in both Light and Dark themes.

---

### Figma

See [`figma-changelog/v1.1.md`](figma-changelog/v1.1.md) for a detailed account of frame-level layout changes, variable mode updates, and action items for designers.

### Migration

See [`migration/v1.1.json`](migration/v1.1.json) for a machine-readable manifest of all token additions, renames, and deprecations suitable for automated codemods.

---

## [1.0.0] — 2025-11-01

Initial release of the TomTom Navigation Design System base token library. Establishes the three-layer token architecture (Global → System → Component) across colour, size, spacing, typography, and effect categories.
