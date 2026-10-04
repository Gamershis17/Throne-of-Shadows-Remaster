'use strict';

/**
 * Self-service account management for players:
 *   POST /api/account/change-password  (auth)
 *   POST /api/account/change-username  (auth)
 *
 * Both endpoints require the current password, so a hijacked session alone
 * cannot lock the real owner out. Changing the password bumps
 * session_version, signing out every other device; the caller's own session
 * is kept alive by syncing its stored version.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { requireAuth, asyncHandler, publicUser, BCRYPT_ROUNDS } = require('./auth');
const { validateUsername, validatePassword } = require('./validation');
const {
  getUserById,
  updatePasswordHash,
  renameUserAccount,
} = require('./db');

const router = express.Router();

// Brute-force protection: 10 attempts per 15 minutes per IP.
const accountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
});

router.post(
  '/account/change-password',
  accountLimiter,
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    const user = await getUserById(req.user.id);
    if (!user) return res.status(401).json({ error: 'Not signed in.' });
    if (!bcrypt.compareSync(String(currentPassword || ''), user.password_hash)) {
      return res.status(403).json({ error: 'Current password is incorrect.' });
    }
    const passwordError = validatePassword(newPassword);
    if (passwordError) return res.status(400).json({ error: passwordError });
    if (String(newPassword) === String(currentPassword)) {
      return res.status(400).json({ error: 'New password must be different.' });
    }
    const newVersion = await updatePasswordHash(
      user.id,
      bcrypt.hashSync(String(newPassword), BCRYPT_ROUNDS)
    );
    // Keep this session alive; every other device is signed out.
    if (req.session) req.session.sessionVersion = Number(newVersion) || 0;
    res.json({ ok: true });
  })
);

router.post(
  '/account/change-username',
  accountLimiter,
  requireAuth,
  asyncHandler(async (req, res) => {
    const { newUsername, password } = req.body || {};
    const user = await getUserById(req.user.id);
    if (!user) return res.status(401).json({ error: 'Not signed in.' });
    if (!bcrypt.compareSync(String(password || ''), user.password_hash)) {
      return res.status(403).json({ error: 'Password is incorrect.' });
    }
    const usernameError = validateUsername(newUsername);
    if (usernameError) return res.status(400).json({ error: usernameError });
    const clean = String(newUsername).trim();
    try {
      await renameUserAccount(user.id, clean);
    } catch (err) {
      if (err.code === 'taken') {
        return res.status(409).json({ error: 'Username is already taken.' });
      }
      throw err;
    }
    const updated = await getUserById(user.id);
    res.json({ ok: true, user: publicUser(updated) });
  })
);

module.exports = { accountRouter: router };
