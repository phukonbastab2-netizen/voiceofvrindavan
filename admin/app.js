(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const API = '/api/community/admin/';
  const requests = new Set();
  const downloadUrls = new Set();
  let token = '', epoch = 0, reports = [], selected = null, reviewRequest = 0;
  let pendingAction = null, exportJob = null, lastActivity = Date.now(), actionBusy = false;
  const date = value => Number.isFinite(Number(value)) ? new Date(Number(value)).toLocaleString() : 'Date unavailable';
  const cancelled = () => new DOMException('Operation cancelled', 'AbortError');
  function notify(message, error = false) { $('notice').textContent = message; $('notice').hidden = !message; $('notice').classList.toggle('error', error); }
  function node(tag, text, className) { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; }
  function lock(message = '') {
    epoch++; token = ''; reports = []; selected = null; pendingAction = null; reviewRequest++;
    if (exportJob) exportJob.cancelled = true;
    exportJob = null; actionBusy = false;
    for (const controller of requests) controller.abort();
    requests.clear();
    for (const url of downloadUrls) URL.revokeObjectURL(url);
    downloadUrls.clear();
    $('token').value = ''; $('console').hidden = true; $('lock').hidden = true; $('access').hidden = false;
    $('unlock').disabled = false; $('unlock').textContent = 'Open console ↗'; $('access-error').textContent = '';
    $('stats').replaceChildren(); $('reports').replaceChildren(); $('messages').replaceChildren();
    $('report-meta').replaceChildren(); $('report-reason').textContent = ''; $('report-date').textContent = ''; $('room-notice').textContent = '';
    $('review-content').hidden = true; $('review-empty').hidden = false; $('report-count').textContent = '';
    $('updated').textContent = ''; $('export-status').textContent = ''; $('cancel-export').hidden = true;
    $('export').disabled = false; $('export-kind').disabled = false; $('refresh').disabled = false;
    $('confirm-member').textContent = ''; $('confirm-error').textContent = ''; $('confirm-apply').disabled = false; $('confirm-cancel').disabled = false;
    if ($('confirm').open) $('confirm').close();
    notify(message);
  }
  async function request(path, options = {}) {
    if (!token) throw cancelled();
    const generation = epoch;
    const controller = new AbortController(); requests.add(controller);
    const externalSignal = options.signal;
    const abort = () => controller.abort();
    externalSignal?.addEventListener('abort', abort, { once: true });
    if (externalSignal?.aborted) controller.abort();
    const timer = setTimeout(abort, 30000);
    try {
      const response = await fetch(API + path, {
        method: options.body ? 'POST' : 'GET', mode: 'same-origin', credentials: 'omit',
        cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: { Authorization: 'Bearer ' + token, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
        ...(options.body ? { body: JSON.stringify(options.body) } : {})
      });
      if (generation !== epoch) throw cancelled();
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        if (response.status === 401) lock('Access expired or the administrator token was rejected.');
        throw new Error(typeof data.error === 'string' ? data.error : `Request failed (${response.status}). Please try again.`);
      }
      if (options.read) return await options.read(response, controller.signal);
      const data = await response.json();
      if (generation !== epoch) throw cancelled();
      return data;
    } catch (error) {
      if (generation !== epoch || externalSignal?.aborted) throw cancelled();
      if (error.name === 'AbortError') throw new Error('The request took too long. Please try again.');
      if (error instanceof TypeError) throw new Error('Cannot reach the community service. Check your connection and try again.');
      throw error;
    } finally {
      clearTimeout(timer); requests.delete(controller); externalSignal?.removeEventListener('abort', abort);
    }
  }
  function renderStats(stats) {
    const labels = { users: 'Members', waiting: 'Waiting now', activeRooms: 'Active conversations', retainedRooms: 'Retained conversations', openReports: 'Open reports', suspendedUsers: 'Banned members' };
    $('stats').replaceChildren(...Object.entries(labels).map(([key, label]) => {
      const card = node('div', undefined, 'stat');
      card.append(node('dt', label), node('dd', Number.isFinite(stats[key]) ? stats[key].toLocaleString() : '—')); return card;
    }));
    $('updated').textContent = `Refreshed ${new Date().toLocaleTimeString()}. Conversation retention window: ${Number.isFinite(stats.retentionDays) ? stats.retentionDays : 30} days.`;
  }
  function renderReports() {
    $('report-count').textContent = reports.length ? `${reports.length} report${reports.length === 1 ? '' : 's'} loaded. Select one to review.` : 'No unresolved reports in this view.';
    $('reports').replaceChildren(...reports.map(report => {
      const item = node('li'); const button = node('button', undefined, 'report-item'); button.type = 'button';
      button.setAttribute('aria-current', String(selected?.id === report.id));
      button.append(node('span', date(report.created_at), 'report-time'), node('span', String(report.reason || '').slice(0, 180), 'reason'), node('span', 'Report ' + report.id, 'report-id'));
      button.addEventListener('click', () => openReport(report)); item.append(button); return item;
    }));
  }
  async function refresh() {
    const generation = epoch; $('refresh').disabled = true;
    try {
      const [stats, result] = await Promise.all([request('stats'), request('reports')]);
      if (generation !== epoch) return;
      renderStats(stats); reports = Array.isArray(result.reports) ? result.reports : [];
      if (selected && !reports.some(r => r.id === selected.id)) {
        selected = null; reviewRequest++; $('review-content').hidden = true; $('review-empty').hidden = false; $('messages').replaceChildren();
      }
      renderReports();
    } finally { if (generation === epoch) $('refresh').disabled = false; }
  }
  async function openReport(report) {
    if (actionBusy) return;
    const generation = epoch, sequence = ++reviewRequest;
    selected = report; renderReports(); $('review-empty').hidden = true; $('review-content').hidden = false;
    $('report-date').textContent = 'Reported ' + date(report.created_at); $('report-reason').textContent = report.reason || 'No reason supplied.';
    const metadata = [['Report', report.id], ['Conversation', report.room_id], ['Reporting member', report.reporter_id], ['Reported member', report.reported_id]];
    $('report-meta').replaceChildren(...metadata.flatMap(([key, value]) => [node('dt', key), node('dd', value)]));
    $('messages').replaceChildren(); $('room-notice').textContent = 'Loading the reported conversation…'; $('dismiss').disabled = true; $('ban').disabled = true;
    try {
      const result = await request('reported-room?' + new URLSearchParams({ roomId: report.room_id }));
      if (generation !== epoch || sequence !== reviewRequest) return;
      const messages = Array.isArray(result.messages) ? result.messages : [];
      $('room-notice').textContent = messages.length ? `${messages.length} messages retained. Read the full exchange before taking action.` : 'No messages are retained for this conversation.';
      $('messages').replaceChildren(...messages.map(message => {
        const reported = message.sender_id === report.reported_id;
        const label = reported ? 'Reported member' : message.sender_id === report.reporter_id ? 'Reporting member' : 'Conversation member';
        const item = node('li', undefined, reported ? 'reported' : '');
        item.append(node('p', `${label} · ${date(message.created_at)}`, 'message-meta'), node('p', message.text || '')); return item;
      }));
      $('dismiss').disabled = false; $('ban').disabled = false;
    } catch (error) {
      if (error.name !== 'AbortError' && generation === epoch && sequence === reviewRequest) $('room-notice').textContent = error.message;
    }
  }
  function confirmAction(action) {
    if (!selected || actionBusy) return;
    pendingAction = { reportId: selected.id, action, member: selected.reported_id };
    $('confirm-title').textContent = action === 'ban' ? 'Ban this member?' : 'Dismiss this report?';
    $('confirm-copy').textContent = action === 'ban'
      ? 'This member will be unable to sign in. Their active conversations end and their conversations become ineligible for dataset exports. This console has no unban action.'
      : 'Close this report after reviewing the conversation. The member keeps access. This action does not remove the report record.';
    $('confirm-member').textContent = 'Reported member: ' + selected.reported_id;
    $('confirm-apply').textContent = action === 'ban' ? 'Ban member' : 'Dismiss report';
    $('confirm-apply').classList.toggle('danger', action === 'ban'); $('confirm-error').textContent = ''; $('confirm').showModal();
  }
  async function moderate() {
    if (!pendingAction || actionBusy) return;
    const generation = epoch, action = pendingAction; actionBusy = true; $('confirm-apply').disabled = true; $('confirm-cancel').disabled = true;
    try {
      await request('moderate', { body: { reportId: action.reportId, action: action.action } });
      if (generation !== epoch) return;
      $('confirm').close(); pendingAction = null; notify(action.action === 'ban' ? 'The member was banned and the report was resolved.' : 'The report was dismissed.');
      await refresh();
    } catch (error) { if (error.name !== 'AbortError' && generation === epoch) { if ($('confirm').open) $('confirm-error').textContent = error.message; else notify('Action completed, but the overview could not refresh. ' + error.message, true); } }
    finally { if (generation === epoch) { actionBusy = false; $('confirm-apply').disabled = false; $('confirm-cancel').disabled = false; } }
  }
  async function downloadDataset() {
    if (exportJob) return;
    const generation = epoch, training = $('export-kind').value === '1';
    const job = { cancelled: false, controller: new AbortController() }; exportJob = job;
    $('export').disabled = true; $('export-kind').disabled = true; $('cancel-export').hidden = false;
    const chunks = [], cursors = new Set(), ids = new Set(); let cursor = '', totalBytes = 0, complete = false, count = 0;
    try {
      for (let page = 1; page <= 200; page++) {
        if (job.cancelled || generation !== epoch) throw cancelled();
        $('export-status').textContent = `Reading page ${page} · ${count} eligible conversations collected…`;
        const query = new URLSearchParams({ training: training ? '1' : '0' }); if (cursor) query.set('after', cursor);
        const result = await request('dataset?' + query, { signal: job.controller.signal, read: async (response, signal) => {
          if (!response.headers.get('Content-Type')?.includes('application/x-ndjson')) throw new Error('The server did not return a dataset. No file was saved.');
          const next = response.headers.get('X-Next-Cursor');
          if (next === null) throw new Error('Pagination information is missing. No partial file was saved.');
          if (!response.body) throw new Error('The dataset response was empty. Please try again.');
          const reader = response.body.getReader(), decoder = new TextDecoder(); let text = '';
          try {
            while (true) {
              const part = await reader.read(); if (part.done) break;
              if (signal.aborted || job.cancelled) throw cancelled();
              totalBytes += part.value.byteLength;
              if (totalBytes > 64 * 1024 * 1024) throw new Error('This export exceeds 64 MB. No partial file was saved. Use a managed server export for this volume.');
              text += decoder.decode(part.value, { stream: true });
            }
            text += decoder.decode(); return { text, next };
          } catch (error) { await reader.cancel().catch(() => {}); throw error; }
        }});
        for (const line of result.text.split('\n').filter(line => line.trim())) {
          let record; try { record = JSON.parse(line); } catch { throw new Error('The export contains an invalid record. No file was saved.'); }
          if (typeof record.conversation_id !== 'string' || !Array.isArray(record.messages) || record.allowed_use !== (training ? 'ai_training' : 'research_and_match_quality')) throw new Error('The export does not match the requested permission. No file was saved.');
          if (ids.has(record.conversation_id)) throw new Error('A repeated conversation was returned. No partial file was saved. Please refresh and try again.');
          ids.add(record.conversation_id); count++;
        }
        if (result.text) chunks.push(result.text.endsWith('\n') ? result.text : result.text + '\n');
        if (!result.next) { complete = true; break; }
        if (result.next.length > 64 || cursors.has(result.next)) throw new Error('The export stopped advancing. No partial file was saved.');
        cursors.add(result.next); cursor = result.next;
      }
      if (!complete) throw new Error('This export exceeds 200 pages. No partial file was saved. Use a managed server export for this volume.');
      if (job.cancelled || generation !== epoch) throw cancelled();
      if (!count) { $('export-status').textContent = 'No conversations currently meet both participants’ permissions for this use. No file was saved.'; return; }
      const blob = new Blob(chunks, { type: 'application/x-ndjson;charset=utf-8' });
      const url = URL.createObjectURL(blob); downloadUrls.add(url);
      const anchor = node('a'); anchor.href = url; anchor.download = `voice-of-vrindavan-${training ? 'training' : 'research'}-current-${new Date().toISOString().slice(0,10)}.ndjson`;
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.delete(url); }, 1000);
      $('export-status').textContent = `Complete export prepared: ${count} conversations. Your browser download has started. Replace outdated copies and revalidate permissions before use.`;
    } catch (error) { if (generation === epoch) $('export-status').textContent = error.name === 'AbortError' || job.cancelled ? 'Export cancelled. No partial file was saved.' : error.message; }
    finally { if (exportJob === job) { exportJob = null; $('export').disabled = false; $('export-kind').disabled = false; $('cancel-export').hidden = true; } }
  }
  $('unlock-form').addEventListener('submit', async event => {
    event.preventDefault(); token = $('token').value.trim(); $('token').value = ''; epoch++; lastActivity = Date.now();
    const generation = epoch; $('unlock').disabled = true; $('unlock').textContent = 'Checking access…'; $('access-error').textContent = ''; notify('');
    try {
      await refresh(); if (generation !== epoch) return;
      $('access').hidden = true; $('console').hidden = false; $('lock').hidden = false; $('refresh').focus();
    } catch (error) {
      if (generation === epoch) { lock(); $('access-error').textContent = error.message; }
    } finally { if (generation === epoch) { $('unlock').disabled = false; $('unlock').textContent = 'Open console ↗'; } }
  });
  $('lock').addEventListener('click', () => { lock('Console locked. The token and loaded conversations were cleared from this page.'); $('token').focus(); });
  $('refresh').addEventListener('click', () => { notify(''); refresh().catch(error => { if (error.name !== 'AbortError') notify(error.message, true); }); });
  $('dismiss').addEventListener('click', () => confirmAction('dismiss')); $('ban').addEventListener('click', () => confirmAction('ban'));
  $('confirm-cancel').addEventListener('click', () => { pendingAction = null; $('confirm').close(); });
  $('confirm').addEventListener('cancel', event => { if (actionBusy) event.preventDefault(); else pendingAction = null; });
  $('confirm-apply').addEventListener('click', moderate); $('export').addEventListener('click', downloadDataset);
  $('cancel-export').addEventListener('click', () => { if (exportJob) { exportJob.cancelled = true; exportJob.controller.abort(); } });
  for (const event of ['pointerdown','keydown']) document.addEventListener(event, () => { lastActivity = Date.now(); }, { passive: true });
  setInterval(() => { if (token && Date.now() - lastActivity > 15 * 60 * 1000) lock('Console locked after 15 minutes of inactivity.'); }, 30000);
  addEventListener('pagehide', () => lock());
})();
