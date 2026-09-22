// Pages uses private Durable Object bindings. No public notification endpoint.
export function liveEnabled(env) { return Boolean(env.CHAT_ROOMS && env.CHAT_LOBBIES); }
export function lobbyFor(env, language) { return env.CHAT_LOBBIES.get(env.CHAT_LOBBIES.idFromName(language.toLowerCase())); }
export function roomForLive(env, id) { return env.CHAT_ROOMS.get(env.CHAT_ROOMS.idFromName(id)); }

export async function liveRequest(context, core, helpers) {
  const { request, env } = context;
  const { currentUser, stmt, rate } = helpers;
  const url = new URL(request.url), path = url.pathname.split('/').filter(Boolean).at(-1);
  const enabled = liveEnabled(env), db = env.COMMUNITY_DB;
  if (path === 'live') {
    if (!enabled) return Response.json({ error: 'Live connections are unavailable.' }, { status: 503 });
    if (request.method !== 'GET' || request.headers.get('Origin') !== url.origin) return new Response('Forbidden', { status: 403 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 });
    const user = await currentUser(db, request, Date.now());
    if (!user) return new Response('Sign in required', { status: 401 });
    try { await rate(db, `socket:${user.id}`, 20, 60000, Date.now()); } catch { return new Response('Please wait', { status: 429 }); }
    const roomId = url.searchParams.get('room');
    if (roomId && !/^[a-zA-Z0-9-]{1,64}$/.test(roomId)) return new Response('Invalid room', { status: 400 });
    const headers = new Headers({ Upgrade: 'websocket', 'X-Session-Hash': user.session_hash });
    const stub = roomId ? roomForLive(env, roomId) : lobbyFor(env, user.language);
    return stub.fetch(new Request(url.toString(), { headers }));
  }

  // Capture affected room before leave/deletion changes its membership.
  let actor, previousRoom;
  const mutation = enabled && request.method === 'POST' && !['register', 'login', 'recover'].includes(path);
  if (mutation && !url.pathname.includes('/admin/')) {
    actor = await currentUser(db, request, Date.now());
    if (actor && path !== 'message') previousRoom = await stmt(db, 'SELECT room_id FROM active_members WHERE user_id=?', actor.id).first();
  }
  const response = await core(context);
  if (!response.ok || !enabled) return response;
  if (!['me', 'health', 'register', 'login', 'recover', 'connect', 'state', 'message', 'leave', 'block', 'report', 'profile', 'logout', 'delete-account', 'feedback'].includes(path)) return response;
  const result = await response.clone().json().catch(() => null);
  if (!result) return response;
  try {
    if (result.state === 'matched' && result.room) {
      const room = await stmt(db, 'SELECT * FROM rooms WHERE id=?', result.room.id).first();
      if (room?.status === 'active') {
        await roomForLive(env, room.id).prepare(room.id);
        await lobbyFor(env, room.language).refresh([room.user_a, room.user_b]);
      }
    }
    if (mutation && actor) {
      if (path === 'message' && result.message) {
        // Fetch authoritative saved row; client fields never become push payloads.
        const saved = await stmt(db, 'SELECT * FROM messages WHERE id=? AND sender_id=?', result.message.id, actor.id).first();
        if (saved) await roomForLive(env, saved.room_id).deliver(saved.id);
      } else if (path !== 'feedback') {
        if (previousRoom) await roomForLive(env, previousRoom.room_id).refresh();
        await lobbyFor(env, actor.language).refresh([actor.id]);
      }
    }
  } catch (error) {
    // A persisted send is successful even if pushing fails. Close/reconnect or
    // bounded read-only reconciliation retrieves the saved message.
    console.error(JSON.stringify({ event: 'live_notification_failed', path, name: error?.name }));
  }
  if (['me', 'health', 'register', 'login', 'recover'].includes(path)) {
    return new Response(JSON.stringify({ ...result, realtime: true }), { status: response.status, headers: response.headers });
  }
  return response;
}
