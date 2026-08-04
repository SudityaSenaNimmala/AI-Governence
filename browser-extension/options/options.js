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
  // user knows they don't need to retype it.
  $('enrollSecret').value = '';
  $('enrollSecret').placeholder = config.enrollSecret
    ? '•••••••• (saved — leave blank to keep)'
    : 'paste secret from IT';
  $('queueStat').textContent =
    `${queue.length} events pending · token ${token ? 'present' : 'not enrolled'}`;

  // Auto-detect desktop agent on this machine
  detectDesktopAgent();
}

async function detectDesktopAgent() {
  const statusEl = $('machineStatus');
  try {
    const res = await fetch('http://127.0.0.1:19532/cfai/identity', { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error('not ok');
    const data = await res.json();
    // Save to config so enrollment uses it
    const { [STORAGE.CONFIG]: config = {} } = await chrome.storage.local.get([STORAGE.CONFIG]);
    config.computerName = data.hostname;
    config.detectedUser = data.user;
    config.detectedMachineId = data.machineId;
    await chrome.storage.local.set({ [STORAGE.CONFIG]: config });
    statusEl.textContent = '✓ Desktop agent detected: ' + data.hostname + ' (' + data.user + ' · ' + data.platform + ')';
    statusEl.className = 'status ok';
  } catch {
    statusEl.textContent = 'Desktop agent not detected — browser data won\'t be linked to a machine profile. Make sure the CloudFuze agent is running.';
    statusEl.className = 'status';
  }
}

async function save() {
  const serverUrl = $('serverUrl').value.trim();
  const enrollSecretInput = $('enrollSecret').value.trim();
  if (!serverUrl) return setStatus('Server URL required', 'err');

  // Read the existing config. If the user left the secret field blank AND we
  // already have one stored, KEEP it. Previously this silently wiped the
  // saved secret on every Save, forcing the user to retype it after every
  // reload — that was the bug.
  const computerName = '';
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
    // Read fresh config (may have been updated by detectDesktopAgent)
    const freshConfig = (await chrome.storage.local.get([STORAGE.CONFIG]))[STORAGE.CONFIG] || {};
    const detectedName = freshConfig.computerName || computerName;
    // Use auto-detected computer name if available, otherwise fall back to UA-based ID
    const hostname = detectedName
      ? detectedName + '-browser-extension'
      : navigator.userAgent.split(/[\s/(]/)[0] + '-browser-extension';
    const enrollBody = { machineId, hostname, enrollSecret };
    if (employeeEmail) enrollBody.employeeEmail = employeeEmail;
    const res = await fetch(`${serverUrl.replace(/\/$/, '')}/api/v1/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(enrollBody),
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
