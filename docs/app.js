/* ─────────────────────────────────────────────────
   TomTom Token Review App
   Step-by-step review with per-mode values
   (Light/Dark + one screen size)
   ───────────────────────────────────────────────── */

const TOMTOM_OWNER = 'VolkanUysal-TomTom';
const TOMTOM_REPO  = 'TomtomTest';

const params       = new URLSearchParams(location.search);
const VERSION      = params.get('version');   // e.g. 1.1.0
const PR_NUMBER    = params.get('pr');
const CLIENT_OWNER = params.get('owner');
const CLIENT_REPO  = params.get('repo');      // e.g. JLRTest
const BRANCH       = params.get('branch');    // e.g. sync/v1.1.0

// Which colour modes and which screen mode to show in UI
// Clients can only have Light/Dark + one screen size
const COLOR_MODES  = ['Light', 'Dark'];
const SCREEN_MODES = ['Large', 'Medium', 'Small'];

let ghToken     = sessionStorage.getItem('gh_token') || '';
let reviewer    = null;
let allTokens   = [];
let currentIdx  = 0;

// Per-token, per-mode decisions
// decisions[tokenName][mode] = { action: 'accept'|'modify'|'reject', value }
const decisions = {};

// Client's existing overrides per mode file
const clientTheme = { Light: {}, Dark: {}, Screen: {} };

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

/* ── Load ─────────────────────────────────────── */
async function loadReview() {
  show('loading-screen');
  try {
    const userRes = await gh('https://api.github.com/user');
    if (!userRes.ok) { show('auth-screen'); return; }
    reviewer = await userRes.json();

    // Fetch migration manifest
    const mRes  = await gh(`https://api.github.com/repos/${TOMTOM_OWNER}/${TOMTOM_REPO}/contents/migration/v${VERSION}.json`);
    if (!mRes.ok) throw new Error(`Migration manifest v${VERSION} not found.`);
    const mFile = await mRes.json();
    const manifest = JSON.parse(atob(mFile.content.replace(/\n/g, '')));

    // Fetch existing client overrides from PR branch (best effort)
    for (const modeFile of ['Light', 'Dark', 'Screen']) {
      try {
        const r = await gh(`https://api.github.com/repos/${CLIENT_OWNER}/${CLIENT_REPO}/contents/tokens/client-theme/${modeFile}.json?ref=${BRANCH}`);
        if (r.ok) {
          const f = await r.json();
          clientTheme[modeFile] = JSON.parse(atob(f.content.replace(/\n/g, '')));
        }
      } catch { /* file doesn't exist yet */ }
    }

    // Build flat ordered review list
    allTokens = [
      ...(manifest.changes.added      || []).map(t => ({ ...t, kind: 'added' })),
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
  ['card-added','card-renamed','card-deprecated','card-done']
    .forEach(id => document.getElementById(id).classList.add('hidden'));

  if (currentIdx >= allTokens.length) {
    document.getElementById('card-done').classList.remove('hidden');
    return;
  }

  const item = allTokens[currentIdx];
  if (item.kind === 'added')      renderAdded(item);
  if (item.kind === 'renamed')    renderRenamed(item);
  if (item.kind === 'deprecated') renderDeprecated(item);
}

function updateProgress() {
  const total = allTokens.length;
  const done  = currentIdx;
  document.getElementById('progress-fill').style.width = total ? `${Math.round(done/total*100)}%` : '100%';
  document.getElementById('progress-label').textContent = total ? `${done} / ${total}` : 'Done';
}

/* ── Added token ──────────────────────────────── */
function renderAdded(token) {
  document.getElementById('card-added').classList.remove('hidden');
  document.getElementById('added-name').textContent = token.token;
  document.getElementById('added-desc').textContent = token.description || '';

  const isColor  = token.type === 'color';
  const modes    = token.modes || {};
  const modeKeys = Object.keys(modes);

  // Determine which client file each mode maps to
  const modeFileMap = modeKey =>
    COLOR_MODES.includes(modeKey)  ? modeKey :   // 'Light' → Light.json
    SCREEN_MODES.includes(modeKey) ? 'Screen' :  // 'Large'/'Medium'/'Small' → Screen.json
    'Light';

  // Init decisions for this token
  decisions[token.token] = {};
  modeKeys.forEach(mk => {
    const existing = clientTheme[modeFileMap(mk)]?.[token.token]?.value;
    decisions[token.token][mk] = existing
      ? { action: 'modify', value: existing }
      : { action: 'accept', value: modes[mk]?.value };
  });

  // Build mode rows
  const container = document.getElementById('added-modes');
  container.innerHTML = '';

  modeKeys.forEach(mk => {
    const mInfo   = modes[mk] || {};
    const defVal  = mInfo.value || '';
    const row     = document.createElement('div');
    row.className = 'mode-row';
    row.id        = `mode-row-${safeId(token.token)}-${mk}`;

    row.innerHTML = `
      <div class="mode-header">
        <span class="mode-label">${mk}</span>
        ${isColor ? `<span class="mode-swatch" id="swatch-${safeId(token.token)}-${mk}" style="background:${defVal}"></span>` : ''}
        <span class="mode-default-val">${defVal}</span>
        ${mInfo.description ? `<span class="mode-desc">— ${mInfo.description}</span>` : ''}
      </div>
      <div class="mode-body">
        <div class="mode-tabs" id="tabs-${safeId(token.token)}-${mk}">
          <button class="mode-tab active-accept" data-action="accept">Accept</button>
          <button class="mode-tab"               data-action="modify">Modify</button>
          <button class="mode-tab"               data-action="reject">Reject</button>
        </div>
        <div class="mode-input-wrap hidden" id="input-wrap-${safeId(token.token)}-${mk}">
          ${isColor ? `<div class="mode-preview" id="preview-${safeId(token.token)}-${mk}" style="background:${defVal}"></div>` : ''}
          <input class="mode-input" type="text"
            placeholder="${isColor ? '#hex or rgba(…)' : 'Enter value'}"
            value="${decisions[token.token][mk].action === 'modify' ? decisions[token.token][mk].value : ''}"
            id="input-${safeId(token.token)}-${mk}">
        </div>
      </div>
    `;

    // Tab click handlers
    row.querySelectorAll('.mode-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const action = tab.dataset.action;
        decisions[token.token][mk].action = action;

        // Update tab styles
        row.querySelectorAll('.mode-tab').forEach(t => {
          t.className = 'mode-tab';
          if (t.dataset.action === action) t.classList.add(`active-${action}`);
        });

        // Show/hide input
        const inputWrap = document.getElementById(`input-wrap-${safeId(token.token)}-${mk}`);
        if (action === 'modify') {
          inputWrap.classList.remove('hidden');
          document.getElementById(`input-${safeId(token.token)}-${mk}`).focus();
        } else {
          inputWrap.classList.add('hidden');
          if (action === 'accept') decisions[token.token][mk].value = defVal;
          if (action === 'reject') decisions[token.token][mk].value = null;
        }

        row.className = action === 'reject' ? 'mode-row is-rejected'
                      : action === 'modify' ? 'mode-row is-modified'
                      : 'mode-row';
      });
    });

    // Input handler
    const input = row.querySelector('.mode-input');
    input?.addEventListener('input', () => {
      const v = input.value.trim();
      decisions[token.token][mk] = { action: 'modify', value: v };
      const preview = document.getElementById(`preview-${safeId(token.token)}-${mk}`);
      if (preview) preview.style.background = v;
    });

    // Restore existing state if already has a decision
    const d = decisions[token.token][mk];
    if (d.action !== 'accept') {
      const existingTab = row.querySelector(`[data-action="${d.action}"]`);
      existingTab?.click();
    }

    container.appendChild(row);
  });

  // "Accept all defaults" button
  wireBtn('btn-accept', () => {
    modeKeys.forEach(mk => { decisions[token.token][mk] = { action: 'accept', value: modes[mk]?.value }; });
    addReviewed(token.token, buildModeLabels(modeKeys, 'accept'));
    next();
  });

  // "Reject" button
  wireBtn('btn-reject', () => {
    modeKeys.forEach(mk => { decisions[token.token][mk] = { action: 'reject', value: null }; });
    addReviewed(token.token, [{ label: 'rejected', cls: 'badge-rejected' }]);
    next();
  });
}

function buildModeLabels(modeKeys, defaultAction) {
  return modeKeys.map(mk => {
    const d = decisions[currentToken()]?.[mk] || { action: defaultAction };
    return {
      label: `${mk}: ${d.action}`,
      cls: d.action === 'modify' ? 'badge-modified'
         : d.action === 'reject' ? 'badge-rejected'
         : 'badge-accepted'
    };
  });
}
function currentToken() { return allTokens[currentIdx]?.token || allTokens[currentIdx]?.oldToken; }

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

  const primaryAction = modeBadges[0]?.cls.includes('reject') ? 'rejected'
                      : modeBadges[0]?.cls.includes('modified') ? 'modified'
                      : modeBadges[0]?.cls.includes('ack') ? 'ack'
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
  btn.disabled = true;
  btn.textContent = 'Submitting…';

  try {
    // Apply decisions to each mode file
    const newTheme = {
      Light:  { ...clientTheme.Light },
      Dark:   { ...clientTheme.Dark  },
      Screen: { ...clientTheme.Screen }
    };

    for (const [tokenName, modeDecs] of Object.entries(decisions)) {
      const token = allTokens.find(t => t.token === tokenName || t.newToken === tokenName);
      if (!token || token.kind !== 'added') continue;

      for (const [mk, d] of Object.entries(modeDecs)) {
        const fileKey = COLOR_MODES.includes(mk) ? mk : 'Screen';
        if (d.action === 'modify' && d.value) {
          newTheme[fileKey][tokenName] = { value: d.value, type: token.type };
        } else if (d.action === 'accept' || d.action === 'reject') {
          delete newTheme[fileKey][tokenName]; // resolve from tomtom-base
        }
      }
    }

    // Commit each mode file to the PR branch
    for (const [modeFile, content] of Object.entries(newTheme)) {
      await commitFile(
        `tokens/client-theme/${modeFile}.json`,
        content,
        `chore(tokens): apply v${VERSION} review (${modeFile}) by @${reviewer.login}`
      );
    }

    // Tally for PR comment
    const flat     = Object.values(decisions).flatMap(d => Object.values(d));
    const accepted = flat.filter(d => d.action === 'accept').length;
    const modified = flat.filter(d => d.action === 'modify').length;
    const rejected = flat.filter(d => d.action === 'reject').length;

    await gh(
      `https://api.github.com/repos/${CLIENT_OWNER}/${CLIENT_REPO}/issues/${PR_NUMBER}/comments`,
      {
        method: 'POST',
        body: JSON.stringify({
          body:
            `## ✅ Token review complete — @${reviewer.login}\n\n` +
            `| Decision | Count |\n|---|---|\n` +
            `| ✓ Accepted TomTom default | ${accepted} |\n` +
            `| ✏ Modified with custom value | ${modified} |\n` +
            `| ✗ Rejected | ${rejected} |\n\n` +
            `\`tokens/client-theme/\` files updated on this branch.\n` +
            `Merge the PR, then pull from Token Studio to sync.`
        })
      }
    );

    document.getElementById('done-message').textContent =
      `${accepted + modified + rejected} token decisions saved across Light, Dark, and Screen modes. Merge the PR and pull in Token Studio.`;
    document.getElementById('pr-link').href =
      `https://github.com/${CLIENT_OWNER}/${CLIENT_REPO}/pull/${PR_NUMBER}`;
    show('done-screen');

  } catch (err) {
    document.getElementById('error-message').textContent = err.message;
    show('error-screen');
  }
}

/* ── Helpers ──────────────────────────────────── */
async function commitFile(path, content, message) {
  // Get existing SHA if file exists
  let sha = null;
  const check = await gh(`https://api.github.com/repos/${CLIENT_OWNER}/${CLIENT_REPO}/contents/${path}?ref=${BRANCH}`);
  if (check.ok) sha = (await check.json()).sha;

  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2))));
  const res = await gh(
    `https://api.github.com/repos/${CLIENT_OWNER}/${CLIENT_REPO}/contents/${path}`,
    { method: 'PUT', body: JSON.stringify({ message, content: encoded, branch: BRANCH, ...(sha && { sha }) }) }
  );
  if (!res.ok) throw new Error((await res.json()).message);
}

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

function safeId(name) { return name.replace(/[^a-zA-Z0-9]/g, '_'); }
function shortName(name) {
  const parts = name.split('_').filter(Boolean);
  return parts.length > 3 ? parts.slice(-3).join('_') : name;
}
