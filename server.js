'use strict';

/**
 * King of Project — Express server entry point (PostgreSQL backend).
 *
 * Boot order: connect -> run schema migrations -> seed owner -> listen.
 * The process exits(1) if the database is unreachable, so a failed
 * migration never leaves the server running in a broken state.
 */

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const createSessionStore = require('./src/sessionStore');
const {
  pool,
  migrate,
  closePool,
  getUserByUsername,
  createUserWithRole,
  setUserRole,
  ownerExists,
  refreshGoldCap,
} = require('./src/db');
const { authRouter } = require('./src/auth');
const { gameRouter } = require('./src/gameApi');
const { gmRouter } = require('./src/gmApi');
const { accountRouter } = require('./src/accountApi');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';

// --- security / proxy ---
app.set('trust proxy', 1); // behind Render's HTTPS terminator
app.use(helmet());
app.disable('x-powered-by');

// --- body parsing ---
// 8mb: allows larger JSON payloads (e.g. data-URL image uploads) where needed.
app.use(express.json({ limit: '8mb' }));

// --- session (PostgreSQL-backed via connect-pg-simple) ---
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (IS_PROD) {
    // Fail closed: a predictable session secret in production would let an
    // attacker forge session cookies for any account, including the owner.
    console.error(
      '[fatal] SESSION_SECRET is not set. Refusing to boot in production.'
    );
    process.exit(1);
  }
  sessionSecret = 'dev-secret-change-me';
  console.warn(
    '[warn] SESSION_SECRET is not set; using an insecure default. ' +
      'Set SESSION_SECRET in production.'
  );
}
app.use(
  session({
    store: createSessionStore(session),
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
app.use('/api', accountRouter);

// --- static frontend ---
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    // Never cache JS/CSS — always fetch fresh to avoid stale syntax errors.
    if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
  }
}));

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
// Runs on every boot. Safe to re-run: once ANY owner exists it becomes a
// no-op, so OWNER_USERNAME can never be used to hijack an account later.
async function seedOwnerIfNeeded() {
  if (await ownerExists()) {
    return { seeded: false, reason: 'owner already exists' };
  }
  const username = (process.env.OWNER_USERNAME || '').trim();
  if (!username) {
    return { seeded: false, reason: 'OWNER_USERNAME not set' };
  }
  // Case 1: the account is already registered (e.g. the owner has been
  // playing as a regular player). Promote it — no password needed.
  const existing = await getUserByUsername(username);
  if (existing) {
    if (existing.role !== 'owner') {
      await setUserRole(existing.id, 'owner');
    }
    console.log(`[owner] promoted existing account "${existing.username}" to owner`);
    return { seeded: true, promoted: true, username: existing.username };
  }
  // Case 2: fresh database — create the owner account (needs a password).
  const password = process.env.OWNER_PASSWORD;
  if (!password) {
    return {
      seeded: false,
      reason: `OWNER_USERNAME "${username}" is not registered yet and OWNER_PASSWORD is not set`,
    };
  }
  const hash = bcrypt.hashSync(password, 10);
  await createUserWithRole(username, hash, 'owner');
  // NEVER log the password — only the username.
  return { seeded: true, username };
}

async function main() {
  // Fail fast if Postgres is unreachable or migrations break.
  await migrate();
  console.log('[db] schema ready');
  await refreshGoldCap();
  console.log('[db] gold cap loaded');

  const ownerResult = await seedOwnerIfNeeded();

  const server = app.listen(PORT, () => {
    console.log('==============================================');
    console.log('  King of Project — server running (PostgreSQL)');
    console.log(`  Port:        ${PORT}`);
    console.log(`  Environment: ${NODE_ENV}`);
    console.log(
      `  Owner:       ${
        ownerResult.seeded
          ? `${ownerResult.promoted ? 'promoted' : 'seeded'} as "${ownerResult.username}"`
          : `not seeded (${ownerResult.reason})`
      }`
    );
    console.log('==============================================');
  });

  // Clean shutdown: stop accepting, then drain the pg pool.
  const shutdown = (signal) => {
    console.log(`[shutdown] received ${signal}, closing...`);
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[fatal] failed to start:', err.message);
  if (!process.env.DATABASE_URL) {
    console.error(
      '[fatal] DATABASE_URL is not set and the default local database ' +
        '(postgres://localhost:5432/king_of_project) is unreachable. ' +
        'Set DATABASE_URL to your Postgres connection string (see README).'
    );
  }
  closePool()
    .catch(() => {})
    .finally(() => process.exit(1));
});
