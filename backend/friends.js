// Friendship authorization is checked again inside message writes, not just in the UI.
export async function friendsRequest({ db, user, path, request, url, data, now }, h) {
  const { stmt, rows, fail, json, rate, roomFor, messageView } = h;
  const cutoff = now - 30 * 86400000;
  const available = `a.suspended=0 AND b.suspended=0 AND NOT EXISTS(SELECT 1 FROM blocks bl
    WHERE (bl.blocker_id=f.user_a AND bl.blocked_id=f.user_b) OR (bl.blocker_id=f.user_b AND bl.blocked_id=f.user_a))`;
  const base = `FROM friendships f JOIN users a ON a.id=f.user_a JOIN users b ON b.id=f.user_b`;
  const visible = `(f.user_a=? OR f.user_b=?) AND ${available}`;
  const select = `SELECT f.*,CASE WHEN f.user_a=? THEN b.display_name ELSE a.display_name END AS name ${base}`;
  const view = f => ({ id: f.id, displayName: f.name, status: f.status, incoming: f.requester !== user.id });
  await rate(db, `friends:${user.id}`, 100, 60000, now);
  if (path === 'friends' && request.method === 'GET') {
    const friends = rows(await stmt(db, `${select} WHERE ${visible} AND f.status IN ('pending','accepted') ORDER BY f.updated_at DESC LIMIT 200`, user.id, user.id, user.id).all());
    return json({ friends: friends.map(view) });
  }
  if (path === 'friends/request' && request.method === 'POST') {
    await rate(db, `friend-request:${user.id}`, 20, 86400000, now);
    const room = await roomFor(db, user.id, data.roomId);
    if (room.created_at <= cutoff) fail(404, 'expired_room', 'This conversation has expired.');
    const partner = room.user_a === user.id ? room.user_b : room.user_a;
    const [a, b] = [user.id, partner].sort();
    const permitted = await stmt(db, `SELECT id FROM users WHERE id=? AND suspended=0 AND NOT EXISTS
      (SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?))`, partner, a, b, b, a).first();
    if (!permitted) fail(404, 'unavailable', 'This person is unavailable.');
    const existing = await stmt(db, 'SELECT * FROM friendships WHERE user_a=? AND user_b=?', a, b).first();
    if (existing && existing.status !== 'removed') return json({ status: existing.status, incoming: existing.requester !== user.id });
    if (existing && existing.updated_at > now - 7 * 86400000) fail(429, 'request_wait', 'Please wait seven days before sending another request to this person.');
    const full = await stmt(db, `SELECT count(*) AS n FROM friendships WHERE status IN ('accepted','pending') AND (user_a=? OR user_b=? OR user_a=? OR user_b=?)`, a, a, b, b).first();
    if (full.n >= 200) fail(409, 'friends_limit', 'The friends list is full. Remove an old request or friendship first.');
    await stmt(db, `INSERT INTO friendships(id,user_a,user_b,requester,status,created_at,updated_at) VALUES(?,?,?,?,'pending',?,?)
      ON CONFLICT(user_a,user_b) DO UPDATE SET requester=excluded.requester,status='pending',updated_at=excluded.updated_at
      WHERE friendships.status='removed' AND friendships.updated_at<=?`, crypto.randomUUID(), a, b, user.id, now, now, now - 7 * 86400000).run();
    return json({ status: 'pending', incoming: false });
  }
  const id = request.method === 'GET' ? url.searchParams.get('id') : data.id;
  if (typeof id !== 'string' || id.length > 64) fail(400, 'invalid_friend', 'Choose a friend.');
  const friend = await stmt(db, `${select} WHERE f.id=? AND ${visible} AND f.status IN ('pending','accepted')`, user.id, id, user.id, user.id).first();
  if (!friend) fail(404, 'friend_unavailable', 'This friendship is unavailable.');
  const partner = friend.user_a === user.id ? friend.user_b : friend.user_a;
  if (path === 'friends/respond' && request.method === 'POST') {
    if (!['accept','remove','block'].includes(data.action)) fail(400, 'invalid_action', 'Choose an action.');
    if (data.action === 'accept') {
      if (friend.status !== 'pending' || friend.requester === user.id) fail(403, 'recipient_only', 'Only the recipient can accept this request.');
      await stmt(db, "UPDATE friendships SET status='accepted',updated_at=? WHERE id=? AND status='pending' AND requester<>?", now, id, user.id).run();
    } else {
      const changes = [stmt(db, "UPDATE friendships SET status='removed',updated_at=? WHERE id=?", now, id)];
      if (data.action === 'block') changes.push(
        stmt(db, 'INSERT OR IGNORE INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)', user.id, partner, now),
        stmt(db, "UPDATE rooms SET status='ended',ended_at=COALESCE(ended_at,?),export_revoked=1 WHERE (user_a=? AND user_b=?) OR (user_a=? AND user_b=?)", now, user.id, partner, partner, user.id));
      await db.batch(changes);
    }
    return json({ ok: true });
  }
  if (friend.status !== 'accepted') fail(403, 'accept_first', 'Accept the friend request before chatting.');
  if (path === 'friends/report' && request.method === 'POST') {
    const linked = await stmt(db, 'SELECT room_id FROM friend_threads WHERE friendship_id=? AND room_id=?', id, String(data.roomId || '')).first();
    if (!linked) fail(404, 'room_not_found', 'This conversation is unavailable.');
    const reason = typeof data.reason === 'string' ? data.reason.trim() : '';
    if (reason.length < 3 || reason.length > 1000) fail(400, 'invalid_reason', 'Briefly describe the issue in 3–1,000 characters.');
    await db.batch([
      stmt(db, 'INSERT OR IGNORE INTO reports(id,room_id,reporter_id,reported_id,reason,created_at) VALUES(?,?,?,?,?,?)', crypto.randomUUID(), linked.room_id, user.id, partner, reason, now),
      stmt(db, 'UPDATE rooms SET export_revoked=1 WHERE id=?', linked.room_id)
    ]);
    return json({ ok: true });
  }
  if (path === 'friends/messages' && request.method === 'GET') {
    const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
    const before = Math.max(0, Number(url.searchParams.get('before')) || 0);
    const messages = rows(await stmt(db, `SELECT m.* FROM friend_threads t JOIN rooms r ON r.id=t.room_id JOIN messages m ON m.room_id=r.id
      WHERE t.friendship_id=? AND r.created_at>? AND m.id>? AND (?=0 OR m.id<?)
      ORDER BY m.id ${after ? 'ASC' : 'DESC'} LIMIT 100`, id, cutoff, after, before, before).all());
    if (!after) messages.reverse();
    return json({ friend: view(friend), messages: messages.map(m => ({ ...messageView(m, user.id), roomId: m.room_id })), hasMore: messages.length === 100 });
  }
  if (path === 'friends/send' && request.method === 'POST') {
    await rate(db, `message:${user.id}`, 30, 60000, now);
    const text = typeof data.text === 'string' ? data.text.trim() : '';
    if (!text || text.length > 2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) fail(400, 'invalid_message', 'Write a message of 1–2,000 characters.');
    const authorized = `EXISTS(SELECT 1 ${base} WHERE f.id=? AND f.status='accepted' AND ${visible})`;
    // Bounded room segments reuse existing retention, export, account download and moderation.
    // Ended segments never reserve either person's random-match slot.
    const usable = `SELECT r.id FROM friend_threads t JOIN rooms r ON r.id=t.room_id WHERE t.friendship_id=? AND r.created_at>?
      AND (SELECT count(*) FROM messages m WHERE m.room_id=r.id)<400 ORDER BY r.created_at DESC,r.id DESC LIMIT 1`;
    const roomId = crypto.randomUUID();
    const result = await db.batch([
      stmt(db, `INSERT INTO rooms(id,user_a,user_b,topics,prompt,language,status,dataset_a,dataset_b,training_a,training_b,created_at,ended_at,last_activity)
        SELECT ?,f.user_a,f.user_b,'[]','Friends conversation',a.language,'ended',a.dataset_consent,b.dataset_consent,0,0,?,?,?
        ${base} WHERE f.id=? AND f.status='accepted' AND ${visible} AND NOT EXISTS(${usable})`,
      roomId, now, now, now, id, user.id, user.id, id, cutoff),
      stmt(db, 'INSERT INTO friend_threads(room_id,friendship_id) SELECT id,? FROM rooms WHERE id=?', id, roomId),
      stmt(db, `INSERT INTO messages(room_id,sender_id,text,created_at) SELECT room.id,?,?,? FROM rooms room
        WHERE room.id=(${usable}) AND ${authorized} RETURNING *`, user.id, text, now, id, cutoff, id, user.id, user.id),
      stmt(db, 'UPDATE friendships SET updated_at=? WHERE id=?', now, id)
    ]);
    const saved = rows(result[2])[0];
    if (!saved) fail(409, 'friend_unavailable', 'This friendship is no longer available.');
    return json({ message: { ...messageView(saved, user.id), roomId: saved.room_id } }, 201);
  }
  fail(404, 'not_found', 'This endpoint does not exist.');
}
