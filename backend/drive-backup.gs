/** Private Google Apps Script. Uses only files created by this script. */
const API = 'https://voiceofvrindavan.com/api/community/admin/dataset';

function setupBackup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('DATASET_EXPORT_TOKEN')) throw new Error('Set DATASET_EXPORT_TOKEN in Script Properties before running setupBackup.');
  syncDatasets();
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'syncDatasets')) {
    ScriptApp.newTrigger('syncDatasets').timeBased().everyHours(1).create();
  }
  console.log('Hourly private Drive backup configured. Folder: https://drive.google.com/drive/folders/' + props.getProperty('FOLDER_ID'));
}

function syncDatasets() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty('DATASET_EXPORT_TOKEN');
    if (!token) throw new Error('Missing export token');
    // Fetch every page before replacing either managed snapshot.
    const research = fetchDataset_(token, false);
    const training = fetchDataset_(token, true);
    let folderId = props.getProperty('FOLDER_ID');
    if (!folderId) {
      folderId = Drive.Files.create({ name: 'Voice of Vrindavan — Private Datasets', mimeType: 'application/vnd.google-apps.folder' }, null, { fields: 'id' }).id;
      props.setProperty('FOLDER_ID', folderId);
    }
    putFile_(props, folderId, 'RESEARCH_FILE', 'current-research-dataset.jsonl', research.text, 'application/x-ndjson');
    putFile_(props, folderId, 'TRAINING_FILE', 'current-training-dataset.jsonl', training.text, 'application/x-ndjson');
    putFile_(props, folderId, 'STATUS_FILE', 'sync-status.json', JSON.stringify({ updatedAt: new Date().toISOString(), researchConversations: research.count, trainingConversations: training.count, retentionDays: 30, policy: 'Current consented snapshot only. Revalidate before use. Pseudonymized and automatically redacted, not guaranteed anonymous.' }, null, 2), 'application/json');
    props.setProperty('LAST_SUCCESS_AT', new Date().toISOString());
    console.log('Backup complete: ' + research.count + ' research conversations; ' + training.count + ' training-permitted conversations.');
  } finally { lock.releaseLock(); }
}

function fetchDataset_(token, training) {
  let cursor = '', parts = [], count = 0, bytes = 0;
  for (let page = 0; page < 200; page++) {
    const response = UrlFetchApp.fetch(API + '?training=' + (training ? '1' : '0') + (cursor ? '&after=' + encodeURIComponent(cursor) : ''), { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true, followRedirects: false });
    if (response.getResponseCode() !== 200) throw new Error('Dataset export failed with HTTP ' + response.getResponseCode() + '; previous files preserved.');
    const chunk = response.getContentText();
    const rows = chunk.split('\n').filter(Boolean);
    rows.forEach(row => { const item = JSON.parse(row); if (!item.conversation_id || !Array.isArray(item.messages)) throw new Error('Invalid dataset record'); });
    if (rows.length) parts.push(rows.join('\n'));
    count += rows.length; bytes += chunk.length;
    if (bytes > 20000000) throw new Error('Dataset exceeds the 20 MB snapshot limit; partition exports before increasing capacity.');
    const headers = response.getAllHeaders();
    const key = Object.keys(headers).find(k => k.toLowerCase() === 'x-next-cursor');
    const next = key ? String(headers[key]) : '';
    if (!next) return { text: parts.length ? parts.join('\n') + '\n' : '', count: count };
    if (next === cursor) throw new Error('Export cursor did not advance');
    cursor = next;
  }
  throw new Error('Dataset exceeds the page limit; previous files preserved.');
}

function putFile_(props, folderId, key, name, text, mime) {
  const blob = Utilities.newBlob(text, mime, name);
  const fileId = props.getProperty(key);
  if (fileId) Drive.Files.update({}, fileId, blob, { fields: 'id' });
  else {
    const file = Drive.Files.create({ name: name, parents: [folderId] }, blob, { fields: 'id' });
    props.setProperty(key, file.id);
  }
}
