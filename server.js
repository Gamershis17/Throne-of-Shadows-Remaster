// Throne of Shadows Remaster — Classic MMORPG Idle
// Fresh start: clean architecture, no legacy baggage.
const express = require('express');
const session = require('express-session');
const path = require('path');

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

// GM list (usernames)
const GMS = (process.env.GM_USERS || 'Gamershis17').split(',');

app.get('/api/chat', (req, res) => {
  res.json({ ok: true, messages: chatMessages.slice(-20) });
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

app.get('/api/session', (req, res) => {
  res.json({ ok: true, guest: req.session.guest || null });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.listen(PORT, () => {
  console.log(`Throne of Shadows Remaster running on port ${PORT}`);
});
