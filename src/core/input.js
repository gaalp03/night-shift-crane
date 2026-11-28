// Unified input: keyboard, gamepad and on-screen touch controls all feed the same action state.
import { clamp } from './util.js';

const KEYS_X_NEG = ['KeyA', 'ArrowLeft'];
const KEYS_X_POS = ['KeyD', 'ArrowRight'];
const KEYS_Z_FAR = ['KeyW', 'ArrowUp'];
const KEYS_Z_NEAR = ['KeyS', 'ArrowDown'];
// (no Ctrl bindings: Ctrl+W / Ctrl+S / Ctrl+D would trigger browser shortcuts mid-lift)
const KEYS_UP = ['KeyE', 'KeyR', 'ShiftLeft', 'ShiftRight', 'PageUp'];
const KEYS_DOWN = ['KeyQ', 'KeyF', 'PageDown'];

// (frames: a press from a second device this soon after the last is the same press seen twice)
export const LOCK_DEBOUNCE = 15;

class Input {
  constructor() {
    this.frame = 0;
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
      // a game button that kept the focus after a tap (the pad, DROP) must not also "click" on a key:
      // that was the same press arriving twice
      if (this._onGameButton(e)) {
        e.preventDefault();
        e.target.blur();
      }
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
      if (this._onGameButton(e)) e.preventDefault();
    });
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clear();
    });
  }

  _onGameButton(e) {
    const t = e.target;
    return !!(t && t.closest && (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') && t.closest('#touch, .dropbtn'));
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
          if (map[idx] === 'lock') this._fireDev = 'gamepad';
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
    if (name === 'lock') return this._lock();
    if (this.touchPressed.has(name)) return true;
    switch (name) {
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

  /**
   * Lock / release, once per real press. The same answer for every read within a frame, and a press from
   * another device within a quarter second of the last one is the same press arriving twice (a tap and
   * the key that followed it on a hybrid, a focused button "clicked" by the key) — not a second toggle.
   */
  _lock() {
    if (this._lockAt === this.frame) return this._lockVal;
    this._lockAt = this.frame;
    const touch = this.touchPressed.has('lock');
    const key = this.enabled && this.hit('Space', 'Enter', 'NumpadEnter');
    let v = touch || key;
    if (v) {
      const dev = key ? 'keyboard' : this._fireDev || 'touch';
      const last = this._lastLock;
      if (last && last.dev !== dev && this.frame - last.frame < LOCK_DEBOUNCE) v = false;
      else this._lastLock = { dev, frame: this.frame };
    }
    this._lockVal = v;
    return v;
  }

  /** Touch UI calls this to fire an edge-triggered action. */
  fire(name, dev = 'touch') {
    this.touchPressed.add(name);
    this.lastDevice = dev === 'mouse' ? this.lastDevice : dev;
    if (name === 'lock') this._fireDev = dev;
  }

  endFrame() {
    this.pressed.clear();
    this.touchPressed.clear();
    this._fireDev = null;
    this.frame++;
  }
}

export const input = new Input();
