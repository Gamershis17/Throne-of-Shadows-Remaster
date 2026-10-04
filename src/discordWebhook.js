'use strict';

/**
 * Discord webhooks.
 *
 * Two independent webhooks, each a channel URL pasted on /staff.html and
 * stored in server_settings (owner/admin only):
 *
 *   - `discord_modlog_webhook`   → #mod-logs: every audit entry written by
 *     logAudit() is mirrored there as a rich embed.
 *   - `discord_bug_webhook`      → #bug-reports: every bug report filed via
 *     POST /api/report is mirrored there as an embed.
 *   - `discord_feedback_webhook` → #feedback: every player feedback filed via
 *     POST /api/report is mirrored there as an embed.
 *
 *   - `discord_patchnotes_webhook` → #patch-notes: staff push the latest
 *     changelog entry there as an embed with the "Push latest patch notes"
 *     button on /staff.html. Player-facing, so staff-flagged changelog items
 *     are stripped before posting.
 *
 *   - `discord_balance_webhook`    → #balance-log: staff push the latest
 *     balance-log.json entry there as an embed with the "Push latest
 *     balance changes" button on /staff.html.
 *
 * No Discord bot needed, just HTTPS POSTs. Posting is fire-and-forget with
 * a short timeout: a dead or slow webhook must never delay or break the
 * game action that triggered it.
 */

const { getSetting, setSetting } = require('./db');

const SETTING_KEY = 'discord_modlog_webhook';
const BUG_SETTING_KEY = 'discord_bug_webhook';
const FEEDBACK_SETTING_KEY = 'discord_feedback_webhook';
const PATCHNOTES_SETTING_KEY = 'discord_patchnotes_webhook';
const BALANCE_SETTING_KEY = 'discord_balance_webhook';
const TIMEOUT_MS = 6000;

function isValidWebhookUrl(url) {
  try {
    const u = new URL(String(url || '').trim());
    const hostOk =
      u.hostname === 'discord.com' || u.hostname.endsWith('.discord.com') ||
      u.hostname === 'discordapp.com' || u.hostname.endsWith('.discordapp.com');
    return u.protocol === 'https:' && hostOk && u.pathname.startsWith('/api/webhooks/');
  } catch {
    return false;
  }
}

async function getWebhookUrl() {
  try {
    return (await getSetting(SETTING_KEY)) || '';
  } catch {
    return '';
  }
}

async function getBugWebhookUrl() {
  try {
    return (await getSetting(BUG_SETTING_KEY)) || '';
  } catch {
    return '';
  }
}

async function getFeedbackWebhookUrl() {
  try {
    return (await getSetting(FEEDBACK_SETTING_KEY)) || '';
  } catch {
    return '';
  }
}

async function setWebhookUrl(url) {
  return setWebhookUrlFor(SETTING_KEY, url);
}

async function setBugWebhookUrl(url) {
  return setWebhookUrlFor(BUG_SETTING_KEY, url);
}

async function setFeedbackWebhookUrl(url) {
  return setWebhookUrlFor(FEEDBACK_SETTING_KEY, url);
}

async function getPatchnotesWebhookUrl() {
  try {
    return (await getSetting(PATCHNOTES_SETTING_KEY)) || '';
  } catch {
    return '';
  }
}

async function setPatchnotesWebhookUrl(url) {
  return setWebhookUrlFor(PATCHNOTES_SETTING_KEY, url);
}

async function getBalanceWebhookUrl() {
  try {
    return (await getSetting(BALANCE_SETTING_KEY)) || '';
  } catch {
    return '';
  }
}

async function setBalanceWebhookUrl(url) {
  return setWebhookUrlFor(BALANCE_SETTING_KEY, url);
}

async function setWebhookUrlFor(key, url) {
  const clean = String(url || '').trim();
  if (clean && !isValidWebhookUrl(clean)) {
    const err = new Error('That does not look like a Discord webhook URL.');
    err.code = 'bad-url';
    throw err;
  }
  await setSetting(key, clean);
  return clean;
}

// Masked for display on the staff page: never leak the token part.
function maskWebhookUrl(url) {
  const m = String(url || '').match(/^(https:\/\/[^/]+\/api\/webhooks\/)(\d+)\/(.+)$/);
  if (!m) return '';
  const token = m[3];
  return `${m[1]}${m[2].slice(0, 4)}…/${token.slice(0, 2)}…${token.slice(-2)}`;
}

function actionEmoji(action) {
  const a = String(action || '').toLowerCase();
  if (a.includes('ban')) return a.includes('un') ? '🔓' : '🔨';
  if (a.includes('kick')) return '👢';
  if (a.includes('mute')) return a.includes('un') ? '🔊' : '🔇';
  if (a.includes('grant')) return '🎁';
  if (a.includes('warn')) return '⚠️';
  return '🛡️';
}

// Mirror one audit entry to the configured Discord channel.
// Never rejects; never throws.
function postModlog(entry) {
  return (async () => {
    const e = entry || {};
    const embed = {
      title: `${actionEmoji(e.action)} ${e.action || 'staff action'}`,
      color: 0x9b30ff, // shadow purple
      fields: [
        { name: 'Staff', value: String(e.actor || '?').slice(0, 100), inline: true },
        { name: 'Role', value: String(e.actorRole || '?').slice(0, 50), inline: true },
        { name: 'Target', value: String(e.target || '—').slice(0, 100), inline: true },
      ],
      timestamp: new Date(Number(e.ts) || Date.now()).toISOString(),
      footer: { text: 'Throne of Shadows — staff audit' },
    };
    if (e.detail) {
      embed.fields.push({
        name: 'Detail',
        value: String(e.detail).slice(0, 1000),
      });
    }
    await postEmbed(SETTING_KEY, embed, 'modlog');
  })().catch(() => {});
}

// Mirror one player bug report / feedback to its Discord channel —
// bugs go to #bug-reports, feedback goes to #feedback.
// Never rejects; never throws.
function postReport(report) {
  return (async () => {
    const r = report || {};
    const isBug = String(r.kind) === 'bug';
    const key = isBug ? BUG_SETTING_KEY : FEEDBACK_SETTING_KEY;
    const tag = isBug ? 'bugs' : 'feedback';
    const embed = {
      title: `${isBug ? '🐞' : '💬'} New ${isBug ? 'bug report' : 'feedback'} #${Number(r.id) || '?'}`,
      color: isBug ? 0xff5555 : 0x55aaff,
      fields: [
        { name: 'Player', value: String(r.username || '?').slice(0, 100), inline: true },
        { name: 'Title', value: String(r.title || '(no title)').slice(0, 256), inline: true },
      ],
      description: String(r.body || '').slice(0, 2000) || '(no details)',
      timestamp: new Date().toISOString(),
      footer: { text: `Throne of Shadows — player ${isBug ? 'bug reports' : 'feedback'}` },
    };
    await postEmbed(key, embed, tag);
  })().catch(() => {});
}

// Post one changelog entry (already player-filtered) to #patch-notes.
// Never rejects; never throws.
function postPatchNotes(entry) {
  return (async () => {
    const e = entry || {};
    const changes = Array.isArray(e.changes) ? e.changes : [];
    const lines = changes.map((c) => `• ${String(c)}`.slice(0, 500));
    const embed = {
      title: `📜 ${String(e.title || 'Patch notes').slice(0, 256)}`,
      color: 0xffd700, // gold
      description: `${String(e.date || '').slice(0, 32)}\n\n${lines.join('\n')}`.slice(0, 4000).trim() || '(no details)',
      timestamp: new Date().toISOString(),
      footer: { text: 'Throne of Shadows — patch notes' },
    };
    await postEmbed(PATCHNOTES_SETTING_KEY, embed, 'patchnotes');
  })().catch(() => {});
}

// Post one balance-log entry to #balance-log.
// Never rejects; never throws.
function postBalanceLog(entry) {
  return (async () => {
    const e = entry || {};
    const changes = Array.isArray(e.changes) ? e.changes : [];
    const blocks = changes.map((c) => {
      const parts = [`**${String(c.system || 'Change').slice(0, 120)}**`];
      if (c.before) parts.push(`before: ${String(c.before).slice(0, 400)}`);
      if (c.after) parts.push(`after: ${String(c.after).slice(0, 400)}`);
      if (c.note) parts.push(`_${String(c.note).slice(0, 200)}_`);
      return parts.join('\n');
    });
    const version = String(e.version || '').replace(/^v/, '');
    const head = `${version ? `v${version}` : ''}${e.date ? ` · ${String(e.date).slice(0, 32)}` : ''}`.trim();
    const embed = {
      title: `⚖️ ${String(e.title || 'Balance changes').slice(0, 256)}`,
      color: 0x7289da, // blurple
      description: `${head}\n\n${blocks.join('\n\n')}`.slice(0, 4000).trim() || '(no details)',
      timestamp: new Date().toISOString(),
      footer: { text: 'Throne of Shadows — balance log' },
    };
    await postEmbed(BALANCE_SETTING_KEY, embed, 'balance');
  })().catch(() => {});
}

// Shared fire-and-forget embed poster: reads the webhook URL from the given
// setting key, skips silently when unconfigured.
async function postEmbed(settingKey, embed, tag) {
  let url = '';
  try {
    url = (await getSetting(settingKey)) || '';
  } catch {
    return;
  }
  if (!url) return;
  const body = { embeds: [embed] };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) console.warn(`[${tag}] Discord webhook POST failed:`, res.status);
  } catch (err) {
    console.warn(`[${tag}] Discord webhook error:`, err && err.message);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  getWebhookUrl,
  setWebhookUrl,
  getBugWebhookUrl,
  setBugWebhookUrl,
  getFeedbackWebhookUrl,
  setFeedbackWebhookUrl,
  getPatchnotesWebhookUrl,
  setPatchnotesWebhookUrl,
  getBalanceWebhookUrl,
  setBalanceWebhookUrl,
  maskWebhookUrl,
  isValidWebhookUrl,
  postModlog,
  postReport,
  postPatchNotes,
  postBalanceLog,
};
