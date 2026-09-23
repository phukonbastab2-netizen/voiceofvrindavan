PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  recovery_hash TEXT NOT NULL,
  interests TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(interests)),
  learned_interests TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(learned_interests)),
  language TEXT NOT NULL,
  style TEXT NOT NULL CHECK(style IN ('explore','debate','listen')),
  learning_consent INTEGER NOT NULL DEFAULT 0 CHECK(learning_consent IN (0,1)),
  dataset_consent INTEGER NOT NULL DEFAULT 0 CHECK(dataset_consent IN (0,1)),
  training_consent INTEGER NOT NULL DEFAULT 0 CHECK(training_consent IN (0,1)),
  consent_version TEXT NOT NULL DEFAULT '2026-09-22',
  adult_confirmed INTEGER NOT NULL CHECK(adult_confirmed = 1),
  suspended INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS queue (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  heartbeat_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS queue_heartbeat ON queue(heartbeat_at);
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topics TEXT NOT NULL CHECK(json_valid(topics)),
  prompt TEXT NOT NULL,
  language TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended')),
  dataset_a INTEGER NOT NULL,
  dataset_b INTEGER NOT NULL,
  training_a INTEGER NOT NULL,
  training_b INTEGER NOT NULL,
  export_revoked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  ended_at INTEGER,
  last_activity INTEGER NOT NULL,
  CHECK(user_a <> user_b)
);
CREATE INDEX IF NOT EXISTS rooms_a ON rooms(user_a,created_at DESC);
CREATE INDEX IF NOT EXISTS rooms_b ON rooms(user_b,created_at DESC);
CREATE INDEX IF NOT EXISTS rooms_retention ON rooms(created_at);
CREATE TABLE IF NOT EXISTS active_members (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  heartbeat_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS active_room ON active_members(room_id);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 2000),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_room ON messages(room_id,id);
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(blocker_id,blocked_id),
  CHECK(blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS blocks_reverse ON blocks(blocked_id,blocker_id);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolution TEXT,
  UNIQUE(room_id,reporter_id)
);
CREATE TABLE IF NOT EXISTS feedback (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating TEXT NOT NULL CHECK(rating IN ('good','poor')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(room_id,user_id)
);
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_expiry ON rate_limits(expires_at);

-- A single INSERT into rooms claims BOTH people in the same SQLite statement.
-- The unique user key prevents competing requests from double-matching anyone.
CREATE TRIGGER IF NOT EXISTS rooms_claim_members AFTER INSERT ON rooms
WHEN NEW.status = 'active'
BEGIN
  INSERT INTO active_members(user_id,room_id,heartbeat_at) VALUES(NEW.user_a,NEW.id,NEW.created_at);
  INSERT INTO active_members(user_id,room_id,heartbeat_at) VALUES(NEW.user_b,NEW.id,NEW.created_at);
  DELETE FROM queue WHERE user_id IN (NEW.user_a,NEW.user_b);
END;
CREATE TRIGGER IF NOT EXISTS rooms_release_members AFTER UPDATE OF status ON rooms
WHEN NEW.status = 'ended'
BEGIN
  DELETE FROM active_members WHERE room_id = NEW.id;
END;
-- Withdrawing dataset/training permission permanently invalidates previous rooms.
-- Opting back in never retroactively re-enables an old conversation.
CREATE TRIGGER IF NOT EXISTS users_revoke_exports AFTER UPDATE OF dataset_consent,training_consent ON users
WHEN (OLD.dataset_consent = 1 AND NEW.dataset_consent = 0)
  OR (OLD.training_consent = 1 AND NEW.training_consent = 0)
BEGIN
  UPDATE rooms SET export_revoked = 1 WHERE user_a = NEW.id OR user_b = NEW.id;
END;
CREATE TABLE IF NOT EXISTS friendships (
  id TEXT PRIMARY KEY,
  user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('pending','accepted','removed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_a,user_b), CHECK(user_a < user_b)
);
CREATE INDEX IF NOT EXISTS friends_a ON friendships(user_a,status);
CREATE INDEX IF NOT EXISTS friends_b ON friendships(user_b,status);
CREATE TABLE IF NOT EXISTS friend_threads (
  room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  friendship_id TEXT NOT NULL REFERENCES friendships(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS friend_threads_friend ON friend_threads(friendship_id);
