'use strict';

/**
 * King of Project — Express server entry point.
 */

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const SqliteSessionStore = require('./src/sessionStore');
const {
  getUserByUsername,
  ownerExists,
  db,
} = require('./src/db');
const { authRouter } = require('./src/auth');
const { gameRouter } = require('./src/gameApi');
const { gmRouter } = require('./src/gmApi');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';

// --- security / proxy ---
app.set('trust proxy', 1); // behind Render's HTTPS terminator
app.use(helmet());
app.disable('x-powered-by');

// --- body parsing ---
app.use(express.json({ limit: '1mb' }));

// --- session ---
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  sessionSecret = 'dev-secret-change-me';
  console.warn(
    '[warn] SESSION_SECRET is not set; using an insecure default. ' +
      'Set SESSION_SECRET in production.'
  );
}
app.use(
  session({
    store: new SqliteSessionStore(),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PROD, // secure only behind HTTPS in production
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
  })
);

// --- rate limit auth routes: 20 req/min per IP ---
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth requests. Try again in a minute.' },
});
app.use('/api/auth/', authLimiter);

// --- routes ---
app.use('/api/auth', authRouter);
app.use('/api', gameRouter);
app.use('/api', gmRouter);

// --- static frontend ---
app.use(express.static(path.join(__dirname, 'public')));

// --- 404 JSON handler (API + unknown paths) ---
app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// --- error handler ---
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body.' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Body too large.' });
  }
  console.error('[error]', err);
  res.status(err.status || 500).json({ error: 'Internal server error.' });
});

// --- owner seeding ---
function seedOwnerIfNeeded() {
  if (ownerExists()) {
    return { seeded: false, reason: 'owner already exists' };
  }
  const username = process.env.OWNER_USERNAME;
  const password = process.env.OWNER_PASSWORD;
  if (!username || !password) {
    return { seeded: false, reason: 'OWNER_USERNAME/OWNER_PASSWORD not set' };
  }
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(
    "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, 'owner', ?)"
  ).run(username.trim(), hash, Date.now());
  // NEVER log the password — only the username.
  return { seeded: true, username: username.trim() };
}

const ownerResult = seedOwnerIfNeeded();

app.listen(PORT, () => {
  console.log('==============================================');
  console.log('  King of Project — server running');
  console.log(`  Port:        ${PORT}`);
  console.log(`  Environment: ${NODE_ENV}`);
  console.log(
    `  Owner:       ${
      ownerResult.seeded
        ? `seeded as "${ownerResult.username}"`
        : `not seeded (${ownerResult.reason})`
    }`
  );
  console.log('==============================================');
});
