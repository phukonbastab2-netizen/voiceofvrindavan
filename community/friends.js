export function setupFriends({ request, getRoom, getUser, tone }) {
  const $ = id => document.getElementById(id);
  const dialog = $('friends-dialog');
  let current = null, version = 0, timer, after = 0, before = 0, busy = false;
  const seen = new Set();
  function status(text = '') { $('friends-status').textContent = text; }
  function button(label, action) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'outline-button'; b.textContent = label;
    b.addEventListener('click', async () => { b.disabled = true; try { await action(); } catch (e) { status(e.message); } finally { b.disabled = false; } });
    return b;
  }
  async function list() {
    const v = version, result = await request('friends');
    if (!dialog.open || v !== version || current) return;
    const target = $('friends-list'); target.replaceChildren();
    if (!result.friends.length) { const p = document.createElement('p'); p.textContent = 'No friends yet. Choose “Add friend” during a conversation.'; target.append(p); }
    for (const friend of result.friends) {
      const row = document.createElement('div'); row.className = 'friend-row';
      const icon = document.createElement('img'); icon.src = '/logo/icon.svg'; icon.alt = '';
      const name = document.createElement('strong'); name.textContent = friend.displayName;
      const info = document.createElement('div'); info.append(name);
      const detail = document.createElement('small'); detail.textContent = friend.status === 'accepted' ? 'Friend' : friend.incoming ? 'Wants to be your friend' : 'Request sent'; info.append(detail);
      const controls = document.createElement('div'); controls.className = 'friend-actions';
      if (friend.status === 'accepted') controls.append(button('Chat', () => openChat(friend)));
      else if (friend.incoming) controls.append(button('Accept', async () => { await request('friends/respond', { id: friend.id, action: 'accept' }); await list(); }));
      controls.append(button(friend.status === 'accepted' ? 'Remove' : friend.incoming ? 'Decline' : 'Cancel', async () => {
        if (friend.status === 'accepted' && !confirm('Remove this friend? You will no longer be able to message each other.')) return;
        await request('friends/respond', { id: friend.id, action: 'remove' }); await list();
      }));
      row.append(icon, info, controls); target.append(row);
    }
  }
  function append(messages, older = false) {
    const target = $('friend-messages'), fragment = document.createDocumentFragment();
    const oldHeight = target.scrollHeight, nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 90;
    let incoming = false;
    for (const m of messages) {
      if (seen.has(m.id)) continue; seen.add(m.id); after = Math.max(after, m.id); before = before ? Math.min(before, m.id) : m.id;
      const row = document.createElement('div'); row.className = `friend-message ${m.speaker === 'self' ? 'own' : ''}`;
      const meta = document.createElement('small'); meta.textContent = `${m.speaker === 'self' ? 'You' : current.displayName} · ${new Date(m.createdAt).toLocaleString()}`;
      const text = document.createElement('p'); text.textContent = m.text; row.append(meta, text);
      if (m.speaker !== 'self') {
        incoming = true;
        row.append(button('Report', async () => {
          const reason = prompt('Briefly describe the issue (3–1,000 characters).');
          if (!reason) return;
          await request('friends/report', { id: current.id, roomId: m.roomId, reason }); status('Report saved for review. You can also block this friend.');
        }));
      }
      fragment.append(row);
    }
    if (older) { target.prepend(fragment); target.scrollTop += target.scrollHeight - oldHeight; }
    else { target.append(fragment); if (nearBottom || oldHeight === 0) target.scrollTop = target.scrollHeight; }
    if (incoming && !older) tone();
    $('friend-empty').hidden = seen.size > 0;
  }
  async function messages(older = false) {
    if (!current || busy) return;
    busy = true; const v = version, id = current.id;
    try {
      const suffix = older ? `&before=${before}` : after ? `&after=${after}` : '';
      const result = await request(`friends/messages?id=${encodeURIComponent(id)}${suffix}`);
      if (v !== version || !dialog.open) return;
      const initial = after === 0; append(result.messages, older);
      if (older || initial) $('friend-older').hidden = !result.hasMore;
    } catch (e) { if (v === version) status(e.message); }
    finally { busy = false; }
  }
  async function openChat(friend) {
    version++; current = friend; after = before = 0; seen.clear(); status();
    $('friends-list').hidden = true; $('friend-chat').hidden = false; $('friends-back').hidden = false;
    $('friends-title').textContent = friend.displayName; $('friend-messages').replaceChildren(); $('friend-empty').hidden = false;
    $('friend-older').hidden = true; $('friend-text').value = ''; await messages();
  }
  async function showList() {
    version++; current = null; status(); $('friends-title').textContent = 'Friends';
    $('friends-list').hidden = false; $('friend-chat').hidden = true; $('friends-back').hidden = true;
    await list();
  }
  async function poll() {
    clearTimeout(timer);
    if (!dialog.open || !getUser()) return;
    if (!document.hidden) { try { if (current) await messages(); else await list(); } catch (e) { status(e.message); } }
    if (dialog.open) timer = setTimeout(poll, current ? 4000 : 15000);
  }
  $('friends-open').addEventListener('click', async () => {
    dialog.showModal(); try { await showList(); } catch (e) { status(e.message); } timer = setTimeout(poll, 4000);
  });
  $('friends-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { version++; current = null; clearTimeout(timer); $('friend-messages').replaceChildren(); $('friends-list').replaceChildren(); });
  $('friends-back').addEventListener('click', () => showList().catch(e => status(e.message)));
  $('friend-older').addEventListener('click', () => messages(true));
  $('add-friend').addEventListener('click', async () => {
    const room = getRoom(); if (!room) return; const b = $('add-friend'); b.disabled = true;
    try { const result = await request('friends/request', { roomId: room.id }); b.textContent = result.status === 'accepted' ? 'Friends' : result.incoming ? 'Accept in Friends' : 'Request sent'; }
    catch (e) { $('chat-error').textContent = e.message; }
    finally { b.disabled = false; }
  });
  $('friend-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!current) return; const b = $('friend-send'), text = $('friend-text').value.trim();
    if (!text || b.disabled) return; b.disabled = true; status(); const v = version, id = current.id;
    try { await request('friends/send', { id, text }); if (version !== v) return;
      $('friend-text').value = ''; await messages();
      // The history cursor only advances through fetched messages, so concurrent sends cannot skip a partner's reply.
      if (version === v) $('friend-messages').scrollTop = $('friend-messages').scrollHeight;
    } catch (e) { if (version === v) status(e.message); } finally { b.disabled = false; }
  });
  $('friend-text').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('friend-form').requestSubmit(); } });
  $('friend-block').addEventListener('click', async () => {
    if (!current || !confirm('Block this friend? They will not be able to contact or match with you.')) return;
    try { await request('friends/respond', { id: current.id, action: 'block' }); await showList(); } catch (e) { status(e.message); }
  });
}
