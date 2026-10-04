(function() {
  const $ = (id) => document.getElementById(id);
  const api = async (path, opts) => {
    const r = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...opts });
    return r.json().then(j => ({ ok: r.ok, j }));
  };
  function bind(id, handler) {
    const el = document.getElementById(id);
    if (el && !el.dataset.wired) { el.dataset.wired = '1'; el.addEventListener('click', handler); }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function setErr(id, msg, isOk) {
    const el = $(id);
    if (el) { el.textContent = msg; el.style.color = isOk ? '#4f4' : '#f66'; }
  }

  // Tabs
  document.querySelectorAll('.staff-tab-btn').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.staff-tab-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    document.querySelectorAll('.staff-tab-pane').forEach(p => p.classList.add('hidden'));
    const pane = $('tab-' + b.dataset.tab);
    if (pane) pane.classList.remove('hidden');
    const tab = b.dataset.tab;
    if (tab === 'audit') loadAudit();
    if (tab === 'bugs') loadReports('bug', 'bugs-list');
    if (tab === 'feedback') loadReports('feedback', 'feedback-list');
    if (tab === 'ideas') loadIdeas();
  }));

  // Login
  async function doLogin() {
    $('login-err').textContent = '';
    const { ok, j } = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: $('login-user').value.trim(), password: $('login-pass').value }) });
    if (!ok || !j.user) { $('login-err').textContent = (j && j.error) || 'Login failed.'; return; }
    const me = await api('/api/auth/me').then(r => r.j.user || r.j);
    const role = (me && me.role) || '';
    if (!['owner', 'admin', 'gm'].includes(role)) {
      $('login-err').textContent = '⛔ Staff only. Your role: ' + (role || 'unknown');
      return;
    }
    $('login-pane').classList.add('hidden');
    $('staff-pane').classList.remove('hidden');
    $('staff-who').textContent = 'Signed in as ' + me.username + ' (' + role + ')';
    loadAudit();
  }
  bind('login-btn', doLogin);
  $('login-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  $('login-user').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

  // Audit Log
  async function loadAudit() {
    const body = $('audit-body');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="5" class="timestamp">Loading...</td></tr>';
    const { ok, j } = await api('/api/gm/audit');
    const entries = (ok && j.entries) || [];
    const filter = (($('audit-filter') || {}).value || '').toLowerCase();
    const type = ($('audit-type') || {}).value || 'all';
    const filtered = entries.filter(e => {
      if (type !== 'all' && !String(e.action || '').toLowerCase().includes(type)) return false;
      if (filter && !JSON.stringify(e).toLowerCase().includes(filter)) return false;
      return true;
    });
    if (!filtered.length) { body.innerHTML = '<tr><td colspan="5" class="timestamp">No entries.</td></tr>'; return; }
    body.innerHTML = filtered.slice(0, 100).map(e => {
      const action = esc(e.action || '');
      const badgeClass = /ban|kick|mute/i.test(action) ? 'danger' : /give|grant/i.test(action) ? 'warning' : 'info';
      return '<tr>' +
        '<td class="timestamp">' + esc(new Date(Number(e.ts) || Date.now()).toLocaleString()) + '</td>' +
        '<td class="highlight-gold">' + esc(e.actor) + '</td>' +
        '<td><span class="badge ' + badgeClass + '">' + action + '</span></td>' +
        '<td>' + esc(e.target || '-') + '</td>' +
        '<td>' + esc(e.detail || '') + '</td>' +
        '</tr>';
    }).join('');
  }
  if ($('audit-filter')) $('audit-filter').addEventListener('input', loadAudit);
  if ($('audit-type')) $('audit-type').addEventListener('change', loadAudit);

  // Reports (bugs/feedback)
  async function loadReports(kind, listId) {
    const list = $(listId);
    if (!list) return;
    list.innerHTML = '<div class="timestamp">Loading...</div>';
    const { ok, j } = await api('/api/gm/reports?kind=' + kind);
    const reports = (ok && j.reports) || [];
    if (!reports.length) { list.innerHTML = '<div class="timestamp">No ' + kind + ' reports.</div>'; return; }
    list.innerHTML = reports.map(r => {
      const prio = r.priority === 'high' ? 'danger' : r.priority === 'medium' ? 'warning' : 'info';
      return '<div class="inbox-card">' +
        '<div class="inbox-card-header">' +
          '<span class="inbox-author">Reporter: ' + esc(r.username || r.reporter || 'Unknown') + '</span>' +
          (r.priority ? '<span class="badge ' + prio + '">' + esc(r.priority) + '</span>' : '') +
        '</div>' +
        '<p class="inbox-body-text">' + esc(r.text || r.body || r.message || '') + '</p>' +
        '<div class="inbox-actions">' +
          '<button class="staff-btn small success" data-resolve="' + esc(r.id) + '" data-kind="' + kind + '">Mark Resolved</button>' +
        '</div>' +
      '</div>';
    }).join('');
    // Wire resolve buttons
    list.querySelectorAll('[data-resolve]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.resolve;
        const k = btn.dataset.kind;
        const { ok } = await api('/api/gm/reports/' + id, { method: 'PATCH', body: JSON.stringify({ status: 'fixed' }) });
        if (ok) loadReports(k, listId);
      });
    });
  }

  // Ideas
  async function loadIdeas() {
    const list = $('ideas-list');
    if (!list) return;
    list.innerHTML = '<div class="timestamp">Loading...</div>';
    const { ok, j } = await api('/api/gm/ideas');
    const ideas = (ok && j.ideas) || [];
    if (!ideas.length) { list.innerHTML = '<div class="timestamp">No ideas yet.</div>'; return; }
    list.innerHTML = ideas.map(r => {
      return '<div class="inbox-card">' +
        '<div class="inbox-card-header">' +
          '<span class="inbox-author">Idea by: ' + esc(r.username || 'Unknown') + '</span>' +
          '<span class="badge gold">👍 ' + (r.votes || 0) + ' Votes</span>' +
        '</div>' +
        '<p class="inbox-body-text">' + esc(r.text || r.title || '') + '</p>' +
      '</div>';
    }).join('');
  }

  // ID Reference Search
  if ($('id-search')) {
    $('id-search').addEventListener('input', async () => {
      const q = $('id-search').value.trim().toLowerCase();
      const results = $('id-results');
      if (!q || q.length < 2) { results.innerHTML = ''; return; }
      // Search via players endpoint for item/pet IDs (fallback to static)
      results.innerHTML = '<div class="timestamp">Searching...</div>';
      // For now, show a simple message - full ID search needs backend endpoint
      results.innerHTML = '<div class="sub-panel"><p class="timestamp">ID search for "' + esc(q) + '" — use the GM console ID sidebar for full lookup.</p></div>';
    });
  }

  // Player Inspector
  let inspectedUser = null;
  bind('inspect-btn', async () => {
    const u = (($('inspect-search') || {}).value || '').trim();
    if (!u) { setErr('inspect-err', '❌ Enter a username.'); return; }
    setErr('inspect-err', 'Inspecting...');
    const { ok, j } = await api('/api/gm/inspect', { method: 'POST', body: JSON.stringify({ username: u }) });
    if (!ok) { setErr('inspect-err', '❌ ' + ((j && j.error) || 'Not found')); $('inspect-result').innerHTML = ''; return; }
    const d = j.data || j;
    inspectedUser = d.username || u;
    $('inspect-result').innerHTML =
      '<div class="sub-panel margin-top">' +
      '<h3 class="panel-subtitle">' + esc(inspectedUser) + '</h3>' +
      '<div class="stat-row"><span>Level</span><span class="highlight-gold">' + esc(d.level || 1) + '</span></div>' +
      '<div class="stat-row"><span>Gold</span><span class="highlight-gold">' + esc(d.gold || 0) + '</span></div>' +
      '<div class="stat-row"><span>Stage</span><span class="highlight-gold">' + esc(d.stage || 1) + '</span></div>' +
      '<div class="stat-row"><span>Rebirths</span><span class="highlight-gold">' + esc(d.rebirthCount || 0) + '</span></div>' +
      '<div class="stat-row"><span>Role</span><span class="highlight-gold">' + esc(d.role || 'player') + '</span></div>' +
      '</div>';
    setErr('inspect-err', '✅ Found ' + inspectedUser, true);
  });

  // Moderation actions (use existing gm endpoints where available)
  bind('mod-mute-btn', async () => {
    if (!inspectedUser) { setErr('mod-err', '❌ Inspect a player first.'); return; }
    setErr('mod-err', 'Mute action — use in-game GM console for chat mute.');
  });
  bind('mod-kick-btn', async () => {
    if (!inspectedUser) { setErr('mod-err', '❌ Inspect a player first.'); return; }
    if (!confirm('Kick ' + inspectedUser + '?')) return;
    setErr('mod-err', 'Kick action — use in-game GM console.');
  });
  bind('mod-ban-btn', async () => {
    if (!inspectedUser) { setErr('mod-err', '❌ Inspect a player first.'); return; }
    if (!confirm('Temp ban ' + inspectedUser + ' for 24h?')) return;
    setErr('mod-err', 'Ban action — use in-game GM console.');
  });
})();
