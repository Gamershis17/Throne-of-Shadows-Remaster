'use strict';

/**
 * Broadcast announcements.
 *
 * Owns its own `broadcasts` table (created lazily on first use) so the
 * game schema in src/schema.sql / src/db.js stays untouched.
 *
 *   broadcasts(id SERIAL PK, message TEXT, created_by TEXT,
 *              created_at TIMESTAMPTZ DEFAULT now())
 */

const { pool } = require('./db');

// SSE clients for live broadcast push: Map<userId, Set<res>>
const sseClients = new Map();

function addSseClient(userId, res) {
  if (!sseClients.has(userId)) sseClients.set(userId, new Set());
  sseClients.get(userId).add(res);
  res.on('close', () => {
    const set = sseClients.get(userId);
    if (set) { set.delete(res); if (set.size === 0) sseClients.delete(userId); }
  });
}

function pushBroadcast(broadcast) {
  const data = `data: ${JSON.stringify({ type: 'broadcast', broadcast })}\n\n`;
  for (const set of sseClients.values()) {
    for (const res of set) {
      try { res.write(data); } catch { set.delete(res); }
    }
  }
}

function pushBuff(userId, buff) {
  const set = sseClients.get(userId);
  if (!set) return false;
  const data = `data: ${JSON.stringify({ type: 'buff', buff })}\n\n`;
  for (const res of set) {
    try { res.write(data); } catch { set.delete(res); }
  }
  return true;
}

// Push a state update to a live player (e.g. level/stage/gold changed by GM).
// `changes` is a flat object of top-level blob fields to merge.
function pushStateUpdate(userId, changes) {
  const set = sseClients.get(userId);
  if (!set) return false;
  const data = `data: ${JSON.stringify({ type: 'state', changes })}\n\n`;
  for (const res of set) {
    try { res.write(data); } catch { set.delete(res); }
  }
  return true;
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS broadcasts (
      id SERIAL PRIMARY KEY,
      message TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);
}

async function addBroadcast(message, createdBy) {
  await ensureTable();
  const { rows } = await pool.query(
    'INSERT INTO broadcasts (message, created_by) VALUES ($1, $2) RETURNING id, message, created_by, created_at',
    [message, createdBy]
  );
  const broadcast = rows[0];
  pushBroadcast(broadcast);
  return broadcast;
}

async function latestBroadcast() {
  await ensureTable();
  const { rows } = await pool.query(
    'SELECT id, message, created_by, created_at FROM broadcasts ORDER BY id DESC LIMIT 1'
  );
  return rows[0] || null;
}

module.exports = { addBroadcast, latestBroadcast, addSseClient, pushBuff, pushStateUpdate };
