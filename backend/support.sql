CREATE TABLE IF NOT EXISTS support_threads (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 category TEXT NOT NULL CHECK(category IN ('physical','mental','other')),
 language TEXT NOT NULL CHECK(language IN ('English','Hindi')),
 status TEXT NOT NULL DEFAULT 'ai' CHECK(status IN ('ai','waiting','answered','closed')),
 urgent INTEGER NOT NULL DEFAULT 0,
 consent_version TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 ai_lock_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS support_user ON support_threads(user_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS support_inbox ON support_threads(status,updated_at DESC);
CREATE TABLE IF NOT EXISTS support_messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 thread_id TEXT NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('user','ai','team','notice')),
 text TEXT NOT NULL,
 request_id TEXT NOT NULL UNIQUE,
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS support_history ON support_messages(thread_id,id);
CREATE INDEX IF NOT EXISTS support_expiry ON support_messages(created_at);
