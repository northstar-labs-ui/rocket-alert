const HISTORY_URL = 'https://agg.rocketalert.live/api/v1/alerts/past48h';
const LATEST_URL = 'https://agg.rocketalert.live/api/v1/alerts/latest';
const REALTIME_CACHE_URL = 'https://agg.rocketalert.live/api/v2/alerts/real-time/cached';
const REALTIME_URL = 'https://agg.rocketalert.live/api/v2/alerts/real-time';
const ROCKET_ALERT_TYPE = 1;
const UAV_ALERT_TYPE = 2;
const MAX_RETRY_DELAY = 10000;
const REQUEST_TIMEOUT = 10000;
const ALERT_SIREN_URL = new URL('./assets/air-raid-siren.mp3', import.meta.url).href;

let lastAlertTime = null;
let lastAlertLocation = '';
let timerInterval = null;
let eventSource = null;
let reconnectTimer = null;
let retryDelay = 1000;
let alertEffectTimer = null;
let alertSiren = null;

let elDays, elHours, elMinutes, elSeconds, elMillis;
let elLocation, elStatus, elAlertDot;

function $(id) { return document.getElementById(id); }

function init() {
  elDays = $('days');
  elHours = $('hours');
  elMinutes = $('minutes');
  elSeconds = $('seconds');
  elMillis = $('millis');
  elLocation = $('last-location');
  elStatus = $('status');
  elAlertDot = $('alert-dot');

  $('test-alert')?.addEventListener('click', testAlert);

  setStatus('Loading…');
  refreshAlertState();
  connectRealtime();
  timerInterval = setInterval(updateTimer, 47);
}

// Fetch recent history and the real-time cache on startup and reconnect. This
// lets the stopwatch recover if an alert arrived while the device was offline.
async function refreshAlertState() {
  const results = await Promise.allSettled([
    fetchJson(LATEST_URL),
    fetchJson(HISTORY_URL),
    fetchJson(REALTIME_CACHE_URL),
  ]);

  const alerts = results.flatMap((result) =>
    result.status === 'fulfilled' ? getRocketAndUavAlerts(result.value) : [],
  );
  applyLatestAlert(alerts, false);

  if (lastAlertTime && (elStatus.textContent === 'Loading…' || elStatus.textContent === 'Refreshing…')) {
    setStatus('Updated');
  } else if (!lastAlertTime) {
    const successfulRequests = results.filter((result) => result.status === 'fulfilled').length;
    setStatus(successfulRequests > 0 ? 'No alerts in past 48h' : 'Data unavailable');
  }

  for (const result of results) {
    if (result.status === 'rejected') console.error('Failed to refresh alert data:', result.reason);
  }
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    return await fetch(url, { cache: 'no-store', signal: controller.signal }).then(readJson);
  } finally {
    window.clearTimeout(timeout);
  }
}

async function readJson(res) {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error('API returned an unsuccessful response');
  return data;
}

function connectRealtime() {
  window.clearTimeout(reconnectTimer);
  eventSource?.close();

  try {
    const source = new EventSource(REALTIME_URL);
    eventSource = source;

    source.onopen = () => {
      if (source !== eventSource) return;
      retryDelay = 1000;
      setStatus('Live');
      refreshAlertState();
    };

    source.onmessage = ({ data }) => {
      if (source !== eventSource) return;
      try {
        applyLatestAlert(getRocketAndUavAlerts(JSON.parse(data)), true);
      } catch (err) {
        console.error('Failed to parse real-time alert:', err);
      }
    };

    source.onerror = () => {
      if (source !== eventSource) return;
      source.close();
      setStatus('Reconnecting…');
      scheduleReconnect();
    };
  } catch (err) {
    console.error('Unable to open real-time alerts:', err);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  window.clearTimeout(reconnectTimer);
  reconnectTimer = window.setTimeout(connectRealtime, retryDelay);
  retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
}

function getRocketAndUavAlerts(data) {
  return flattenAlerts(data?.payload ?? data).filter((alert) =>
    alert?.name !== 'KEEP_ALIVE' &&
    (alert?.alertTypeId === ROCKET_ALERT_TYPE || alert?.alertTypeId === UAV_ALERT_TYPE),
  );
}

function flattenAlerts(value) {
  if (Array.isArray(value)) return value.flatMap(flattenAlerts);
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value.alerts)) return value.alerts;
  return [];
}

function applyLatestAlert(alerts, flashOnChange) {
  let latestAlert = null;
  let latestTimestamp = null;

  for (const alert of alerts) {
    const timestamp = parseAlertTimestamp(alert.timeStamp);
    if (!timestamp || Number.isNaN(timestamp.getTime())) continue;
    if (!latestTimestamp || timestamp > latestTimestamp) {
      latestAlert = alert;
      latestTimestamp = timestamp;
    }
  }

  if (!latestAlert || !latestTimestamp) return;
  if (lastAlertTime && latestTimestamp < lastAlertTime) return;

  const changed = !lastAlertTime || latestTimestamp.getTime() > lastAlertTime.getTime();
  lastAlertTime = latestTimestamp;
  lastAlertLocation = latestAlert.englishName || latestAlert.name || 'Unknown';
  elLocation.textContent = lastAlertLocation;

  if (changed && flashOnChange) triggerAlertEffects();
  updateTimer();
}

function parseAlertTimestamp(tsStr) {
  if (typeof tsStr !== 'string') return null;
  const parts = tsStr.split(/[- :]/).map(Number);
  if (parts.length !== 6 || parts.some(Number.isNaN)) return null;

  const [year, month, day, hour, minute, second] = parts;
  // Calculate the daylight-saving-aware Jerusalem offset for the alert date.
  const sampleUtc = new Date(Date.UTC(year, month - 1, day, 12));
  const israelParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(sampleUtc);
  const israelHour = Number(israelParts.find((part) => part.type === 'hour')?.value);
  let offset = israelHour - 12;
  if (offset < -12) offset += 24;
  if (offset > 12) offset -= 24;

  return new Date(Date.UTC(year, month - 1, day, hour - offset, minute, second));
}

function updateTimer() {
  if (!lastAlertTime) return;

  let diff = Date.now() - lastAlertTime.getTime();
  if (diff < 0) diff = 0;

  const days = Math.floor(diff / 86400000);
  diff %= 86400000;
  const hours = Math.floor(diff / 3600000);
  diff %= 3600000;
  const minutes = Math.floor(diff / 60000);
  diff %= 60000;
  const seconds = Math.floor(diff / 1000);
  const millis = Math.floor((diff % 1000) / 10);

  elDays.textContent = String(days).padStart(2, '0');
  elHours.textContent = String(hours).padStart(2, '0');
  elMinutes.textContent = String(minutes).padStart(2, '0');
  elSeconds.textContent = String(seconds).padStart(2, '0');
  elMillis.textContent = String(millis).padStart(2, '0');
}

function triggerAlertEffects() {
  flashAlert();
  playAlertSound();
}

function flashAlert() {
  document.body.classList.remove('alert-pulse');
  // Restart the animation when alerts arrive in quick succession.
  void document.body.offsetWidth;
  document.body.classList.add('alert-pulse');
  elAlertDot?.classList.add('flash');

  window.clearTimeout(alertEffectTimer);
  alertEffectTimer = window.setTimeout(() => {
    document.body.classList.remove('alert-pulse');
    elAlertDot?.classList.remove('flash');
  }, 3000);
}

function playAlertSound() {
  try {
    alertSiren ??= new Audio(ALERT_SIREN_URL);
    alertSiren.currentTime = 0;
    alertSiren.play().catch((err) => {
      // Some WebViews block audio until a user gesture. The test button unlocks it.
      console.warn('Unable to play alert sound:', err);
    });
  } catch (err) {
    console.warn('Unable to play alert sound:', err);
  }
}

function testAlert() {
  triggerAlertEffects();
  setStatus('Test alert');
  window.setTimeout(() => setStatus(eventSource?.readyState === EventSource.OPEN ? 'Live' : 'Reconnecting…'), 3000);
}

function setStatus(text) {
  if (!elStatus) return;
  elStatus.textContent = text;
  elStatus.className = 'status';
  if (text === 'Live') elStatus.classList.add('live');
  else if (text.includes('error') || text.includes('Error')) elStatus.classList.add('error');
}

// Side button: resync the stopwatch, then force a fresh live connection.
window.addEventListener('sideClick', () => {
  setStatus('Refreshing…');
  refreshAlertState();
  connectRealtime();
});

window.addEventListener('beforeunload', () => {
  window.clearTimeout(reconnectTimer);
  window.clearInterval(timerInterval);
  window.clearTimeout(alertEffectTimer);
  eventSource?.close();
});

document.addEventListener('DOMContentLoaded', () => {
  if (typeof PluginMessageHandler === 'undefined') {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('sideClick'));
      }
    });
  }
  init();
});
