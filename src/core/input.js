// Unified input: keyboard, gamepad and on-screen touch controls all feed the same action state.
import { clamp } from './util.js';

const KEYS_X_NEG = ['KeyA', 'ArrowLeft'];
const KEYS_X_POS = ['KeyD', 'ArrowRight'];
const KEYS_Z_FAR = ['KeyW', 'ArrowUp'];
const KEYS_Z_NEAR = ['KeyS', 'ArrowDown'];
const KEYS_UP = ['KeyE', 'KeyR', 'ShiftLeft', 'ShiftRight', 'PageUp'];
const KEYS_DOWN = ['KeyQ', 'KeyF', 'ControlLeft', 'ControlRight', 'PageDown'];

class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set(); // edge-triggered this frame
    this.touch = { x: 0, z: 0, hoist: 0, active: false };
    this.touchPressed = new Set();
    this.pad = { x: 0, z: 0, hoist: 0 };
    this._padButtons = {};
    this.enabled = true;
    this.lastDevice = 'keyboard';
    this.anyKeyHandlers = new Set();
    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) {
        if (this._isGameKey(e.code)) e.preventDefault();
        return;
      }
      this.keys.add(e.code);
      this.pressed.add(e.code);
      this.lastDevice = 'keyboard';
      if (this._isGameKey(e.code)) e.preventDefault();
      for (const fn of this.anyKeyHandlers) fn(e);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clear();
    });
  }

  _isGameKey(code) {
    return (
      code.startsWith('Arrow') ||
      code === 'Space' ||
      code === 'Tab' ||
      KEYS_UP.includes(code) ||
      KEYS_DOWN.includes(code) ||
      code === 'PageUp' ||
      code === 'PageDown'
    );
  }

  clear() {
    this.keys.clear();
    this.pressed.clear();
    this.touchPressed.clear();
    this.touch.x = this.touch.z = this.touch.hoist = 0;
  }

  any(list) {
    for (const k of list) if (this.keys.has(k)) return true;
    return false;
  }

  hit(...codes) {
    for (const c of codes) if (this.pressed.has(c)) return true;
    return false;
  }

  /** Call once per frame before reading actions. */
  poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    this.pad.x = this.pad.z = this.pad.hoist = 0;
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const dz = (v) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
      this.pad.x = dz(p.axes[0] || 0);
      this.pad.z = dz(p.axes[1] || 0);
      const ry = dz(p.axes[3] || 0);
      const trig = (p.buttons[7] ? p.buttons[7].value : 0) - (p.buttons[6] ? p.buttons[6].value : 0);
      this.pad.hoist = Math.abs(ry) > 0.01 ? -ry : trig;
      if (p.buttons[12] && p.buttons[12].pressed) this.pad.z = -1;
      if (p.buttons[13] && p.buttons[13].pressed) this.pad.z = 1;
      if (p.buttons[14] && p.buttons[14].pressed) this.pad.x = -1;
      if (p.buttons[15] && p.buttons[15].pressed) this.pad.x = 1;
      const map = { 0: 'lock', 2: 'lock', 3: 'camera', 9: 'pause', 1: 'horn', 8: 'camera' };
      for (const idx in map) {
        const b = p.buttons[idx];
        const down = !!(b && b.pressed);
        if (down && !this._padButtons[idx]) {
          this.touchPressed.add(map[idx]);
          this.lastDevice = 'gamepad';
        }
        this._padButtons[idx] = down;
      }
      if (Math.abs(this.pad.x) + Math.abs(this.pad.z) + Math.abs(this.pad.hoist) > 0.2) this.lastDevice = 'gamepad';
      break;
    }
  }

  /** Trolley axis: +1 seaward (screen right). */
  get axisX() {
    if (!this.enabled) return 0;
    const k = (this.any(KEYS_X_POS) ? 1 : 0) - (this.any(KEYS_X_NEG) ? 1 : 0);
    return clamp(k + this.touch.x + this.pad.x, -1, 1);
  }

  /** Gantry axis: +1 towards the camera (+Z), -1 away. */
  get axisZ() {
    if (!this.enabled) return 0;
    const k = (this.any(KEYS_Z_NEAR) ? 1 : 0) - (this.any(KEYS_Z_FAR) ? 1 : 0);
    return clamp(k + this.touch.z + this.pad.z, -1, 1);
  }

  /** Hoist: +1 up, -1 down. */
  get hoist() {
    if (!this.enabled) return 0;
    const k = (this.any(KEYS_UP) ? 1 : 0) - (this.any(KEYS_DOWN) ? 1 : 0);
    return clamp(k + this.touch.hoist + this.pad.hoist, -1, 1);
  }

  action(name) {
    if (this.touchPressed.has(name)) return true;
    switch (name) {
      case 'lock':
        return this.enabled && this.hit('Space', 'Enter', 'NumpadEnter');
      case 'camera':
        return this.enabled && this.hit('KeyC', 'KeyV', 'Tab');
      case 'pause':
        return this.hit('Escape', 'KeyP');
      case 'horn':
        return this.enabled && this.hit('KeyH');
      case 'skip':
        return this.hit('Space', 'Enter', 'Escape');
      default:
        return false;
    }
  }

  /** Touch UI calls this to fire an edge-triggered action. */
  fire(name) {
    this.touchPressed.add(name);
    this.lastDevice = 'touch';
  }

  endFrame() {
    this.pressed.clear();
    this.touchPressed.clear();
  }
}

export const input = new Input();
