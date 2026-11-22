// In-play coaching: one control per box, shown as a single key prompt — no cards, no chain of steps.
// It also decides what the crane does by itself while a control has not been taught yet.
import { h } from '../core/util.js';

const K = (...keys) => keys.map((k) => `<span class="kbd">${k}</span>`).join('');

export class Coach {
  /**
   * @param save   save store (flags.coach = how many lessons are done)
   * @param touch  () => true while the player is on a touch screen
   */
  constructor(save, touch) {
    this.save = save;
    this.touch = touch;
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

  /** What runs itself. Touch: everything but steering. Keyboard: whatever has not been taught yet. */
  automation(s) {
    const touch = this.touch();
    const st = this.step;
    if (touch) return { hoist: true, lock: true, release: st >= 1 };
    return { hoist: st < 2, lock: !!s.mods.autoLock, release: false };
  }

  /** Called every frame in play; picks at most one prompt. */
  update(s) {
    if (!s || s.phase !== 'play') return this._show(null);
    s.auto = this.automation(s);
    const touch = this.touch();
    const st = this.step;
    const rig = s.rig;
    const g = s.wantedGrab();
    const seat = s.seat;
    let p = null;
    if (st === 0) {
      p = rig.carry ? (touch ? { html: 'Tap', text: 'to let go of the box' } : { html: K('SPACE'), text: 'Release the box' }) : null;
    } else if (st === 1) {
      if (!rig.carry) {
        if (g && g.ready) p = touch ? null : { html: K('SPACE'), text: 'Lock on' };
        else p = touch ? { html: 'Drag', text: 'the crane over the truck' } : { html: K('A', 'D') + K('W', 'S'), text: 'Drive over the truck' };
      } else if (seat && seat.seated && seat.valid) p = touch ? null : { html: K('SPACE'), text: 'Release' };
      else p = touch ? { html: 'Drag', text: 'the box over a glowing slot — let go and it lands' } : { html: K('A', 'D') + K('W', 'S'), text: 'Carry it over a glowing slot' };
    } else if (st === 2 && !touch) {
      if (!rig.carry) {
        if (g && g.ready) p = { html: K('SPACE'), text: 'Lock on' };
        else if (g && Math.hypot(g.lx, g.lz) < 0.8) p = { html: K('Q'), text: 'Lower onto the box' };
        else p = { html: K('E'), text: 'Hoist up, then drive over the next box' };
      } else if (seat && seat.seated && seat.valid) p = { html: K('SPACE'), text: 'Release' };
      else if (seat && seat.err < 0.8) p = { html: K('Q'), text: 'Lower it in' };
      else if (s.altitude < 3) p = { html: K('E'), text: 'Hoist it clear' };
    } else if (st === 3) {
      p = this._comboT == null || this._comboT > 0 ? { html: touch ? '★' : K('C'), text: touch ? 'Chain PERFECT set-downs to build the combo' : 'Cab view — and chain PERFECTs for the combo' } : null;
    }
    this._show(p);
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
    if (st < 3) this.advance(this.touch() && st >= 1 ? 3 : st + 1);
  }

  _show(p) {
    const key = p ? p.html + p.text : '';
    if (key === this.key) return;
    this.key = key;
    this.root.innerHTML = '';
    this.root.classList.toggle('on', !!p);
    if (p) this.root.appendChild(h('div.coachpill', h('span.keys', { html: p.html }), h('span.txt', p.text)));
  }

  hide() {
    this._show(null);
  }
}
