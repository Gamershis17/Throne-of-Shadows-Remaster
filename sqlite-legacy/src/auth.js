'use strict';

/**
 * Auth routes: POST /api/auth/register, /login, /logout, GET /api/auth/me.
 * Also exports requireAuth and requireRole(role...) middleware.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const {
  getUserByUsername,
  getUserById,
  createUser,
} = require('./db');
const { validateUsername, validatePassword } = require('./validation');

const BCRYPT_ROUNDS = 10;
const router = express.Router();

function publicUser(user) {
  return { username: user.username, role: user.role };
}

// ---------- middleware ----------
function requireAuth(req, res, next) {
  const userId = req.session && req.session.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Not signed in.' });
  }
  const user = getUserById(userId);
  if (!user) {
    // Account deleted while a session was active.
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Not signed in.' });
  }
  req.user = user;
  next();
}

/** Require the signed-in user to hold one of the given roles. */
function requireRole(...roles) {
  return (req, res, next) => {
    requireAuth(req, res, () => {
      if (!roles.includes(req.user.role)) {
        return res.status(403).json({ error: 'Forbidden: insufficient role.' });
      }
      next();
    });
  };
}

// ---------- routes ----------
router.post('/register', (req, res) => {
  const { username, password } = req.body || {};

  const usernameError = validateUsername(username);
  if (usernameError) return res.status(400).json({ error: usernameError });
  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ error: passwordError });

  const cleanUsername = String(username).trim();
  if (getUserByUsername(cleanUsername)) {
    return res.status(409).json({ error: 'Username is already taken.' });
  }

  const passwordHash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
  const user = createUser(cleanUsername, passwordHash);

  req.session.userId = user.id;
  res.status(201).json({ user: publicUser(user) });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  const user = getUserByUsername(username.trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    // Same message either way: don't reveal which part failed.
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  // Fresh session id on login to prevent session fixation.
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Session error.' });
    req.session.userId = user.id;
    res.json({ user: publicUser(user) });
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed.' });
    res.clearCookie('connect.sid', { path: '/' });
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  const userId = req.session && req.session.userId;
  if (!userId) return res.status(401).json({ error: 'Not signed in.' });
  const user = getUserById(userId);
  if (!user) return res.status(401).json({ error: 'Not signed in.' });
  res.json({ user: publicUser(user) });
});

module.exports = {
  authRouter: router,
  requireAuth,
  requireRole,
};
