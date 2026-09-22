'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const TOPICS = { truth: 'Truth', consciousness: 'Consciousness', meaning: 'Meaning of life', 'free-will': 'Free will', ethics: 'Ethics', spirituality: 'Spirituality' };
  const STYLES = { explore: 'Explore together', debate: 'Thoughtful debate', listen: 'Listen & reflect' };
  const API = '/api/community/';
  let audioContext;
  let soundEnabled = true;
  try { soundEnabled = localStorage.getItem('vov-sound') !== 'off'; } catch {}
  function tone(match = false) {
    if (!soundEnabled || !audioContext) return;
    try { const now = audioContext.currentTime; [0, ...(match ? [.16,.32] : [])].forEach((delay,i) => {const osc=audioContext.createOscillator(),gain=audioContext.createGain();osc.type='sine';osc.frequency.value=[528,660,792][i];gain.gain.setValueAtTime(0,now+delay);gain.gain.linearRampToValueAtTime(.045,now+delay+.015);gain.gain.exponentialRampToValueAtTime(.001,now+delay+.3);osc.connect(gain).connect(audioContext.destination);osc.start(now+delay);osc.stop(now+delay+.32);}); } catch {}
  }
  document.addEventListener('pointerdown', () => { try { audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); audioContext.resume(); } catch {} }, {once:true});
  function soundLabel(){ $('sound-toggle').textContent = soundEnabled ? 'Sound on' : 'Sound off'; $('sound-toggle').setAttribute('aria-pressed',String(soundEnabled)); }
  $('sound-toggle').addEventListener('click',()=>{soundEnabled=!soundEnabled;try { localStorage.setItem('vov-sound',soundEnabled?'on':'off'); } catch {}soundLabel();tone();});soundLabel();
  let realtimeEnabled = false, liveSocket = null, liveKey = '', livePing = null, liveRetry = null, liveFailures = 0;
  function closeLive() {
    clearInterval(livePing); clearTimeout(liveRetry); livePing = liveRetry = null;
    const old = liveSocket; liveSocket = null; liveKey = ''; if (old) old.close(1000, 'Room changed');
  }
  function ensureLive() {
    if (!realtimeEnabled || !user || !['waiting','matched'].includes(state)) return;
    const key = state === 'matched' ? currentRoom?.id : 'waiting';
    if (!key || (liveSocket && liveKey === key && liveSocket.readyState < 2)) return;
    closeLive(); liveKey = key;
    const address = new URL(API + 'live', location.origin); address.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    if (key !== 'waiting') address.searchParams.set('room',key);
    const socket = new WebSocket(address); liveSocket = socket;
    socket.onopen = () => {
      if (liveSocket !== socket) return;
      liveFailures = 0; socket.send('ping');
      livePing = setInterval(() => { if(socket.readyState === WebSocket.OPEN) socket.send('ping'); },25000);
    };
    socket.onmessage = event => {
      if (liveSocket !== socket || event.data === 'pong') return;
      let packet; try {packet=JSON.parse(event.data);} catch { return; }
      if (packet.type === 'ready' || packet.type === 'refresh') syncState();
      else if(packet.type === 'message' && packet.roomId === currentRoom?.id && state === 'matched') addMessages([packet.message],false);
      else if(packet.type === 'ended' && packet.roomId === currentRoom?.id) {renderEnded();syncState();}
    };
    socket.onclose = event => {
      if(liveSocket !== socket) return;
      liveSocket=null; clearInterval(livePing);
      if(event.code===4001) {signedOut('Your session expired. Please sign in again.');return;}
      const delay=Math.min(30000,1000*2**Math.min(liveFailures++,5));
      if(user && ['waiting','matched'].includes(state)) liveRetry=setTimeout(()=>{syncState();ensureLive();},delay);
    };
    socket.onerror = () => { /* close/reconciliation handles network failures */ };
  }
  let enteringRoom = false;
  let user = null;
  let currentRoom = null;
  let state = 'idle';
  let afterId = 0;
  let pollTimer = null;
  let pollBusy = false;
  let syncAgain = false;
  let generation = 0;
  let waitingSince = 0;
  let savedRecovery = '';
  let recoveryUsername = '';
  let seenMessages = new Set();

  function setError(id, message = '') { $(id).textContent = message; }
  function notice(message, error = false) {
    $('global-notice').textContent = message;
    $('global-notice').hidden = !message;
    $('global-notice').classList.toggle('error', error);
  }
  function initials(name) { return String(name || '?').trim().slice(0, 1).toUpperCase(); }
  function isAuthError(error) { return error.status === 401; }
  async function request(path, data) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const options = { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: controller.signal, cache: 'no-store' };
      if (data !== undefined) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(data); }
      const response = await fetch(API + path, options);
      let result;
      try { result = await response.json(); } catch { throw new Error('The service returned an unexpected response. Please try again shortly.'); }
      if (typeof result.realtime === 'boolean') realtimeEnabled = result.realtime;
      if (!response.ok) {
        const error = new Error(result.error || 'Something went wrong. Please try again.');
        error.status = response.status;
        throw error;
      }
      return result;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('The connection took too long. Please check your connection and try again.');
      if (error instanceof TypeError) throw new Error('We couldn’t reach the conversation room. Check your internet connection and try again.');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  async function busy(button, action) {
    if (button.disabled) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try { await action(); }
    finally { button.disabled = false; button.removeAttribute('aria-busy'); }
  }
  function download(filename, content, mime = 'application/json') {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function showDialog(id) { if (!$(id).open) $(id).showModal(); }
  function closeDialog(id) { $(id).close(); }

  document.querySelectorAll('[data-topic-options]').forEach((container) => {
    for (const [value, text] of Object.entries(TOPICS)) {
      const label = document.createElement('label'); label.className = 'interest-option';
      const input = document.createElement('input'); input.type = 'checkbox'; input.name = 'interests'; input.value = value;
      const span = document.createElement('span'); span.textContent = text;
      label.append(input, span); container.append(label);
    }
  });
  const desiredTopic = new URLSearchParams(location.search).get('topic');
  if (Object.hasOwn(TOPICS, desiredTopic)) {
    const selected = Array.from($('room-preferences').querySelectorAll('[name=interests]')).find((input) => input.value === desiredTopic);
    if (selected) selected.checked = true;
  }

  function bindConsent(form) {
    const dataset = form.elements.datasetConsent;
    const training = form.elements.trainingConsent;
    const update = () => { training.disabled = !dataset.checked; if (!dataset.checked) training.checked = false; };
    dataset.addEventListener('change', update);
    return update;
  }
  const refreshProfileConsent = bindConsent($('profile-form'));

  function formProfile(form) {
    const data = new FormData(form);
    const interests = data.getAll('interests');
    if (!interests.length) throw new Error('Choose at least one topic you’d like to talk about.');
    return { displayName: String(data.get('displayName') || '').trim(), interests, language: data.get('language'), style: data.get('style'), learningConsent: data.has('learningConsent'), datasetConsent: data.has('datasetConsent'), trainingConsent: data.has('datasetConsent') && data.has('trainingConsent') };
  }

  function authTab(tab) {
    const register = tab === 'register';
    $('register-panel').hidden = !register; $('login-panel').hidden = register; $('recover-panel').hidden = true;
    document.querySelector('.auth-tabs').hidden = false;
    $('register-tab').setAttribute('aria-selected', String(register)); $('login-tab').setAttribute('aria-selected', String(!register));
    $('register-tab').tabIndex = register ? 0 : -1; $('login-tab').tabIndex = register ? -1 : 0;
  }
  $('register-tab').addEventListener('click', () => authTab('register'));
  $('login-tab').addEventListener('click', () => authTab('login'));
  document.querySelector('.auth-tabs').addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'register' : event.key === 'End' ? 'login' : $('register-tab').getAttribute('aria-selected') === 'true' ? 'login' : 'register';
    authTab(next); $(next + '-tab').focus();
  });
  $('recover-toggle').addEventListener('click', () => { $('login-panel').hidden = true; $('recover-panel').hidden = false; document.querySelector('.auth-tabs').hidden = true; $('recover-form').elements.username.focus(); });
  $('recover-back').addEventListener('click', () => authTab('login'));

  function renderTags(target, values) {
    target.replaceChildren();
    for (const value of values) { const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = TOPICS[value] || value; target.append(tag); }
  }
  function learnedTopics() {
    const interests = user?.learnedInterests;
    if (Array.isArray(interests)) return interests.map((item) => typeof item === 'string' ? item : item.topic || item.interest).filter((topic) => Object.hasOwn(TOPICS, topic));
    if (interests && typeof interests === 'object') return Object.entries(interests).filter(([topic, score]) => Object.hasOwn(TOPICS, topic) && Number(score) > 0).sort((a, b) => b[1] - a[1]).map(([topic]) => topic);
    return [];
  }
  function renderUser() {
    if (!user) return;
    const choices = $('room-preferences');
    for (const field of ['language','style']) choices.elements[field].value = user[field];
    choices.querySelectorAll('[name=interests]').forEach(input => { input.checked = (user.interests || []).includes(input.value) || (!user.interests?.length && input.value === desiredTopic); });
    $('greeting-name').textContent = user.displayName + '.';
    $('profile-name').textContent = user.displayName;
    $('profile-username').textContent = '@' + user.username;
    $('avatar').textContent = initials(user.displayName);
    $('profile-language').textContent = user.language;
    $('profile-style').textContent = STYLES[user.style] || user.style;
    renderTags($('profile-topics'), user.interests || []);
    const learned = learnedTopics();
    $('learned-section').hidden = !user.learningConsent || !learned.length;
    renderTags($('learned-topics'), learned);
  }
  function stopPolling() { clearTimeout(pollTimer); pollTimer = null; }
  function authenticated(nextUser) {
    generation++;
    user = nextUser;
    $('boot').hidden = true; $('auth-view').hidden = true; $('workspace').hidden = false; $('account-nav').hidden = false;
    document.querySelector('.header-back').hidden = true;
    notice(''); renderUser(); renderIdle();
    enteringRoom = true;
    syncState();
  }
  function signedOut(message = '') {
    generation++; stopPolling(); closeLive();
    user = null; currentRoom = null; state = 'idle'; afterId = 0; seenMessages.clear();
    $('boot').hidden = true; $('workspace').hidden = true; $('auth-view').hidden = false; $('account-nav').hidden = true;
    document.querySelector('.header-back').hidden = false;
    document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
    $('message-text').value = ''; $('message-list').replaceChildren($('no-messages') || noMessagesNode());
    $('message-count').textContent = '0 / 2000';
    if (message) authTab('login');
    notice(message);
  }
  function noMessagesNode() { const p = document.createElement('p'); p.id = 'no-messages'; p.className = 'no-messages'; p.textContent = 'Say hello. A good question goes a long way.'; return p; }
  function recovery(result, username) {
    savedRecovery = String(result.recoveryCode || ''); recoveryUsername = username;
    if (!savedRecovery) return;
    $('recovery-value').value = savedRecovery; $('saved-recovery').checked = false; $('recovery-done').disabled = true; showDialog('recovery-dialog');
  }
  $('recovery-dialog').addEventListener('cancel', (event) => event.preventDefault());
  $('saved-recovery').addEventListener('change', () => { $('recovery-done').disabled = !$('saved-recovery').checked; });
  $('recovery-done').addEventListener('click', () => { if (!$('saved-recovery').checked) return; closeDialog('recovery-dialog'); savedRecovery = ''; $('recovery-value').value = ''; syncState(); });
  $('download-recovery').addEventListener('click', () => download('voice-of-vrindavan-recovery.txt', `Voice of Vrindavan account recovery\nUsername: ${recoveryUsername}\nRecovery code: ${savedRecovery}\n\nKeep this private. Anyone with it can reset your password.\n`, 'text/plain'));

  $('register-form').addEventListener('submit', (event) => {
    event.preventDefault(); const form = event.currentTarget;
    busy(form.querySelector('[type=submit]'), async () => {
      setError('register-error');
      try {
        const data = new FormData(form);
        const result = await request('register', { username: String(data.get('username')).trim(), password: data.get('password'), adult: data.has('adult') });
        authenticated(result.user); recovery(result, result.user.username); form.elements.password.value = '';
      } catch (error) { setError('register-error', error.message); }
    });
  });
  $('login-form').addEventListener('submit', (event) => {
    event.preventDefault(); const form = event.currentTarget;
    busy(form.querySelector('[type=submit]'), async () => {
      setError('login-error');
      try { const data = new FormData(form); const result = await request('login', { username: String(data.get('username')).trim(), password: data.get('password') }); authenticated(result.user); form.elements.password.value = ''; }
      catch (error) { setError('login-error', error.message); }
    });
  });
  $('recover-form').addEventListener('submit', (event) => {
    event.preventDefault(); const form = event.currentTarget;
    busy(form.querySelector('[type=submit]'), async () => {
      setError('recover-error');
      try { const data = new FormData(form); const result = await request('recover', { username: String(data.get('username')).trim(), recoveryCode: String(data.get('recoveryCode')).trim(), password: data.get('password') }); if (result.user) authenticated(result.user); else { authTab('login'); notice('Your password has been reset. Sign in with your new password.'); } recovery(result, String(data.get('username')).trim()); form.reset(); }
      catch (error) { setError('recover-error', error.message); }
    });
  });
  $('logout').addEventListener('click', () => busy($('logout'), async () => {
    try { await request('logout', {}); signedOut('You’re signed out. Come back whenever curiosity calls.'); }
    catch (error) { notice(error.message, true); }
  }));

  async function openProfile() {
    if (!user) return;
    const version = generation;
    try {
      const latest = await request('me');
      if (version !== generation) return;
      if (!latest.user) { signedOut('Your session expired. Please sign in again.'); return; }
      user = latest.user; renderUser();
    } catch (error) { notice(error.message, true); }
    if (!user || version !== generation) return;
    const form = $('profile-form');
    for (const field of ['displayName', 'language', 'style']) form.elements[field].value = user[field];
    for (const field of ['learningConsent', 'datasetConsent', 'trainingConsent']) form.elements[field].checked = !!user[field];
    form.querySelectorAll('[name=interests]').forEach((checkbox) => { checkbox.checked = (user.interests || []).includes(checkbox.value); });
    refreshProfileConsent(); setError('profile-error'); $('profile-success').textContent = ''; showDialog('profile-dialog');
  }
  $('profile-open').addEventListener('click', openProfile); $('sidebar-profile-open').addEventListener('click', openProfile);
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => closeDialog(button.dataset.close)));
  $('profile-form').addEventListener('submit', (event) => {
    event.preventDefault(); const form = event.currentTarget;
    busy(form.querySelector('[type=submit]'), async () => {
      setError('profile-error'); $('profile-success').textContent = '';
      try { const result = await request('profile', formProfile(form)); user = result.user; renderUser(); $('profile-success').textContent = 'Your preferences have been saved.'; await syncState(); }
      catch (error) { if (isAuthError(error)) signedOut('Your session expired. Please sign in again.'); else setError('profile-error', error.message); }
    });
  });
  $('reset-learning').addEventListener('click', () => busy($('reset-learning'), async () => {
    setError('profile-error'); $('profile-success').textContent = '';
    try { const result = await request('profile', { resetLearning: true }); user = result.user; renderUser(); $('profile-success').textContent = 'Learned interests cleared. Your selected interests are unchanged.'; }
    catch (error) { setError('profile-error', error.message); }
  }));
  $('export-data').addEventListener('click', () => busy($('export-data'), async () => {
    setError('profile-error'); $('profile-success').textContent = '';
    try {
      const data = await request('export');
      const messages = [...(data.messages || [])];
      const cursors = new Set();
      let cursor = data.nextCursor;
      while (cursor !== null && cursor !== undefined) {
        if (cursors.has(String(cursor))) throw new Error('The export could not finish. Please try again later.');
        cursors.add(String(cursor));
        $('profile-success').textContent = `Preparing your download… ${messages.length} messages collected.`;
        const page = await request('export?after=' + encodeURIComponent(cursor));
        messages.push(...(page.messages || [])); cursor = page.nextCursor;
      }
      download('voice-of-vrindavan-my-data.json', JSON.stringify({ ...data, messages, nextCursor: null }, null, 2));
      $('profile-success').textContent = 'Your data download is ready. Keep it private.';
    }
    catch (error) { setError('profile-error', error.message); }
  }));
  $('delete-open').addEventListener('click', () => { closeDialog('profile-dialog'); $('delete-form').reset(); setError('delete-error'); showDialog('delete-dialog'); });
  $('delete-form').addEventListener('submit', (event) => {
    event.preventDefault(); const form = event.currentTarget;
    busy(form.querySelector('[type=submit]'), async () => {
      setError('delete-error');
      try { await request('delete-account', { password: form.elements.password.value }); form.reset(); signedOut('Your account has been deleted.'); }
      catch (error) { setError('delete-error', error.message); }
    });
  });

  function renderIdle() {
    closeLive();
    state = 'idle'; waitingSince = 0; currentRoom = null; afterId = 0; stopPolling();
    $('empty-room').hidden = false; $('chat-room').hidden = true;
    $('empty-room').classList.remove('is-waiting'); $('room-status').textContent = 'READY WHEN YOU ARE';
    $('empty-eyebrow').textContent = 'A SHARED INTEREST. A NEW PERSPECTIVE.';
    $('room-preferences').hidden = false;
    $('empty-title').textContent = 'Who would you like to talk to?';
    $('empty-copy').textContent = 'Choose your interests, then find a match.';
    $('connect').hidden = false; $('cancel-wait').hidden = true; $('wait-details').hidden = true;
  }
  function renderWaiting() {
    if (state !== 'waiting') waitingSince = Date.now();
    state = 'waiting'; currentRoom = null; $('room-preferences').hidden = true;
    $('empty-room').hidden = false; $('chat-room').hidden = true; $('empty-room').classList.add('is-waiting');
    $('room-status').textContent = 'IN THE WAITING ROOM'; $('empty-eyebrow').textContent = 'GOOD CONVERSATIONS ARE WORTH A MOMENT';
    $('empty-title').textContent = 'Finding your match…';
    $('empty-copy').textContent = Date.now() - waitingSince > 60000 ? 'Still waiting for someone available. We’re also looking across other philosophy topics in your language. You can leave the queue at any time.' : Date.now() - waitingSince > 25000 ? 'Nobody suitable is available yet. After a minute, we’ll also look across other philosophy topics in your language.' : 'You’re in the queue. We’re looking for an available person who shares your language and interests.';
    $('connect').hidden = true; $('cancel-wait').hidden = false; $('wait-details').hidden = false;
  }
  function showRoom(room) {
    if (!room) return;
    if (!currentRoom || currentRoom.id !== room.id) {
      if (room.status !== 'ended') tone(true);
      currentRoom = room; afterId = 0; seenMessages = new Set();
      $('message-list').replaceChildren(noMessagesNode()); $('feedback-status').textContent = ''; $('feedback-buttons').hidden = false;
      $('feedback-buttons').querySelectorAll('button').forEach((button) => { button.disabled = false; });
      $('block-open').disabled = false;
      $('message-text').value = ''; $('message-text').style.height = ''; $('message-count').textContent = '0 / 2000';
      setError('chat-error');
    } else currentRoom = room;
    $('empty-room').hidden = true; $('chat-room').hidden = false;
    $('partner-name').textContent = room.partner?.displayName || 'Your conversation partner';
    $('partner-avatar').textContent = initials(room.partner?.displayName);
    $('room-topics').textContent = (room.topics || []).map((topic) => TOPICS[topic] || topic).join(' · ');
    $('room-prompt').textContent = room.prompt || 'What is a question you keep coming back to?';
  }
  function addMessages(messages, advanceCursor = true) {
    if (!Array.isArray(messages)) return;
    const list = $('message-list'); const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 90;
    let added = false; let ownAdded = false;
    for (const message of messages) {
      if (advanceCursor) afterId = Math.max(afterId, Number(message.id) || 0);
      if (seenMessages.has(String(message.id))) continue;
      seenMessages.add(String(message.id));
      $('no-messages')?.remove();
      const own = message.speaker === 'self';
      const row = document.createElement('article'); row.className = 'message' + (own ? ' self' : '');
      row.dataset.messageId = String(message.id);
      const content = document.createElement('p'); content.className = 'message-content'; content.textContent = message.text;
      const meta = document.createElement('span'); meta.className = 'message-meta';
      const date = new Date(message.createdAt);
      const time = Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      meta.textContent = `${own ? 'You' : currentRoom?.partner?.displayName || 'Partner'}${time ? ' · ' + time : ''}`;
      row.append(content, meta);
      const next = Array.from(list.children).find((child) => Number(child.dataset.messageId) > Number(message.id));
      list.insertBefore(row, next || null); if (!own) tone(); added = true; ownAdded ||= own;
    }
    if (added && (atBottom || ownAdded)) list.scrollTop = list.scrollHeight;
  }
  function renderEnded(message = 'This conversation has come to a close.') {
    closeLive();
    state = 'ended'; stopPolling(); $('room-status').textContent = 'CONVERSATION COMPLETE'; $('message-form').hidden = true; $('ended-panel').hidden = false;
    $('leave').hidden = true; $('ended-text').textContent = message;
  }
  function applyState(result) {
    if (result.state === 'waiting') renderWaiting();
    else if (result.state === 'matched' && result.room) {
      state = 'matched'; showRoom(result.room); addMessages(result.messages);
      $('room-status').textContent = 'A MEETING OF MINDS'; $('message-form').hidden = false; $('ended-panel').hidden = true; $('leave').hidden = false;
    } else if (result.state === 'ended' && result.room) { showRoom(result.room); addMessages(result.messages); renderEnded(); }
    else if (result.state === 'idle' && state !== 'ended') renderIdle();
    ensureLive();
  }
  function schedulePoll() {
    stopPolling();
    if (user && !document.hidden && (state === 'waiting' || state === 'matched' || $('global-notice').dataset.connectionError === 'true')) pollTimer = setTimeout(syncState, realtimeEnabled ? 60000 : 4000);
  }
  async function syncState() {
    if (!user) return;
    if (pollBusy) { syncAgain = true; return; }
    pollBusy = true;
    const version = generation;
    try {
      const result = await request('state?after=' + encodeURIComponent(afterId));
      if (version !== generation || !user) return;
      if (enteringRoom && (result.state === 'idle' || result.state === 'ended')) renderIdle();
      else applyState(result);
      enteringRoom = false;
      if ($('global-notice').dataset.connectionError === 'true') { notice(''); delete $('global-notice').dataset.connectionError; }
    } catch (error) {
      if (version !== generation) return;
      if (isAuthError(error)) signedOut('Your session expired. Please sign in again.');
      else { notice(error.message + ' We’ll reconnect automatically while this page is open.', true); $('global-notice').dataset.connectionError = 'true'; }
    } finally {
      pollBusy = false;
      if (syncAgain && user && !document.hidden) { syncAgain = false; syncState(); }
      else schedulePoll();
    }
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopPolling(); else if (user) syncState(); });
  window.addEventListener('online', () => { if (user) syncState(); });

  async function connect(button) {
    await busy(button, async () => {
      setError('connect-error'); setError('chat-error');
      try {
        const preferences = new FormData($('room-preferences'));
        const interests = preferences.getAll('interests');
        if (!interests.length) throw new Error('Choose at least one topic or interest.');
        const updated = await request('profile', { interests, language: preferences.get('language'), style: preferences.get('style') });
        user = updated.user; renderUser();
        const result = await request('connect', {}); generation++; currentRoom = null; afterId = 0; seenMessages.clear(); applyState(result); await syncState(); }
      catch (error) { if (isAuthError(error)) signedOut('Your session expired. Please sign in again.'); else { if (state === 'ended') setError('chat-error', error.message); else setError('connect-error', error.message); } }
    });
  }
  $('room-preferences').addEventListener('submit', event => { event.preventDefault(); connect($('connect')); });
  $('connect-again').addEventListener('click', () => { renderIdle(); $('room-preferences').scrollIntoView({block:'center'}); });
  $('cancel-wait').addEventListener('click', () => busy($('cancel-wait'), async () => {
    setError('connect-error');
    try { await request('leave', { roomId: currentRoom?.id || null }); generation++; renderIdle(); }
    catch (error) { setError('connect-error', error.message); }
  }));
  $('leave').addEventListener('click', () => busy($('leave'), async () => {
    if (!currentRoom) return;
    setError('chat-error');
    try { await request('leave', { roomId: currentRoom.id }); generation++; renderEnded('You left the conversation. Thank you for sharing a little curiosity.'); }
    catch (error) { setError('chat-error', error.message); }
  }));

  $('message-text').addEventListener('input', (event) => {
    const input = event.currentTarget; $('message-count').textContent = `${input.value.length} / 2000`;
    input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 128) + 'px';
  });
  $('message-text').addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if ($('message-text').value.trim() && !$('message-form').querySelector('button').disabled) $('message-form').requestSubmit(); } });
  $('message-form').addEventListener('submit', (event) => {
    event.preventDefault(); const form = event.currentTarget;
    busy(form.querySelector('button'), async () => {
      if (!currentRoom || state !== 'matched') return;
      const text = $('message-text').value.trim(); if (!text) return;
      const roomId = currentRoom.id; const version = generation;
      setError('chat-error');
      try {
        const result = await request('message', { roomId, text });
        if (version !== generation || currentRoom?.id !== roomId) return;
        if ($('message-text').value.trim() === text) { $('message-text').value = ''; $('message-text').style.height = ''; $('message-count').textContent = '0 / 2000'; }
        // Sending must not advance the read cursor past unseen partner messages.
        if (result.message) addMessages([result.message], false);
        if (!realtimeEnabled) await syncState(); $('message-text').focus();
      } catch (error) { if (isAuthError(error)) signedOut('Your session expired. Please sign in again.'); else { setError('chat-error', error.message); if (error.status === 409) await syncState(); } }
    });
  });

  $('report-open').addEventListener('click', () => { if (!currentRoom) return; $('report-form').reset(); setError('report-error'); showDialog('report-dialog'); });
  $('report-form').addEventListener('submit', (event) => {
    event.preventDefault(); const form = event.currentTarget;
    busy(form.querySelector('[type=submit]'), async () => {
      if (!currentRoom) return;
      setError('report-error');
      try { await request('report', { roomId: currentRoom.id, reason: form.elements.reason.value }); generation++; closeDialog('report-dialog'); renderEnded('Your report has been saved and this conversation is closed.'); notice('Your report has been saved for review. You can also block this person to prevent future matches.'); }
      catch (error) { setError('report-error', error.message); }
    });
  });
  $('block-open').addEventListener('click', () => { if (!currentRoom) return; setError('block-error'); showDialog('block-dialog'); });
  $('block-confirm').addEventListener('click', () => busy($('block-confirm'), async () => {
    if (!currentRoom) return;
    setError('block-error');
    try { await request('block', { roomId: currentRoom.id }); generation++; closeDialog('block-dialog'); renderEnded('This person is blocked. Your accounts won’t be matched again.'); $('block-open').disabled = true; }
    catch (error) { setError('block-error', error.message); }
  }));
  $('feedback-buttons').querySelectorAll('[data-rating]').forEach((button) => button.addEventListener('click', () => {
    const buttons = Array.from($('feedback-buttons').querySelectorAll('button'));
    if (!currentRoom || button.disabled) return;
    buttons.forEach((item) => { item.disabled = true; }); $('feedback-status').textContent = '';
    request('feedback', { roomId: currentRoom.id, rating: button.dataset.rating }).then(() => { $('feedback-status').textContent = 'Thank you. Your feedback helps improve future matches.'; $('feedback-buttons').hidden = true; }).catch((error) => { $('feedback-status').textContent = error.message; buttons.forEach((item) => { item.disabled = false; }); });
  }));

  async function init() {
    try { const result = await request('me'); if (result.user) authenticated(result.user); else signedOut(); }
    catch (error) { signedOut(); notice(error.message, true); }
  }
  init();
})();
