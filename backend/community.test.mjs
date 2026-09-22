import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { onRequest, testing } from '../functions/api/community/[[path]].js';
import maintenanceWorker from './maintenance-worker.js';
import { PHILOSOPHERS } from '../community/philosophers.js';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const origin = 'https://voiceofvrindavan.test';
const password = 'A-very-long-test-password!';

function fixture() {
  const sql = new DatabaseSync(':memory:'); sql.exec(schema);
  function prepare(query, values = []) {
    return {
      bind: (...args) => prepare(query, args),
      async first() { return sql.prepare(query).get(...values) || null; },
      async all() { return { success: true, results: sql.prepare(query).all(...values) }; },
      async run() { return { success: true, results: sql.prepare(query).all(...values) }; },
      exec() { return { success: true, results: sql.prepare(query).all(...values) }; }
    };
  }
  const db = { prepare, async batch(statements) {
    sql.exec('BEGIN');
    try { const result = statements.map(s => s.exec()); sql.exec('COMMIT'); return result; }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  }};
  const env = { COMMUNITY_DB: db, AUTH_PEPPER: 'test-auth-pepper-'.repeat(4), ADMIN_TOKEN: 'admin-token-'.repeat(5), DATASET_EXPORT_TOKEN: 'export-only-'.repeat(5) };
  async function call(path, { method = 'GET', data, cookie, token, requestOrigin = origin, ip = '192.0.2.1' } = {}) {
    const headers = new Headers({ Origin: requestOrigin, 'CF-Connecting-IP': ip });
    if (cookie) headers.set('Cookie', cookie);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (data !== undefined) headers.set('Content-Type', 'application/json');
    const response = await onRequest({ env, request: new Request(`${origin}/api/community/${path}`, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) }) });
    const content = await response.text();
    return { status: response.status, data: response.headers.get('Content-Type')?.includes('application/json') ? JSON.parse(content) : content,
      cookie: response.headers.get('Set-Cookie')?.split(';')[0], headers: response.headers };
  }
  async function register(username, overrides = {}) {
    const response = await call('register', { method: 'POST', ip: `192.0.2.${username.length}`, data: { username, password, displayName: username,
      interests: ['philosopher:krishna'], language: 'English', style: 'explore', learningConsent: false, datasetConsent: false, trainingConsent: false, adult: true, ...overrides } });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response;
  }
  async function match(a, b) {
    const waiting = await call('connect', { method: 'POST', cookie: a.cookie, data: {} });
    assert.equal(waiting.data.state, 'waiting');
    const connected = await call('connect', { method: 'POST', cookie: b.cookie, data: {} });
    assert.equal(connected.data.state, 'matched', JSON.stringify(connected));
    return connected.data.room.id;
  }
  return { sql, db, env, call, register, match };
}

test('accounts require adult/consent validation, use hashed passwords and secure sessions', async () => {
  const f = fixture();
  const a = await f.register('alice');
  assert.equal(a.data.recoveryCode.length, 48);
  assert.match(a.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Strict/);
  const stored = f.sql.prepare('SELECT * FROM users').get();
  assert.notEqual(stored.password_hash, password); assert.match(stored.password_hash, /^pbkdf2-sha256\$100000\$/);
  assert.notEqual(stored.recovery_hash, a.data.recoveryCode);
  const me = await f.call('me', { cookie: a.cookie });
  assert.equal(me.data.user.username, 'alice'); assert.equal(me.data.user.password_hash, undefined);
  const anonymous = await f.call('me'); assert.equal(anonymous.data.user, null);
  assert.equal((await f.call('register', { method: 'POST', data: { username: 'child', password, adult: false } })).status, 400);
  assert.equal((await f.call('login', { method: 'POST', data: { username: 'alice', password: 'not-the-right-password' } })).status, 401);
  assert.equal((await f.call('login', { method: 'POST', data: { username: 'alice', password } })).status, 200);
  assert.equal((await f.call('logout', { method: 'POST', cookie: a.cookie, data: {} })).status, 200);
  assert.equal((await f.call('me', { cookie: a.cookie })).data.user, null);
});

test('minimal registration defers interests until the room and keeps optional consent off', async () => {
  const f = fixture();
  const a = await f.call('register', { method: 'POST', data: { username: 'New Person', password, adult: true } });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  assert.deepEqual(a.data.user.interests, []);
  assert.equal(a.data.user.displayName, 'New Person');
  for (const key of ['learningConsent', 'datasetConsent', 'trainingConsent']) assert.equal(a.data.user[key], false);
  assert.equal((await f.call('login', { method: 'POST', data: { username: ' NEW  PERSON ', password } })).status, 200);
  assert.equal((await f.call('connect', { method: 'POST', cookie: a.cookie, data: {} })).status, 400);
  const profile = await f.call('profile', { method: 'POST', cookie: a.cookie, data: { interests: ['philosopher:krishna'], language: 'English', style: 'explore' } });
  assert.equal(profile.status, 200, JSON.stringify(profile.data));
  assert.equal(profile.data.user.datasetConsent, false);
  const b = await f.register('another');
  await f.match(a, b);
});

test('one shared philosopher matches and the choice survives privacy changes', async () => {
  const f = fixture();
  assert.equal(new Set(PHILOSOPHERS.map(p => p.id)).size, PHILOSOPHERS.length);
  const a = await f.register('alice', { interests: ['philosopher:ashtavakra'] });
  const b = await f.register('bobby', { interests: ['philosopher:ashtavakra'] });
  const roomId = await f.match(a, b);
  const state = await f.call('state', { cookie:a.cookie });
  assert.deepEqual(state.data.room.topics, ['philosopher:ashtavakra']);
  await f.call('leave', { method:'POST', cookie:a.cookie, data:{roomId} });
  assert.equal((await f.call('profile', {method:'POST',cookie:a.cookie,data:{interests:['philosopher:others']}})).status,200);
  const changed = await f.call('profile', {method:'POST',cookie:a.cookie,data:{datasetConsent:true}});
  assert.deepEqual(changed.data.user.interests,['philosopher:others']);
  for (const interests of [['philosopher:unknown'], ['<script>'], PHILOSOPHERS.slice(0,11).map(p=>p.id)]) {
    assert.equal((await f.call('profile',{method:'POST',cookie:a.cookie,data:{interests}})).status,400);
  }
});

test('matching stays within one teacher and English or Hindi, even after a long wait', async () => {
  const f = fixture();
  const a = await f.register('alice', { interests:['philosopher:osho'] });
  const b = await f.register('bobby', { interests:['philosopher:buddha'] });
  const c = await f.register('carol', { interests:['philosopher:osho'], language:'Hindi' });
  for (const user of [a,b,c]) assert.equal((await f.call('connect',{method:'POST',cookie:user.cookie,data:{}})).data.state,'waiting');
  f.sql.prepare('UPDATE queue SET joined_at=?').run(Date.now()-300000);
  for (const user of [a,b,c]) assert.equal((await f.call('state',{cookie:user.cookie})).data.state,'waiting');
  for (const data of [{interests:['truth']},{interests:['philosopher:osho','philosopher:buddha']},{language:'Assamese'},{language:'Other'}]) {
    assert.equal((await f.call('profile',{method:'POST',cookie:a.cookie,data})).status,400);
  }
  const d = await f.register('daphne', { interests:['philosopher:osho'], language:'Hindi' });
  const matched = await f.call('connect',{method:'POST',cookie:d.cookie,data:{}});
  assert.equal(matched.data.state,'matched');
  assert.equal(matched.data.room.partner.displayName,'carol');
  // Existing accounts may edit privacy, but must replace old multi-topic settings before queueing.
  f.sql.prepare('UPDATE users SET interests=?,language=? WHERE id=?').run('["truth","ethics"]','Assamese',a.data.user.id);
  assert.equal((await f.call('profile',{method:'POST',cookie:a.cookie,data:{datasetConsent:false}})).status,200);
  assert.equal((await f.call('connect',{method:'POST',cookie:a.cookie,data:{}})).status,400);
});

test('matching, messaging and feedback work; outsiders cannot read or write a room', async () => {
  const f = fixture(); const a = await f.register('alice'); const b = await f.register('bob'); const c = await f.register('charlie');
  const roomId = await f.match(a, b);
  const message = await f.call('message', { method: 'POST', cookie: a.cookie, data: { roomId, text: 'What makes a belief true?' } });
  assert.equal(message.status, 201); assert.equal(message.data.message.speaker, 'self');
  const state = await f.call('state', { cookie: b.cookie });
  assert.equal(state.data.messages[0].speaker, 'partner'); assert.equal(state.data.room.partner.displayName, 'alice');
  assert.deepEqual((await f.call(`state?after=${message.data.message.id}`, { cookie: b.cookie })).data.messages, []);
  assert.equal((await f.call('message', { method: 'POST', cookie: c.cookie, data: { roomId, text: 'Intrusion' } })).status, 404);
  assert.equal((await f.call('report', { method: 'POST', cookie: c.cookie, data: { roomId, reason: 'Intrusion' } })).status, 404);
  await f.call('leave', { method: 'POST', cookie: a.cookie, data: { roomId } });
  assert.equal((await f.call('state', { cookie: b.cookie })).data.state, 'ended');
  assert.equal((await f.call('message', { method: 'POST', cookie: b.cookie, data: { roomId, text: 'After ended' } })).status, 409);
  assert.equal((await f.call('feedback', { method: 'POST', cookie: b.cookie, data: { roomId, rating: 'good' } })).status, 200);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM active_members').get().n, 0);
});

test('concurrent matching never assigns a person twice and excludes language mismatch', async () => {
  const f = fixture(); const a = await f.register('alice'); const b = await f.register('bob'); const c = await f.register('charlie');
  const d = await f.register('daphne', { language: 'Hindi' });
  await Promise.all([a, b, c, d].map(x => f.call('connect', { method: 'POST', cookie: x.cookie, data: {} })));
  const rooms = f.sql.prepare('SELECT * FROM rooms').all();
  assert.equal(rooms.length, 1); assert.equal(rooms[0].language, 'English');
  const members = f.sql.prepare('SELECT * FROM active_members').all();
  assert.equal(members.length, 2); assert.equal(new Set(members.map(x => x.user_id)).size, 2);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM queue').get().n, 2);
  assert.equal((await f.call('state', { cookie: d.cookie })).data.state, 'waiting');
});

test('database trigger enforces exclusive membership and rolls back losing room insert', async () => {
  const f = fixture(); const a = await f.register('alice'); const b = await f.register('bob'); const c = await f.register('charlie');
  await f.match(a, b);
  assert.throws(() => f.sql.prepare(`INSERT INTO rooms(id,user_a,user_b,topics,prompt,language,dataset_a,dataset_b,training_a,training_b,created_at,last_activity)
    VALUES('competing',?,?,'["truth"]','Question','English',0,0,0,0,1,1)`).run(a.data.user.id, c.data.user.id), /UNIQUE/);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM rooms WHERE id='competing'").get().n, 0);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM active_members').get().n, 2);
});

test('cancel without a room ID also ends a match that raced the waiting screen', async () => {
  const f = fixture(); const a = await f.register('alice'); const b = await f.register('bob');
  await f.match(a, b);
  const result = await f.call('leave', { method: 'POST', cookie: a.cookie, data: { roomId: null } });
  assert.equal(result.status, 200);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM active_members').get().n, 0);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM queue').get().n, 0);
  assert.equal((await f.call('state', { cookie: b.cookie })).data.state, 'ended');
});

test('dataset requires both snapshot and current consent, redacts identifiers, and exporter cannot moderate', async () => {
  const f = fixture();
  const a = await f.register('alice', { datasetConsent: true, trainingConsent: true });
  const b = await f.register('bob', { datasetConsent: true, trainingConsent: false });
  const roomId = await f.match(a, b);
  await f.call('message', { method: 'POST', cookie: a.cookie, data: { roomId, text: 'alice writes to bob via hello@example.com or +91 98765 43210 https://example.com' } });
  await f.call('leave', { method: 'POST', cookie: a.cookie, data: { roomId } });
  const exported = await f.call('admin/dataset', { token: f.env.DATASET_EXPORT_TOKEN });
  assert.equal(exported.status, 200);
  const record = JSON.parse(exported.data.trim());
  assert.ok(['A', 'B'].includes(record.messages[0].speaker));
  assert.equal(record.messages[0].text, '[name] writes to [name] via [email] or [number] [link]');
  assert.equal((await f.call('admin/dataset?training=1', { token: f.env.ADMIN_TOKEN })).data, '');
  assert.equal((await f.call('admin/reports', { token: f.env.DATASET_EXPORT_TOKEN })).status, 401);
  assert.equal((await f.call('admin/maintenance', { method: 'POST', token: f.env.DATASET_EXPORT_TOKEN, data: {} })).status, 401);
  await f.call('profile', { method: 'POST', cookie: b.cookie, data: { datasetConsent: false } });
  assert.equal((await f.call('admin/dataset', { token: f.env.ADMIN_TOKEN })).data, '');
  await f.call('profile', { method: 'POST', cookie: b.cookie, data: { datasetConsent: true, trainingConsent: true } });
  assert.equal((await f.call('admin/dataset', { token: f.env.ADMIN_TOKEN })).data, '', 'Opting back in must not restore old rooms.');
});

test('learning is opt-in, only own text, visible and resettable', async () => {
  const f = fixture(); const a = await f.register('alice', { learningConsent: true }); const b = await f.register('bob');
  const roomId = await f.match(a, b);
  await f.call('message', { method: 'POST', cookie: a.cookie, data: { roomId, text: 'Consciousness and truth interest me.' } });
  await f.call('message', { method: 'POST', cookie: b.cookie, data: { roomId, text: 'I love ethics and spirituality.' } });
  const me = await f.call('me', { cookie: a.cookie }); assert.equal(me.data.user.learnedInterests.consciousness, 1); assert.equal(me.data.user.learnedInterests.ethics, undefined);
  assert.deepEqual((await f.call('me', { cookie: b.cookie })).data.user.learnedInterests, {});
  await f.call('profile', { method: 'POST', cookie: a.cookie, data: { resetLearning: true } });
  assert.deepEqual((await f.call('me', { cookie: a.cookie })).data.user.learnedInterests, {});
});

test('blocking is bidirectional and reports support moderation without exporter escalation', async () => {
  const f = fixture(); const a = await f.register('alice', { datasetConsent: true }); const b = await f.register('bob', { datasetConsent: true });
  const roomId = await f.match(a, b);
  await f.call('message', { method: 'POST', cookie: b.cookie, data: { roomId, text: 'Message reported by the other participant.' } });
  await f.call('report', { method: 'POST', cookie: a.cookie, data: { roomId, reason: 'Unwanted contact' } });
  const reports = await f.call('admin/reports', { token: f.env.ADMIN_TOKEN });
  assert.equal(reports.data.reports.length, 1);
  assert.equal((await f.call('admin/dataset', { token: f.env.ADMIN_TOKEN })).data, '');
  const room = await f.call(`admin/reported-room?roomId=${roomId}`, { token: f.env.ADMIN_TOKEN }); assert.equal(room.data.messages.length, 1);
  await f.call('block', { method: 'POST', cookie: a.cookie, data: { roomId } });
  f.sql.prepare('UPDATE rooms SET created_at=?').run(Date.now() - 700000);
  await f.call('connect', { method: 'POST', cookie: b.cookie, data: {} });
  await f.call('connect', { method: 'POST', cookie: a.cookie, data: {} });
  assert.equal(f.sql.prepare('SELECT count(*) n FROM active_members').get().n, 0);
  await f.call('admin/moderate', { method: 'POST', token: f.env.ADMIN_TOKEN, data: { reportId: reports.data.reports[0].id, action: 'ban' } });
  assert.equal((await f.call('me', { cookie: b.cookie })).data.user, null);
  assert.equal((await f.call('login', { method: 'POST', data: { username: 'bob', password } })).status, 401);
});

test('recovery rotates recovery code and revokes existing sessions; account deletion cascades chats', async () => {
  const f = fixture(); const a = await f.register('alice'); const b = await f.register('bob'); const roomId = await f.match(a, b);
  await f.call('message', { method: 'POST', cookie: b.cookie, data: { roomId, text: 'This conversation will be deleted.' } });
  const recovered = await f.call('recover', { method: 'POST', data: { username: 'alice', recoveryCode: a.data.recoveryCode, password: 'New-and-longer-password!' } });
  assert.equal(recovered.status, 200); assert.notEqual(recovered.data.recoveryCode, a.data.recoveryCode);
  assert.equal((await f.call('me', { cookie: a.cookie })).data.user, null);
  assert.equal((await f.call('recover', { method: 'POST', data: { username: 'alice', recoveryCode: a.data.recoveryCode, password } })).status, 401);
  assert.equal((await f.call('delete-account', { method: 'POST', cookie: recovered.cookie, data: { password: 'New-and-longer-password!' } })).status, 200);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM rooms').get().n, 0);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM messages').get().n, 0);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM active_members').get().n, 0);
  assert.equal((await f.call('state', { cookie: b.cookie })).data.state, 'idle');
});

test('origin, size, message rate and idle expiry safeguards are enforced', async () => {
  const f = fixture(); const a = await f.register('alice'); const b = await f.register('bob'); const roomId = await f.match(a, b);
  assert.equal((await f.call('profile', { method: 'POST', cookie: a.cookie, requestOrigin: 'https://evil.example', data: { displayName: 'Hijacked' } })).status, 403);
  assert.equal((await f.call('message', { method: 'POST', cookie: a.cookie, data: { roomId, text: 'x'.repeat(17000) } })).status, 413);
  for (let index = 0; index < 30; index++) assert.equal((await f.call('message', { method: 'POST', cookie: a.cookie, data: { roomId, text: `Message ${index}` } })).status, 201);
  assert.equal((await f.call('message', { method: 'POST', cookie: a.cookie, data: { roomId, text: 'Rate limit' } })).status, 429);
  f.sql.prepare('UPDATE active_members SET heartbeat_at=? WHERE user_id=?').run(Date.now() - 100000, b.data.user.id);
  assert.equal((await f.call('state', { cookie: a.cookie })).data.state, 'ended');
});

test('expired content is excluded and retention maintenance physically deletes it', async () => {
  const f = fixture(); const a = await f.register('alice', { datasetConsent: true }); const b = await f.register('bob', { datasetConsent: true });
  const roomId = await f.match(a, b);
  await f.call('message', { method: 'POST', cookie: a.cookie, data: { roomId, text: 'Old content' } });
  await f.call('leave', { method: 'POST', cookie: a.cookie, data: { roomId } });
  f.sql.prepare('UPDATE rooms SET created_at=?').run(Date.now() - 31 * 86400000);
  assert.deepEqual((await f.call('export', { cookie: a.cookie })).data.messages, []);
  assert.equal(maintenanceWorker.fetch, undefined);
  await maintenanceWorker.scheduled({ scheduledTime: Date.now() }, { COMMUNITY_DB: f.db });
  assert.equal(f.sql.prepare('SELECT count(*) n FROM rooms').get().n, 0);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM messages').get().n, 0);
});

test('live transport uses read-only presence snapshots and publishes saved messages', async () => {
  const f = fixture();
  const a = await f.register('livealice'), b = await f.register('livebruno');
  const notifications = [];
  const stub = { async prepare(id) { notifications.push(['prepare',id]); }, async refresh(ids) { notifications.push(['refresh',ids]); }, async deliver(id) { notifications.push(['deliver',id]); } };
  f.env.CHAT_ROOMS = f.env.CHAT_LOBBIES = { idFromName: value => value, get: () => stub };
  assert.equal((await f.call('me', { cookie:a.cookie })).data.realtime,true);
  const roomId = await f.match(a,b);
  const before = f.sql.prepare('SELECT user_id,heartbeat_at FROM active_members ORDER BY user_id').all();
  await new Promise(resolve => setTimeout(resolve,10));
  await f.call('state', {cookie:a.cookie});
  assert.deepEqual(f.sql.prepare('SELECT user_id,heartbeat_at FROM active_members ORDER BY user_id').all(),before);
  const sent = await f.call('message',{method:'POST',cookie:a.cookie,data:{roomId,text:'Persistent before push'}});
  assert.equal(sent.status,201);
  assert(notifications.some(([kind,id])=>kind==='deliver' && id===sent.data.message.id));
  stub.deliver=async()=>{throw new Error('Temporary delivery outage');};
  const recovered = await f.call('message',{method:'POST',cookie:a.cookie,data:{roomId,text:'Recover this on reconnect'}});
  assert.equal(recovered.status,201);
  const state=await f.call('state',{cookie:b.cookie});
  assert.equal(state.data.messages.length,2);
  assert.equal(state.data.messages[1].text,'Recover this on reconnect');
});
