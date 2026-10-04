(function () {
  var loginPane = document.getElementById('login-pane');
  var opsPane = document.getElementById('ops-pane');
  var loginErr = document.getElementById('login-err');
  var opsErr = document.getElementById('ops-err');
  var statusEl = document.getElementById('status');
  var msgEl = document.getElementById('cur-msg');
  var toggleBtn = document.getElementById('toggle-btn');
  var msgInput = document.getElementById('nm');
  var current = null;

  function api(path, opts) {
    return fetch(path, Object.assign({ credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' } }, opts || {}));
  }

  function refresh() {
    opsErr.textContent = '';
    api('/api/status').then(function (r) { return r.json(); }).then(function (st) {
      current = !!(st && st.maintenance);
      statusEl.innerHTML = 'Maintenance is <span class="' + (current ? 'on">ON' : 'off">OFF') + '</span>';
      msgEl.textContent = (st && st.message) ? '“' + st.message + '”' : '';
      if (!msgInput.value && st && st.message) msgInput.value = st.message;
      toggleBtn.textContent = current ? 'Turn maintenance OFF' : 'Turn maintenance ON';
      toggleBtn.className = current ? 'go' : 'danger';
      // Scheduled window: show the live countdown and offer cancel.
      var schedStatus = document.getElementById('sched-status');
      var schedCancel = document.getElementById('sched-cancel');
      var minsLeft = (st && !st.maintenance && st.maintenanceIn != null && st.maintenanceIn > 0)
        ? Math.ceil(st.maintenanceIn / 60) : 0;
      if (minsLeft > 0) {
        schedStatus.innerHTML = 'Goes live in <span class="on">' + minsLeft + ' min</span> — players see a countdown.';
        schedCancel.classList.remove('hidden');
      } else {
        schedStatus.textContent = '';
        schedCancel.classList.add('hidden');
      }
    }).catch(function () { statusEl.textContent = 'Could not reach server.'; });
  }
  document.getElementById('sched-btn').addEventListener('click', function () {
    opsErr.textContent = '';
    var mins = Math.min(Math.max(parseInt(document.getElementById('sched-min').value, 10) || 0, 1), 180);
    var btn = this; btn.disabled = true;
    api('/api/gm/maintenance', {
      method: 'POST',
      body: JSON.stringify({ enabled: true, message: msgInput.value.trim(), delayMinutes: mins })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) { opsErr.textContent = (res.j && res.j.error) || 'Schedule failed.'; return; }
        refresh();
      })
      .catch(function () { btn.disabled = false; opsErr.textContent = 'Could not reach server.'; });
  });
  document.getElementById('sched-cancel').addEventListener('click', function () {
    opsErr.textContent = '';
    var btn = this; btn.disabled = true;
    api('/api/gm/maintenance', {
      method: 'POST',
      body: JSON.stringify({ enabled: false, message: msgInput.value.trim() })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) { opsErr.textContent = (res.j && res.j.error) || 'Cancel failed.'; return; }
        refresh();
      })
      .catch(function () { btn.disabled = false; opsErr.textContent = 'Could not reach server.'; });
  });

  document.getElementById('login-btn').addEventListener('click', function () {
    loginErr.textContent = '';
    var u = document.getElementById('mu').value.trim();
    var p = document.getElementById('mp').value;
    if (!u || !p) { loginErr.textContent = 'Enter username and password.'; return; }
    this.disabled = true;
    var btn = this;
    api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) { loginErr.textContent = (res.j && res.j.error) || 'Login failed.'; return; }
        return api('/api/auth/me').then(function (r) { return r.json(); }).then(function (me) {
          var role = me && me.user && me.user.role;
          if (role !== 'owner' && role !== 'admin') {
            loginErr.textContent = 'This page is for owners and admins only.';
            api('/api/auth/logout', { method: 'POST' });
            return;
          }
          document.getElementById('who').textContent =
            'Signed in as ' + (me.user.username || u) + ' (' + role + ')';
          loginPane.classList.add('hidden');
          opsPane.classList.remove('hidden');
          refresh();
        });
      })
      .catch(function () { btn.disabled = false; loginErr.textContent = 'Could not reach server.'; });
  });

  document.getElementById('mp').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') document.getElementById('login-btn').click();
  });

  toggleBtn.addEventListener('click', function () {
    opsErr.textContent = '';
    this.disabled = true;
    var btn = this;
    api('/api/gm/maintenance', {
      method: 'POST',
      body: JSON.stringify({ enabled: !current, message: msgInput.value.trim() })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) { opsErr.textContent = (res.j && res.j.error) || 'Toggle failed.'; return; }
        refresh();
      })
      .catch(function () { btn.disabled = false; opsErr.textContent = 'Could not reach server.'; });
  });

  // If already signed in as staff, skip the login form.
  api('/api/auth/me').then(function (r) { return r.ok ? r.json() : null; }).then(function (me) {
    var role = me && me.user && me.user.role;
    if (role === 'owner' || role === 'admin') {
      document.getElementById('who').textContent =
        'Signed in as ' + (me.user.username || '') + ' (' + role + ')';
      loginPane.classList.add('hidden');
      opsPane.classList.remove('hidden');
      refresh();
    }
  }).catch(function () {});
})();
