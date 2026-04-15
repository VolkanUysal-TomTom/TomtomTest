# Client Guide — Consuming TomTom Base Tokens

This guide explains how to set up Token Studio to consume the TomTom base token library, assign your own brand values, and stay in sync when new versions are released.

---

## Concept: two token sets

The key principle is keeping TomTom's tokens and your brand values in **separate Token Studio sets**. This makes upgrading to a new version safe — your values are never overwritten.

```
tomtom-base     (TomTom's keys + default values — you re-import this on each release)
     ↓
client-theme    (your values only — this never changes when you upgrade)
```

Token Studio resolves your `client-theme` values on top of `tomtom-base`. When a new TomTom release adds tokens that you haven't overridden yet, Token Studio highlights them as unresolved — which is your cue to assign a value.

---

## Initial setup

### Step 1 — Get the token files

Go to the [latest release](../../releases/latest) of this repository and download the source zip, or copy the JSON files from the `tokens/` folder.

Only copy the files you need. Clients typically use:

```
tokens/1-Global/
tokens/2-System/
tokens/3-Component/
```

Do **not** copy `tokens/Figma Only/` — those files are for internal Figma use only.

### Step 2 — Import into Token Studio

1. Open Token Studio in Figma
2. Go to **Settings → Token Storage → Local**
3. Import the JSON files you downloaded. Give this set the name **`tomtom-base`**

### Step 3 — Create your brand override set

1. In Token Studio, create a new empty token set named **`client-theme`** (or your brand name)
2. This is where you will add your own values for any token you want to override
3. Make sure `client-theme` is ordered **below** `tomtom-base` in the set list — Token Studio resolves sets from top to bottom

### Step 4 — Override values

In `client-theme`, add only the tokens you want to change. For example:

```json
{
  "tt_sys_color_brand_primary": {
    "value": "#your-brand-colour",
    "type": "color"
  }
}
```

You do not need to copy every token — only the ones you are overriding. Everything else resolves from `tomtom-base`.

---

## Staying in sync with new releases

### How to get notified

Watch this repository for release notifications:

1. Go to the repository on GitHub
2. Click **Watch** (top right) → **Custom** → check **Releases** → **Apply**

You will receive an email whenever a new version is published.

### How to upgrade

When a new release is published:

1. Read the [`CHANGELOG.md`](CHANGELOG.md) — it lists what changed (added, renamed, deprecated tokens)
2. Read `migration/vX.X.json` — machine-readable list of every new token key that needs a value in your `client-theme`
3. Download the new token files from the [release page](../../releases)
4. **Replace** your `tomtom-base` set in Token Studio with the new files
5. Token Studio will highlight any new tokens that are unresolved in your `client-theme`
6. Add values for those tokens in `client-theme`

Your existing `client-theme` values are untouched throughout this process.

---

## Handling renamed or deprecated tokens

Check the `migration/vX.X.json` file for the release. Each rename and deprecation includes a `migration` field explaining exactly what to change.

**Renamed token example:**

```json
{
  "oldToken": "tt_sys_color_nip_accent",
  "newToken": "tt_sys_color_guidance_accent",
  "migration": "Replace all references to 'tt_sys_color_nip_accent' with 'tt_sys_color_guidance_accent'. No value change — swap is safe."
}
```

Update the key name in your `client-theme` if you were overriding it.

**Deprecated token example:**

```json
{
  "token": "tt_cmp_color_routeMessage_warningLegacy",
  "replacedBy": "tt_sys_color_feedback_warning",
  "removalVersion": "2.0.0"
}
```

The deprecated token continues to work until the removal version. Migrate at your own pace before that release.

---

## Questions and support

Raise questions in the `#design-system` channel or open an issue in this repository.
