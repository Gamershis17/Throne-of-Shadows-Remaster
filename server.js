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
