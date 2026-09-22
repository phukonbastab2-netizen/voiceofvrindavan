// Shared by the authenticated API and the scheduled Worker. Each invocation is bounded.
export async function runMaintenance(db, now = Date.now()) {
  const statement = (sql, ...values) => db.prepare(sql).bind(...values);
  return db.batch([
    statement(`UPDATE rooms SET status='ended',ended_at=? WHERE status='active' AND id IN
      (SELECT r.id FROM rooms r WHERE r.status='active' AND (r.created_at<? OR EXISTS
      (SELECT 1 FROM active_members m WHERE m.room_id=r.id AND m.heartbeat_at<?)) LIMIT 100)`, now, now - 7200000, now - 90000),
    statement('DELETE FROM queue WHERE user_id IN (SELECT user_id FROM queue WHERE heartbeat_at<? LIMIT 100)', now - 90000),
    statement('DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at<? LIMIT 500)', now),
    statement('DELETE FROM rate_limits WHERE bucket IN (SELECT bucket FROM rate_limits WHERE expires_at<? LIMIT 500)', now),
    statement('DELETE FROM rooms WHERE id IN (SELECT id FROM rooms WHERE created_at<? LIMIT 100)', now - 30 * 86400000)
  ]);
}
