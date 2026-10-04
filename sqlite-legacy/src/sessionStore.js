'use strict';

/**
 * express-session Store backed by the SQLite `sessions` table.
 * Session data is stored as JSON text with an `expire` epoch-ms column;
 * expired sessions are treated as missing and purged opportunistically.
 */

const { Store } = require('express-session');
const { db } = require('./db');

const stmtGet = db.prepare('SELECT sess, expire FROM sessions WHERE sid = ?');
const stmtSet = db.prepare(
  'INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?) ' +
    'ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire'
);
const stmtDestroy = db.prepare('DELETE FROM sessions WHERE sid = ?');
const stmtTouch = db.prepare('UPDATE sessions SET expire = ? WHERE sid = ?');
const stmtAll = db.prepare('SELECT sess, expire FROM sessions');
const stmtClear = db.prepare('DELETE FROM sessions');
const stmtPurge = db.prepare('DELETE FROM sessions WHERE expire <= ?');

function expireOf(sess) {
  // express-session gives us the full session object with .cookie
  const cookie = (sess && sess.cookie) || {};
  if (cookie.expires) {
    const t = new Date(cookie.expires).getTime();
    if (Number.isFinite(t)) return t;
  }
  const maxAge = Number(cookie.maxAge);
  if (Number.isFinite(maxAge)) return Date.now() + maxAge;
  // Session cookie without expiry: keep it alive for 30 days of inactivity.
  return Date.now() + 30 * 24 * 60 * 60 * 1000;
}

class SqliteSessionStore extends Store {
  constructor(options = {}) {
    super(options);
    this.db = db;
  }

  get(sid, callback) {
    try {
      const row = stmtGet.get(sid);
      if (!row) return callback(null, null);
      if (row.expire <= Date.now()) {
        stmtDestroy.run(sid);
        return callback(null, null);
      }
      return callback(null, JSON.parse(row.sess));
    } catch (err) {
      return callback(err);
    }
  }

  set(sid, sess, callback) {
    try {
      stmtSet.run(sid, JSON.stringify(sess), expireOf(sess));
      callback && callback(null);
    } catch (err) {
      callback && callback(err);
    }
  }

  destroy(sid, callback) {
    try {
      stmtDestroy.run(sid);
      callback && callback(null);
    } catch (err) {
      callback && callback(err);
    }
  }

  touch(sid, sess, callback) {
    try {
      stmtTouch.run(expireOf(sess), sid);
      callback && callback(null);
    } catch (err) {
      callback && callback(err);
    }
  }

  all(callback) {
    try {
      const now = Date.now();
      stmtPurge.run(now);
      const rows = stmtAll.all();
      const result = [];
      for (const row of rows) {
        try {
          result.push(JSON.parse(row.sess));
        } catch {
          // skip corrupt rows
        }
      }
      callback(null, result);
    } catch (err) {
      callback(err);
    }
  }

  length(callback) {
    try {
      stmtPurge.run(Date.now());
      const { n } = this.db.prepare('SELECT COUNT(*) AS n FROM sessions').get();
      callback(null, n);
    } catch (err) {
      callback(err);
    }
  }

  clear(callback) {
    try {
      stmtClear.run();
      callback && callback(null);
    } catch (err) {
      callback && callback(err);
    }
  }
}

module.exports = SqliteSessionStore;
