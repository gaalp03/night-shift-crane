// In-play coaching without reading: a big bobbing arrow on the thing that matters, a ghost hand that
// shows the gesture, and one or two words at most. It also decides what the crane does by itself while
// a control has not been taught yet.
import * as THREE from 'three';
import { h } from '../core/util.js';
import { icon } from '../ui/icons.js';

// the LOWER hint: after this long hovering (s), shown this long (s), at most once per `every` s
const HOVER = { after: 4, show: 3.5, every: 15 };
const _lw = new THREE.Vector3();
const K = (...keys) => keys.map((k) => `<span class="kbd">${k}</span>`).join('');
const ARROWS = K('←', '→', '↑', '↓');
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class Coach {
  /**
   * @param save     save store (flags.coach = how many lessons are done)
   * @param scheme   () => 'touch' (one-finger) | 'pad' (manual on-screen stick + buttons) | 'mouse' | 'keys'
   * @param project  (Vector3) => { x, y, behind }: world to screen
   * @param dropRect () => DOMRect of the big DROP button, or null when it is not on screen
   */
  constructor(save, scheme, project, dropRect) {
    this.save = save;
    this.scheme = scheme;
    this.project = project || null;
    this.dropRect = dropRect || (() => null);
    this.root = document.getElementById('coach');
    this.key = '';
    // the guide layer: arrow + ghost hand, positioned every frame
    this.layer = h('div#guide');
    this.arrow = h('div.garrow', { html: '<svg viewBox="0 0 48 48"><path d="M24 44L4 20h12V4h16v16h12z"/></svg>' });
    this.hand = h('div.ghand', h('i.ripple'), h('span', { html: icon('hand') }));
    this.layer.append(this.arrow, this.hand);
    const ui = document.getElementById('ui');
    if (ui) ui.appendChild(this.layer);
    this._pos = { ax: -1, ay: -1, fx: -1, fy: -1, tx: -1, ty: -1 };
  }

  get step() {
    return this.save.data.flags.coach || 0;
  }

  advance(to) {
    const f = this.save.data.flags;
    if ((f.coach || 0) >= to) return;
    f.coach = to;
    this.save.commit();
  }

  /** What runs itself. Finger and mouse (one-touch): everything but steering. Keys: whatever has not been taught yet. */
  automation(s) {
    const sc = this.scheme();
    const st = this.step;
    // manual control (keys, or the on-screen stick + buttons): the player drives; only the hoist
    // helps out until it has been taught
    if (sc === 'keys' || sc === 'pad') return { hoist: st < 2, lock: !!s.mods.autoLock, release: false };
    return { hoist: true, lock: true, release: st >= 1 };
  }

  _truckBox(s) {
    // the parked truck's box; failing that, the one rolling in
    let any = null;
    for (const l of s.lanes) {
      const t = l.truck;
      if (!t || !t.cargo || !t.cargo.mesh || t.cargo.discharge) continue;
      if (t.parked) return t.cargo.mesh.getWorldPosition(_b);
      any = any || t;
    }
    return any ? any.cargo.mesh.getWorldPosition(_b) : null;
  }

  /**
   * Called every frame in play; picks at most one lesson.
   * @param idle  seconds since the player last touched anything
   */
  update(s, idle = 0) {
    if (!s || s.phase !== 'play') return this._show(null);
    s.auto = this.automation(s);
    // a gust has swung the load out: drive the trolley towards it (the ghost hand shows the counter-swing)
    const ct = this.counter;
    if (ct) {
      const rig = s.rig;
      if (!rig.carry || s.elapsed > ct.until) this.counter = null;
      else {
        const ox = rig.sprPos.x - rig.x;
        const oz = rig.sprPos.z - rig.z;
        const sc = this.scheme();
        const xMajor = Math.abs(ox) >= Math.abs(oz);
        const key = xMajor ? (ox > 0 ? '→' : '←') : oz > 0 ? '↓' : '↑';
        const from = (this._cf || (this._cf = new THREE.Vector3())).set(rig.x, rig.sprPos.y + 1.2, rig.z);
        const to = (this._ct || (this._ct = new THREE.Vector3())).set(rig.sprPos.x + ox * 1.8, rig.sprPos.y + 1.2, rig.sprPos.z + oz * 1.8);
        return this._show({ word: 'COUNTER', keys: sc === 'keys' ? K(key) : sc === 'pad' ? icon('move') : '', arrow: null, hand: { mode: 'drag', from, to } }, true);
      }
    }
    // hovering over the target (a slot, or the box on the truck) without coming down: LOWER + arrow
    const low = this._lowerHint(s);
    if (low) return this._show(low, true);
    // a box with no room aboard goes back ashore: always said, always pointed at (never a silent dead end)
    if (s.noSlotCargo && s.rig.carry === s.noSlotCargo) {
      const sd = s.seat;
      const there = sd && sd.seated && sd.valid;
      return this._show({ word: there ? 'DROP' : 'RETURN', keys: icon('truck'), arrow: s.guideSlot }, false);
    }
    // a box in the wrong place: point at it, then at where it belongs (any time, not just in lessons)
    const fx = this.fix;
    if (fx && fx.cargo) {
      const c = fx.cargo;
      if (c.counted || c.lost || c.state === 'gone' || fx.t-- <= 0) this.fix = null;
      else {
        const carried = s.rig.carry === c;
        const at = carried ? s.guideSlot : c.mesh.getWorldPosition(_b);
        return this._show({ word: carried ? 'HERE' : 'MOVE', keys: icon(carried ? 'check' : 'retry'), arrow: at }, false);
      }
    }
    const sc = this.scheme();
    const one = sc === 'touch' || sc === 'mouse'; // one-touch: drag to steer, tap / click to lock or let go
    const pad = sc === 'pad';
    // key caps for the keyboard, the on-screen buttons' own icons for the touch pad
    const KEY = { act: pad ? icon('lock') : K('SPACE'), down: pad ? icon('down') : K('Q'), up: pad ? icon('up') : K('E'), move: pad ? icon('move') : ARROWS };
    const st = this.step;
    const rig = s.rig;
    const g = s.wantedGrab();
    const seat = s.seat;
    const spr = rig.sprPos;
    let p = null;
    if (st === 0) {
      // the very first box hangs over its slot: one action and it pays (the DROP button is the prompt)
      if (rig.carry) p = { word: '', arrow: s.guideSlot || spr, hand: { mode: 'tap', to: 'drop' } };
    } else if (st === 1 || (st === 2 && !one)) {
      if (!rig.carry) {
        const box = this._truckBox(s);
        if (g && g.ready && !one) p = { word: 'GRAB', keys: KEY.act, arrow: g.cargo.mesh.getWorldPosition(_b), hand: pad ? { mode: 'tap', to: 'drop' } : null };
        else if (st === 2 && g && Math.hypot(g.lx, g.lz) < 0.8) p = { word: 'LOWER', keys: KEY.down, arrow: g.cargo.mesh.getWorldPosition(_b) };
        else if (st === 2) p = { word: 'LIFT', keys: KEY.up, arrow: box };
        else p = { word: one ? 'DRAG' : 'MOVE', keys: one ? '' : KEY.move, arrow: box, hand: one && box ? { mode: 'drag', from: spr, to: box } : null };
      } else {
        const slot = s.guideSlot;
        if (seat && seat.seated && seat.valid && !one) p = { word: 'DROP', keys: KEY.act, arrow: slot, hand: pad ? { mode: 'tap', to: 'drop' } : null };
        else if (st === 2 && seat && seat.err < 0.8) p = { word: 'LOWER', keys: KEY.down, arrow: slot };
        else if (st === 2 && s.altitude < 3) p = { word: 'LIFT', keys: KEY.up, arrow: slot };
        else p = { word: one ? 'DRAG' : 'MOVE', keys: one ? '' : KEY.move, arrow: slot, hand: one && slot ? { mode: 'drag', from: spr, to: slot } : null };
      }
    } else if (st === 3) {
      p = this._comboT == null || this._comboT > 0 ? { word: 'COMBO', keys: icon('star') } : null;
    }
    // nothing pressed for a while on the first boxes: everything pulses harder
    const nudge = !!p && st <= 1 && idle > 4;
    this._show(p, nudge);
  }

  /**
   * The hook has hung over its target for more than HOVER.after s without paying out: say LOWER, with
   * the arrow on the target, for a few seconds; again at most every HOVER.every s.
   */
  _lowerHint(s) {
    const sc = this.scheme();
    const dt = this._lastE == null ? 0 : Math.max(0, s.elapsed - this._lastE);
    this._lastE = s.elapsed;
    if (sc === 'touch') return null; // (one-finger: the hoist works by itself)
    const rig = s.rig;
    let over = null;
    if (rig.carry) {
      const seat = s.seat;
      if (seat && seat.err < 1.2 && seat.gap > 1.2 && seat.problem !== 'full' && s.guideSlot) over = s.guideSlot;
    } else {
      // (any height: the grab finder only looks a few metres down)
      const sp = rig.sprPos;
      for (const k of s.cargos) {
        if (k.state !== 'truck' || !k.truck || !k.truck.parked || k.truck.purpose !== 'deliver') continue;
        const p = k.mesh.getWorldPosition(_lw);
        if (Math.hypot(p.x - sp.x, p.z - sp.z) < 1.0 && sp.y - p.y > 2.4) {
          over = p;
          break;
        }
      }
    }
    const coming = rig.vr > 0.05;
    // (hovering: parked over it, not on the way past)
    const parked = Math.hypot(rig.vx, rig.vz) < 0.4;
    this._hoverT = over && !coming && parked ? (this._hoverT || 0) + dt : 0;
    if (!over || coming) this._lowerUntil = 0;
    if (this._hoverT > HOVER.after && s.elapsed - (this._lowerAt == null ? -1e9 : this._lowerAt) > HOVER.every) {
      this._lowerAt = s.elapsed;
      this._lowerUntil = s.elapsed + HOVER.show;
      this.lowerShown = (this.lowerShown || 0) + 1;
    }
    if (!over || !(s.elapsed < this._lowerUntil)) return null;
    return { word: 'LOWER', keys: sc === 'pad' ? icon('down') : K('Q', '↓'), arrow: over };
  }

  tick(dt) {
    if (this.step === 3) {
      this._comboT = (this._comboT == null ? 7 : this._comboT) - dt;
      if (this._comboT <= 0) this.advance(4);
    }
  }

  /** A box has been placed: the next lesson begins. */
  onPlaced() {
    const st = this.step;
    const one = this.scheme() === 'touch' || this.scheme() === 'mouse';
    if (st < 3) this.advance(one && st >= 1 ? 3 : st + 1);
  }

  _screen(v) {
    if (!v || !this.project) return null;
    if (v === 'drop') {
      const r = this.dropRect();
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    }
    const q = this.project(_a.copy(v));
    return q.behind ? null : q;
  }

  _show(p, nudge = false) {
    // the word pill (rebuilt only when it changes)
    const key = p ? (p.word || '') + (p.keys || '') + nudge : '';
    if (key !== this.key) {
      this.key = key;
      this.root.innerHTML = '';
      const on = !!(p && (p.word || p.keys));
      this.root.classList.toggle('on', on);
      if (on) this.root.appendChild(h('div.coachpill.gword' + (nudge ? '.nudge' : ''), p.keys ? h('span.keys', { html: p.keys }) : null, p.word ? h('span.txt', p.word) : null));
    }
    this.layer.classList.toggle('nudge', nudge);
    document.body.classList.toggle('coach-nudge', nudge);
    // the arrow sits on its target and bobs
    const a = p && this._screen(p.arrow);
    this.arrow.classList.toggle('on', !!a);
    if (a) this._move('a', a.x, a.y, this.arrow, '--x', '--y');
    // the ghost hand taps the DROP button or drags from the spreader to the target
    const hd = p && p.hand;
    const from = hd && hd.mode === 'drag' ? this._screen(hd.from) : null;
    const to = hd ? this._screen(hd.to) : null;
    const showHand = !!(to && (hd.mode === 'tap' || from));
    this.hand.classList.toggle('on', showHand);
    this.hand.classList.toggle('tap', showHand && hd.mode === 'tap');
    this.hand.classList.toggle('drag', showHand && hd.mode === 'drag');
    if (showHand) {
      this._move('t', to.x, to.y, this.hand, '--tx', '--ty');
      if (from) this._move('f', from.x, from.y, this.hand, '--fx', '--fy');
    }
  }

  /** Style variables only change when the point has really moved (no layout churn). */
  _move(k, x, y, el, vx, vy) {
    const P = this._pos;
    if (Math.abs(P[k + 'x'] - x) < 1.5 && Math.abs(P[k + 'y'] - y) < 1.5) return;
    P[k + 'x'] = x;
    P[k + 'y'] = y;
    el.style.setProperty(vx, Math.round(x) + 'px');
    el.style.setProperty(vy, Math.round(y) + 'px');
  }

  hide() {
    this._show(null);
  }
}
