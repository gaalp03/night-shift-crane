// In-play coaching: one control per box, shown as a single icon-first prompt (a few words at most)
// — no cards, no chain of steps. It also decides what the crane does by itself while a control has
// not been taught yet.
import { h } from '../core/util.js';
import { icon } from '../ui/icons.js';

const K = (...keys) => keys.map((k) => `<span class="kbd">${k}</span>`).join('');
const I = (name) => icon(name);
const ARROWS = K('←', '→', '↑', '↓');

export class Coach {
  /**
   * @param save    save store (flags.coach = how many lessons are done)
   * @param scheme  () => 'touch' | 'mouse' | 'keys': how the player is steering right now
   */
  constructor(save, scheme) {
    this.save = save;
    this.scheme = scheme;
    this.root = document.getElementById('coach');
    this.key = '';
    this.prompt = null;
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
    if (sc !== 'keys') return { hoist: true, lock: true, release: st >= 1 };
    return { hoist: st < 2, lock: !!s.mods.autoLock, release: false };
  }

  /**
   * Called every frame in play; picks at most one prompt.
   * @param idle  seconds since the player last touched anything
   */
  update(s, idle = 0) {
    if (!s || s.phase !== 'play') return this._show(null);
    s.auto = this.automation(s);
    const sc = this.scheme();
    const touch = sc === 'touch';
    const one = sc !== 'keys'; // one-touch: drag to steer, tap / click to lock or let go
    const pointer = touch ? I('hand') : I('mouse');
    const st = this.step;
    const rig = s.rig;
    const g = s.wantedGrab();
    const seat = s.seat;
    let p = null;
    if (st === 0) {
      // the very first box hangs over its slot: one action and it pays
      if (rig.carry) p = touch ? { html: I('hand'), text: 'Tap to drop' } : { html: K('SPACE') + I('mouse'), text: 'Drop the box' };
    } else if (st === 1) {
      if (!rig.carry) {
        if (g && g.ready && !one) p = { html: K('SPACE'), text: 'Lock on' };
        else p = { html: one ? pointer : ARROWS, text: one ? 'Drag to the truck' : 'Drive to the truck' };
      } else if (seat && seat.seated && seat.valid && !one) p = { html: K('SPACE'), text: 'Release' };
      else p = { html: one ? pointer : ARROWS, text: one ? 'Drag over a slot' : 'Over a glowing slot' };
    } else if (st === 2 && !one) {
      if (!rig.carry) {
        if (g && g.ready) p = { html: K('SPACE'), text: 'Lock on' };
        else if (g && Math.hypot(g.lx, g.lz) < 0.8) p = { html: K('Q'), text: 'Lower onto it' };
        else p = { html: K('E'), text: 'Hoist, then drive' };
      } else if (seat && seat.seated && seat.valid) p = { html: K('SPACE'), text: 'Release' };
      else if (seat && seat.err < 0.8) p = { html: K('Q'), text: 'Lower it in' };
      else if (s.altitude < 3) p = { html: K('E'), text: 'Hoist it clear' };
    } else if (st === 3) {
      p = this._comboT == null || this._comboT > 0 ? { html: I('star') + (one ? '' : K('C')), text: one ? 'Chain PERFECTs' : 'Cab view · chain PERFECTs' } : null;
    }
    // nothing pressed for a while on the first boxes: a pulsing nudge with the controls themselves
    let nudge = false;
    if (st <= 1 && idle > 4) {
      nudge = true;
      if (st === 0 && rig.carry) p = touch ? { html: I('hand'), text: 'Tap' } : { html: I('mouse'), text: 'Click or <SPACE>' };
      else if (st === 1) p = touch ? { html: I('hand') + I('move'), text: 'Drag' } : { html: I('mouse') + I('move'), text: 'Drag or ' + '<ARROWS>' };
    }
    this._show(p, nudge);
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
    if (st < 3) this.advance(this.scheme() !== 'keys' && st >= 1 ? 3 : st + 1);
  }

  _show(p, nudge = false) {
    const key = p ? p.html + p.text + nudge : '';
    if (key === this.key) return;
    this.key = key;
    this.root.innerHTML = '';
    this.root.classList.toggle('on', !!p);
    if (!p) return;
    const txt = h('span.txt');
    // (the arrow keys are drawn as key caps inside the text)
    if (/<(ARROWS|SPACE)>/.test(p.text)) txt.innerHTML = p.text.replace('<ARROWS>', ARROWS).replace('<SPACE>', K('SPACE'));
    else txt.textContent = p.text;
    this.root.appendChild(h('div.coachpill' + (nudge ? '.nudge' : ''), h('span.keys', { html: p.html }), txt));
  }

  hide() {
    this._show(null);
  }
}
