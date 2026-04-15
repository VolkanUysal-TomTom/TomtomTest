/* ─────────────────────────────────────────────────────
   TomTom Token Review App
   Reads URL params → loads migration manifest + client theme
   → renders review UI → commits decisions to client repo
   ───────────────────────────────────────────────────── */

const TOMTOM_OWNER = 'VolkanUysal-TomTom';
const TOMTOM_REPO  = 'TomtomTest';

// URL params passed by the bot comment link
const params      = new URLSearchParams(location.search);
const VERSION     = params.get('version');   // e.g. 1.1.0
const PR_NUMBER   = params.get('pr');        // e.g. 3
const CLIENT_OWNER = params.get('owner');    // e.g. VolkanUysal-TomTom
const CLIENT_REPO  = params.get('repo');     // e.g. client-navkit-tokens
const BRANCH       = params.get('branch');   // e.g. sync/v1.1.0

// State
let ghToken       = sessionStorage.getItem('gh_token') || '';
let reviewer      = null;
let migrationData = null;
let clientTheme   = {};
const decisions   = {};   // { tokenName: { action, value, type } }

/* ── Screens ──────────────────────────────────────── */
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

/* ── Validate params ──────────────────────────────── */
if (!VERSION || !PR_NUMBER || !CLIENT_REPO) {
  // Opened without params — show a friendly placeholder
  document.getElementById('auth-screen').innerHTML = `
    <div class="brand">TomTom DS</div>
    <h1 style="margin-top:12px">Token Review Tool</h1>
    <p class="subtitle" style="margin-top:8px">
      Open this page from the pull request comment link — it includes the
      version, repository, and PR details needed to load the review.
    </p>
  `;
}

/* ── Auth ─────────────────────────────────────────── */
document.getElementById('signin-btn').addEventListener('click', () => {
  const pat = document.getElementById('pat-input').value.trim();
  if (!pat) return showAuthError('Please enter your GitHub Personal Access Token.');
  ghToken = pat;
  sessionStorage.setItem('gh_token', pat);
  loadReview();
});

document.getElementById('pat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('signin-btn').click();
});

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

/* ── Load review data ─────────────────────────────── */
async function loadReview() {
  show('loading-screen');
  try {
    // Verify token + get reviewer identity
    const userRes = await gh('https://api.github.com/user');
    if (!userRes.ok) { show('auth-screen'); return showAuthError('Invalid token — please check and try again.'); }
    reviewer = await userRes.json();

    // Fetch migration manifest from TomTom repo
    const manifestRes = await gh(
      `https://api.github.com/repos/${TOMTOM_OWNER}/${TOMTOM_REPO}/contents/migration/v${VERSION}.json`
    );
    if (!manifestRes.ok) throw new Error(`Migration manifest for v${VERSION} not found in ${TOMTOM_REPO}.`);
    const manifestFile = await manifestRes.json();
    migrationData = JSON.parse(atob(manifestFile.content.replace(/\n/g, '')));

    // Fetch client's current client-theme.json from the PR branch
    try {
      const themeRes = await gh(
        `https://api.github.com/repos/${CLIENT_OWNER}/${CLIENT_REPO}/contents/tokens/client-theme.json?ref=${BRANCH}`
      );
      if (themeRes.ok) {
        const themeFile = await themeRes.json();
        clientTheme = JSON.parse(atob(themeFile.content.replace(/\n/g, '')));
      }
    } catch {
      clientTheme = {}; // New client — no overrides yet
    }

    renderReview();
    show('review-screen');
  } catch (err) {
    document.getElementById('error-message').textContent = err.message;
    show('error-screen');
  }
}

// Auto-load if token already in session and params are present
if (ghToken && VERSION && PR_NUMBER && CLIENT_REPO) loadReview();

/* ── Render review UI ─────────────────────────────── */
function renderReview() {
  const { changes } = migrationData;

  document.getElementById('version-badge').textContent = `v${VERSION}`;
  document.getElementById('client-badge').textContent  = CLIENT_REPO;
  document.getElementById('reviewer-name').textContent = reviewer.login;

  // Summary pills
  const pills = [];
  if (changes.added?.length)      pills.push(`<div class="summary-pill pill-added">● ${changes.added.length} new token${changes.added.length !== 1 ? 's' : ''}</div>`);
  if (changes.renamed?.length)    pills.push(`<div class="summary-pill pill-renamed">● ${changes.renamed.length} renamed</div>`);
  if (changes.deprecated?.length) pills.push(`<div class="summary-pill pill-deprecated">● ${changes.deprecated.length} deprecated</div>`);
  document.getElementById('summary-bar').innerHTML = `<div class="summary-bar">${pills.join('')}</div>`;

  // Sections
  const container = document.getElementById('sections');
  container.innerHTML = '';

  if (changes.added?.length) {
    container.appendChild(
      buildSection('New tokens — assign your values', 'added', 'count-added', changes.added, buildAddedCard)
    );
  }
  if (changes.renamed?.length) {
    container.appendChild(
      buildSection('Renamed tokens — update your references', 'renamed', 'count-renamed', changes.renamed, buildRenamedCard)
    );
  }
  if (changes.deprecated?.length) {
    container.appendChild(
      buildSection('Deprecated tokens — migrate before removal', 'deprecated', 'count-deprecated', changes.deprecated, buildDeprecatedCard)
    );
  }
}

function buildSection(title, type, countClass, items, cardFn) {
  const section = document.createElement('div');
  section.className = 'section';
  section.innerHTML = `
    <div class="section-header">
      <span class="section-title">${title}</span>
      <span class="section-count ${countClass}">${items.length}</span>
    </div>
  `;
  items.forEach(item => section.appendChild(cardFn(item)));
  return section;
}

/* ── Added token card ─────────────────────────────── */
function buildAddedCard(token) {
  const isColor      = token.type === 'color';
  const defaultVal   = displayValue(token.value);
  const existingVal  = clientTheme[token.token]?.value || null;
  const tokenId      = safeId(token.token);

  // Initial decision
  decisions[token.token] = existingVal
    ? { action: 'custom', value: existingVal, type: token.type }
    : { action: 'accept', value: defaultVal,  type: token.type };

  const card = document.createElement('div');
  card.className = 'token-card';
  card.innerHTML = `
    <div class="card-header">
      <div class="token-name">${token.token}</div>
      ${token.description ? `<div class="token-desc">${token.description}</div>` : ''}
    </div>
    <div class="card-body">
      <div class="default-value">
        <span class="default-label">TomTom default</span>
        ${isColor ? `<div class="color-swatch" style="background:${defaultVal}"></div>` : ''}
        <span class="default-val">${defaultVal}</span>
      </div>
      <div class="action-group">
        <button class="action-btn accept-btn ${!existingVal ? 'active' : ''}" data-token="${token.token}" data-action="accept">
          Accept default
        </button>
        <button class="action-btn custom-btn ${existingVal ? 'active' : ''}" data-token="${token.token}" data-action="custom">
          Custom value
        </button>
      </div>
    </div>
    <div class="custom-row ${existingVal ? '' : 'hidden'}" id="custom-row-${tokenId}">
      ${isColor ? `<div class="custom-preview" id="preview-${tokenId}" style="background:${existingVal || defaultVal}"></div>` : ''}
      <input
        class="custom-input"
        type="text"
        placeholder="${isColor ? '#hex or rgba(r,g,b,a)' : 'Enter value'}"
        value="${existingVal || ''}"
        data-token="${token.token}"
        data-type="${token.type}"
      >
    </div>
  `;

  // Action buttons
  card.querySelectorAll('.action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      card.querySelectorAll('.action-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const row = document.getElementById(`custom-row-${tokenId}`);
      if (btn.dataset.action === 'custom') {
        row.classList.remove('hidden');
        decisions[token.token].action = 'custom';
      } else {
        row.classList.add('hidden');
        decisions[token.token] = { action: 'accept', value: defaultVal, type: token.type };
      }
    });
  });

  // Custom input
  const input = card.querySelector('.custom-input');
  if (input) {
    input.addEventListener('input', () => {
      const val = input.value.trim();
      decisions[input.dataset.token] = { action: 'custom', value: val, type: input.dataset.type };
      const preview = document.getElementById(`preview-${tokenId}`);
      if (preview) preview.style.background = val;
    });
  }

  return card;
}

/* ── Renamed token card ───────────────────────────── */
function buildRenamedCard(token) {
  const card = document.createElement('div');
  card.className = 'token-card border-renamed';
  card.innerHTML = `
    <div class="info-row">
      <div class="rename-row">
        <span class="old-token">${token.oldToken}</span>
        <span class="arrow">→</span>
        <span class="new-token">${token.newToken}</span>
      </div>
      <div class="migration-note">${token.migration || 'Value unchanged — update references to the new token name.'}</div>
    </div>
  `;
  return card;
}

/* ── Deprecated token card ────────────────────────── */
function buildDeprecatedCard(token) {
  const card = document.createElement('div');
  card.className = 'token-card border-deprecated';
  card.innerHTML = `
    <div class="info-row">
      <div class="token-name">${token.token}</div>
      <div class="deprecation-warning">
        ⚠ Removed in v${token.removalVersion} — replace with
        <span class="replacement-token">${token.replacedBy}</span>
      </div>
      ${token.migration ? `<div class="migration-note" style="margin-top:6px">${token.migration}</div>` : ''}
    </div>
  `;
  return card;
}

/* ── Submit ───────────────────────────────────────── */
document.getElementById('submit-btn').addEventListener('click', submitReview);

async function submitReview() {
  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  btn.textContent = 'Submitting…';

  try {
    // Build updated client-theme: merge existing overrides with new decisions
    const newTheme = { ...clientTheme };

    for (const [tokenName, decision] of Object.entries(decisions)) {
      if (decision.action === 'custom' && decision.value) {
        newTheme[tokenName] = { value: decision.value, type: decision.type };
      } else if (decision.action === 'accept') {
        // Remove override — let it resolve from tomtom-base
        delete newTheme[tokenName];
      }
    }

    // Get current SHA (needed for file update)
    let sha = null;
    const existingRes = await gh(
      `https://api.github.com/repos/${CLIENT_OWNER}/${CLIENT_REPO}/contents/tokens/client-theme.json?ref=${BRANCH}`
    );
    if (existingRes.ok) {
      sha = (await existingRes.json()).sha;
    }

    // Commit updated client-theme.json to the PR branch
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(newTheme, null, 2))));
    const commitRes = await gh(
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
    if (!commitRes.ok) {
      const err = await commitRes.json();
      throw new Error(err.message || 'Failed to commit client-theme.json');
    }

    // Post summary comment on the PR
    const accepted = Object.values(decisions).filter(d => d.action === 'accept').length;
    const custom   = Object.values(decisions).filter(d => d.action === 'custom' && d.value).length;

    await gh(
      `https://api.github.com/repos/${CLIENT_OWNER}/${CLIENT_REPO}/issues/${PR_NUMBER}/comments`,
      {
        method: 'POST',
        body: JSON.stringify({
          body:
            `✅ **Token review complete** — by @${reviewer.login}\n\n` +
            `| Decision | Count |\n|---|---|\n` +
            `| Accepted TomTom default | ${accepted} |\n` +
            `| Set custom value | ${custom} |\n\n` +
            `\`client-theme.json\` has been updated on this branch. ` +
            `Merge the PR and pull from Token Studio to sync.`
        })
      }
    );

    // Done screen
    document.getElementById('done-message').textContent =
      `${accepted + custom} tokens reviewed. The PR branch is updated — merge it, then pull in Token Studio.`;
    document.getElementById('pr-link').href =
      `https://github.com/${CLIENT_OWNER}/${CLIENT_REPO}/pull/${PR_NUMBER}`;
    show('done-screen');

  } catch (err) {
    document.getElementById('error-message').textContent = err.message;
    show('error-screen');
  }
}

/* ── Helpers ──────────────────────────────────────── */
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

// Strip Token Studio alias syntax for display: {Group.token_name} → token_name
function displayValue(val) {
  if (!val) return '';
  if (val.startsWith('{') && val.endsWith('}')) return val;
  return val;
}

function safeId(name) {
  return name.replace(/[^a-zA-Z0-9]/g, '_');
}
