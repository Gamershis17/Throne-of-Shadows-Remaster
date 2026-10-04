-- King of Project — PostgreSQL schema.
-- Applied at server boot via CREATE TABLE IF NOT EXISTS (see src/db.js migrate()).
-- Timestamps are BIGINT epoch milliseconds (same convention as the old SQLite build).
-- Usernames are case-insensitive: lookups use LOWER(username) = LOWER($1) and a
-- unique index on LOWER(username) enforces case-insensitive uniqueness.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'player',   -- 'owner' | 'gm' | 'admin' | 'moderator' | 'player'
  banned BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_nocase_uidx ON users (LOWER(username));
-- Migration for databases created before the banned column existed:
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT FALSE;
-- session_version: bumped by GM kick; sessions carrying an older version are
-- destroyed on next request (see src/auth.js requireAuth).
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS player_state (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  level INTEGER NOT NULL DEFAULT 1,
  stage INTEGER NOT NULL DEFAULT 1,
  bosses_killed INTEGER NOT NULL DEFAULT 0,
  rebirth_count INTEGER NOT NULL DEFAULT 0,
  state_json TEXT NOT NULL DEFAULT '{}',
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS gift_codes (
  code TEXT PRIMARY KEY,
  gear_set TEXT NOT NULL,                 -- gear-set id, or 'none' for gold/star codes
  reward_kind TEXT NOT NULL DEFAULT 'gear', -- 'gear' | 'gold' | 'stars'
  reward_amount INTEGER NOT NULL DEFAULT 0, -- gold/stars granted (0 for gear codes)
  max_uses INTEGER NOT NULL DEFAULT 1,
  uses INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at BIGINT NOT NULL
);
-- Migration for databases created before reward kinds existed:
ALTER TABLE gift_codes ADD COLUMN IF NOT EXISTS reward_kind TEXT NOT NULL DEFAULT 'gear';
ALTER TABLE gift_codes ADD COLUMN IF NOT EXISTS reward_amount INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS code_redemptions (
  code TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  redeemed_at BIGINT NOT NULL,
  PRIMARY KEY (code, user_id)
);

-- Session table for connect-pg-simple (table name 'sessions').
-- Column types must match what the store expects: sid text PK, sess json,
-- expire as a timestamp. The store writes expire as a JS Date.
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions (expire);

-- Guilds: player-created groups. One guild per player (enforced in code;
-- guild_members.username is UNIQUE).
CREATE TABLE IF NOT EXISTS guilds (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  tag TEXT NOT NULL,
  owner_username TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  treasury_gold BIGINT NOT NULL DEFAULT 0,
  hall_valor_level INTEGER NOT NULL DEFAULT 0,
  hall_treasury_level INTEGER NOT NULL DEFAULT 0,
  hall_forge_level INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS guilds_name_nocase_uidx ON guilds (LOWER(name));

CREATE TABLE IF NOT EXISTS guild_members (
  guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  rank TEXT NOT NULL DEFAULT 'member',   -- 'master' | 'officer' | 'member' | 'initiate'
  joined_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_guild_members_guild ON guild_members (guild_id);
-- Guild rework migrations (2026-09-28):
-- Rank ladder: 'leader' -> 'master'; newcomers join as 'initiate'.
UPDATE guild_members SET rank = 'master' WHERE rank = 'leader';
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS level INTEGER NOT NULL DEFAULT 1;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS xp BIGINT NOT NULL DEFAULT 0;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS motd TEXT NOT NULL DEFAULT '';
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS banner_style TEXT NOT NULL DEFAULT 'shadow';
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS unlocked_banners TEXT NOT NULL DEFAULT '["shadow"]';
ALTER TABLE guild_members ADD COLUMN IF NOT EXISTS credits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE guild_members ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';

-- Guild chat: server-stored history, pruned to the newest 100 per guild.
CREATE TABLE IF NOT EXISTS guild_chat (
  id SERIAL PRIMARY KEY,
  guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guild_chat_guild ON guild_chat (guild_id, id DESC);

-- Staff-only admin chat (owner + admin). Pruned to the newest 200 messages.
CREATE TABLE IF NOT EXISTS admin_chat (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_chat_id ON admin_chat (id DESC);

-- Guild news / activity feed: server-generated entries, pruned to newest 100.
CREATE TABLE IF NOT EXISTS guild_news (
  id SERIAL PRIMARY KEY,
  guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,   -- join|leave|kick|promote|demote|levelup|challenge|motd|banner|boss
  text TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guild_news_guild ON guild_news (guild_id, id DESC);

-- Weekly guild challenges (week starts Monday 00:00 UTC).
CREATE TABLE IF NOT EXISTS guild_challenges (
  id SERIAL PRIMARY KEY,
  guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  week_start BIGINT NOT NULL,
  kind TEXT NOT NULL,   -- bosses|kills|quests
  target INTEGER NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  completed BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE UNIQUE INDEX IF NOT EXISTS guild_challenges_week_uidx ON guild_challenges (guild_id, week_start, kind);

-- Guild invites: officer+ can invite a player by username; the invitee
-- accepts or declines from the guild screen.
CREATE TABLE IF NOT EXISTS guild_invites (
  id SERIAL PRIMARY KEY,
  guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  invited_by TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS guild_invites_guild_user_uidx ON guild_invites (guild_id, LOWER(username));
CREATE INDEX IF NOT EXISTS idx_guild_invites_user ON guild_invites (LOWER(username));

-- Multiplayer parties: invite-code groups, max 4 humans. NPC allies are
-- derived live from each member's save blob (state.party) and are NOT
-- stored here; the is_npc/npc_id columns are reserved for future use.
CREATE TABLE IF NOT EXISTS parties (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  leader_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS party_members (
  party_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_npc BOOLEAN NOT NULL DEFAULT false,
  npc_id TEXT NOT NULL DEFAULT '',
  joined_at BIGINT NOT NULL,
  PRIMARY KEY (party_id, user_id, npc_id)
);
CREATE INDEX IF NOT EXISTS idx_party_members_user ON party_members (user_id);
-- One party per human: a human row (is_npc=false) is unique per user.
-- NPC rows (is_npc=true) are exempt so allies can attach freely.
CREATE UNIQUE INDEX IF NOT EXISTS party_one_human_per_party
  ON party_members (user_id) WHERE is_npc = false;

-- Server-wide tunable settings (key/value). The GM console's owner-only
-- "Server settings" card writes here; e.g. gold_cap (max player gold).
CREATE TABLE IF NOT EXISTS server_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Friendships: player-to-player friend links. Usernames are case-insensitive;
-- pair_key is the lowercased "a|b" of the alphabetically-sorted pair, so one
-- row covers the friendship regardless of who requested or the name casing.
CREATE TABLE IF NOT EXISTS friendships (
  id SERIAL PRIMARY KEY,
  requester TEXT NOT NULL,
  addressee TEXT NOT NULL,
  pair_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'accepted'
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair_uidx ON friendships (pair_key);

-- Online presence: last authenticated activity (epoch ms). Refreshed at most
-- once per minute per user (see touchLastActive in src/db.js); the friends
-- list treats "active within 5 minutes" as online.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active BIGINT NOT NULL DEFAULT 0;

-- Player bug reports + feedback (submitted from /report.html, reviewed on
-- /staff.html). Timestamps are BIGINT epoch ms, same convention as elsewhere.
CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username TEXT NOT NULL,
  kind TEXT NOT NULL,            -- 'bug' | 'feedback'
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',  -- 'new' | 'reviewing' | 'fixed' | 'closed'
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS reports_status_idx ON reports (status);
CREATE INDEX IF NOT EXISTS reports_created_idx ON reports (created_at DESC);

-- Staff idea board (owner/admin brainstorming on /staff.html).
CREATE TABLE IF NOT EXISTS ideas (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'planned' | 'done' | 'dropped'
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS ideas_status_idx ON ideas (status);
CREATE INDEX IF NOT EXISTS ideas_created_idx ON ideas (created_at DESC);

-- Staff social page (/social.html): owner/admin-only profiles + posts feed.
-- avatars and media are data URLs (pictures only for now); post rows snapshot
-- the author's name/avatar/accent so old posts keep their history.
CREATE TABLE IF NOT EXISTS staff_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  accent TEXT NOT NULL DEFAULT 'gold',
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS social_posts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '',
  accent TEXT NOT NULL DEFAULT 'gold',
  role TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  media TEXT NOT NULL DEFAULT '[]',
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS social_posts_created_idx ON social_posts (created_at DESC);
-- Pre-reset backup for the Stage 1 stat-fix reset (Oct 2026).
-- Stores full player blobs before the reset so the owner can restore
-- individual players on request.
CREATE TABLE IF NOT EXISTS stage_reset_backup (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  state_json JSONB NOT NULL,
  backed_up_at TIMESTAMPTZ DEFAULT now()
);
