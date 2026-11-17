import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptiveDemand, defaultProfile, demand, normalizeProfile, parseHeartRate, parsePower, speedCommands, validThresholds, FAN_SERVICE, FAN_CHARACTERISTIC } from '../core.js';
import { FanConnection } from '../bluetooth.js';

const view = bytes => new DataView(Uint8Array.from(bytes).buffer);
test('manual command encodes mode before speed; zero encodes off', () => {
  assert.deepEqual(speedCommands(75).map(bytes => [...bytes]), [[4, 4, 0, 0], [2, 75, 0, 0]]);
  assert.deepEqual([...speedCommands(0)[0]], [4, 1, 0, 0]);
  for (const value of [-1, 101, 1.5, NaN, '50']) assert.throws(() => speedCommands(value), RangeError);
});
test('linear curve clamps values and reverses pace thresholds', () => {
  assert.equal(demand(90, 100, 160), 0);
  assert.equal(demand(130, 100, 160), 50);
  assert.equal(demand(200, 100, 160), 100);
  assert.equal(demand(6, 8, 4), 50);
  assert.equal(demand(3, 8, 4), 100);
  assert.equal(demand(NaN, 8, 4), 0);
  assert.equal(validThresholds('pace', 8, 4), true);
  assert.equal(validThresholds('pace', 4, 8), false);
});
test('adaptive control chooses the highest fresh enabled live sensor only', () => {
  const profile = defaultProfile();
  profile.hr = { enabled: true, min: 100, max: 180 };
  profile.power = { enabled: true, min: 0, max: 400 };
  profile.core.enabled = true;
  const readings = { hr: { value: 160, at: 20000 }, power: { value: 200, at: 20000 }, core: { value: 43, at: 20000 } };
  assert.deepEqual(adaptiveDemand(profile, readings, 20000), { key: 'hr', speed: 75 });
  readings.hr.at = 9999;
  assert.deepEqual(adaptiveDemand(profile, readings, 20000), { key: 'power', speed: 50 });
  profile.power.enabled = false;
  assert.equal(adaptiveDemand(profile, readings, 20000), null);
  readings.hr.at = 20000; readings.hr.value = 80;
  assert.deepEqual(adaptiveDemand(profile, readings, 20000), { key: 'hr', speed: 0 });
  assert.equal(adaptiveDemand(profile, readings, 30001), null);
});
test('stored profiles reject inverted, missing, out-of-bounds, and malformed settings', () => {
  const stored = { hr: { enabled: true, min: 170, max: 100 }, power: { enabled: false, min: 90, max: 320 }, core: { enabled: true, min: 30, max: 99 } };
  const result = normalizeProfile(stored);
  assert.deepEqual(result.hr, defaultProfile().hr);
  assert.deepEqual(result.power, stored.power);
  assert.deepEqual(result.core, defaultProfile().core);
  assert.deepEqual(normalizeProfile(null), defaultProfile());
});
test('heart rate handles 8-bit, 16-bit, no contact, and short packets', () => {
  assert.equal(parseHeartRate(view([0, 142])), 142);
  assert.equal(parseHeartRate(view([1, 44, 1])), 300);
  assert.equal(parseHeartRate(view([4, 142])), null);
  assert.equal(parseHeartRate(view([6, 142])), 142);
  assert.throws(() => parseHeartRate(view([1, 44])), /Truncated/);
  assert.throws(() => parseHeartRate(view([])), /Truncated/);
});
test('cycling power reads signed instantaneous watts and rejects truncated packets', () => {
  assert.equal(parsePower(view([0, 0, 250, 0])), 250);
  assert.equal(parsePower(view([0, 0, 255, 255])), 0);
  assert.throws(() => parsePower(view([0, 0, 1])), /Truncated/);
});

function mockBluetooth({ write, notifications = true, notificationFailure = false, serviceFailure = false } = {}) {
  const writes = [];
  const characteristic = new EventTarget();
  characteristic.properties = { write: true, notify: notifications };
  characteristic.startNotifications = async () => { if (notificationFailure) throw new Error('Unsupported'); return characteristic; };
  characteristic.writeValueWithResponse = async bytes => { writes.push([...bytes]); await write?.(bytes, writes.length); };
  const device = new EventTarget(); device.name = 'HEADWIND Test';
  const server = {
    connected: false,
    connect: async () => { server.connected = true; return server; },
    disconnect: () => { server.connected = false; device.dispatchEvent(new Event('gattserverdisconnected')); },
    getPrimaryService: async uuid => {
      if (serviceFailure || uuid !== FAN_SERVICE) throw new Error('Service missing');
      return { getCharacteristic: async uuid => { assert.equal(uuid, FAN_CHARACTERISTIC); return characteristic; } };
    },
  };
  device.gatt = server;
  const bluetooth = { requestDevice: async options => { assert.ok(options.optionalServices.includes(FAN_SERVICE)); return device; } };
  return { bluetooth, device, characteristic, writes };
}
test('connection discovers control without changing fan mode or speed', async () => {
  const mock = mockBluetooth(); const fan = new FanConnection(mock.bluetooth);
  const info = await fan.connect();
  assert.equal(fan.connected, true); assert.equal(info.firmware, 'Not reported');
  assert.deepEqual(mock.writes, []);
  fan.disconnect(); assert.equal(fan.connected, false); assert.deepEqual(mock.writes, []);
});
test('GATT writes serialize entire manual batches', async () => {
  let active = 0;
  const mock = mockBluetooth({ write: async () => { assert.equal(++active, 1); await new Promise(resolve => setTimeout(resolve, 2)); active--; } });
  const fan = new FanConnection(mock.bluetooth); await fan.connect();
  await Promise.all([fan.setSpeed(25), fan.setSpeed(50), fan.setSpeed(0)]);
  assert.deepEqual(mock.writes, [[4, 4, 0, 0], [2, 25, 0, 0], [4, 4, 0, 0], [2, 50, 0, 0], [4, 1, 0, 0]]);
  fan.disconnect();
});
test('disconnect invalidates queued commands and prevents a partial batch continuing', async () => {
  let release, started;
  const began = new Promise(resolve => { started = resolve; });
  const mock = mockBluetooth({ write: () => { started(); return new Promise(resolve => { release = resolve; }); } });
  const fan = new FanConnection(mock.bluetooth); await fan.connect();
  const first = fan.setSpeed(50); const second = fan.setSpeed(75);
  const checks = [assert.rejects(first, /disconnected/), assert.rejects(second, /disconnected/)];
  await began; fan.disconnect(); release(); await Promise.all(checks);
  assert.deepEqual(mock.writes, [[4, 4, 0, 0]]);
});
test('failed write does not send remaining speed packet; future off can recover', async () => {
  const mock = mockBluetooth({ write: (_bytes, count) => { if (count === 1) throw new Error('Write rejected'); } });
  const fan = new FanConnection(mock.bluetooth); await fan.connect();
  await assert.rejects(fan.setSpeed(80), /Write rejected/);
  await fan.setSpeed(0);
  assert.deepEqual(mock.writes, [[4, 4, 0, 0], [4, 1, 0, 0]]);
  fan.disconnect();
});
test('notification failures preserve manual control; unknown services fail cleanly', async () => {
  const mock = mockBluetooth({ notificationFailure: true });
  const fan = new FanConnection(mock.bluetooth); await fan.connect(); await fan.setSpeed(0); fan.disconnect();
  const bad = mockBluetooth({ serviceFailure: true });
  const invalidFan = new FanConnection(bad.bluetooth);
  await assert.rejects(invalidFan.connect(), /Service missing/);
  assert.equal(invalidFan.connected, false); assert.equal(bad.device.gatt.connected, false);
});
