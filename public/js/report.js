(function () {
  var kind = 'bug';
  var kindBug = document.getElementById('kind-bug');
  var kindFb = document.getElementById('kind-feedback');

  function api(path, opts) {
    return fetch(path, Object.assign({ credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' } }, opts || {}));
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtTs(ts) {
    try {
      return new Date(Number(ts)).toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit'
      });
    } catch (e) { return ''; }
  }

  kindBug.addEventListener('click', function () {
    kind = 'bug';
    kindBug.classList.add('active'); kindFb.classList.remove('active');
  });
  kindFb.addEventListener('click', function () {
    kind = 'feedback';
    kindFb.classList.add('active'); kindBug.classList.remove('active');
  });

  function renderMine(reports) {
    var list = document.getElementById('mine-list');
    if (!reports.length) {
      list.innerHTML = '<div class="empty">No reports yet — yours will show up here.</div>';
      return;
    }
    list.innerHTML = reports.map(function (r) {
      var updated = (r.updated_at && r.updated_at !== r.created_at)
        ? ' · updated ' + fmtTs(r.updated_at) : '';
      return '<div class="rep">' +
        '<div class="rep-head"><span class="rep-title">' + esc(r.title) + '</span>' +
        '<span class="badge st-' + esc(r.status) + '">' + esc(r.status) + '</span></div>' +
        '<div class="rep-kind">' + (r.kind === 'bug' ? '🐞 Bug' : '💬 Feedback') + '</div>' +
        '<div class="rep-body">' + esc(r.body) + '</div>' +
        '<div class="rep-ts">Sent ' + fmtTs(r.created_at) + updated + '</div>' +
        '</div>';
    }).join('');
  }

  function loadMine() {
    api('/api/report/mine').then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok) renderMine(j.reports || []);
    }).catch(function () {});
  }

  document.getElementById('send-btn').addEventListener('click', function () {
    var errEl = document.getElementById('form-err');
    var okEl = document.getElementById('form-ok');
    errEl.textContent = ''; okEl.textContent = '';
    var title = document.getElementById('f-title').value.trim();
    var body = document.getElementById('f-body').value.trim();
    if (!title) { errEl.textContent = 'Give your report a title.'; return; }
    if (!body) { errEl.textContent = 'Add some details.'; return; }
    var btn = this; btn.disabled = true;
    api('/api/report', { method: 'POST', body: JSON.stringify({ kind: kind, title: title, body: body }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) { errEl.textContent = (res.j && res.j.error) || 'Could not send.'; return; }
        document.getElementById('f-title').value = '';
        document.getElementById('f-body').value = '';
        okEl.textContent = 'Report sent — thank you!';
        loadMine();
      })
      .catch(function () { btn.disabled = false; errEl.textContent = 'Could not reach server.'; });
  });

  // Signed-in players only. The game and this page share the same session.
  function showForm(username) {
    document.getElementById('who').textContent = 'Signed in as ' + username;
    document.getElementById('signin-pane').classList.add('hidden');
    document.getElementById('form-pane').classList.remove('hidden');
    loadMine();
  }

  document.getElementById('signin-btn').addEventListener('click', function () {
    var errEl = document.getElementById('signin-err');
    errEl.textContent = '';
    var u = document.getElementById('ru').value.trim();
    var p = document.getElementById('rp').value;
    if (!u || !p) { errEl.textContent = 'Enter username and password.'; return; }
    var btn = this; btn.disabled = true;
    api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok || !res.j || !res.j.user) {
          errEl.textContent = (res.j && res.j.error) || 'Sign-in failed.';
          return;
        }
        showForm(res.j.user.username || u);
      })
      .catch(function () { btn.disabled = false; errEl.textContent = 'Could not reach server.'; });
  });
  document.getElementById('rp').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') document.getElementById('signin-btn').click();
  });

  api('/api/auth/me').then(function (r) { return r.ok ? r.json() : null; }).then(function (me) {
    if (me && me.user) {
      showForm(me.user.username);
    }
  }).catch(function () {});
})();
