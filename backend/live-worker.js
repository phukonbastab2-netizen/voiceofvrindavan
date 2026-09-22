import { DurableObject } from 'cloudflare:workers';
import { stmt, getState, messageView } from '../functions/api/community/[[path]].js';
import { lobbyFor, roomForLive } from './live-api.js';

const GRACE = 90000, TICK = 60000, ROOM_LIFE = 7200000;
export async function sessionUser(db, hash) {
  return stmt(db, `SELECT u.*,s.token_hash AS session_hash,s.expires_at AS session_expires
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.suspended=0`, hash, Date.now()).first();
}

class LiveBase extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS disconnected(user_id TEXT PRIMARY KEY,deadline INTEGER NOT NULL)');
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  sockets(id) { return this.ctx.getWebSockets(id).filter(s => s.readyState === 1); }
  async arm() { if (!await this.ctx.storage.getAlarm()) await this.ctx.storage.setAlarm(Date.now() + TICK); }
  async accept(request, user) {
    // Two tabs per person; opening more replaces older connections.
    for (const old of this.sockets(user.id).slice(0, -1)) old.close(4000, 'Opened in another tab');
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [user.id]);
    server.serializeAttachment({ userId: user.id, sessionHash: user.session_hash, connectedAt: Date.now() });
    this.ctx.storage.sql.exec('DELETE FROM disconnected WHERE user_id=?', user.id);
    await this.arm();
    server.send(JSON.stringify({ type: 'ready' }));
    return new Response(null, { status: 101, webSocket: client });
  }
  async eligible(socket) {
    const a = socket.deserializeAttachment();
    const user = a && await sessionUser(this.env.COMMUNITY_DB, a.sessionHash);
    if (!user || user.id !== a.userId) { socket.close(4001, 'Session expired'); return null; }
    return user;
  }
  async send(socket, event) {
    if (socket.readyState !== 1 || !await this.eligible(socket)) return;
    try { socket.send(JSON.stringify(event)); } catch { /* close handler cleans up */ }
  }
  async webSocketMessage(socket) {
    // Application writes use the authenticated, rate-limited HTTP API. Only
    // ping/pong is accepted here, and is answered by the hibernating runtime.
    socket.close(1008, 'Unsupported message');
  }
  async webSocketClose(socket, code) {
    const a = socket.deserializeAttachment();
    try { socket.close(code === 1006 ? 1000 : code); } catch {}
    if (!a || this.sockets(a.userId).length) return;
    this.ctx.storage.sql.exec('INSERT INTO disconnected VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET deadline=excluded.deadline', a.userId, Date.now() + GRACE);
    await this.arm();
  }
  async webSocketError(socket) { return this.webSocketClose(socket, 1011); }
  async sweep() {
    const now = Date.now();
    for (const s of this.sockets()) {
      const a = s.deserializeAttachment();
      const last = this.ctx.getWebSocketAutoResponseTimestamp(s)?.getTime() || a.connectedAt;
      if (now - last > GRACE) {
        s.close(4000, 'Reconnect required');
        this.ctx.storage.sql.exec('INSERT INTO disconnected VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET deadline=MIN(deadline,excluded.deadline)', a.userId, now);
      }
    }
  }
  due() { return this.ctx.storage.sql.exec('SELECT * FROM disconnected WHERE deadline<=?', Date.now()).toArray(); }
  hasPending() { return this.ctx.storage.sql.exec('SELECT count(*) AS n FROM disconnected').one().n > 0; }
}

export class ChatRoom extends LiveBase {
  async prepare(id) {
    const old = await this.ctx.storage.get('room');
    if (old) { if (old.id !== id) throw new Error('Room identity mismatch'); return; }
    const room = await stmt(this.env.COMMUNITY_DB, 'SELECT * FROM rooms WHERE id=? AND status=\'active\'', id).first();
    if (!room) return;
    await this.ctx.storage.put('room', { id, members: [room.user_a, room.user_b], expires: room.created_at + ROOM_LIFE });
    // One lease per room, replacing every-four-second presence writes.
    await stmt(this.env.COMMUNITY_DB, 'UPDATE active_members SET heartbeat_at=? WHERE room_id=?', room.created_at + ROOM_LIFE, id).run();
    for (const uid of [room.user_a, room.user_b]) if (!this.sockets(uid).length) {
      this.ctx.storage.sql.exec('INSERT OR IGNORE INTO disconnected VALUES(?,?)', uid, Date.now() + GRACE);
    }
    await this.arm();
  }
  async fetch(request) {
    const user = await sessionUser(this.env.COMMUNITY_DB, request.headers.get('X-Session-Hash'));
    if (!user) return new Response('Unauthorized', { status: 401 });
    const id = new URL(request.url).searchParams.get('room');
    const room = await stmt(this.env.COMMUNITY_DB, 'SELECT * FROM rooms WHERE id=? AND status=\'active\' AND (user_a=? OR user_b=?) AND created_at>?', id, user.id, user.id, Date.now() - ROOM_LIFE).first();
    if (!room) return new Response('Room unavailable', { status: 404 });
    await this.prepare(id);
    return this.accept(request, user);
  }
  async deliver(messageId) {
    const meta = await this.ctx.storage.get('room');
    if (!meta) return;
    const m = await stmt(this.env.COMMUNITY_DB, `SELECT m.* FROM messages m JOIN rooms r ON r.id=m.room_id
      WHERE m.id=? AND m.room_id=? AND r.status='active' AND r.created_at>?`, messageId, meta.id, Date.now() - ROOM_LIFE).first();
    if (!m) { await this.refresh(); return; }
    await Promise.all(this.sockets().map(s => this.send(s, { type: 'message', roomId: meta.id, message: messageView(m, s.deserializeAttachment().userId) })));
  }
  async refresh(onlyEnded = false) {
    const meta = await this.ctx.storage.get('room');
    if (!meta) return;
    const room = await stmt(this.env.COMMUNITY_DB, 'SELECT status FROM rooms WHERE id=?', meta.id).first();
    const ended = !room || room.status !== 'active';
    if (ended || !onlyEnded) await Promise.all(this.sockets().map(s => this.send(s, { type: ended ? 'ended' : 'refresh', roomId: meta.id })));
    if (ended) {
      for (const s of this.sockets()) s.close(1000, 'Conversation ended');
      await this.ctx.storage.delete('room');
      this.ctx.storage.sql.exec('DELETE FROM disconnected');
      await this.ctx.storage.deleteAlarm();
    }
  }
  async alarm() {
    await this.sweep();
    const meta = await this.ctx.storage.get('room');
    if (!meta) { this.ctx.storage.sql.exec('DELETE FROM disconnected'); return; }
    const missing = this.due().some(x => !this.sockets(x.user_id).length);
    if (missing || Date.now() >= meta.expires) {
      await stmt(this.env.COMMUNITY_DB, "UPDATE rooms SET status='ended',ended_at=? WHERE id=? AND status='active'", Date.now(), meta.id).run();
    }
    await this.refresh(true);
    if (await this.ctx.storage.get('room')) await this.ctx.storage.setAlarm(Math.min(Date.now() + TICK, meta.expires));
  }
}

export class ChatLobby extends LiveBase {
  async fetch(request) {
    const user = await sessionUser(this.env.COMMUNITY_DB, request.headers.get('X-Session-Hash'));
    if (!user) return new Response('Unauthorized', { status: 401 });
    if (this.sockets().length >= 1000) return new Response('Waiting room is busy. Please try again shortly.', { status: 503 });
    const queue = await stmt(this.env.COMMUNITY_DB, 'SELECT * FROM queue WHERE user_id=? AND heartbeat_at>?', user.id, Date.now() - GRACE).first();
    if (!queue) return new Response('Refresh your room', { status: 409 });
    // Queue lease has an absolute two-hour bound. No periodic D1 updates.
    await stmt(this.env.COMMUNITY_DB, 'UPDATE queue SET heartbeat_at=? WHERE user_id=?', queue.joined_at + ROOM_LIFE, user.id).run();
    return this.accept(request, user);
  }
  async refresh(ids) {
    await Promise.all([...new Set(ids)].flatMap(id => this.sockets(id)).map(s => this.send(s, { type: 'refresh' })));
  }
  async alarm() {
    await this.sweep();
    for (const gone of this.due()) {
      if (!this.sockets(gone.user_id).length) await stmt(this.env.COMMUNITY_DB, 'DELETE FROM queue WHERE user_id=? AND joined_at<=?', gone.user_id, gone.deadline - GRACE).run();
      this.ctx.storage.sql.exec('DELETE FROM disconnected WHERE user_id=?', gone.user_id);
    }
    // One bounded matching pass per minute, only while people are waiting.
    // A new arrival also matches immediately through the regular connect API.
    const unique = new Map(this.sockets().map(s => [s.deserializeAttachment().userId, s]));
    const all = [...unique], offset = (await this.ctx.storage.get('cursor') || 0) % Math.max(1, all.length);
    const batch = [...all.slice(offset), ...all.slice(0,offset)].slice(0,100);
    if (all.length > 100) await this.ctx.storage.put('cursor',(offset+100)%all.length);
    for (const [id, socket] of batch) {
      const user = await this.eligible(socket);
      if (!user) continue;
      const q = await stmt(this.env.COMMUNITY_DB, 'SELECT joined_at FROM queue WHERE user_id=?', id).first();
      if (!q) { await this.refresh([id]); socket.close(1000, 'Queue changed'); continue; }
      if (Date.now() - q.joined_at >= ROOM_LIFE) {
        await stmt(this.env.COMMUNITY_DB, 'DELETE FROM queue WHERE user_id=?', id).run();
        await this.send(socket, { type: 'refresh' }); socket.close(1000, 'Waiting session ended'); continue;
      }
      const result = await getState(this.env.COMMUNITY_DB, user, Date.now(), 0, true);
      if (result.state === 'matched') {
        await roomForLive(this.env, result.room.id).prepare(result.room.id);
        const room = await stmt(this.env.COMMUNITY_DB, 'SELECT user_a,user_b FROM rooms WHERE id=?', result.room.id).first();
        if (room) await this.refresh([room.user_a, room.user_b]);
      }
    }
    if (this.sockets().length || this.hasPending()) await this.ctx.storage.setAlarm(Date.now() + TICK);
  }
}

export default { fetch() { return new Response('Not found', { status: 404 }); } };
