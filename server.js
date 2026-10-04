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

// --- GM Tools ---
let gmAnnouncement = null;
const feedbackList = [];

function isGM(req) {
  const guest = req.session.guest;
  if (!guest) return false;
  return GMS.includes(guest.name);
}

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

app.get('/api/session', (req, res) => {
  res.json({ ok: true, guest: req.session.guest || null });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.listen(PORT, () => {
  console.log(`Throne of Shadows Remaster running on port ${PORT}`);
});
