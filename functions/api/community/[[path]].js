import { liveRequest, liveEnabled } from '../../../backend/live-api.js';
import { runMaintenance as maintenance } from '../../../backend/maintenance.js';
import { PHILOSOPHER_LABELS } from '../../../community/philosophers.js';

const TOPICS = ['truth', 'consciousness', 'free-will', 'ethics', 'spirituality', 'meaning'];
const KEYWORDS = {
  truth: /\b(truth|true|knowledge|evidence|belief|reality)\b/iu,
  consciousness: /\b(consciousness|conscious|awareness|mind|perception|experience)\b/iu,
  'free-will': /\b(free will|choice|determinism|freedom|agency|destiny)\b/iu,
  ethics: /\b(ethics|ethical|moral|morality|justice|virtue|compassion)\b/iu,
  spirituality: /\b(spiritual|spirituality|meditation|soul|god|religion|divine)\b/iu,
  meaning: /\b(meaning|purpose|fulfilment|fulfillment|existence|happiness)\b/iu
};
const COOKIE = '__Host-vov_session';
const DAY = 86400000;
const SESSION_LIFE = 7 * DAY;
const RETENTION = 30 * DAY;
const QUEUE_LIFE = 90000;
const MAX_MESSAGES = 400;
const encoder = new TextEncoder();

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function fail(status, code, message) { throw new ApiError(status, code, message); }
function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...extra
  }});
}
function stmt(db, sql, ...values) { return db.prepare(sql).bind(...values); }
function rows(result) { return result.results || []; }
function parse(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function hex(bytes) { return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join(''); }
function randomHex(length = 32) { return hex(crypto.getRandomValues(new Uint8Array(length))); }
async function digest(value) { return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
async function keyed(value, pepper) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}
async function equal(a, b) {
  const left = await crypto.subtle.digest('SHA-256', encoder.encode(a));
  const right = await crypto.subtle.digest('SHA-256', encoder.encode(b));
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(left, right);
  // Standard WebCrypto runtimes used by local tests do not provide the Workers extension.
  const key = await crypto.subtle.importKey('raw', left, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const signature = await crypto.subtle.sign('HMAC', key, left);
  return crypto.subtle.verify('HMAC', key, signature, right);
}
async function passwordHash(password, pepper, salt = randomHex(16)) {
  const prehash = await keyed(password, pepper);
  const key = await crypto.subtle.importKey('raw', encoder.encode(prehash), 'PBKDF2', false, ['deriveBits']);
  const bytes = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: 100000 }, key, 256);
  return `pbkdf2-sha256$100000$${salt}$${hex(bytes)}`;
}
async function verifyPassword(password, stored, pepper) {
  const parts = String(stored || '').split('$');
  const salt = parts.length === 4 ? parts[2] : '00000000000000000000000000000000';
  return equal(await passwordHash(password, pepper, salt), stored || '');
}
function checkPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) fail(400, 'invalid_password', 'Use a password of 12–128 characters.');
}
function checkUsername(value) {
  if (typeof value !== 'string') fail(400, 'invalid_username', 'Enter your name.');
  const name = value.normalize('NFC').trim().replace(/ +/g, ' ');
  if (name.length < 3 || name.length > 32 || !/^[\p{L}\p{N}_][\p{L}\p{N}_ -]*[\p{L}\p{N}_]$/u.test(name)) fail(400, 'invalid_username', 'Use 3–32 letters, numbers, spaces, hyphens or underscores for your name.');
  return name.toLowerCase();
}
function profileInput(data, existing = null, allowEmptyInterests = false) {
  const value = (key, column) => data[key] === undefined && existing ? existing[column] : data[key];
  const displayName = String(value('displayName', 'display_name') || '').trim();
  if (displayName.length < 2 || displayName.length > 48 || /[\p{Cc}\p{Cf}<>]/u.test(displayName)) fail(400, 'invalid_name', 'Choose a display name of 2–48 characters.');
  const originalInterests = data.interests ?? (existing && parse(existing.interests, []));
  // Preserve legacy settings on privacy-only edits; matching requires a fresh single choice.
  if (!Array.isArray(originalInterests) || (data.interests !== undefined &&
    (originalInterests.length < (allowEmptyInterests ? 0 : 1) || originalInterests.length > 1 ||
    originalInterests.some(v => typeof v !== 'string' || !Object.hasOwn(PHILOSOPHER_LABELS, v)))))
    fail(400, 'invalid_interests', 'Choose one philosopher or spiritual teacher.');
  const interests = [...new Set(originalInterests)];
  const language = String(value('language', 'language') || '').trim();
  if ((data.language !== undefined || !existing) && !['English', 'Hindi'].includes(language)) fail(400, 'invalid_language', 'Choose English or Hindi.');
  const style = 'explore';
  const consent = (key, column) => {
    if (data[key] === undefined) return existing ? existing[column] : 0;
    if (typeof data[key] !== 'boolean') fail(400, 'invalid_consent', 'Consent choices must be true or false.');
    return data[key] ? 1 : 0;
  };
  const learning = consent('learningConsent', 'learning_consent');
  const dataset = consent('datasetConsent', 'dataset_consent');
  const training = consent('trainingConsent', 'training_consent');
  if (training && !dataset) fail(400, 'invalid_consent', 'AI training permission also requires dataset permission.');
  return { displayName, interests, language, style, learning, dataset, training };
}
function safeUser(user) {
  return { id: user.id, username: user.username, displayName: user.display_name,
    interests: parse(user.interests, []), language: user.language, style: user.style,
    learningConsent: Boolean(user.learning_consent), datasetConsent: Boolean(user.dataset_consent), trainingConsent: Boolean(user.training_consent),
    learnedInterests: user.learning_consent ? parse(user.learned_interests, {}) : {}, consentVersion: user.consent_version };
}
async function body(request) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) fail(415, 'json_required', 'Send JSON data.');
  if (Number(request.headers.get('Content-Length') || 0) > 16000) fail(413, 'too_large', 'This request is too large.');
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 16000) { await reader.cancel(); fail(413, 'too_large', 'This request is too large.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let data;
  try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { fail(400, 'invalid_json', 'This request contains invalid JSON.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, 'invalid_json', 'Send a JSON object.');
  return data;
}
async function rate(db, key, maximum, windowMs, now) {
  const bucket = `${key}:${Math.floor(now / windowMs)}`;
  const entry = await stmt(db, `INSERT INTO rate_limits(bucket,count,expires_at) VALUES(?,1,?)
    ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count`, bucket, now + windowMs * 2).first();
  if (entry.count > maximum) fail(429, 'rate_limited', 'Please wait a little before trying again.');
}
function sessionCookie(token = '', expires = SESSION_LIFE / 1000) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${expires}`;
}
async function createSession(db, userId, now) {
  const token = randomHex();
  await stmt(db, 'INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)', await digest(token), userId, now + SESSION_LIFE).run();
  return sessionCookie(token);
}
async function currentUser(db, request, now) {
  const token = (request.headers.get('Cookie') || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  return stmt(db, `SELECT u.*,s.token_hash AS session_hash,s.expires_at AS session_expires FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.suspended=0`, await digest(token), now).first();
}
async function roomFor(db, userId, roomId) {
  if (typeof roomId !== 'string' || roomId.length > 64) fail(400, 'invalid_room', 'Choose a conversation.');
  const room = await stmt(db, 'SELECT * FROM rooms WHERE id=? AND (user_a=? OR user_b=?)', roomId, userId, userId).first();
  if (!room) fail(404, 'room_not_found', 'This conversation is unavailable.');
  return room;
}
async function roomView(db, room, userId) {
  const partnerId = room.user_a === userId ? room.user_b : room.user_a;
  const partner = await stmt(db, 'SELECT display_name FROM users WHERE id=?', partnerId).first();
  return { id: room.id, partner: { displayName: partner?.display_name || 'Former member' }, topics: parse(room.topics, []), prompt: room.prompt, status: room.status };
}
function messageView(message, userId) {
  return { id: message.id, speaker: message.sender_id === userId ? 'self' : 'partner', text: message.text, createdAt: new Date(message.created_at).toISOString() };
}
async function expireOwnRoom(db, userId, now) {
  await stmt(db, `UPDATE rooms SET status='ended',ended_at=? WHERE status='active'
    AND id IN (SELECT room_id FROM active_members WHERE user_id=?)
    AND (created_at<? OR EXISTS(SELECT 1 FROM active_members m WHERE m.room_id=rooms.id AND m.heartbeat_at<?))`,
  now, userId, now - 2 * 3600000, now - QUEUE_LIFE).run();
}
function matchingChoice(user) {
  const choices = parse(user.interests, []);
  return choices.length === 1 && Object.hasOwn(PHILOSOPHER_LABELS, choices[0]) && ['English', 'Hindi'].includes(user.language) ? choices[0] : null;
}
function scoreCandidate(me, other, wait, now) {
  const choice = matchingChoice(me);
  const theirs = matchingChoice(other);
  const compatible = choice && theirs && me.language === other.language &&
    (choice === theirs || choice === 'philosopher:any' || theirs === 'philosopher:any');
  const common = compatible ? [choice === 'philosopher:any' ? theirs : choice] : [];
  return { topics: common, score: Math.min(20, (now - wait) / 15000) - (other.poor_feedback ? 30 : 0) };
}
async function tryMatch(db, user, now) {
  if (!matchingChoice(user)) return null;
  const ownQueue = await stmt(db, 'SELECT * FROM queue WHERE user_id=?', user.id).first();
  if (!ownQueue) return null;
  const candidates = rows(await stmt(db, `SELECT u.*,q.joined_at,
    EXISTS(SELECT 1 FROM feedback f JOIN rooms past ON past.id=f.room_id WHERE f.user_id=? AND f.rating='poor'
      AND ((past.user_a=? AND past.user_b=u.id) OR (past.user_b=? AND past.user_a=u.id))) AS poor_feedback
    FROM queue q JOIN users u ON u.id=q.user_id WHERE q.user_id<>? AND q.heartbeat_at>?
    AND lower(u.language)=lower(?) AND u.suspended=0
    AND json_array_length(u.interests)=1 AND json_extract(u.interests,'$[0]') LIKE 'philosopher:%'
    AND (json_extract(u.interests,'$[0]')=? OR json_extract(u.interests,'$[0]')='philosopher:any' OR ?='philosopher:any')
    AND NOT EXISTS(SELECT 1 FROM active_members m WHERE m.user_id=u.id)
    AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=u.id) OR (b.blocked_id=? AND b.blocker_id=u.id))
    AND NOT EXISTS(SELECT 1 FROM rooms recent WHERE recent.created_at>? AND
      ((recent.user_a=? AND recent.user_b=u.id) OR (recent.user_b=? AND recent.user_a=u.id)))
    ORDER BY q.joined_at LIMIT 100`, user.id, user.id, user.id, user.id, now - QUEUE_LIFE, user.language, matchingChoice(user), matchingChoice(user),
  user.id, user.id, now - 600000, user.id, user.id).all());
  const ranked = candidates.map(other => ({ other, ...scoreCandidate(user, other, other.joined_at, now) }))
    .filter(item => item.topics.length === 1)
    .sort((a, b) => b.score - a.score);
  for (const candidate of ranked.slice(0, 3)) {
    const id = crypto.randomUUID();
    const topics = candidate.topics.length ? candidate.topics : [...new Set([...parse(user.interests, []), ...parse(candidate.other.interests, [])])].slice(0, 3);
    const prompt = topics[0] === 'philosopher:any' ? 'What would you like to explore together?' : topics[0] === 'philosopher:others' ? 'Who would you like to discuss?' : `What interests you about ${PHILOSOPHER_LABELS[topics[0]]}?`;
    // Every eligibility guard is rechecked inside the atomic INSERT, not trusted from the earlier read.
    await stmt(db, `INSERT INTO rooms(id,user_a,user_b,topics,prompt,language,dataset_a,dataset_b,training_a,training_b,created_at,last_activity)
      SELECT ?,a.id,b.id,?,?,a.language,a.dataset_consent,b.dataset_consent,a.training_consent,b.training_consent,?,?
      FROM users a JOIN users b ON b.id=? WHERE a.id=? AND a.suspended=0 AND b.suspended=0 AND lower(a.language)=lower(b.language)
      AND json_array_length(a.interests)=1 AND json_array_length(b.interests)=1
      AND (json_extract(a.interests,'$[0]')=json_extract(b.interests,'$[0]') OR json_extract(a.interests,'$[0]')='philosopher:any' OR json_extract(b.interests,'$[0]')='philosopher:any')
      AND a.language IN ('English','Hindi') AND json_extract(a.interests,'$[0]')=? AND json_extract(b.interests,'$[0]')=?
      AND EXISTS(SELECT 1 FROM queue q WHERE q.user_id=a.id AND q.heartbeat_at>?)
      AND EXISTS(SELECT 1 FROM queue q WHERE q.user_id=b.id AND q.heartbeat_at>?)
      AND NOT EXISTS(SELECT 1 FROM active_members m WHERE m.user_id IN(a.id,b.id))
      AND NOT EXISTS(SELECT 1 FROM blocks bl WHERE (bl.blocker_id=a.id AND bl.blocked_id=b.id) OR (bl.blocker_id=b.id AND bl.blocked_id=a.id))`,
    id, JSON.stringify(topics), prompt, now, now, candidate.other.id, user.id, matchingChoice(user), matchingChoice(candidate.other), now - QUEUE_LIFE, now - QUEUE_LIFE).run();
    const room = await stmt(db, 'SELECT r.* FROM rooms r JOIN active_members m ON r.id=m.room_id WHERE m.user_id=?', user.id).first();
    if (room) return room;
  }
  return null;
}
async function getState(db, user, now, after = 0, live = false) {
  await expireOwnRoom(db, user.id, now);
  if (!live) await db.batch([
    stmt(db, 'UPDATE active_members SET heartbeat_at=MAX(heartbeat_at,?) WHERE user_id=?', now, user.id),
    stmt(db, 'UPDATE queue SET heartbeat_at=MAX(heartbeat_at,?) WHERE user_id=? AND heartbeat_at>?', now, user.id, now - QUEUE_LIFE)
  ]);
  let room = await stmt(db, 'SELECT r.* FROM rooms r JOIN active_members m ON m.room_id=r.id WHERE m.user_id=?', user.id).first();
  if (!room) {
    const queued = await stmt(db, 'SELECT user_id FROM queue WHERE user_id=? AND heartbeat_at>?', user.id, now - QUEUE_LIFE).first();
    if (queued) {
      room = await tryMatch(db, user, now);
      if (!room) return { state: 'waiting' };
    } else {
      room = await stmt(db, 'SELECT * FROM rooms WHERE (user_a=? OR user_b=?) AND created_at>? ORDER BY created_at DESC LIMIT 1', user.id, user.id, now - RETENTION).first();
      if (!room) return { state: 'idle' };
    }
  }
  const messages = rows(await stmt(db, 'SELECT * FROM messages WHERE room_id=? AND id>? ORDER BY id LIMIT 400', room.id, after).all());
  return { state: room.status === 'active' ? 'matched' : 'ended', room: await roomView(db, room, user.id), messages: messages.map(m => messageView(m, user.id)) };
}
function redact(text, identities = []) {
  let output = text;
  for (const identity of identities.filter(s => typeof s === 'string' && s.length >= 2)) {
    const escaped = identity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    output = output.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'giu'), '[name]');
  }
  return output.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/https?:\/\/[^\s]+|\bwww\.[^\s]+/gi, '[link]')
    .replace(/(?<!\w)@\w{2,}/g, '[handle]')
    .replace(/(?<!\w)\+?\d[\d ().-]{6,}\d(?!\w)/g, '[number]');
}
async function adminRoute(request, env, db, path, url, now) {
  const bearer = request.headers.get('Authorization')?.replace(/^Bearer /, '') || '';
  const isAdmin = Boolean(env.ADMIN_TOKEN && env.ADMIN_TOKEN.length >= 32 && await equal(bearer, env.ADMIN_TOKEN));
  const isExporter = path === 'admin/dataset' && request.method === 'GET' && env.DATASET_EXPORT_TOKEN?.length >= 32 && await equal(bearer, env.DATASET_EXPORT_TOKEN);
  if (!isAdmin && !isExporter) fail(401, 'unauthorized', 'Administrator authentication is required.');
  if (path === 'admin/maintenance' && request.method === 'POST') { await maintenance(db, now); return json({ ok: true }); }
  if (path === 'admin/stats' && request.method === 'GET') {
    const stats = await stmt(db, `SELECT
      (SELECT count(*) FROM users) AS users,
      (SELECT count(*) FROM queue WHERE heartbeat_at>?) AS waiting,
      (SELECT count(*) FROM rooms WHERE status='active') AS activeRooms,
      (SELECT count(*) FROM rooms WHERE created_at>?) AS retainedRooms,
      (SELECT count(*) FROM reports WHERE resolved_at IS NULL) AS openReports,
      (SELECT count(*) FROM users WHERE suspended=1) AS suspendedUsers`, now - QUEUE_LIFE, now - RETENTION).first();
    return json({ ...stats, retentionDays: 30 });
  }
  if (path === 'admin/reports' && request.method === 'GET') {
    return json({ reports: rows(await stmt(db, 'SELECT * FROM reports WHERE resolved_at IS NULL ORDER BY created_at LIMIT 100').all()) });
  }
  if (path === 'admin/reported-room' && request.method === 'GET') {
    const id = url.searchParams.get('roomId') || '';
    const room = await stmt(db, 'SELECT r.* FROM rooms r WHERE r.id=? AND EXISTS(SELECT 1 FROM reports p WHERE p.room_id=r.id)', id).first();
    if (!room) fail(404, 'not_found', 'Reported conversation not found.');
    return json({ room, messages: rows(await stmt(db, 'SELECT * FROM messages WHERE room_id=? ORDER BY id LIMIT 400', id).all()) });
  }
  if (path === 'admin/moderate' && request.method === 'POST') {
    const data = await body(request);
    if (typeof data.reportId !== 'string' || !['dismiss', 'ban'].includes(data.action)) fail(400, 'invalid_request', 'Supply a report ID and choose dismiss or ban.');
    const report = await stmt(db, 'SELECT * FROM reports WHERE id=?', data.reportId).first();
    if (!report) fail(404, 'report_not_found', 'This report does not exist.');
    if (data.action === 'dismiss') {
      await stmt(db, 'UPDATE reports SET resolved_at=?,resolution=? WHERE id=?', now, 'Dismissed after review', report.id).run();
      return json({ ok: true });
    }
    await db.batch([
      stmt(db, 'UPDATE users SET suspended=1,updated_at=? WHERE id=?', now, report.reported_id),
      stmt(db, 'DELETE FROM sessions WHERE user_id=?', report.reported_id),
      stmt(db, 'DELETE FROM queue WHERE user_id=?', report.reported_id),
      stmt(db, `UPDATE rooms SET status='ended',ended_at=COALESCE(ended_at,?),export_revoked=1 WHERE user_a=? OR user_b=?`, now, report.reported_id, report.reported_id),
      stmt(db, 'UPDATE reports SET resolved_at=?,resolution=? WHERE id=?', now, 'Member banned after review', report.id)
    ]);
    return json({ ok: true });
  }
  if (path === 'admin/dataset' && request.method === 'GET') {
    const training = url.searchParams.get('training') === '1';
    const cursor = (url.searchParams.get('after') || '').slice(0, 64);
    if (!cursor) await maintenance(db, now);
    const eligible = rows(await stmt(db, `SELECT r.*,a.username AS username_a,a.display_name AS name_a,b.username AS username_b,b.display_name AS name_b
      FROM rooms r JOIN users a ON a.id=r.user_a JOIN users b ON b.id=r.user_b
      WHERE r.id>? AND r.status='ended' AND r.created_at>? AND r.export_revoked=0
      AND r.dataset_a=1 AND r.dataset_b=1 AND a.dataset_consent=1 AND b.dataset_consent=1
      AND (?=0 OR (r.training_a=1 AND r.training_b=1 AND a.training_consent=1 AND b.training_consent=1))
      AND a.suspended=0 AND b.suspended=0
      AND NOT EXISTS(SELECT 1 FROM reports p WHERE p.room_id=r.id)
      AND NOT EXISTS(SELECT 1 FROM blocks bl WHERE (bl.blocker_id=r.user_a AND bl.blocked_id=r.user_b) OR (bl.blocker_id=r.user_b AND bl.blocked_id=r.user_a))
      AND EXISTS(SELECT 1 FROM messages m WHERE m.room_id=r.id)
      ORDER BY r.id LIMIT 25`, cursor, now - RETENTION, training ? 1 : 0).all());
    const lines = [];
    for (const room of eligible) {
      const messages = rows(await stmt(db, 'SELECT * FROM messages WHERE room_id=? ORDER BY id LIMIT 400', room.id).all());
      // Recheck current consent after reading messages, minimizing withdrawal races.
      const stillEligible = await stmt(db, `SELECT r.id FROM rooms r JOIN users a ON a.id=r.user_a JOIN users b ON b.id=r.user_b
        WHERE r.id=? AND r.export_revoked=0 AND a.dataset_consent=1 AND b.dataset_consent=1
        AND (?=0 OR (a.training_consent=1 AND b.training_consent=1))
        AND NOT EXISTS(SELECT 1 FROM reports p WHERE p.room_id=r.id)
        AND NOT EXISTS(SELECT 1 FROM blocks bl WHERE (bl.blocker_id=r.user_a AND bl.blocked_id=r.user_b) OR (bl.blocker_id=r.user_b AND bl.blocked_id=r.user_a))`, room.id, training ? 1 : 0).first();
      if (!stillEligible) continue;
      const identities = [room.username_a, room.name_a, room.username_b, room.name_b];
      lines.push(JSON.stringify({ conversation_id: room.id, topics: parse(room.topics, []), language: room.language,
        consent_version: '2026-09-22', allowed_use: training ? 'ai_training' : 'research_and_match_quality',
        privacy: 'Pseudonymized and automatically redacted; may still contain identifying information. Human review required.',
        messages: messages.map(m => ({ speaker: m.sender_id === room.user_a ? 'A' : 'B', text: redact(m.text, identities) })) }));
    }
    return new Response(lines.join('\n') + (lines.length ? '\n' : ''), { headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff',
      'X-Next-Cursor': eligible.length === 25 ? eligible.at(-1).id : '', 'X-Export-Count': String(lines.length),
      'X-Dataset-Policy': 'replace-snapshot-not-append; revalidate-before-use; no-public-sharing'
    }});
  }
  fail(404, 'not_found', 'This endpoint does not exist.');
}

async function coreRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url); const now = Date.now();
  const path = url.pathname.replace(/^\/api\/community\/?/, '').replace(/\/$/, '');
  const db = env.COMMUNITY_DB;
  try {
    if (!db) fail(503, 'setup_required', 'The community database is not connected yet.');
    if (path === 'health' && request.method === 'GET') {
      await stmt(db, 'SELECT id FROM users LIMIT 1').first();
      return json({ ok: true, service: 'Voice of Vrindavan community', accountsReady: Boolean(env.AUTH_PEPPER?.length >= 32), matching: 'interest-based', learning: 'consented-keyword-topics', retentionDays: 30 });
    }
    if (path.startsWith('admin/')) return await adminRoute(request, env, db, path, url, now);
    if (!['GET', 'POST'].includes(request.method)) fail(405, 'method_not_allowed', 'Use GET or POST.');
    const origin = request.headers.get('Origin');
    if ((request.method === 'POST' && origin !== url.origin) || (origin && origin !== url.origin)) fail(403, 'origin_rejected', 'Open the website directly before continuing.');
    if (!env.AUTH_PEPPER || env.AUTH_PEPPER.length < 32) fail(503, 'setup_required', 'Account security configuration is not ready.');
    const data = request.method === 'POST' ? await body(request) : {};
    if (['register', 'login', 'recover'].includes(path) && request.method === 'POST') {
      const username = checkUsername(data.username);
      checkPassword(data.password);
      const ipKey = await keyed(request.headers.get('CF-Connecting-IP') || 'local', env.AUTH_PEPPER);
      await rate(db, `auth-ip:${ipKey}`, 30, 15 * 60000, now);
      await rate(db, `auth-user:${await digest(username)}`, 10, 15 * 60000, now);
      if (path === 'register') {
        await rate(db, `register:${ipKey}`, 5, 3600000, now);
        if (data.adult !== true) fail(400, 'adults_only', 'This community is for adults aged 18 and over.');
        const profile = profileInput({ displayName: String(data.username).trim(), interests: [], language: 'English', style: 'explore', ...data }, null, true);
        const id = crypto.randomUUID(); const recoveryCode = randomHex(24);
        const hash = await passwordHash(data.password, env.AUTH_PEPPER);
        try {
          await stmt(db, `INSERT INTO users(id,username,display_name,password_hash,recovery_hash,interests,language,style,
            learning_consent,dataset_consent,training_consent,adult_confirmed,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
          id, username, profile.displayName, hash, await keyed(`recovery:${recoveryCode}`, env.AUTH_PEPPER), JSON.stringify(profile.interests),
          profile.language, profile.style, profile.learning, profile.dataset, profile.training, now, now).run();
        } catch (error) {
          if (String(error.message).includes('UNIQUE')) fail(409, 'username_taken', 'That name is already taken. Please choose another.');
          throw error;
        }
        const user = await stmt(db, 'SELECT * FROM users WHERE id=?', id).first();
        return json({ user: safeUser(user), recoveryCode }, 201, { 'Set-Cookie': await createSession(db, id, now) });
      }
      const user = await stmt(db, 'SELECT * FROM users WHERE username=?', username).first();
      if (path === 'recover') {
        const provided = typeof data.recoveryCode === 'string' ? data.recoveryCode.trim().toLowerCase() : '';
        const good = await equal(await keyed(`recovery:${provided}`, env.AUTH_PEPPER), user?.recovery_hash || '');
        if (!user || !good || user.suspended) fail(401, 'invalid_credentials', 'The username or recovery code is incorrect.');
        const recoveryCode = randomHex(24);
        const replacementHash = await keyed(`recovery:${recoveryCode}`, env.AUTH_PEPPER);
        const result = await db.batch([
          stmt(db, 'UPDATE users SET password_hash=?,recovery_hash=?,updated_at=? WHERE id=? AND recovery_hash=? RETURNING id', await passwordHash(data.password, env.AUTH_PEPPER), replacementHash, now, user.id, user.recovery_hash),
          stmt(db, 'DELETE FROM sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND recovery_hash=?)', user.id, user.id, replacementHash)
        ]);
        if (!rows(result[0]).length) fail(401, 'invalid_credentials', 'The username or recovery code is incorrect.');
        return json({ user: safeUser(user), recoveryCode }, 200, { 'Set-Cookie': await createSession(db, user.id, now) });
      }
      const good = await verifyPassword(data.password, user?.password_hash, env.AUTH_PEPPER);
      if (!user || !good || user.suspended) fail(401, 'invalid_credentials', 'The username or password is incorrect.');
      return json({ user: safeUser(user) }, 200, { 'Set-Cookie': await createSession(db, user.id, now) });
    }
    const user = await currentUser(db, request, now);
    if (path === 'me' && request.method === 'GET') return json({ user: user ? safeUser(user) : null });
    if (!user) fail(401, 'sign_in_required', 'Please sign in to continue.');
    if (request.method === 'POST') await rate(db, `write:${user.id}`, 90, 60000, now);
    if (path === 'logout' && request.method === 'POST') {
      await db.batch([stmt(db, 'DELETE FROM sessions WHERE token_hash=?', user.session_hash), stmt(db, 'DELETE FROM queue WHERE user_id=?', user.id),
        stmt(db, "UPDATE rooms SET status='ended',ended_at=? WHERE status='active' AND (user_a=? OR user_b=?)", now, user.id, user.id)]);
      return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
    }
    if (path === 'profile' && request.method === 'POST') {
      const p = profileInput(data, user);
      // Changing interests or language while waiting starts a fresh queue on the next Connect.
      await db.batch([
        stmt(db, `UPDATE users SET display_name=?,interests=?,language=?,style=?,learning_consent=?,dataset_consent=?,training_consent=?,
          learned_interests=?,updated_at=? WHERE id=?`, p.displayName, JSON.stringify(p.interests), p.language, p.style, p.learning, p.dataset, p.training,
        !p.learning || data.resetLearning === true ? '{}' : user.learned_interests, now, user.id),
        stmt(db, 'DELETE FROM queue WHERE user_id=?', user.id)
      ]);
      return json({ user: safeUser(await stmt(db, 'SELECT * FROM users WHERE id=?', user.id).first()) });
    }
    if (path === 'connect' && request.method === 'POST') {
      if (!matchingChoice(user)) fail(400, 'interests_required', 'Choose one philosopher or spiritual teacher and English or Hindi before finding a match.');
      await rate(db, `connect:${user.id}`, 12, 60000, now);
      await maintenance(db, now);
      const active = await stmt(db, 'SELECT room_id FROM active_members WHERE user_id=?', user.id).first();
      if (!active) await stmt(db, `INSERT INTO queue(user_id,joined_at,heartbeat_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET heartbeat_at=excluded.heartbeat_at`, user.id, now, now).run();
      return json(await getState(db, user, now, 0, liveEnabled(env)));
    }
    if (path === 'state' && request.method === 'GET') {
      // Four-second background polling plus a refresh after each permitted send must fit.
      await rate(db, `poll:${user.id}`, 60, 60000, now);
      const after = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(url.searchParams.get('after')) || 0));
      return json(await getState(db, user, now, after, liveEnabled(env)));
    }
    if (path === 'message' && request.method === 'POST') {
      await rate(db, `message:${user.id}`, 30, 60000, now);
      const text = typeof data.text === 'string' ? data.text.trim() : '';
      if (!text || text.length > 2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) fail(400, 'invalid_message', 'Write a message of 1–2,000 characters.');
      await expireOwnRoom(db, user.id, now);
      const room = await roomFor(db, user.id, data.roomId);
      if (room.status !== 'active') fail(409, 'room_ended', 'This conversation has ended.');
      const inserted = await stmt(db, `INSERT INTO messages(room_id,sender_id,text,created_at) SELECT ?,?,?,?
        WHERE EXISTS(SELECT 1 FROM rooms WHERE id=? AND status='active' AND (user_a=? OR user_b=?))
        AND (SELECT count(*) FROM messages WHERE room_id=?)<? RETURNING *`, room.id, user.id, text, now, room.id, user.id, user.id, room.id, MAX_MESSAGES).first();
      if (!inserted) fail(409, 'room_limit', 'This conversation has ended or reached its message limit. Start another conversation.');
      const updates = [stmt(db, 'UPDATE rooms SET last_activity=? WHERE id=?', now, room.id), stmt(db, 'UPDATE active_members SET heartbeat_at=MAX(heartbeat_at,?) WHERE user_id=?', now, user.id)];
      if (user.learning_consent) {
        const learned = { ...parse(user.learned_interests, {}) };
        for (const topic of TOPICS) if (KEYWORDS[topic].test(text)) learned[topic] = Math.min(100, (learned[topic] || 0) + 1);
        updates.push(stmt(db, 'UPDATE users SET learned_interests=? WHERE id=? AND learning_consent=1', JSON.stringify(learned), user.id));
      }
      await db.batch(updates);
      return json({ message: messageView(inserted, user.id) }, 201);
    }
    if (['leave', 'block', 'report', 'feedback'].includes(path) && request.method === 'POST') {
      if (path === 'leave' && !data.roomId) {
        // Cancellation also covers a match committed just before the browser received its room ID.
        await db.batch([
          stmt(db, 'DELETE FROM queue WHERE user_id=?', user.id),
          stmt(db, "UPDATE rooms SET status='ended',ended_at=? WHERE status='active' AND (user_a=? OR user_b=?)", now, user.id, user.id)
        ]);
        return json({ ok: true });
      }
      const room = await roomFor(db, user.id, data.roomId);
      const partner = room.user_a === user.id ? room.user_b : room.user_a;
      if (path === 'feedback') {
        if (!['good', 'poor'].includes(data.rating)) fail(400, 'invalid_rating', 'Choose good or poor.');
        await stmt(db, `INSERT INTO feedback(room_id,user_id,rating,created_at) VALUES(?,?,?,?) ON CONFLICT(room_id,user_id) DO UPDATE SET rating=excluded.rating,created_at=excluded.created_at`, room.id, user.id, data.rating, now).run();
        return json({ ok: true });
      }
      const operations = [stmt(db, "UPDATE rooms SET status='ended',ended_at=COALESCE(ended_at,?) WHERE id=?", now, room.id), stmt(db, 'DELETE FROM queue WHERE user_id=?', user.id)];
      if (path === 'block') operations.push(stmt(db, 'INSERT OR IGNORE INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)', user.id, partner, now), stmt(db, 'UPDATE rooms SET export_revoked=1 WHERE (user_a=? AND user_b=?) OR (user_a=? AND user_b=?)', user.id, partner, partner, user.id));
      if (path === 'report') {
        const reason = typeof data.reason === 'string' ? data.reason.trim() : '';
        if (reason.length < 3 || reason.length > 1000) fail(400, 'invalid_reason', 'Briefly describe the issue in 3–1,000 characters.');
        operations.push(stmt(db, 'INSERT OR IGNORE INTO reports(id,room_id,reporter_id,reported_id,reason,created_at) VALUES(?,?,?,?,?,?)', crypto.randomUUID(), room.id, user.id, partner, reason, now), stmt(db, 'UPDATE rooms SET export_revoked=1 WHERE id=?', room.id));
      }
      await db.batch(operations);
      return json({ ok: true });
    }
    if (path === 'export' && request.method === 'GET') {
      const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
      await rate(db, `${after ? 'export-page' : 'export'}:${user.id}`, after ? 120 : 10, 3600000, now);
      const messages = rows(await stmt(db, `SELECT m.* FROM messages m JOIN rooms r ON r.id=m.room_id
        WHERE (r.user_a=? OR r.user_b=?) AND r.created_at>? AND m.id>? ORDER BY m.id LIMIT 1001`, user.id, user.id, now - RETENTION, after).all());
      const page = messages.slice(0, 1000);
      const related = await db.batch([
        stmt(db, 'SELECT room_id AS roomId,rating,created_at AS createdAt FROM feedback WHERE user_id=? ORDER BY created_at DESC LIMIT 1000', user.id),
        stmt(db, 'SELECT id,room_id AS roomId,reason,created_at AS createdAt,resolved_at AS resolvedAt,resolution FROM reports WHERE reporter_id=? ORDER BY created_at DESC LIMIT 1000', user.id),
        stmt(db, 'SELECT u.display_name AS displayName,b.created_at AS createdAt FROM blocks b JOIN users u ON u.id=b.blocked_id WHERE b.blocker_id=? ORDER BY b.created_at DESC LIMIT 1000', user.id)
      ]);
      return json({ account: safeUser(user), exportedAt: new Date(now).toISOString(), retentionDays: 30,
        accountCreatedAt: new Date(user.created_at).toISOString(), feedback: rows(related[0]), reports: rows(related[1]), blocks: rows(related[2]),
        relatedRecordsLimit: 1000,
        messages: page.map(m => ({ roomId: m.room_id, ...messageView(m, user.id) })),
        nextCursor: messages.length > 1000 ? page.at(-1).id : null }, 200, { 'Content-Disposition': 'attachment; filename="voice-of-vrindavan-data.json"' });
    }
    if (path === 'delete-account' && request.method === 'POST') {
      checkPassword(data.password);
      await rate(db, `delete:${user.id}`, 5, 3600000, now);
      if (!await verifyPassword(data.password, user.password_hash, env.AUTH_PEPPER)) fail(401, 'invalid_credentials', 'Your password is incorrect.');
      await stmt(db, 'DELETE FROM users WHERE id=?', user.id).run();
      return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
    }
    fail(404, 'not_found', 'This endpoint does not exist.');
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message, code: error.code }, error.status, error.status === 429 ? { 'Retry-After': '60' } : {});
    console.error(JSON.stringify({ event: 'community_error', path, name: error?.name || 'Error' }));
    return json({ error: 'The community is temporarily unavailable. Please try again shortly.', code: 'server_error' }, 500);
  }
}

export const testing = { TOPICS, profileInput, scoreCandidate, redact, passwordHash, verifyPassword, maintenance, tryMatch, safeUser };

export async function onRequest(context) {
  try { return await liveRequest(context, coreRequest, { currentUser, stmt, rate }); }
  catch (error) { console.error(JSON.stringify({event:'live_gateway_error',name:error?.name})); return json({error:'The connection is temporarily unavailable.'},503); }
}
export { stmt, currentUser, getState, messageView, roomView };
