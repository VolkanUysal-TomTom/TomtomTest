## What changed

<!-- Briefly describe what tokens were added, changed, or removed and why -->

## Type of change

- [ ] **Patch** — value update only, no key changes (e.g. colour value adjusted)
- [ ] **Minor** — new tokens added, nothing removed (clients can upgrade safely)
- [ ] **Major** — tokens renamed or removed (clients need to migrate)

## Token checklist

- [ ] Token names follow the `tt_[glb|sys|cmp]_[category]_[name]` convention
- [ ] New tokens are added at the correct layer (Global / System / Component)
- [ ] References use token aliases (`{Group.token_name}`), not hard-coded values
- [ ] Both Light and Dark variants updated (if colour token)
- [ ] All relevant screen size variants updated (Large / Medium / Small) if size/spacing token

## Documentation checklist

- [ ] `CHANGELOG.md` updated with a summary of changes under the correct version heading
- [ ] `migration/vX.X.json` updated if any tokens were **added**, **renamed**, or **deprecated**
- [ ] `figma-changelog/vX.X.md` updated if any Figma frames, components, or variable modes changed

## Figma checklist

- [ ] Token Studio changes committed and pushed via the GitHub sync
- [ ] Figma variable library published (or scheduled for publish after merge)
- [ ] Affected component variants visually checked in both Light and Dark modes

## Notes for reviewer

<!-- Anything else the reviewer should know — edge cases, screen sizes tested, open questions -->
