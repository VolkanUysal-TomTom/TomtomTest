/* ─────────────────────────────────────────────────
   TomTom Token Review App
   Single-set architecture: resolves values against
   JLR's own token files on the PR branch.
   ───────────────────────────────────────────────── */

const params        = new URLSearchParams(location.search);
const VERSION       = params.get('version');       // e.g. 1.2.0
const PR_NUMBER     = params.get('pr');
const CLIENT_OWNER  = params.get('owner');
const CLIENT_REPO   = params.get('repo');          // e.g. JLRTest
const BRANCH        = params.get('branch');        // e.g. sync/v1.2.0
const TOMTOM_OWNER  = params.get('tomtom_owner') || 'VolkanUysal-TomTom';
const TOMTOM_REPO   = params.get('tomtom_repo')  || 'TomtomTest';

// Which colour modes and which screen modes to recognise
const COLOR_MODES   = ['Light', 'Dark'];
const SCREEN_MODES  = ['Large', 'Medium', 'Small'];

let ghToken    = sessionStorage.getItem('gh_token') || '';
let reviewer   = null;
let allTokens  = [];
let currentIdx = 0;
let tokenMap   = {};  // flat map: tokenName -> resolved hex/value (from JLR files)
let manifest   = null;

// Per-token decisions
// decisions[tokenName] = { action: 'accept'|'modify'|'reject', value, modifiedValues: {mode: value} }
const decisions = {};

/* ── Screens ──────────────────────────────────── */
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

/* ── Missing params guard ─────────────────────── */
if (!VERSION || !PR_NUMBER || !CLIENT_REPO) {
  document.getElementById('auth-screen').innerHTML = `
    <div class="auth-card">
      <div class="brand">TomTom DS</div>
      <h1>Token Review</h1>
      <p class="subtitle">Open this page from the pull request comment link — it includes the version and repo details needed to load the review.</p>
    </div>`;
}

/* ── Auth ─────────────────────────────────────── */
// GitHub OAuth App client ID (set up at github.com/settings/developers)
const OAUTH_CLIENT_ID = 'YOUR_GITHUB_OAUTH_APP_CLIENT_ID';
// Cloudflare Worker URL that exchanges auth code → access token
const OAUTH_PROXY_URL = 'YOUR_OAUTH_PROXY_URL';

document.getElementById('signin-btn')?.addEventListener('click', startSignIn);

function startSignIn() {
  // Development fallback: prompt for PAT when OAuth not configured
  if (OAUTH_CLIENT_ID === 'YOUR_GITHUB_OAUTH_APP_CLIENT_ID') {
    const pat = prompt(
      'Dev mode — paste your GitHub PAT (repo scope)\n' +
      'Configure OAuth App to replace this prompt.'
    );
    if (!pat) return;
    ghToken = pat.trim();
    sessionStorage.setItem('gh_token', ghToken);
    loadReview();
    return;
  }

  const state    = crypto.randomUUID();
  const redirect = encodeURIComponent(location.origin + location.pathname);
  sessionStorage.setItem('oauth_state', state);

  const popup = window.open(
    `https://github.com/login/oauth/authorize?client_id=${OAUTH_CLIENT_ID}&scope=repo&state=${state}&redirect_uri=${redirect}`,
    'github-auth', 'width=600,height=700,left=200,top=100'
  );

  const timer = setInterval(async () => {
    try {
      const url = popup.location.href;
      if (url.includes('code=')) {
        clearInterval(timer);
        popup.close();
        const code = new URLSearchParams(new URL(url).search).get('code');
        const res  = await fetch(`${OAUTH_PROXY_URL}?code=${code}`);
        const data = await res.json();
        if (!data.access_token) throw new Error(data.error_description);
        ghToken = data.access_token;
        sessionStorage.setItem('gh_token', ghToken);
        loadReview();
      }
    } catch { /* cross-origin, still waiting */ }
    if (popup.closed) clearInterval(timer);
  }, 600);
}

/* ── Token map: load all JLR token files ─────── */
function extractTokens(obj, map) {
  if (typeof obj !== 'object' || obj === null) return;
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'object' && val !== null && 'value' in val) {
      map[key] = val.value;  // token name -> raw value (may be a reference)
    } else if (typeof val === 'object' && val !== null) {
      extractTokens(val, map);
    }
  }
}

function resolveValue(value, map, depth = 0) {
  if (depth > 10) return value;  // prevent infinite loops
  if (typeof value !== 'string') return value;

  // Token Studio reference format: {Group.tokenName} or {tokenName}
  const refMatch = value.match(/^\{(.+)\}$/);
  if (!refMatch) return value;  // literal value, return as-is

  const ref   = refMatch[1];
  // Try full reference key first, then just the last part (token name)
  const parts = ref.split('.');
  const tokenName = parts[parts.length - 1];

  if (map[ref] !== undefined) {
    return resolveValue(map[ref], map, depth + 1);
  }
  if (map[tokenName] !== undefined) {
    return resolveValue(map[tokenName], map, depth + 1);
  }

  return value;  // unresolved reference
}

// Encode a file path for the GitHub Contents API — encode each segment but keep slashes
function encodePath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

async function buildTokenMap(owner, repo, branch) {
  // Get the full git tree — encode branch name for URL safety (e.g. sync/v1.4.0)
  const encodedBranch = encodeURIComponent(branch);
  const treeRes = await gh(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodedBranch}?recursive=1`
  );
  if (!treeRes.ok) throw new Error(`Could not fetch file tree for ${owner}/${repo} branch ${branch} (${treeRes.status}).`);
  const tree = await treeRes.json();

  const tokenFiles = (tree.tree || []).filter(f =>
    f.path.startsWith('tokens/') &&
    f.path.endsWith('.json') &&
    !f.path.includes('/$') &&
    !f.path.includes('Figma Only')
  );

  console.log(`Building token map from ${tokenFiles.length} files on ${branch}`);
  const flat = {};

  for (const file of tokenFiles) {
    try {
      const res = await gh(
        `https://api.github.com/repos/${owner}/${repo}/contents/${encodePath(file.path)}?ref=${encodedBranch}`
      );
      if (!res.ok) { console.warn(`Skip ${file.path}: ${res.status}`); continue; }
      const data = await res.json();
      if (!data.content) { console.warn(`Skip ${file.path}: no content`); continue; }
      const content = JSON.parse(atob(data.content.replace(/\n/g, '')));
      extractTokens(content, flat);
    } catch (e) { console.warn(`Skip ${file.path}:`, e.message); }
  }

  console.log(`Token map built: ${Object.keys(flat).length} tokens`);
  return flat;
}

/* ── Load ─────────────────────────────────────── */
async function loadReview() {
  show('loading-screen');
  try {
    console.log('Step 1: checking auth...');
    const userRes = await gh('https://api.github.com/user');
    if (!userRes.ok) { show('auth-screen'); return; }
    reviewer = await userRes.json();
    console.log('Step 1 done: logged in as', reviewer.login);

    // Fetch migration manifest from TomTom repo — use raw URL to avoid API/base64 issues
    console.log('Step 2: fetching manifest...');
    const mRes = await fetch(
      `https://raw.githubusercontent.com/${TOMTOM_OWNER}/${TOMTOM_REPO}/main/migration/v${VERSION}.json`
    );
    if (!mRes.ok) throw new Error(`Migration manifest v${VERSION} not found (${mRes.status}). URL: raw.githubusercontent.com/${TOMTOM_OWNER}/${TOMTOM_REPO}/main/migration/v${VERSION}.json`);
    const mText = await mRes.text();
    console.log('Step 2: raw manifest length:', mText.length);
    manifest = JSON.parse(mText);
    console.log('Step 2 done: manifest loaded with', (manifest.changes?.added?.length || 0), 'added tokens');

    // Build flat token resolution map from JLR's own files on the PR branch
    console.log('Step 3: building token map from', CLIENT_OWNER, CLIENT_REPO, BRANCH);
    tokenMap = await buildTokenMap(CLIENT_OWNER, CLIENT_REPO, BRANCH);
    console.log('Step 3 done');

    // Build flat ordered review list
    allTokens = [
      ...(manifest.changes.added      || []).map(t => ({ ...t, kind: 'added' })),
      ...(manifest.changes.changed    || []).map(t => ({ ...t, kind: 'changed' })),
      ...(manifest.changes.renamed    || []).map(t => ({ ...t, kind: 'renamed' })),
      ...(manifest.changes.deprecated || []).map(t => ({ ...t, kind: 'deprecated' })),
    ];

    // Populate topbar
    document.getElementById('version-chip').textContent = `v${VERSION}`;
    document.getElementById('client-chip').textContent  = CLIENT_REPO;
    document.getElementById('avatar').src               = reviewer.avatar_url;
    document.getElementById('avatar').style.display     = '';
    document.getElementById('username').textContent     = reviewer.login;

    show('review-screen');
    renderCurrent();
  } catch (err) {
    document.getElementById('error-message').textContent = err.message;
    show('error-screen');
  }
}

if (ghToken && VERSION && PR_NUMBER && CLIENT_REPO) loadReview();

/* ── Render current step ──────────────────────── */
function renderCurrent() {
  updateProgress();
  ['card-added', 'card-changed', 'card-renamed', 'card-deprecated', 'card-done']
    .forEach(id => document.getElementById(id).classList.add('hidden'));

  if (currentIdx >= allTokens.length) {
    document.getElementById('card-done').classList.remove('hidden');
    return;
  }

  const item = allTokens[currentIdx];
  if (item.kind === 'added')      renderAdded(item);
  if (item.kind === 'changed')    renderChanged(item);
  if (item.kind === 'renamed')    renderRenamed(item);
  if (item.kind === 'deprecated') renderDeprecated(item);
}

function updateProgress() {
  const total = allTokens.length;
  const done  = currentIdx;
  document.getElementById('progress-fill').style.width   = total ? `${Math.round(done / total * 100)}%` : '100%';
  document.getElementById('progress-label').textContent  = total ? `${done} / ${total}` : 'Done';
}

/* ── Added token ──────────────────────────────── */
function renderAdded(token) {
  document.getElementById('card-added').classList.remove('hidden');
  document.getElementById('added-name').textContent = token.token;
  document.getElementById('added-desc').textContent = token.description || '';

  const isColor  = token.type === 'color';
  const modes    = token.modes || {};
  const modeKeys = Object.keys(modes);

  // Init decision for this token
  decisions[token.token] = { action: 'accept', modifiedValues: {} };

  const container = document.getElementById('added-modes');
  container.innerHTML = '';

  modeKeys.forEach(mk => {
    const mInfo    = modes[mk] || {};
    const rawVal   = mInfo.value || '';
    // Resolve against JLR's own token map to get the actual colour
    const resolved = resolveValue(rawVal, tokenMap);
    const isRef    = rawVal !== resolved && rawVal.startsWith('{');

    const row     = document.createElement('div');
    row.className = 'mode-row';
    row.id        = `mode-row-${safeId(token.token)}-${mk}`;

    row.innerHTML = `
      <div class="mode-header">
        <span class="mode-label">${mk}</span>
      </div>
      <div class="mode-body">
        <div class="value-in-tomtom">
          <div class="value-label">VALUE IN TOMTOM REPO</div>
          <div class="value-display">
            ${isColor ? `<span class="color-swatch" style="background:${resolved}"></span>` : ''}
            <span class="value-hex">${resolved}</span>
            ${isRef ? `<span class="value-via">via ${rawVal.replace(/^\{/, '').replace(/\}$/, '').split('.').pop()}</span>` : ''}
          </div>
          ${mInfo.description ? `<div class="value-desc">${mInfo.description}</div>` : ''}
        </div>
      </div>
    `;

    container.appendChild(row);
  });

  // Single set of action buttons for the whole token
  const actionArea = document.getElementById('added-actions');
  if (actionArea) {
    actionArea.innerHTML = `
      <div class="token-action-btns">
        <button class="action-btn btn-accept-token" id="btn-token-accept">Accept</button>
        <button class="action-btn btn-modify-token" id="btn-token-modify">Modify</button>
        <button class="action-btn btn-reject-token" id="btn-token-reject">Reject</button>
      </div>
      <div class="modify-area hidden" id="modify-area-${safeId(token.token)}">
        ${modeKeys.map(mk => `
          <div class="modify-row">
            <label class="modify-label">${mk}</label>
            <input class="modify-input" type="text"
              placeholder="${isColor ? '#hex or rgba(…)' : 'Enter value'}"
              id="modify-input-${safeId(token.token)}-${mk}">
            ${isColor ? `<span class="modify-preview" id="modify-preview-${safeId(token.token)}-${mk}"></span>` : ''}
          </div>
        `).join('')}
        <button class="action-btn btn-confirm-modify" id="btn-confirm-modify-${safeId(token.token)}">Confirm</button>
      </div>
    `;
  }

  // Accept
  wireBtn('btn-token-accept', () => {
    decisions[token.token].action = 'accept';
    addReviewed(token.token, [{ label: 'accepted', cls: 'badge-accepted' }]);
    next();
  });

  // Modify — reveal per-mode inputs
  wireBtn('btn-token-modify', () => {
    decisions[token.token].action = 'modify';
    const modifyArea = document.getElementById(`modify-area-${safeId(token.token)}`);
    if (modifyArea) modifyArea.classList.remove('hidden');

    // Wire up live preview for each mode input
    modeKeys.forEach(mk => {
      const input   = document.getElementById(`modify-input-${safeId(token.token)}-${mk}`);
      const preview = document.getElementById(`modify-preview-${safeId(token.token)}-${mk}`);
      if (input) {
        // Pre-fill with resolved value as starting point
        const rawVal   = modes[mk]?.value || '';
        const resolved = resolveValue(rawVal, tokenMap);
        input.value    = resolved;
        if (preview) preview.style.background = resolved;

        input.addEventListener('input', () => {
          const v = input.value.trim();
          decisions[token.token].modifiedValues[mk] = v;
          if (preview) preview.style.background = v;
        });

        // Capture initial pre-filled value
        decisions[token.token].modifiedValues[mk] = resolved;
      }
    });

    wireBtn(`btn-confirm-modify-${safeId(token.token)}`, () => {
      addReviewed(token.token, modeKeys.map(mk => ({
        label: `${mk}: ${decisions[token.token].modifiedValues[mk] || '?'}`,
        cls: 'badge-modified'
      })));
      next();
    });
  });

  // Reject
  wireBtn('btn-token-reject', () => {
    decisions[token.token].action = 'reject';
    addReviewed(token.token, [{ label: 'rejected', cls: 'badge-rejected' }]);
    next();
  });
}

/* ── Changed token (TomTom value update) ──────── */
function renderChanged(token) {
  document.getElementById('card-changed').classList.remove('hidden');
  document.getElementById('changed-name').textContent = token.token;

  const isColor  = token.type === 'color';
  const modes    = token.modes || {};
  const modeKeys = Object.keys(modes);

  // Default: keep client's existing values (no write on submit)
  decisions[token.token] = {
    kind: 'changed',
    action: 'keep',
    modifiedValues: {},
    // Pre-resolved TomTom new values — used when "adopt" is chosen
    adoptedValues: {},
    file: token.file || '',
    modeKeys,
  };

  const container = document.getElementById('changed-modes');
  container.innerHTML = '';

  modeKeys.forEach(mk => {
    const mInfo  = modes[mk] || {};
    const oldTT  = mInfo.oldValue || '';
    const newTT  = mInfo.newValue || '';

    // Resolved (hex) values — old TomTom ref, new TomTom ref, and the current JLR value
    const oldTTResolved = resolveValue(oldTT, tokenMap);
    const newTTResolved = resolveValue(newTT, tokenMap);
    const clientValue   = tokenMap[token.token] ?? '';
    const clientResolved = resolveValue(clientValue, tokenMap);

    // Record what "adopt" would write — the resolved hex of TomTom's new value
    // (Option B: literal hex, because TomTom's reference won't resolve in JLR's files)
    decisions[token.token].adoptedValues[mk] = newTTResolved;

    const row = document.createElement('div');
    row.className = 'mode-row';
    row.id = `changed-row-${safeId(token.token)}-${mk}`;
    row.innerHTML = `
      <div class="mode-header">
        <span class="mode-label">${mk}</span>
      </div>
      <div class="mode-body" style="flex-direction:column;align-items:stretch;gap:6px">
        <div class="value-in-tomtom">
          <div class="value-label">TOMTOM WAS</div>
          <div class="value-display">
            ${isColor ? `<span class="color-swatch" style="background:${oldTTResolved}"></span>` : ''}
            <span class="value-hex">${oldTTResolved}</span>
            ${oldTT !== oldTTResolved ? `<span class="value-via">via ${oldTT.replace(/^\{/, '').replace(/\}$/, '').split('.').pop()}</span>` : ''}
          </div>
        </div>
        <div class="value-in-tomtom">
          <div class="value-label">TOMTOM NOW</div>
          <div class="value-display">
            ${isColor ? `<span class="color-swatch" style="background:${newTTResolved}"></span>` : ''}
            <span class="value-hex">${newTTResolved}</span>
            ${newTT !== newTTResolved ? `<span class="value-via">via ${newTT.replace(/^\{/, '').replace(/\}$/, '').split('.').pop()}</span>` : ''}
          </div>
        </div>
        <div class="value-in-tomtom">
          <div class="value-label">YOUR CURRENT VALUE</div>
          <div class="value-display">
            ${isColor ? `<span class="color-swatch" style="background:${clientResolved}"></span>` : ''}
            <span class="value-hex">${clientResolved || '—'}</span>
            ${clientValue && clientValue !== clientResolved ? `<span class="value-via">via ${String(clientValue).replace(/^\{/, '').replace(/\}$/, '').split('.').pop()}</span>` : ''}
          </div>
        </div>
      </div>
    `;
    container.appendChild(row);
  });

  const actionArea = document.getElementById('changed-actions');
  actionArea.innerHTML = `
    <div class="token-action-btns">
      <button class="action-btn btn-accept-token" id="btn-changed-adopt">Adopt TomTom's new value</button>
      <button class="action-btn" id="btn-changed-keep">Keep yours</button>
      <button class="action-btn btn-modify-token" id="btn-changed-modify">Modify</button>
    </div>
    <div class="modify-area hidden" id="modify-area-changed-${safeId(token.token)}">
      ${modeKeys.map(mk => `
        <div class="modify-row">
          <label class="modify-label">${mk}</label>
          <input class="modify-input" type="text"
            placeholder="${isColor ? '#hex or rgba(…)' : 'Enter value'}"
            id="modify-input-changed-${safeId(token.token)}-${mk}">
          ${isColor ? `<span class="modify-preview" id="modify-preview-changed-${safeId(token.token)}-${mk}"></span>` : ''}
        </div>
      `).join('')}
      <button class="action-btn btn-confirm-modify" id="btn-confirm-changed-${safeId(token.token)}">Confirm</button>
    </div>
  `;

  // Adopt — writes TomTom's resolved new value (Option B: literal hex)
  wireBtn('btn-changed-adopt', () => {
    decisions[token.token].action = 'adopt';
    addReviewed(token.token, modeKeys.map(mk => ({
      label: `${mk}: adopted ${decisions[token.token].adoptedValues[mk] || '?'}`,
      cls: 'badge-accepted'
    })));
    next();
  });

  // Keep — no file write on submit
  wireBtn('btn-changed-keep', () => {
    decisions[token.token].action = 'keep';
    addReviewed(token.token, [{ label: 'kept yours', cls: 'badge-ack' }]);
    next();
  });

  // Modify — per-mode custom values
  wireBtn('btn-changed-modify', () => {
    decisions[token.token].action = 'modify';
    const area = document.getElementById(`modify-area-changed-${safeId(token.token)}`);
    if (area) area.classList.remove('hidden');

    modeKeys.forEach(mk => {
      const input   = document.getElementById(`modify-input-changed-${safeId(token.token)}-${mk}`);
      const preview = document.getElementById(`modify-preview-changed-${safeId(token.token)}-${mk}`);
      if (input) {
        // Pre-fill with TomTom's new resolved value as a helpful starting point
        const starter = decisions[token.token].adoptedValues[mk] || '';
        input.value = starter;
        if (preview) preview.style.background = starter;
        decisions[token.token].modifiedValues[mk] = starter;

        input.addEventListener('input', () => {
          const v = input.value.trim();
          decisions[token.token].modifiedValues[mk] = v;
          if (preview) preview.style.background = v;
        });
      }
    });

    wireBtn(`btn-confirm-changed-${safeId(token.token)}`, () => {
      addReviewed(token.token, modeKeys.map(mk => ({
        label: `${mk}: ${decisions[token.token].modifiedValues[mk] || '?'}`,
        cls: 'badge-modified'
      })));
      next();
    });
  });
}

/* ── Renamed token ────────────────────────────── */
function renderRenamed(token) {
  document.getElementById('card-renamed').classList.remove('hidden');
  document.getElementById('renamed-old').textContent  = token.oldToken;
  document.getElementById('renamed-new').textContent  = token.newToken;
  document.getElementById('renamed-note').textContent = token.migration || 'No value change — update references only.';
  wireBtn('btn-rename-ack', () => {
    addReviewed(token.newToken, [{ label: 'acknowledged', cls: 'badge-ack' }]);
    next();
  });
}

/* ── Deprecated token ─────────────────────────── */
function renderDeprecated(token) {
  document.getElementById('card-deprecated').classList.remove('hidden');
  document.getElementById('dep-name').textContent        = token.token;
  document.getElementById('dep-version').textContent     = token.removalVersion || '2.0.0';
  document.getElementById('dep-replacement').textContent = token.replacedBy || '—';
  document.getElementById('dep-note').textContent        = token.migration || '';
  wireBtn('btn-dep-ack', () => {
    addReviewed(token.token, [{ label: 'acknowledged', cls: 'badge-ack' }]);
    next();
  });
}

/* ── Reviewed sidebar ─────────────────────────── */
function addReviewed(tokenName, modeBadges) {
  const list = document.getElementById('reviewed-list');
  const item = document.createElement('div');
  item.className = 'rev-item';

  const primaryAction = modeBadges[0]?.cls.includes('reject')   ? 'rejected'
                      : modeBadges[0]?.cls.includes('modified')  ? 'modified'
                      : modeBadges[0]?.cls.includes('ack')        ? 'ack'
                      : 'accepted';

  item.innerHTML = `
    <div class="rev-dot dot-${primaryAction}"></div>
    <div class="rev-info">
      <div class="rev-token" title="${tokenName}">${shortName(tokenName)}</div>
      <div class="rev-modes">
        ${modeBadges.map(b => `<span class="rev-badge ${b.cls}">${b.label}</span>`).join('')}
      </div>
    </div>
  `;
  list.prepend(item);
}

/* ── Navigation ───────────────────────────────── */
function next() { currentIdx++; renderCurrent(); }

function wireBtn(id, handler) {
  const el = document.getElementById(id);
  if (!el) return;
  const fresh = el.cloneNode(true);
  el.parentNode.replaceChild(fresh, el);
  fresh.addEventListener('click', handler);
}

/* ── Submit ───────────────────────────────────── */
document.getElementById('submit-btn')?.addEventListener('click', submitReview);

async function submitReview() {
  const btn = document.getElementById('submit-btn');
  btn.disabled    = true;
  btn.textContent = 'Submitting…';

  try {
    let accepted = 0, modified = 0, rejected = 0, adopted = 0, kept = 0;

    for (const [tokenName, dec] of Object.entries(decisions)) {
      const token = allTokens.find(t => t.token === tokenName);
      if (!token) continue;

      const fileDir = token.file || '';
      const modes   = token.modes || {};

      // ── Added tokens ──────────────────────────
      if (token.kind === 'added') {
        if (dec.action === 'accept') { accepted++; continue; }

        if (dec.action === 'reject') {
          rejected++;
          for (const mk of Object.keys(modes)) {
            const filePath = `tokens/${fileDir}/${mk}.json`;
            await updateTokenInFile(
              CLIENT_OWNER, CLIENT_REPO, BRANCH,
              filePath, tokenName, null, true
            );
          }
          continue;
        }

        if (dec.action === 'modify') {
          modified++;
          for (const [mk, newValue] of Object.entries(dec.modifiedValues)) {
            if (!newValue) continue;
            const filePath = `tokens/${fileDir}/${mk}.json`;
            await updateTokenInFile(
              CLIENT_OWNER, CLIENT_REPO, BRANCH,
              filePath, tokenName, newValue, false
            );
          }
        }
        continue;
      }

      // ── Changed tokens (TomTom value updates) ─
      if (token.kind === 'changed') {
        if (dec.action === 'keep') { kept++; continue; }  // no file write

        if (dec.action === 'adopt') {
          adopted++;
          // Write TomTom's resolved new value (Option B: literal hex) into each mode
          for (const [mk, newValue] of Object.entries(dec.adoptedValues || {})) {
            if (!newValue) continue;
            const filePath = `tokens/${fileDir}/${mk}.json`;
            await updateTokenInFile(
              CLIENT_OWNER, CLIENT_REPO, BRANCH,
              filePath, tokenName, newValue, false
            );
          }
          continue;
        }

        if (dec.action === 'modify') {
          modified++;
          for (const [mk, newValue] of Object.entries(dec.modifiedValues || {})) {
            if (!newValue) continue;
            const filePath = `tokens/${fileDir}/${mk}.json`;
            await updateTokenInFile(
              CLIENT_OWNER, CLIENT_REPO, BRANCH,
              filePath, tokenName, newValue, false
            );
          }
        }
        continue;
      }
    }

    // Post summary comment on PR
    await gh(
      `https://api.github.com/repos/${CLIENT_OWNER}/${CLIENT_REPO}/issues/${PR_NUMBER}/comments`,
      {
        method: 'POST',
        body: JSON.stringify({
          body:
            `## ✅ Token review complete — @${reviewer.login}\n\n` +
            `| Decision | Count |\n|---|---|\n` +
            `| ✓ Accepted TomTom default (new tokens) | ${accepted} |\n` +
            `| ✏ Modified with custom value | ${modified} |\n` +
            `| ✗ Rejected (removed) | ${rejected} |\n` +
            `| ↻ Adopted TomTom value update | ${adopted} |\n` +
            `| ⏸ Kept existing value | ${kept} |\n\n` +
            `Token files in \`tokens/\` updated directly on this branch.\n` +
            `Merge the PR, then pull from Token Studio to sync.`
        })
      }
    );

    const total = accepted + modified + rejected + adopted + kept;
    document.getElementById('done-message').textContent =
      `${total} token decisions applied. ` +
      `Accepted: ${accepted}, Modified: ${modified}, Rejected: ${rejected}, ` +
      `Adopted: ${adopted}, Kept: ${kept}. ` +
      `Merge the PR and pull from Token Studio.`;
    document.getElementById('pr-link').href =
      `https://github.com/${CLIENT_OWNER}/${CLIENT_REPO}/pull/${PR_NUMBER}`;
    show('done-screen');

  } catch (err) {
    document.getElementById('error-message').textContent = err.message;
    show('error-screen');
  }
}

/* ── File update helpers ──────────────────────── */
async function updateTokenInFile(owner, repo, branch, filePath, tokenName, newValue, shouldRemove) {
  const res = await gh(
    `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`
  );
  if (!res.ok) {
    console.warn(`Skipping ${filePath} — file not found on branch ${branch}`);
    return;
  }
  const fileData = await res.json();
  const sha      = fileData.sha;
  let content;
  try {
    content = JSON.parse(atob(fileData.content.replace(/\n/g, '')));
  } catch {
    throw new Error(`Could not parse JSON in ${filePath}`);
  }

  if (shouldRemove) {
    removeTokenFromObj(content, tokenName);
  } else {
    updateTokenValueInObj(content, tokenName, newValue);
  }

  const newContent = btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2) + '\n')));
  const putRes = await gh(
    `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        message: `review: set ${tokenName} value`,
        content: newContent,
        sha:     sha,
        branch:  branch
      })
    }
  );
  if (!putRes.ok) {
    const errData = await putRes.json();
    throw new Error(`Failed to commit ${filePath}: ${errData.message}`);
  }
}

function updateTokenValueInObj(obj, tokenName, newValue) {
  if (typeof obj !== 'object' || obj === null) return false;
  if (tokenName in obj && typeof obj[tokenName] === 'object' && 'value' in obj[tokenName]) {
    obj[tokenName].value = newValue;
    return true;
  }
  for (const val of Object.values(obj)) {
    if (typeof val === 'object' && updateTokenValueInObj(val, tokenName, newValue)) return true;
  }
  return false;
}

function removeTokenFromObj(obj, tokenName) {
  if (typeof obj !== 'object' || obj === null) return false;
  if (tokenName in obj && typeof obj[tokenName] === 'object' && 'value' in obj[tokenName]) {
    delete obj[tokenName];
    return true;
  }
  for (const val of Object.values(obj)) {
    if (typeof val === 'object' && removeTokenFromObj(val, tokenName)) return true;
  }
  return false;
}

/* ── Low-level helpers ────────────────────────── */
function gh(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${ghToken}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
}

function safeId(name)  { return name.replace(/[^a-zA-Z0-9]/g, '_'); }
function shortName(name) {
  const parts = name.split('_').filter(Boolean);
  return parts.length > 3 ? parts.slice(-3).join('_') : name;
}
