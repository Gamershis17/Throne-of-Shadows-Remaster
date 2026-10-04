// Throne of Shadows Remaster — Classic MMORPG Idle
// Fresh start: clean architecture, no legacy baggage.
const express = require('express');
const session = require('express-session');
const path = require('path');
const { Pool } = require('pg');

// Database (Neon Postgres)
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
}) : null;

async function initDb() {
  if (!pool) {
    console.log('No DATABASE_URL — running without persistent storage');
    return;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS players (
        name TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        username TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'player',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Seed GM account (password: set via GM_USERS env or default)
    const gmPass = process.env.GM_PASSWORD || 'throne2026';
    const hash = await bcrypt.hash(gmPass, 10);
    await pool.query(`
      INSERT INTO accounts (username, password_hash, role)
      VALUES ('Gamershis17', $1, 'gm'), ('Jass', $1, 'gm')
      ON CONFLICT (username) DO NOTHING
    `, [hash]);
    console.log('Database ready');
  } catch (e) {
    console.error('DB init failed (non-fatal):', e.message);
  }
}
// Non-blocking, never crashes startup
initDb().catch(e => console.error('DB init error (non-fatal):', e.message));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'throne-of-shadows-remaster-dev',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 days
}));
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/api/status', (req, res) => {
  res.json({ ok: true, game: 'Throne of Shadows Remaster', version: '2.0.0' });
});

// --- Chat ---
const chatMessages = [];
const MAX_CHAT = 50;

// GM list (usernames) — can also be set via database roles
const GMS = (process.env.GM_USERS || 'Gamershis17,Jass').split(',');

async function getRole(name) {
  if (GMS.includes(name)) return 'gm';
  if (!pool) return 'player';
  try {
    const r = await pool.query('SELECT data FROM players WHERE name = $1', [name]);
    return r.rows[0]?.data?.role || 'player';
  } catch { return 'player'; }
}

function hasRole(req, ...roles) {
  const guest = req.session.guest;
  if (!guest) return false;
  if (GMS.includes(guest.name)) return true; // GMS env always GM
  // Check DB role (async, so we do it in the endpoint)
  return false;
}

async function checkRole(req, ...roles) {
  const guest = req.session.guest;
  if (!guest) return false;
  if (GMS.includes(guest.name)) return true;
  const role = await getRole(guest.name);
  return roles.includes(role);
}

app.get('/api/chat', (req, res) => {
  res.json({ ok: true, messages: chatMessages.slice(-20) });
});

// --- GM Tools ---
let gmAnnouncement = null;
const feedbackList = [];

function isGM(req) {
  // Check logged-in account first
  if (req.session.user && (req.session.user.role === 'gm' || GMS.includes(req.session.user.username))) {
    return true;
  }
  // Fallback: guest name
  const guest = req.session.guest;
  if (!guest) return false;
  return GMS.includes(guest.name);
}

function getUserRole(req) {
  if (req.session.user) return req.session.user.role;
  return 'player';
}

// GM can set player roles
app.post('/api/gm/setrole/:name', async (req, res) => {
  if (!isGM(req) || !pool) return res.json({ ok: false });
  const { role } = req.body || {};
  if (!['player', 'tester', 'admin', 'gm'].includes(role)) return res.json({ ok: false });
  try {
    const r = await pool.query('SELECT data FROM players WHERE name = $1', [req.params.name]);
    if (!r.rows[0]) return res.json({ ok: false, error: 'Player not found' });
    const data = r.rows[0].data;
    data.role = role;
    await pool.query('UPDATE players SET data = $1 WHERE name = $2',
      [JSON.stringify(data), req.params.name]);
    res.json({ ok: true, role });
  } catch (e) {
    res.json({ ok: false });
  }
});

// Get own role
app.get('/api/role', async (req, res) => {
  if (req.session.user) {
    return res.json({ ok: true, role: req.session.user.role, username: req.session.user.username });
  }
  const guest = req.session.guest;
  if (!guest) return res.json({ ok: true, role: 'player' });
  const role = await getRole(guest.name);
  res.json({ ok: true, role });
});

// Broadcast announcement (pops up on all players)
app.post('/api/gm/broadcast', (req, res) => {
  if (!isGM(req)) return res.json({ ok: false, error: 'Not GM' });
  const { text } = req.body || {};
  if (!text) return res.json({ ok: false });
  gmAnnouncement = { text: text.slice(0, 300), at: Date.now(), by: req.session.guest.name };
  res.json({ ok: true });
});

app.get('/api/announcement', (req, res) => {
  // Only send if newer than client's last seen
  const since = parseInt(req.query.since) || 0;
  if (gmAnnouncement && gmAnnouncement.at > since) {
    res.json({ ok: true, announcement: gmAnnouncement });
  } else {
    res.json({ ok: true, announcement: null });
  }
});

// Player feedback
app.post('/api/feedback', (req, res) => {
  const { text, type } = req.body || {};
  if (!text) return res.json({ ok: false });
  const guest = req.session.guest;
  feedbackList.push({
    id: Date.now(),
    from: guest ? guest.name : 'Guest',
    type: type || 'feedback',
    text: text.slice(0, 500),
    at: Date.now(),
  });
  if (feedbackList.length > 100) feedbackList.shift();
  res.json({ ok: true });
});

app.get('/api/gm/feedback', (req, res) => {
  if (!isGM(req)) return res.json({ ok: false });
  res.json({ ok: true, feedback: feedbackList.slice().reverse() });
});

app.post('/api/chat', (req, res) => {
  const { text } = req.body || {};
  if (!text || text.length > 200) return res.json({ ok: false });
  const guest = req.session.guest;
  const name = guest ? guest.name : 'Guest';
  const isGM = GMS.includes(name);
  const msg = {
    id: Date.now(),
    name,
    display: isGM ? `<GM> ${name}` : name,
    isGM,
    text: text.slice(0, 200),
    at: Date.now(),
  };
  chatMessages.push(msg);
  if (chatMessages.length > MAX_CHAT) chatMessages.shift();
  res.json({ ok: true, message: msg });
});

// Guest session — immediate play, no account needed
app.post('/api/guest', (req, res) => {
  const { name, classId } = req.body || {};
  req.session.guest = {
    name: (name || 'Hero').slice(0, 16),
    classId: classId || 'warrior',
    created: Date.now()
  };
  res.json({ ok: true, guest: req.session.guest });
});

// Save player data to DB
app.post('/api/save', async (req, res) => {
  const guest = req.session.guest;
  if (!guest || !pool) return res.json({ ok: false });
  const { hero } = req.body || {};
  if (!hero) return res.json({ ok: false });
  try {
    await pool.query(
      `INSERT INTO players (name, data) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET data = $2, updated_at = NOW()`,
      [guest.name, JSON.stringify(hero)]
    );
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// Load player data from DB
app.get('/api/load', async (req, res) => {
  const guest = req.session.guest;
  if (!guest || !pool) return res.json({ ok: true, hero: null });
  try {
    const r = await pool.query('SELECT data FROM players WHERE name = $1', [guest.name]);
    res.json({ ok: true, hero: r.rows[0]?.data || null });
  } catch (e) {
    res.json({ ok: false });
  }
});

// GM: inspect any player
app.get('/api/gm/inspect/:name', async (req, res) => {
  if (!isGM(req) || !pool) return res.json({ ok: false });
  try {
    const r = await pool.query('SELECT data, updated_at FROM players WHERE name = $1', [req.params.name]);
    if (!r.rows[0]) return res.json({ ok: false, error: 'Not found' });
    res.json({ ok: true, player: r.rows[0].data, updated: r.rows[0].updated_at });
  } catch (e) {
    res.json({ ok: false });
  }
});

// GM: modify player stats
app.post('/api/gm/modify/:name', async (req, res) => {
  if (!isGM(req) || !pool) return res.json({ ok: false });
  const { gold, level } = req.body || {};
  try {
    const r = await pool.query('SELECT data FROM players WHERE name = $1', [req.params.name]);
    if (!r.rows[0]) return res.json({ ok: false, error: 'Not found' });
    const data = r.rows[0].data;
    if (gold !== undefined && gold >= 0) data.gold = gold;
    if (level !== undefined && level >= 1 && level <= 100) data.level = level;
    await pool.query('UPDATE players SET data = $1, updated_at = NOW() WHERE name = $2',
      [JSON.stringify(data), req.params.name]);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false });
  }
});

// GM: list all players
app.get('/api/gm/players', async (req, res) => {
  if (!isGM(req) || !pool) return res.json({ ok: false });
  try {
    const r = await pool.query('SELECT name, updated_at FROM players ORDER BY updated_at DESC LIMIT 50');
    res.json({ ok: true, players: r.rows });
  } catch (e) {
    res.json({ ok: false });
  }
});

app.get('/api/session', (req, res) => {
  res.json({ ok: true, guest: req.session.guest || null });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.post('/api/change-password', async (req, res) => {
  const user = req.session.user;
  if (!user || !pool) return res.json({ ok: false, error: 'Not logged in' });
  const { current, newPass } = req.body || {};
  if (!current || !newPass || newPass.length < 4) {
    return res.json({ ok: false, error: 'New password min 4 chars' });
  }
  try {
    const r = await pool.query(
      'SELECT password_hash FROM accounts WHERE username = $1',
      [user.username]
    );
    if (!r.rows[0]) return res.json({ ok: false });
    const valid = await bcrypt.compare(current, r.rows[0].password_hash);
    if (!valid) return res.json({ ok: false, error: 'Current password wrong' });
    const hash = await bcrypt.hash(newPass, 10);
    await pool.query(
      'UPDATE accounts SET password_hash = $1 WHERE username = $2',
      [hash, user.username]
    );
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: 'Failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Throne of Shadows Remaster running on port ${PORT}`);
});
