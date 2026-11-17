export const FAN_SERVICE = 'a026ee0c-0a7d-4ab3-97fa-f1500f9feb8b';
export const FAN_CHARACTERISTIC = 'a026e038-0a7d-4ab3-97fa-f1500f9feb8b';
export const SENSOR_TYPES = {
  hr: { label: 'Heart rate', unit: 'bpm', min: 100, max: 170, value: 135, step: 1, bounds: [30, 240], live: true },
  power: { label: 'Cycling power', unit: 'W', min: 80, max: 300, value: 200, step: 1, bounds: [0, 2500], live: true },
  speed: { label: 'Cycling speed', unit: 'km/h', min: 10, max: 40, value: 25, step: 0.5, bounds: [0, 120] },
  pace: { label: 'Run pace', unit: 'min/km', min: 8, max: 4, value: 6, step: 0.1, bounds: [2, 30], descending: true },
  core: { label: 'CORE temperature', unit: '°C', min: 37, max: 38.5, value: 37.5, step: 0.1, bounds: [30, 43] },
};
export function defaultProfile() {
  return Object.fromEntries(Object.entries(SENSOR_TYPES).map(([key, type]) => [key, { enabled: !!type.live, min: type.min, max: type.max }]));
}
export function validThresholds(key, min, max) {
  const t = SENSOR_TYPES[key];
  return !!t && Number.isFinite(min) && Number.isFinite(max) && min >= t.bounds[0] && min <= t.bounds[1] && max >= t.bounds[0] && max <= t.bounds[1] && (t.descending ? min > max : min < max);
}
export function normalizeProfile(value) {
  const profile = defaultProfile();
  for (const key of Object.keys(profile)) {
    const entry = value?.[key];
    if (entry && validThresholds(key, entry.min, entry.max) && typeof entry.enabled === 'boolean') profile[key] = { enabled: entry.enabled, min: entry.min, max: entry.max };
  }
  return profile;
}
// A linear PoC curve, not a claim about Wahoo's internal interpolation.
export function demand(value, min, max) {
  if (![value, min, max].every(Number.isFinite) || min === max) return 0;
  return Math.round(Math.max(0, Math.min(1, (value - min) / (max - min))) * 100);
}
export function adaptiveDemand(profile, samples, now, freshness = 10000) {
  const requests = Object.entries(profile).filter(([key, p]) => SENSOR_TYPES[key]?.live && p.enabled && samples[key] && Number.isFinite(samples[key].value) && now - samples[key].at >= 0 && now - samples[key].at <= freshness)
    .map(([key, p]) => ({ key, speed: demand(samples[key].value, p.min, p.max) }));
  return requests.length ? requests.reduce((a, b) => a.speed >= b.speed ? a : b) : null;
}
export function speedCommands(speed) {
  if (!Number.isInteger(speed) || speed < 0 || speed > 100) throw new RangeError('Speed must be an integer from 0 to 100.');
  return speed === 0 ? [Uint8Array.of(4, 1, 0, 0)] : [Uint8Array.of(4, 4, 0, 0), Uint8Array.of(2, speed, 0, 0)];
}
export function parseHeartRate(view) {
  if (view.byteLength < 2) throw new Error('Truncated heart-rate measurement.');
  const flags = view.getUint8(0);
  if ((flags & 4) && !(flags & 2)) return null; // Supported contact sensor reports no contact.
  if (flags & 1) {
    if (view.byteLength < 3) throw new Error('Truncated 16-bit heart-rate measurement.');
    return view.getUint16(1, true);
  }
  return view.getUint8(1);
}
export function parsePower(view) {
  if (view.byteLength < 4) throw new Error('Truncated cycling-power measurement.');
  return Math.max(0, view.getInt16(2, true));
}
export function hex(value) { return Array.from(value, b => b.toString(16).padStart(2, '0')).join(' '); }
