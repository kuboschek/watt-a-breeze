import { SENSOR_TYPES, defaultProfile, normalizeProfile, validThresholds, demand, adaptiveDemand, parseHeartRate, parsePower } from './core.js';
import { FanConnection } from './bluetooth.js';

const $ = id => document.getElementById(id);
const fan = new FanConnection(navigator.bluetooth);
const storageKey = 'headwind.cooling-profile.v1';
let profile = defaultProfile();
let storageAvailable = true;
try { profile = normalizeProfile(JSON.parse(localStorage.getItem(storageKey))); } catch { storageAvailable = false; }
const readings = {};
const sensors = {};
const preview = Object.fromEntries(Object.entries(SENSOR_TYPES).map(([key, t]) => [key, t.value]));
let demo = false, busy = false, pairing = false, running = false, writing = false;
let lastSpeed = null, wakeLock = null, lastLeader = '';
let sliderTimer = null, pendingSliderSpeed = null;
const logs = [];
function log(message) {
  logs.push(`${new Date().toLocaleTimeString()}  ${message}`);
  if (logs.length > 200) logs.shift();
  $('log').textContent = logs.join('\n');
}
function notice(message, type = '') { $('notice').textContent = message; $('notice').className = `notice ${type}`; }
function showSpeed(speed) {
  lastSpeed = speed;
  $('speed-display').textContent = speed ?? '—';
  $('speed-caption').textContent = speed === null ? 'No command sent' : demo ? 'Simulated airflow' : 'Last command written';
  $('gauge').style.setProperty('--fill', `${(speed || 0) * .75}%`);
}
function renderControls() {
  const ready = demo || fan.connected;
  $('connect').hidden = fan.connected || demo;
  $('connect').disabled = busy || pairing || !navigator.bluetooth || !window.isSecureContext;
  $('disconnect').hidden = !fan.connected;
  $('disconnect').disabled = busy || pairing || writing;
  $('show-all').disabled = busy || fan.connected || demo;
  $('demo').disabled = busy || pairing || writing || fan.connected;
  $('demo').textContent = demo ? 'Exit demo mode' : 'Try demo mode';
  $('connection-status').textContent = demo ? 'Demo · No hardware' : fan.connected ? 'Connected' : 'Disconnected';
  $('connection-status').className = `status ${ready ? 'online' : ''}`;
  $('control-badge').textContent = running ? 'Adaptive' : 'Manual';
  $('control-badge').hidden = !running;
  $('speed').disabled = !ready || busy || running;
  for (const element of [$('apply-speed'), ...document.querySelectorAll('[data-speed]')]) element.disabled = !ready || busy || running || writing;
  $('off').disabled = !ready || busy || writing;
  $('start-adaptive').hidden = running;
  $('stop-adaptive').hidden = !running;
  $('start-adaptive').disabled = !ready || busy || pairing || writing || !['hr', 'power'].some(key => profile[key].enabled);
  $('stop-adaptive').disabled = writing;
  for (const key of ['hr', 'power']) {
    $(`pair-${key}`).disabled = demo || busy || pairing || running || !navigator.bluetooth || !window.isSecureContext;
    $(`pair-${key}`).textContent = sensors[key] ? 'Disconnect' : 'Connect';
  }
}
function saveProfile() {
  try { localStorage.setItem(storageKey, JSON.stringify(profile)); storageAvailable = true; }
  catch { storageAvailable = false; }
  $('save-status').textContent = storageAvailable ? 'Saved in this browser · Never synced to fan' : 'Storage unavailable · Export to keep this profile';
}
function updatePreview() {
  let maximum = 0;
  for (const [key, p] of Object.entries(profile)) {
    const value = p.enabled ? demand(preview[key], p.min, p.max) : 0;
    $(`request-${key}`).textContent = p.enabled ? `${value}%` : 'Excluded';
    maximum = Math.max(maximum, value);
  }
  $('preview-output').textContent = `${maximum}%`;
}
function createSettings() {
  for (const [key, t] of Object.entries(SENSOR_TYPES)) {
    const row = document.createElement('tr');
    row.innerHTML = `<td><label class="sensor-label"><input type="checkbox" id="enabled-${key}">${t.label}</label><small>${t.live ? 'Browser control + preview' : 'Planning + preview only'}</small></td>` +
      ['min', 'max', 'preview'].map(field => `<td><label><input id="${field}-${key}" type="number" min="${t.bounds[0]}" max="${t.bounds[1]}" step="${t.step}" aria-label="${t.label} ${field === 'min' ? 'starts cooling at' : field === 'max' ? 'full airflow at' : 'preview reading'}" required><span class="unit">${t.unit}</span></label></td>`).join('') +
      `<td><output class="request" id="request-${key}"></output></td>`;
    $('settings-rows').append(row);
    $(`enabled-${key}`).checked = profile[key].enabled;
    $(`enabled-${key}`).addEventListener('change', e => {
      profile[key].enabled = e.target.checked; saveProfile(); updatePreview(); renderControls();
    });
    for (const field of ['min', 'max', 'preview']) {
      const input = $(`${field}-${key}`);
      input.value = field === 'preview' ? preview[key] : profile[key][field];
      input.addEventListener('input', () => {
        const minimum = $(`min-${key}`).valueAsNumber, maximum = $(`max-${key}`).valueAsNumber;
        $(`min-${key}`).setCustomValidity(''); $(`max-${key}`).setCustomValidity('');
        if (!validThresholds(key, minimum, maximum)) {
          const message = t.descending ? 'Start pace must be slower (a larger min/km value) than full-airflow pace.' : 'Start threshold must be lower than full-airflow threshold, within the allowed range.';
          $(`max-${key}`).setCustomValidity(message);
          $('save-status').textContent = `Invalid ${t.label.toLowerCase()} thresholds. Last valid settings remain active.`;
          return;
        }
        profile[key].min = minimum; profile[key].max = maximum;
        if ($(`preview-${key}`).validity.valid) preview[key] = $(`preview-${key}`).valueAsNumber;
        saveProfile(); updatePreview();
      });
    }
  }
  updatePreview();
}
function createSensors() {
  for (const key of ['hr', 'power']) {
    const t = SENSOR_TYPES[key];
    const card = document.createElement('div'); card.className = 'sensor-card';
    card.innerHTML = `<span class="sensor-glyph" aria-hidden="true">${key === 'hr' ? '♡' : 'ϟ'}</span><div class="sensor-body"><strong>${t.label}</strong><p id="sensor-${key}">No sensor connected</p></div><output class="reading" id="reading-${key}">—</output><button id="pair-${key}">Connect</button>`;
    $('live-sensors').append(card);
    $(`pair-${key}`).addEventListener('click', () => pairSensor(key));
  }
}
function renderReadings() {
  for (const key of ['hr', 'power']) {
    const fresh = readings[key] && Date.now() - readings[key].at <= 10000;
    $(`reading-${key}`).textContent = fresh ? `${readings[key].value}` : '—';
    $(`reading-${key}`).setAttribute('aria-label', `${SENSOR_TYPES[key].label}: ${fresh ? `${readings[key].value} ${SENSOR_TYPES[key].unit}` : 'no fresh reading'}`);
    $(`sensor-${key}`).textContent = demo ? `Simulated · ${SENSOR_TYPES[key].unit}` : sensors[key] ? `${sensors[key].device.name || SENSOR_TYPES[key].label} · ${fresh ? SENSOR_TYPES[key].unit : 'Waiting for fresh reading'}` : 'No sensor connected';
  }
}
async function pairSensor(key) {
  if (sensors[key]) { disconnectSensor(key); renderReadings(); renderControls(); return; }
  pairing = true; renderControls();
  let device, characteristic, handler, onDisconnect;
  const serviceName = key === 'hr' ? 'heart_rate' : 'cycling_power';
  try {
    device = await navigator.bluetooth.requestDevice({ filters: [{ services: [serviceName] }] });
    onDisconnect = () => {
      if (sensors[key]?.device !== device) return;
      characteristic?.removeEventListener('characteristicvaluechanged', handler);
      delete sensors[key]; delete readings[key]; log(`${SENSOR_TYPES[key].label} disconnected.`); renderReadings(); renderControls();
    };
    device.addEventListener('gattserverdisconnected', onDisconnect);
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(serviceName);
    characteristic = await service.getCharacteristic(key === 'hr' ? 'heart_rate_measurement' : 'cycling_power_measurement');
    handler = event => {
      try {
        const value = (key === 'hr' ? parseHeartRate : parsePower)(event.target.value);
        if (value === null) delete readings[key]; else readings[key] = { value, at: Date.now() };
        renderReadings();
      } catch (error) { log(error.message); }
    };
    characteristic.addEventListener('characteristicvaluechanged', handler);
    await characteristic.startNotifications();
    if (!device.gatt.connected) throw new Error('Sensor disconnected during setup.');
    sensors[key] = { device, characteristic, handler, onDisconnect };
    notice(`${SENSOR_TYPES[key].label} connected. Enable it in your cooling profile to use it.`);
    log(`${SENSOR_TYPES[key].label} connected: ${device.name || 'Unnamed sensor'}`);
  } catch (error) {
    characteristic?.removeEventListener('characteristicvaluechanged', handler);
    device?.removeEventListener('gattserverdisconnected', onDisconnect);
    if (device?.gatt.connected) device.gatt.disconnect();
    if (error.name !== 'NotFoundError') notice(error.message, 'error');
    else notice('Sensor selection cancelled.');
  } finally { pairing = false; renderReadings(); renderControls(); }
}
function disconnectSensor(key) {
  const sensor = sensors[key]; if (!sensor) return;
  sensor.characteristic.removeEventListener('characteristicvaluechanged', sensor.handler);
  sensor.device.removeEventListener('gattserverdisconnected', sensor.onDisconnect);
  delete sensors[key]; delete readings[key];
  if (sensor.device.gatt.connected) sensor.device.gatt.disconnect();
}
async function releaseWakeLock() { try { await wakeLock?.release(); } catch {} wakeLock = null; }
function pauseAdaptive(message) {
  cancelSliderUpdate();
  running = false; releaseWakeLock(); $('adaptive-status').textContent = message || 'Adaptive control stopped';
  $('adaptive-output').textContent = '—'; renderControls();
}
async function sendSpeed(speed) {
  if (writing) return;
  writing = true; renderControls();
  try {
    if (demo) log(`DEMO airflow ${speed}% (no Bluetooth write)`);
    else await fan.setSpeed(speed);
    showSpeed(speed);
    return true;
  } catch (error) {
    pauseAdaptive('Write failed · Control paused');
    showSpeed(null);
    notice(`Could not complete the fan command: ${error.message} Fan state is unconfirmed.`, 'error');
    log(`ERROR ${error.message}`);
    return false;
  } finally { writing = false; renderControls(); flushSliderUpdate(); }
}
function cancelSliderUpdate() {
  clearTimeout(sliderTimer); sliderTimer = null; pendingSliderSpeed = null;
}
function flushSliderUpdate() {
  if (writing || pendingSliderSpeed === null) return;
  const speed = pendingSliderSpeed;
  pendingSliderSpeed = null;
  if (!running && !busy && (demo || fan.connected)) void sendSpeed(speed);
}
function scheduleSliderUpdate(immediate = false) {
  $('speed-value').textContent = `${$('speed').value}%`;
  clearTimeout(sliderTimer);
  // Coalesce changes during an outstanding BLE write to the latest selection.
  pendingSliderSpeed = Number($('speed').value);
  sliderTimer = immediate ? null : setTimeout(flushSliderUpdate, 150);
  if (immediate) flushSliderUpdate();
}
async function tick() {
  if (demo) {
    const time = Date.now() / 1000;
    readings.hr = { value: Math.round(137 + Math.sin(time / 12) * 18), at: Date.now() };
    readings.power = { value: Math.round(185 + Math.sin(time / 6) * 95), at: Date.now() };
  }
  renderReadings();
  if (!running || writing) return;
  const request = adaptiveDemand(profile, readings, Date.now());
  if (!request) {
    pauseAdaptive('No fresh readings · Control paused');
    notice('Adaptive control paused: no enabled sensor has a fresh reading. The last fan command remains in effect. Reconnect sensors, then start again.', 'error');
    return;
  }
  $('adaptive-status').textContent = `${demo ? 'Demo · ' : ''}${SENSOR_TYPES[request.key].label} leads`;
  $('adaptive-output').textContent = `${request.speed}%`;
  if (request.speed !== lastSpeed || lastLeader === '') {
    lastLeader = request.key;
    await sendSpeed(request.speed);
  }
}
$('connect').addEventListener('click', async () => {
  busy = true; renderControls(); notice('Select your HEADWIND in the Bluetooth chooser.');
  try {
    const info = await fan.connect($('show-all').checked);
    $('device-name').textContent = info.name;
    $('device-detail').textContent = `Firmware: ${info.firmware} · BLE connected`;
    showSpeed(null); log(`Connected to ${info.name}. Firmware: ${info.firmware}. No control commands sent.`);
    notice('Connected. Drag the slider to adjust airflow.');
  } catch (error) {
    notice(error.name === 'NotFoundError' ? 'No fan selected. Check power, range, and the “Show all” option for renamed devices.' : `Connection failed: ${error.message}`, error.name === 'NotFoundError' ? '' : 'error');
    log(`Connection: ${error.message}`);
  } finally { busy = false; renderControls(); }
});
$('disconnect').addEventListener('click', () => {
  pauseAdaptive(); fan.disconnect(); showSpeed(null);
  $('device-detail').textContent = 'Bluetooth Low Energy · No fan connected'; renderControls();
  notice('Disconnected. The fan may continue at its last setting. Use its buttons or reconnect to turn it off.'); log('Fan disconnected by user.');
});
fan.addEventListener('disconnected', () => {
  pauseAdaptive('Fan disconnected'); showSpeed(null); $('device-detail').textContent = 'Connection lost'; renderControls();
  notice('Bluetooth connection lost. Fan state is unknown; use its physical buttons if needed.', 'error'); log('Fan connection lost.');
});
for (const event of ['sent', 'packet', 'note']) fan.addEventListener(event, e => log(`${{ sent: 'TX', packet: 'RX (raw)', note: 'NOTE' }[event]} ${e.detail}`));
$('speed').addEventListener('input', () => scheduleSliderUpdate());
$('speed').addEventListener('change', () => scheduleSliderUpdate(true));
$('apply-speed').addEventListener('click', () => { cancelSliderUpdate(); sendSpeed(Number($('speed').value)); });
for (const button of document.querySelectorAll('[data-speed]')) button.addEventListener('click', () => {
  cancelSliderUpdate();
  $('speed').value = button.dataset.speed; $('speed-value').textContent = `${button.dataset.speed}%`; sendSpeed(Number(button.dataset.speed));
});
async function stopAndOff() { pauseAdaptive('Adaptive control stopped'); await sendSpeed(0); }
$('off').addEventListener('click', stopAndOff);
$('stop-adaptive').addEventListener('click', stopAndOff);
$('start-adaptive').addEventListener('click', async () => {
  if (document.hidden) { notice('Keep this page visible to start adaptive control.', 'error'); return; }
  if (!adaptiveDemand(profile, readings, Date.now())) { notice('Connect an enabled heart-rate or power sensor and wait for its first reading.', 'error'); return; }
  cancelSliderUpdate(); running = true; lastLeader = ''; renderControls();
  notice(demo ? 'Demo adaptive control is running. No hardware is connected.' : 'Browser adaptive control is running. Keep this page visible and your computer awake.', demo ? 'demo' : '');
  if (!demo && navigator.wakeLock) {
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (running) wakeLock = lock; else await lock.release();
    } catch { log('Screen wake lock unavailable. Keep the computer awake manually.'); }
  }
  if (running) await tick();
});
$('demo').addEventListener('click', () => {
  pauseAdaptive();
  for (const key of ['hr', 'power']) disconnectSensor(key);
  demo = !demo; delete readings.hr; delete readings.power; showSpeed(null);
  $('device-name').textContent = demo ? 'HEADWIND DEMO' : 'KICKR HEADWIND';
  $('device-detail').textContent = demo ? 'Simulated fan & sensors · No Bluetooth writes' : 'Bluetooth Low Energy · No fan connected';
  notice(demo ? 'DEMO MODE — Fan and sensor readings are simulated. Preview readings below are separate from these simulated sensors.' : 'Demo ended. Connect a real fan to control airflow.', demo ? 'demo' : '');
  log(demo ? 'Entered demo mode. No hardware connected.' : 'Exited demo mode.'); tick(); renderControls();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running) {
    pauseAdaptive('Page hidden · Control paused');
    notice('Adaptive control paused because the page was hidden. The last fan setting remains. Return to this page and start again.');
    log('Adaptive control paused on page hide; last fan setting retained.');
  }
});
window.addEventListener('pagehide', () => {
  pauseAdaptive(); fan.disconnect(); showSpeed(null);
  for (const key of ['hr', 'power']) disconnectSensor(key);
  renderControls(); renderReadings();
  if (!demo) $('device-detail').textContent = 'Bluetooth Low Energy · No fan connected';
});
function download(name, value, type) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('export').addEventListener('click', () => download('watt-a-breeze-profile.json', JSON.stringify({ application: 'Watt a Breeze', version: 1, scope: 'Local browser settings and native-mode planning only; not synced to HEADWIND', curve: 'linear-poc', sensors: profile }, null, 2), 'application/json'));
$('download-log').addEventListener('click', () => download('watt-a-breeze-log.txt', ['Watt a Breeze — Connection log', ...logs].join('\n'), 'text/plain'));
$('clear-log').addEventListener('click', () => { logs.length = 0; $('log').textContent = 'Log cleared.'; });
createSettings(); createSensors(); renderControls();
if (!storageAvailable) $('save-status').textContent = 'Storage unavailable · Export to keep this profile';
if (!navigator.bluetooth || !window.isSecureContext) notice('Direct fan control needs Chrome or Edge on a supported computer, opened over HTTPS or localhost. Demo mode works here without Bluetooth.', 'error');
setInterval(tick, 1000);
