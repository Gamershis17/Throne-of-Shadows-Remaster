(function() {
  const $ = (id) => document.getElementById(id);
  const api = async (path, opts) => {
    const r = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...opts });
    return r.json().then(j => ({ ok: r.ok, j }));
  };
  // Global bind helper
  function bind(id, handler) {
    const el = document.getElementById(id);
    if (el && !el.dataset.wired) { el.dataset.wired = '1'; el.addEventListener('click', handler); }
  }

  // Clock
  setInterval(() => { const c = $('owner-clock'); if (c) c.textContent = new Date().toLocaleString(); }, 1000);

  // Tabs
  document.querySelectorAll('.owner-tab-btn').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.owner-tab-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    document.querySelectorAll('.owner-tab-pane').forEach(p => p.classList.add('hidden'));
    const pane = $('tab-' + b.dataset.tab);
    if (pane) pane.classList.remove('hidden');
  }));

  // Login
  async function doLogin() {
    $('login-err').textContent = '';
    const { ok, j } = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: $('login-user').value.trim(), password: $('login-pass').value }) });
    if (!ok || !j.user) { $('login-err').textContent = (j && j.error) || 'Login failed.'; return; }
    const me = await api('/api/auth/me').then(r => r.j.user || r.j);
    if (!me || me.role !== 'owner') {
      $('login-err').textContent = '⛔ Owner only. Your role: ' + ((me && me.role) || 'unknown');
      return;
    }
    $('login-pane').classList.add('hidden');
    $('owner-pane').classList.remove('hidden');
    $('owner-who').textContent = 'Signed in as ' + me.username + ' (owner)';
  }
  bind('login-btn', doLogin);
  $('login-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  $('login-user').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

  // Helper for error display
  function setErr(id, msg, isOk) {
    const el = $(id);
    if (el) {
      el.textContent = msg;
      el.style.color = isOk ? '#4f4' : '#f66';
    }
  }
  const getUser = (id) => (($(id) || {}).value || '').trim();

  // Player Search & Inspect
  bind('btn-search-player', async () => {
    const u = getUser('player-search-input');
    if (!u) { setErr('search-err', '❌ Enter a username.'); return; }
    setErr('search-err', 'Searching...');
    try {
      const r = await fetch('/api/gm/inspect', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr('search-err', `❌ Search failed (HTTP ${r.status}): ${j.error || 'Unknown error'}`); return; }
      const d = j.dossier || j.data || j;
      if (!d || !d.username) { setErr('search-err', '❌ No player data returned.'); return; }
      $('search-result-card').classList.remove('hidden');
      $('target-name').textContent = d.username || u;
      $('target-level').textContent = 'Lv ' + (d.level || 1) + ' / ' + (d.xp || 0) + ' XP';
      $('target-rebirths').textContent = d.rebirthCount || 0;
      $('target-gold').textContent = d.gold || 0;
      $('target-stage').textContent = d.stage || 1;
      // Also fill the powers username
      if ($('pow-user')) $('pow-user').value = d.username || u;
      if ($('forge-user')) $('forge-user').value = d.username || u;
      setErr('search-err', '✅ Found ' + (d.username || u), true);
    } catch (e) {
      setErr('search-err', '❌ Network error: ' + e.message);
    }
  });

  // Powers: Give Gold
  bind('pow-gold-btn', async () => {
    const u = getUser('pow-user');
    const amt = parseInt(($('pow-gold') || {}).value) || 0;
    if (!u || !amt) { setErr('powers-err', '❌ Enter username and amount.'); return; }
    const { ok, j } = await api('/api/gm/set-gold', { method: 'POST', body: JSON.stringify({ username: u, amount: amt }) });
    setErr('powers-err', ok ? `✅ Gave ${amt} gold to ${u}` : '❌ ' + ((j && j.error) || 'failed'), ok);
  });

  // Powers: Set Level & XP
  bind('pow-level-btn', async () => {
    const u = getUser('pow-user');
    const lvl = Math.floor(Number(($('pow-level') || {}).value));
    const xp = Math.floor(Number(($('pow-xp') || {}).value)) || 0;
    if (!u || !lvl) { setErr('powers-err', '❌ Enter username and level.'); return; }
    const { ok, j } = await api('/api/gm/set-level', { method: 'POST', body: JSON.stringify({ username: u, level: lvl }) });
    if (ok && xp > 0) {
      await api('/api/gm/set-xp', { method: 'POST', body: JSON.stringify({ username: u, xp }) });
    }
    setErr('powers-err', ok ? `✅ Set ${u} to level ${lvl}` : '❌ ' + ((j && j.error) || 'failed'), ok);
  });

  // Powers: Set Rebirth
  bind('pow-rebirth-btn', async () => {
    const u = getUser('pow-user');
    const rb = Math.floor(Number(($('pow-rebirth') || {}).value));
    if (!u || isNaN(rb)) { setErr('powers-err', '❌ Enter username and rebirth count.'); return; }
    const { ok, j } = await api('/api/gm/set-rebirth', { method: 'POST', body: JSON.stringify({ username: u, rebirths: rb }) });
    setErr('powers-err', ok ? `✅ Set ${u} rebirths to ${rb}` : '❌ ' + ((j && j.error) || 'failed'), ok);
  });

  // Powers: Set Stage
  bind('pow-stage-btn', async () => {
    const u = getUser('pow-user');
    const st = Math.floor(Number(($('pow-stage') || {}).value));
    if (!u || !st) { setErr('powers-err', '❌ Enter username and stage.'); return; }
    const { ok, j } = await api('/api/gm/set-stage', { method: 'POST', body: JSON.stringify({ username: u, stage: st }) });
    setErr('powers-err', ok ? `✅ Set ${u} to stage ${st}` : '❌ ' + ((j && j.error) || 'failed'), ok);
  });

  // Powers: Heal
  bind('pow-heal-btn', async () => {
    const u = getUser('pow-user');
    if (!u) { setErr('powers-err', '❌ Enter username.'); return; }
    const { ok, j } = await api('/api/gm/heal', { method: 'POST', body: JSON.stringify({ username: u }) });
    setErr('powers-err', ok ? `✅ Healed ${u}` : '❌ ' + ((j && j.error) || 'failed'), ok);
  });

  // Powers: Grant Buff
  bind('pow-buff-btn', async () => {
    const u = getUser('pow-user');
    if (!u) { setErr('powers-err', '❌ Enter username.'); return; }
    const { ok, j } = await api('/api/gm/grant-buff', { method: 'POST', body: JSON.stringify({ username: u, buffType: 'damage', value: 100, duration: 3600 }) });
    setErr('powers-err', ok ? `✅ Granted god-buff to ${u}` : '❌ ' + ((j && j.error) || 'failed'), ok);
  });

  // Powers: Clear Inventory
  bind('pow-clear-btn', async () => {
    const u = getUser('pow-user');
    if (!u) { setErr('powers-err', '❌ Enter username.'); return; }
    if (!confirm(`Clear ${u}'s inventory?`)) return;
    const { ok, j } = await api('/api/gm/clear-bags', { method: 'POST', body: JSON.stringify({ username: u }) });
    setErr('powers-err', ok ? `✅ Cleared ${u}'s inventory` : '❌ ' + ((j && j.error) || 'failed'), ok);
  });

  // Stage Reset
  bind('reset-stages-btn', async () => {
    const confirmText = (($('reset-confirm') || {}).value || '').trim();
    if (confirmText !== 'RESET-TO-STAGE-1') {
      setErr('reset-err', '❌ Type RESET-TO-STAGE-1 in the box first.');
      return;
    }
    if (!confirm('Reset ALL players to Stage 1? This will backup first.')) return;
    setErr('reset-err', 'Working...');
    try {
      const { ok, j } = await api('/api/gm/reset-all-stages', { method: 'POST', body: JSON.stringify({ confirm: 'RESET-TO-STAGE-1' }) });
      setErr('reset-err', ok ? `✅ Backed up ${j.backedUp}, reset ${j.reset} players to Stage 1.` : '❌ ' + ((j && j.error) || 'failed'), ok);
    } catch (e) {
      setErr('reset-err', '❌ ' + e.message);
    }
  });

  // Restore Player
  bind('restore-btn', async () => {
    const u = getUser('restore-user');
    if (!u) { setErr('restore-err', '❌ Enter a username.'); return; }
    setErr('restore-err', 'Restoring...');
    try {
      const { ok, j } = await api('/api/gm/restore-player', { method: 'POST', body: JSON.stringify({ username: u }) });
      setErr('restore-err', ok ? `✅ Restored ${u}'s progress${j.live ? ' (live!)' : ''}.` : '❌ ' + ((j && j.error) || 'failed'), ok);
    } catch (e) {
      setErr('restore-err', '❌ ' + e.message);
    }
  });

  // Forge OP Gear
  bind('forge-btn', async () => {
    const u = getUser('forge-user');
    const name = (($('forge-name') || {}).value || '').trim();
    const slot = ($('forge-slot') || {}).value || 'weapon';
    const rarity = ($('forge-rarity') || {}).value || 'rainbowstar';
    const atk = parseFloat(($('forge-atk') || {}).value) || 0;
    const def = parseFloat(($('forge-def') || {}).value) || 0;
    const crit = parseFloat(($('forge-crit') || {}).value) || 0;
    if (!u || !name) { setErr('forge-err', '❌ Enter username and item name.'); return; }
    setErr('forge-err', 'Forging...');
    const { ok, j } = await api('/api/gm/create-op-gear', {
      method: 'POST',
      body: JSON.stringify({ username: u, name, slot, rarity, stats: { attack: atk, defense: def, critChance: crit } })
    });
    setErr('forge-err', ok ? `✅ Forged ${name} for ${u}` : '❌ ' + ((j && j.error) || 'failed'), ok);
  });

  // Broadcast
  bind('broadcast-btn', async () => {
    const msg = (($('broadcast-msg') || {}).value || '').trim();
    if (!msg) { setErr('broadcast-err', '❌ Enter a message.'); return; }
    const { ok, j } = await api('/api/gm/broadcast', { method: 'POST', body: JSON.stringify({ message: msg }) });
    setErr('broadcast-err', ok ? '✅ Broadcast sent!' : '❌ ' + ((j && j.error) || 'failed'), ok);
    if (ok) $('broadcast-msg').value = '';
  });

  // 2x Event Toggle
  bind('pow-2x-btn', async () => {
    const { ok, j } = await api('/api/gm/event-buff', { method: 'POST', body: JSON.stringify({ type: 'xp_gold', hours: 24 }) });
    setErr('patch-err', ok ? '✅ 2x event toggled (24h)' : '❌ ' + ((j && j.error) || 'failed'), ok);
  });

  // Grant Protection Buffs
  bind('pow-priest-shield-btn', async () => {
    const u = getUser('pow-user');
    if (!u) { setErr('patch-err', '❌ Enter username in Target Player Username.'); return; }
    const { ok, j } = await api('/api/gm/grant-buff', { method: 'POST', body: JSON.stringify({ username: u, buffType: 'priest_shield', value: 5000, duration: 300 }) });
    setErr('patch-err', ok ? `✅ Granted Power Word: Shield to ${u}` : '❌ ' + ((j && j.error) || 'failed'), ok);
  });
  bind('pow-pally-bubble-btn', async () => {
    const u = getUser('pow-user');
    if (!u) { setErr('patch-err', '❌ Enter username in Target Player Username.'); return; }
    const { ok, j } = await api('/api/gm/grant-buff', { method: 'POST', body: JSON.stringify({ username: u, buffType: 'pally_bubble', value: 10000, duration: 300 }) });
    setErr('patch-err', ok ? `✅ Granted Divine Shield to ${u}` : '❌ ' + ((j && j.error) || 'failed'), ok);
  });
  bind('pow-dmg-boost-btn', async () => {
    const u = getUser('pow-user');
    if (!u) { setErr('patch-err', '❌ Enter username in Target Player Username.'); return; }
    const { ok, j } = await api('/api/gm/grant-buff', { method: 'POST', body: JSON.stringify({ username: u, buffType: 'damage', value: 50, duration: 300 }) });
    setErr('patch-err', ok ? `✅ Granted Damage Boost to ${u}` : '❌ ' + ((j && j.error) || 'failed'), ok);
  });
  bind('pow-heal-btn2', async () => {
    const u = getUser('pow-user');
    if (!u) { setErr('patch-err', '❌ Enter username in Target Player Username.'); return; }
    const { ok, j } = await api('/api/gm/grant-buff', { method: 'POST', body: JSON.stringify({ username: u, buffType: 'heal', value: 0, duration: 30 }) });
    setErr('patch-err', ok ? `✅ Healed ${u}` : '❌ ' + ((j && j.error) || 'failed'), ok);
  });

  // Push Patch Notes
  bind('pow-patch-btn', async () => {
    const { ok, j } = await api('/api/gm/push-patch-notes', { method: 'POST', body: JSON.stringify({}) });
    setErr('broadcast-patch-err', ok ? '✅ Patch notes pushed!' : '❌ ' + ((j && j.error) || 'failed'), ok);
  });

  // Check Buffs
  bind('buff-check-btn', async () => {
    const u = getUser('buff-check-user');
    if (!u) { setErr('patch-err', '❌ Enter username.'); return; }
    const { ok, j } = await api('/api/gm/inspect', { method: 'POST', body: JSON.stringify({ username: u }) });
    if (!ok) { setErr('patch-err', '❌ ' + ((j && j.error) || 'failed')); return; }
    const buffs = (j.dossier && j.dossier.buffs) || (j.data && j.data.buffs) || j.buffs || [];
    setErr('patch-err', `✅ ${u} has ${buffs.length} active buffs: ${buffs.map(b => b.id || b).join(', ') || 'none'}`, true);
  });

  // Event toggles (Realm tab)
  bind('event-gold-btn', async () => {
    const { ok, j } = await api('/api/gm/event-buff', { method: 'POST', body: JSON.stringify({ type: 'gold', hours: 24 }) });
    setErr('event-err', ok ? '✅ Gold event toggled' : '❌ ' + ((j && j.error) || 'failed'), ok);
  });
  bind('event-xp-btn', async () => {
    const { ok, j } = await api('/api/gm/event-buff', { method: 'POST', body: JSON.stringify({ type: 'xp', hours: 24 }) });
    setErr('event-err', ok ? '✅ XP event toggled' : '❌ ' + ((j && j.error) || 'failed'), ok);
  });

  // Backup
  bind('backup-btn', async () => {
    setErr('backup-err', 'Backing up...');
    const { ok, j } = await api('/api/gm/reset-all-stages', { method: 'POST', body: JSON.stringify({ confirm: 'BACKUP-ONLY' }) });
    setErr('backup-err', ok ? '✅ Backup complete' : '❌ ' + ((j && j.error) || 'failed'), ok);
  });
})();
