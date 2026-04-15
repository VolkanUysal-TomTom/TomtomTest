/* ─────────────────────────────────────────────────────
   TomTom Token Review App
   Step-by-step token review: Accept / Modify / Reject
   Writes decisions to client-theme.json on PR branch
   ───────────────────────────────────────────────────── */

const TOMTOM_OWNER = 'VolkanUysal-TomTom';
const TOMTOM_REPO  = 'TomtomTest';

// URL params injected by the bot's PR comment link
const params       = new URLSearchParams(location.search);
const VERSION      = params.get('version');  // e.g. 1.1.0
const PR_NUMBER    = params.get('pr');
const CLIENT_OWNER = params.get('owner');
const CLIENT_REPO  = params.get('repo');
const BRANCH       = params.get('branch');   // e.g. sync/v1.1.0

// App state
let ghToken      = sessionStorage.getItem('gh_token') || '';
let reviewer     = null;
let allTokens    = [];   // flat ordered list of all items to review
let currentIndex = 0;
let clientTheme  = {};
const decisions  = {};   // { tokenName: { action, value, type } }

/* ── Screens ──────────────────────────────────────── */
function show(id) {
  document.querySelectorAll('.screen, .modal-overlay').forEach(el => el.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

/* ── Guard: missing URL params ────────────────────── */
if (!VERSION || !PR_NUMBER || !CLIENT_REPO) {
  document.getElementById('auth-screen').innerHTML = `
    <div class="auth-card">
      <div class="brand">TomTom DS</div>
      <h1>Token Review</h1>
      <p class="subtitle">Open this page from the pull request comment link —
      it includes the version, repository, and PR details needed to load the review.</p>
    </div>`;
}

/* ── Auth: GitHub OAuth (opens popup) ─────────────── */
// OAuth App client ID — create one at github.com/settings/developers
// Redirect URI must point to this page (GitHub Pages URL)
const OAUTH_CLIENT_ID  = 'YOUR_GITHUB_OAUTH_CLIENT_ID';
// Tiny proxy (e.g. Cloudflare Worker) that exchanges code → token
// See: docs/oauth-proxy/README.md for setup instructions
const OAUTH_PROXY_URL  = 'YOUR_OAUTH_PROXY_URL';

let oauthPollTimer = null;

document.getElementById('signin-btn')?.addEventListener('click', startOAuth);
document.getElementById('cancel-oauth')?.addEventListener('click', () => {
  clearInterval(oauthPollTimer);
  document.getElementById('oauth-modal').classList.add('hidden');
});

function startOAuth() {
  // If no OAuth app configured yet, fall back to a PAT prompt for development
  if (OAUTH_CLIENT_ID === 'YOUR_GITHUB_OAUTH_CLIENT_ID') {
    const pat = prompt('Development mode: paste your GitHub Personal Access Token\n(Set up OAuth App to remove this step)');
    if (!pat) return;
    ghToken = pat.trim();
    sessionStorage.setItem('gh_token', ghToken);
    loadReview();
    return;
  }

  const state    = Math.random().toString(36).slice(2);
  const redirect = encodeURIComponent(location.origin + location.pathname);
  const oauthUrl = `https://github.com/login/oauth/authorize?client_id=${OAUTH_CLIENT_ID}&scope=repo&state=${state}&redirect_uri=${redirect}`;

  sessionStorage.setItem('oauth_state', state);
  document.getElementById('oauth-modal').classList.remove('hidden');

  const popup = window.open(oauthUrl, 'github-oauth', 'width=600,height=700,left=200,top=100');

  // Poll for the popup to redirect back with ?code=
  oauthPollTimer = setInterval(async () => {
    try {
      const popupUrl = popup.location.href;
      if (popupUrl.includes('code=')) {
        clearInterval(oauthPollTimer);
        popup.close();
        const code = new URLSearchParams(new URL(popupUrl).search).get('code');
        await exchangeCodeForToken(code);
      }
    } catch {
      // Cross-origin — popup not yet redirected back, keep polling
    }
    if (popup.closed) {
      clearInterval(oauthPollTimer);
      document.getElementById('oauth-modal').classList.add('hidden');
    }
  }, 500);
}

async function exchangeCodeForToken(code) {
  document.getElementById('oauth-modal').classList.remove('hidden');
  try {
    const res  = await fetch(`${OAUTH_PROXY_URL}?code=${code}`);
    const data = await res.json();
    if (data.access_token) {
      ghToken = data.access_token;
      sessionStorage.setItem('gh_token', ghToken);
      document.getElementById('oauth-modal').classList.add('hidden');
      loadReview();
    } else {
      throw new Error(data.error_description || 'OAuth failed');
    }
  } catch (err) {
    document.getElementById('oauth-modal').classList.add('hidden');
    alert('Sign-in failed: ' + err.message);
  }
}

/* ── Load data ────────────────────────────────────── */
async function loadReview() {
  show('loading-screen');
  try {
    // Verify token + fetch reviewer profile
    const userRes = await gh('https://api.github.com/user');
    if (!userRes.ok) { show('auth-screen'); return; }
    reviewer = await userRes.json();

    // Fetch migration manifest from TomTom repo
    const mRes = await gh(
      `https://api.github.com/repos/${TOMTOM_OWNER}/${TOMTOM_REPO}/contents/migration/v${VERSION}.json`
    );
    if (!mRes.ok) throw new Error(`Migration manifest v${VERSION} not found.`);
    const mFile = await mRes.json();
    const manifest = JSON.parse(atob(mFile.content.replace(/\n/g, '')));

    // Fetch client's current client-theme from PR branch
    try {
      const tRes = await gh(
        `https://api.github.com/repos/${CLIENT_OWNER}/${CLIENT_REPO}/contents/tokens/client-theme.json?ref=${BRANCH}`
      );
      if (tRes.ok) {
        const tFile = await tRes.json();
        clientTheme = JSON.parse(atob(tFile.content.replace(/\n/g, '')));
      }
    } catch { clientTheme = {}; }

    // Build flat ordered token list: added → renamed → deprecated
    const { changes } = manifest;
    allTokens = [
      ...(changes.added      || []).map(t => ({ ...t, kind: 'added' })),
      ...(changes.renamed    || []).map(t => ({ ...t, kind: 'renamed' })),
      ...(changes.deprecated || []).map(t => ({ ...t, kind: 'deprecated' })),
    ];

    // Populate topbar
    document.getElementById('version-chip').textContent = `v${VERSION}`;
    document.getElementById('repo-label').textContent   = CLIENT_REPO;
    document.getElementById('avatar').src = reviewer.avatar_url;
    document.getElementById('username').textContent = reviewer.login;

    show('review-screen');
    renderCurrent();
  } catch (err) {
    document.getElementById('error-message').textContent = err.message;
    show('error-screen');
  }
}

// Auto-load if session token exists and params are present
if (ghToken && VERSION && PR_NUMBER && CLIENT_REPO) loadReview();

/* ── Step renderer ────────────────────────────────── */
function renderCurrent() {
  updateProgress();

  if (currentIndex >= allTokens.length) {
    showCard('card-done');
    return;
  }

  const item = allTokens[currentIndex];
  hideAllCards();

  if (item.kind === 'added')      renderAdded(item);
  if (item.kind === 'renamed')    renderRenamed(item);
  if (item.kind === 'deprecated') renderDeprecated(item);
}

function hideAllCards() {
  ['card-added', 'card-renamed', 'card-deprecated', 'card-done']
    .forEach(id => document.getElementById(id).classList.add('hidden'));
}
function showCard(id) {
  hideAllCards();
  document.getElementById(id).classList.remove('hidden');
}

/* ── Progress ─────────────────────────────────────── */
function updateProgress() {
  const total   = allTokens.length;
  const done    = currentIndex;
  const pct     = total ? Math.round((done / total) * 100) : 100;
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-label').textContent =
    total ? `${done} / ${total}` : 'Done';
}

/* ── Added token ──────────────────────────────────── */
function renderAdded(token) {
  showCard('card-added');

  const isColor  = token.type === 'color';
  const defVal   = token.value || '';
  const existing = clientTheme[token.token]?.value || null;

  document.getElementById('added-name').textContent = token.token;
  document.getElementById('added-hex').textContent  = defVal;
  document.getElementById('added-desc').textContent = token.description || '';

  const swatch = document.getElementById('added-swatch');
  swatch.style.display = isColor ? '' : 'none';
  if (isColor) swatch.style.background = defVal;

  // Reset modify row
  const modRow   = document.getElementById('modify-row');
  const modInput = document.getElementById('modify-input');
  const modPrev  = document.getElementById('modify-preview');
  modRow.classList.add('hidden');
  modInput.value = existing || '';
  if (isColor) { modPrev.style.display = ''; modPrev.style.background = existing || defVal; }
  else modPrev.style.display = 'none';

  modInput.oninput = () => {
    const v = modInput.value.trim();
    if (isColor) modPrev.style.background = v;
    decisions[token.token] = { action: 'modify', value: v, type: token.type };
  };

  // Wire action buttons
  wireActionBtn('btn-accept', () => {
    decisions[token.token] = { action: 'accept', value: defVal, type: token.type };
    addReviewedItem(token.token, 'accepted', defVal, isColor);
    next();
  });
  wireActionBtn('btn-modify', () => {
    modRow.classList.remove('hidden');
    modInput.focus();
    // Confirm on Enter or second click of Modify while value is filled
    wireActionBtn('btn-modify', () => {
      const v = modInput.value.trim();
      if (!v) { modInput.focus(); return; }
      decisions[token.token] = { action: 'modify', value: v, type: token.type };
      addReviewedItem(token.token, 'modified', v, isColor);
      next();
    }, true);
  });
  wireActionBtn('btn-reject', () => {
    decisions[token.token] = { action: 'reject', type: token.type };
    addReviewedItem(token.token, 'rejected', null, isColor);
    next();
  });
}

/* ── Renamed token ────────────────────────────────── */
function renderRenamed(token) {
  showCard('card-renamed');
  document.getElementById('renamed-old').textContent  = token.oldToken;
  document.getElementById('renamed-new').textContent  = token.newToken;
  document.getElementById('renamed-note').textContent = token.migration || 'No value change — update references only.';

  wireActionBtn('btn-rename-ack', () => {
    decisions[token.oldToken] = { action: 'ack-rename' };
    addReviewedItem(token.newToken, 'ack', null, false, 'acknowledged');
    next();
  });
}

/* ── Deprecated token ─────────────────────────────── */
function renderDeprecated(token) {
  showCard('card-deprecated');
  document.getElementById('deprecated-name').textContent = token.token;
  document.getElementById('dep-version').textContent     = token.removalVersion || '2.0';
  document.getElementById('dep-replacement').textContent = token.replacedBy || '—';
  document.getElementById('dep-note').textContent        = token.migration || '';

  wireActionBtn('btn-dep-ack', () => {
    decisions[token.token] = { action: 'ack-deprecated' };
    addReviewedItem(token.token, 'ack', null, false, 'acknowledged');
    next();
  });
}

/* ── Reviewed so far list ─────────────────────────── */
function addReviewedItem(name, action, value, isColor, labelOverride) {
  const list  = document.getElementById('reviewed-list');
  const item  = document.createElement('div');
  item.className = 'reviewed-item';

  const dotClass   = { accepted: 'dot-accepted', modified: 'dot-modified', rejected: 'dot-rejected', ack: 'dot-ack' }[action];
  const badgeClass = { accepted: 'badge-accepted', modified: 'badge-modified', rejected: 'badge-rejected', ack: 'badge-ack' }[action];
  const label      = labelOverride || action;

  let valueHtml = '';
  if (value && isColor) {
    valueHtml = `<span class="reviewed-value" style="display:flex;align-items:center;gap:5px">
      <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${value};border:1px solid rgba(0,0,0,0.1)"></span>
      ${value}
    </span>`;
  } else if (value) {
    valueHtml = `<span class="reviewed-value">${value}</span>`;
  }

  item.innerHTML = `
    <div class="reviewed-dot ${dotClass}"></div>
    <span class="reviewed-token-name" title="${name}">${shortName(name)}</span>
    <span class="reviewed-badge ${badgeClass}">${label}</span>
    ${valueHtml}
  `;
  list.prepend(item); // newest at top
}

function shortName(name) {
  // Show last 2 segments for readability: tt_sys_color_brand_primary → brand_primary
  const parts = name.split('_');
  return parts.length > 3 ? parts.slice(-2).join('_') : name;
}

/* ── Navigation ───────────────────────────────────── */
function next() {
  currentIndex++;
  renderCurrent();
}

function wireActionBtn(id, handler, replace = false) {
  const btn = document.getElementById(id);
  if (!btn) return;
  const fresh = btn.cloneNode(true); // remove old listeners
  btn.parentNode.replaceChild(fresh, btn);
  fresh.addEventListener('click', handler);
}

/* ── Submit ───────────────────────────────────────── */
document.getElementById('submit-btn')?.addEventListener('click', submitReview);

async function submitReview() {
  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  btn.textContent = 'Submitting…';

  try {
    // Build updated client-theme
    const newTheme = { ...clientTheme };

    for (const [tokenName, d] of Object.entries(decisions)) {
      if (d.action === 'modify' && d.value) {
        newTheme[tokenName] = { value: d.value, type: d.type };
      } else if (d.action === 'accept' || d.action === 'reject') {
        // Accept = use TomTom default (no override needed)
        // Reject = explicitly remove from theme
        delete newTheme[tokenName];
      }
      // ack-rename / ack-deprecated = no file change needed
    }

    // Get SHA if file exists
    let sha = null;
    const existRes = await gh(
      `https://api.github.com/repos/${CLIENT_OWNER}/${CLIENT_REPO}/contents/tokens/client-theme.json?ref=${BRANCH}`
    );
    if (existRes.ok) sha = (await existRes.json()).sha;

    // Commit client-theme.json to PR branch
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(newTheme, null, 2))));
    const putRes  = await gh(
      `https://api.github.com/repos/${CLIENT_OWNER}/${CLIENT_REPO}/contents/tokens/client-theme.json`,
      {
        method: 'PUT',
        body: JSON.stringify({
          message: `chore(tokens): apply v${VERSION} review by @${reviewer.login}`,
          content,
          branch: BRANCH,
          ...(sha && { sha })
        })
      }
    );
    if (!putRes.ok) throw new Error((await putRes.json()).message);

    // Tally decisions for PR comment
    const accepted = Object.values(decisions).filter(d => d.action === 'accept').length;
    const modified = Object.values(decisions).filter(d => d.action === 'modify').length;
    const rejected = Object.values(decisions).filter(d => d.action === 'reject').length;

    // Post summary comment on PR
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
            `\`tokens/client-theme.json\` has been updated on this branch.\n` +
            `Merge the PR, then pull from Token Studio to sync.`
        })
      }
    );

    document.getElementById('done-message').textContent =
      `${accepted + modified + rejected} tokens reviewed. Merge the PR and pull in Token Studio.`;
    document.getElementById('pr-link').href =
      `https://github.com/${CLIENT_OWNER}/${CLIENT_REPO}/pull/${PR_NUMBER}`;
    show('done-screen');

  } catch (err) {
    document.getElementById('error-message').textContent = err.message;
    show('error-screen');
  }
}

/* ── GitHub API helper ────────────────────────────── */
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
