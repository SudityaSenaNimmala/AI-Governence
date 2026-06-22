const $ = (id) => document.getElementById(id);

const STORAGE = {
  CONFIG: 'cfai.config',
  TOKEN: 'cfai.token',
  MACHINE_ID: 'cfai.machineId',
  QUEUE: 'cfai.queue',
};

async function load() {
  const { [STORAGE.CONFIG]: config = {}, [STORAGE.QUEUE]: queue = [], [STORAGE.TOKEN]: token } =
    await chrome.storage.local.get([STORAGE.CONFIG, STORAGE.QUEUE, STORAGE.TOKEN]);
  $('serverUrl').value = config.serverUrl || '';
  // Never display the actual secret, but show a "saved" placeholder so the
  // user knows they don't need to retype it. This is the key UX fix — most
  // users hit Save expecting to update the URL or just re-enroll, and the
  // blank field was previously wiping their stored secret.
  $('enrollSecret').value = '';
  $('enrollSecret').placeholder = config.enrollSecret
    ? '•••••••• (saved — leave blank to keep)'
    : 'paste secret from IT';
  $('queueStat').textContent =
    `${queue.length} events pending · token ${token ? 'present' : 'not enrolled'}`;
}

async function save() {
  const serverUrl = $('serverUrl').value.trim();
  const enrollSecretInput = $('enrollSecret').value.trim();
  if (!serverUrl) return setStatus('Server URL required', 'err');

  // Read the existing config. If the user left the secret field blank AND we
  // already have one stored, KEEP it. Previously this silently wiped the
  // saved secret on every Save, forcing the user to retype it after every
  // reload — that was the bug.
  const { [STORAGE.CONFIG]: existing = {} } = await chrome.storage.local.get([STORAGE.CONFIG]);
  const enrollSecret = enrollSecretInput || existing.enrollSecret || '';
  if (!enrollSecret) return setStatus('Enrollment secret required (first time only)', 'err');

  await chrome.storage.local.set({
    [STORAGE.CONFIG]: { serverUrl, enrollSecret },
  });
  // Force re-enrollment with the (possibly new) credentials
  await chrome.storage.local.remove([STORAGE.TOKEN]);

  setStatus('Saved. Enrolling…');

  try {
    let machineId = (await chrome.storage.local.get(STORAGE.MACHINE_ID))[STORAGE.MACHINE_ID];
    if (!machineId) {
      machineId = crypto.randomUUID();
      await chrome.storage.local.set({ [STORAGE.MACHINE_ID]: machineId });
    }
    const hostname = navigator.userAgent.split(/[\s/(]/)[0] + '-browser-extension';
    const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/v1/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machineId, hostname, enrollSecret }),
    });
    if (!res.ok) throw new Error(await res.text());
    const { token } = await res.json();
    await chrome.storage.local.set({ [STORAGE.TOKEN]: token });
    setStatus('Enrolled successfully.', 'ok');
    load();
  } catch (err) {
    setStatus('Enrollment failed: ' + err.message, 'err');
  }
}

function setStatus(text, kind = '') {
  const el = $('status');
  el.textContent = text;
  el.className = 'status ' + kind;
}

$('save').addEventListener('click', save);
$('flush').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ kind: 'manual_flush' });
  setStatus('Flush requested.', 'ok');
  setTimeout(load, 800);
});
$('reset').addEventListener('click', async () => {
  if (!confirm('Reset extension state? You will need to re-enter the enrollment secret.')) return;
  await chrome.storage.local.clear();
  load();
  setStatus('Reset.', 'ok');
});

load();
