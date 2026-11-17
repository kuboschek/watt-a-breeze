import { FAN_SERVICE, FAN_CHARACTERISTIC, speedCommands, hex } from './core.js';

export class FanConnection extends EventTarget {
  constructor(bluetooth) { super(); this.bluetooth = bluetooth; this.queue = Promise.resolve(); this.epoch = 0; }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  get connected() { return !!(this.device?.gatt?.connected && this.characteristic); }
  async connect(showAll = false) {
    if (!this.bluetooth) throw new Error('Use Chrome or Edge with Bluetooth enabled.');
    const device = await this.bluetooth.requestDevice({ ...(showAll ? { acceptAllDevices: true } : { filters: [{ namePrefix: 'HEADWIND' }, { namePrefix: 'Headwind' }] }), optionalServices: [FAN_SERVICE, 'device_information'] });
    this.device = device;
    const epoch = ++this.epoch;
    this.onDisconnect = () => {
      if (this.device !== device) return;
      this.epoch++;
      this.characteristic?.removeEventListener('characteristicvaluechanged', this.onNotification);
      this.characteristic = null; this.queue = Promise.resolve(); this.emit('disconnected');
    };
    device.addEventListener('gattserverdisconnected', this.onDisconnect);
    try {
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(FAN_SERVICE);
      const characteristic = await service.getCharacteristic(FAN_CHARACTERISTIC);
      if (this.epoch !== epoch) throw new Error('Connection interrupted.');
      if (!characteristic.properties.write && !characteristic.properties.writeWithoutResponse) throw new Error('Fan control characteristic is not writable.');
      this.characteristic = characteristic;
      this.onNotification = e => this.emit('packet', hex(new Uint8Array(e.target.value.buffer, e.target.value.byteOffset, e.target.value.byteLength)));
      if (characteristic.properties.notify || characteristic.properties.indicate) {
        characteristic.addEventListener('characteristicvaluechanged', this.onNotification);
        try { await characteristic.startNotifications(); } catch (error) { this.emit('note', `Notifications unavailable: ${error.message}`); }
      }
      let firmware = 'Not reported';
      try {
        const info = await server.getPrimaryService('device_information');
        const revision = await info.getCharacteristic('firmware_revision_string');
        firmware = new TextDecoder().decode(await revision.readValue());
      } catch { /* Optional standard Device Information service. */ }
      if (!this.connected || this.epoch !== epoch) throw new Error('Connection interrupted.');
      return { name: device.name || 'HEADWIND', firmware };
    } catch (error) { this.disconnect(); throw error; }
  }
  setSpeed(speed) {
    const commands = speedCommands(speed);
    const epoch = this.epoch;
    const characteristic = this.characteristic;
    const task = this.queue.catch(() => {}).then(async () => {
      for (const bytes of commands) {
        if (!this.connected || this.epoch !== epoch || this.characteristic !== characteristic) throw new Error('Fan disconnected. Reconnect before sending commands.');
        if (characteristic.properties.write) await characteristic.writeValueWithResponse(bytes);
        else await characteristic.writeValueWithoutResponse(bytes);
        this.emit('sent', hex(bytes));
      }
    });
    this.queue = task;
    return task;
  }
  disconnect() {
    this.epoch++;
    this.queue = Promise.resolve();
    if (this.characteristic && this.onNotification) this.characteristic.removeEventListener('characteristicvaluechanged', this.onNotification);
    this.characteristic = null;
    if (this.device) {
      this.device.removeEventListener('gattserverdisconnected', this.onDisconnect);
      if (this.device.gatt.connected) this.device.gatt.disconnect();
    }
    this.device = null;
  }
}
