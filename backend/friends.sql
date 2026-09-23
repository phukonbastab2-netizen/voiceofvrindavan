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
