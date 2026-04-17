'use strict';

// ── Configuration ─────────────────────────────────────────────────────────────
const OWNER      = 'VolkanUysal-TomTom';
const REPO       = 'TomtomTest';
const CLIENT_ID  = 'Ov23liEnfBzfWKcryH7j';
const SCOPE      = 'repo workflow';
const CALLBACK   = 'https://volkanuysal-tomtom.github.io/TomtomTest/release.html';

// Set this to your Cloudflare Worker URL after deploying oauth-proxy.js
// It will look like: https://tomtom-oauth-proxy.YOUR-ACCOUNT.workers.dev
const WORKER_URL = 'https://plain-wave-5669.volkan-uysal.workers.dev';

// ── State ─────────────────────────────────────────────────────────────────────
let token      = null;
let lastTag    = null;
let clients    = [];

// ── GitHub API helper ──────────────────────────────────────────────────────────
async function gh(path, opts = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API error ${res.status}`);
  }
  return res.json();
}

// ── Auth ───────────────────────────────────────────────────────────────────────
async function init() {
  const params = new URLSearchParams(location.search);
  const code   = params.get('code');

  if (code) {
    // OAuth callback — exchange code for token
    history.replaceState({}, '', location.pathname);
    showScreen('loading');
    setLoadingLabel('Signing in with GitHub…');
    try {
      token = await exchangeCode(code);
      sessionStorage.setItem('gh_token', token);
    } catch (e) {
      showScreen('auth');
      showAuthError('Sign-in failed: ' + e.message);
      return;
    }
  } else {
    token = sessionStorage.getItem('gh_token');
  }

  if (!token) {
    showScreen('auth');
    return;
  }

  showScreen('loading');
  setLoadingLabel('Loading release info…');
  try {
    await loadData();
    showScreen('release');
  } catch (e) {
    // Token likely expired
    sessionStorage.removeItem('gh_token');
    showScreen('auth');
    showAuthError('Session expired — please sign in again.');
  }
}

async function exchangeCode(code) {
  if (WORKER_URL.startsWith('REPLACE')) {
    throw new Error('Cloudflare Worker URL not configured in release.js');
  }
  const res = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error('Worker returned ' + res.status);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  if (!data.access_token) throw new Error('No access token in response');
  return data.access_token;
}

function startOAuth() {
  const url = 'https://github.com/login/oauth/authorize' +
    `?client_id=${CLIENT_ID}` +
    `&scope=${encodeURIComponent(SCOPE)}` +
    `&redirect_uri=${encodeURIComponent(CALLBACK)}`;
  location.href = url;
}

// ── Load data ──────────────────────────────────────────────────────────────────
async function loadData() {
  // Fetch user, latest release, and clients list in parallel
  const [me, latestRelease, clientsRaw] = await Promise.all([
    gh('/user'),
    gh(`/repos/${OWNER}/${REPO}/releases/latest`).catch(() => null),
    fetch(`https://raw.githubusercontent.com/${OWNER}/${REPO}/main/clients.json`)
      .then(r => r.json()),
  ]);

  // User info
  const avatar = document.getElementById('avatar');
  avatar.src = me.avatar_url;
  avatar.style.display = 'block';
  document.getElementById('username').textContent = me.login;

  // Clients
  clients = clientsRaw;
  renderClients();

  // Last release
  lastTag = latestRelease?.tag_name || null;
  document.getElementById('last-version-chip').textContent = lastTag || 'No releases yet';
  document.getElementById('since-label').textContent = lastTag ? lastTag : 'the beginning';

  // Suggest next minor version
  if (lastTag) {
    const parts = lastTag.replace('v', '').split('.').map(Number);
    parts[1] += 1;
    parts[2] = 0;
    document.getElementById('version-input').placeholder = parts.join('.');
  }

  // Commits since last release
  await loadCommits();
}

async function loadCommits() {
  const commitsList = document.getElementById('commits-list');

  if (!lastTag) {
    commitsList.innerHTML = '<div class="commits-empty">No previous release — all current tokens will be the baseline.</div>';
    return;
  }

  try {
    const compare = await gh(`/repos/${OWNER}/${REPO}/compare/${lastTag}...main`);
    const commits = compare.commits
      .filter(c => !c.commit.message.startsWith('chore: add migration'))
      .reverse(); // Most recent first

    if (commits.length === 0) {
      commitsList.innerHTML = '<div class="commits-empty">No new commits since ' + esc(lastTag) + '.</div>';
      return;
    }

    commitsList.innerHTML = commits.map(c => {
      const msg  = c.commit.message.split('\n')[0];
      const sha  = c.sha.slice(0, 7);
      const date = new Date(c.commit.author.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      return `<div class="commit-row">
        <span class="commit-msg">${esc(msg)}</span>
        <span class="commit-meta">${sha} · ${date}</span>
      </div>`;
    }).join('');
  } catch (e) {
    commitsList.innerHTML = '<div class="commits-empty">Could not load commits.</div>';
  }
}

function renderClients() {
  const list = document.getElementById('clients-list');
  if (!clients.length) {
    list.innerHTML = '<div class="commits-empty">No clients registered in clients.json.</div>';
    return;
  }
  list.innerHTML = clients.map(c => `
    <div class="client-row">
      <span class="client-check">✓</span>
      <span class="client-name">${esc(c.name)}</span>
      <span class="client-repo">${esc(c.owner)}/${esc(c.repo)}</span>
    </div>`).join('');

  // Update dispatch step label
  const n = clients.length;
  document.getElementById('step-dispatch-label').textContent =
    `Dispatching to ${n} client${n !== 1 ? 's' : ''}`;
}

// ── Release ────────────────────────────────────────────────────────────────────
async function triggerRelease() {
  const versionInput = document.getElementById('version-input');
  const version = versionInput.value.trim();
  const notes   = document.getElementById('notes-input').value.trim();

  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    versionInput.classList.add('input-error');
    versionInput.focus();
    return;
  }

  // Switch to progress screen
  document.getElementById('progress-version').textContent = version;
  document.getElementById('success-version').textContent  = version;
  document.getElementById('actions-link').href =
    `https://github.com/${OWNER}/${REPO}/actions`;
  showScreen('progress');
  setStep('manifest', 'running');
  setStep('release',  'pending');
  setStep('dispatch', 'pending');

  // Timestamp before dispatch — used to find the right workflow run
  const beforeDispatch = new Date();

  try {
    await gh(`/repos/${OWNER}/${REPO}/actions/workflows/release.yml/dispatches`, {
      method: 'POST',
      body: { ref: 'main', inputs: { version, release_notes: notes } },
    });
  } catch (e) {
    setStep('manifest', 'error', 'Failed to trigger workflow: ' + e.message);
    showProgressError('Could not start the release workflow. Do you have "workflow" OAuth scope?');
    return;
  }

  await pollRun(version, beforeDispatch);
}

async function pollRun(version, afterTime) {
  const TIMEOUT = 6 * 60 * 1000; // 6 min
  const start   = Date.now();
  let   runId   = null;

  // ── Phase 1: find the run ────────────────────────────────────────────────
  while (!runId && Date.now() - start < TIMEOUT) {
    await sleep(3000);
    try {
      const data = await gh(
        `/repos/${OWNER}/${REPO}/actions/runs?event=workflow_dispatch&per_page=10`
      );
      const run = data.workflow_runs.find(
        r => new Date(r.created_at) >= afterTime
      );
      if (run) runId = run.id;
    } catch { /* retry */ }
  }

  if (!runId) {
    setStep('manifest', 'error', 'Workflow did not start. Check Actions tab.');
    showProgressError('The release workflow did not appear. Check the Actions tab on GitHub.');
    showProgressActions();
    return;
  }

  // ── Phase 2: poll until complete ─────────────────────────────────────────
  let lastStatus = '';
  while (Date.now() - start < TIMEOUT) {
    await sleep(4000);
    try {
      const run = await gh(`/repos/${OWNER}/${REPO}/actions/runs/${runId}`);

      if (run.status !== lastStatus) {
        lastStatus = run.status;
        if (run.status === 'in_progress') {
          setStep('manifest', 'running', 'Generating manifest…');
          setStep('release',  'running', 'Creating GitHub Release…');
        }
      }

      if (run.status === 'completed') {
        if (run.conclusion === 'success') {
          setStep('manifest', 'done', 'Manifest generated & committed');
          setStep('release',  'done', `Release v${version} created on GitHub`);
          setStep('dispatch', 'done', `Dispatched to ${clients.length} client${clients.length !== 1 ? 's' : ''}`);
          document.getElementById('success-box').classList.remove('hidden');
        } else {
          setStep('manifest', 'error', `Workflow ${run.conclusion}`);
          showProgressError(`The release workflow ended with: ${run.conclusion}. Check the Actions tab for details.`);
        }
        showProgressActions();
        return;
      }
    } catch { /* retry */ }
  }

  showProgressError('Timed out waiting for the workflow. Check the Actions tab.');
  showProgressActions();
}

// ── UI Helpers ─────────────────────────────────────────────────────────────────
function showScreen(name) {
  ['auth', 'loading', 'release', 'progress'].forEach(id => {
    document.getElementById(`${id}-screen`).classList.toggle('hidden', id !== name);
  });
}

function setLoadingLabel(msg) {
  document.getElementById('loading-label').textContent = msg;
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function setStep(id, status, label) {
  const el = document.getElementById(`step-${id}`);
  if (!el) return;
  el.className = `p-step step-${status}`;
  const icons = { pending: '○', running: '<span class="step-spinner"></span>', done: '✓', error: '✕' };
  el.querySelector('.step-icon').innerHTML = icons[status] || '○';
  if (label) el.querySelector('.step-label').textContent = label;
}

function showProgressError(msg) {
  const el = document.getElementById('progress-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function showProgressActions() {
  const el = document.getElementById('progress-actions');
  el.classList.remove('hidden');
  el.style.display = 'flex';
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Event listeners ────────────────────────────────────────────────────────────
document.getElementById('signin-btn').addEventListener('click', startOAuth);
document.getElementById('release-btn').addEventListener('click', triggerRelease);
document.getElementById('version-input').addEventListener('input', () => {
  document.getElementById('version-input').classList.remove('input-error');
});
document.getElementById('release-another-btn').addEventListener('click', () => {
  // Reset form and go back to release screen
  document.getElementById('version-input').value = '';
  document.getElementById('notes-input').value = '';
  document.getElementById('success-box').classList.add('hidden');
  document.getElementById('progress-error').classList.add('hidden');
  document.getElementById('progress-actions').style.display = 'none';
  document.getElementById('progress-actions').classList.add('hidden');
  showScreen('loading');
  setLoadingLabel('Refreshing…');
  loadData().then(() => showScreen('release')).catch(() => {
    sessionStorage.removeItem('gh_token');
    showScreen('auth');
  });
});

// ── Boot ───────────────────────────────────────────────────────────────────────
init();
