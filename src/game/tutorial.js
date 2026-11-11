// First-shift tutorial: a short chain of prompts that advance when the player actually does the thing.
import { h } from '../core/util.js';
import { audio } from '../core/audio.js';
import { DIM } from '../config.js';

const K = (...keys) => keys.map((k) => `<span class="kbd">${k}</span>`).join('');

export class Tutorial {
  constructor(session, { touch }) {
    this.s = session;
    this.touch = touch;
    this.root = document.getElementById('tutorial');
    this.i = -1;
    this.t = 0;
    this.done = false;
    this.placed = 0;
    this.unsub = [session.on('placed', () => this.placed++)];
    const T = touch;
    this.steps = [
      {
        text: T ? 'Drag the stick to park the spreader over the truck' : `Park the spreader over the container on the truck`,
        sub: T ? 'Left / right runs the trolley · up / down drives the whole crane' : `${K('A', 'D')} trolley &nbsp; ${K('W', 'S')} drive the crane along the quay`,
        ok: (s) => s.grab && Math.hypot(s.grab.lx, s.grab.lz) < 1.3,
      },
      {
        text: T ? 'Hold LOWER and set the spreader down on the box' : 'Lower the spreader onto the box',
        sub: T ? 'The big button turns amber when it has landed' : `${K('Q')} lower &nbsp; ${K('E')} hoist — the corner lamps turn amber when it has landed`,
        ok: (s) => (s.grab && s.grab.ready) || !!s.rig.carry,
      },
      {
        text: T ? 'Tap LOCK to grab it' : 'Lock on',
        sub: T ? '' : `${K('SPACE')} engages the twist-locks`,
        ok: (s) => !!s.rig.carry,
      },
      {
        text: T ? 'Hold HOIST to lift it clear' : 'Hoist it clear of the truck',
        sub: 'Higher loads swing less and clear the ship’s rail',
        ok: (s) => s.rig.carry && s.rig.bottomWorld().y > DIM.QUAY_Y + 5.2,
      },
      {
        text: 'Carry it out over the ship',
        sub: 'Glowing frames are free slots. Ease off early — the load keeps swinging',
        ok: (s) => !!s.seat && s.seat.kind === 'ship',
      },
      {
        text: 'Lower it into a frame',
        sub: 'Green reticle = on the lock points. The plumb lines show where it will land',
        ok: (s) => (s.seat && s.seat.seated && s.seat.valid) || this.placed > 0,
      },
      {
        text: T ? 'Tap RELEASE' : 'Release to lock it down',
        sub: T ? '' : `${K('SPACE')}`,
        ok: () => this.placed > 0,
      },
      {
        done: true,
        text: 'Locked! Three more to go',
        sub: T ? 'Soft, centred set-downs score PERFECT · the camera button switches to the cab view' : `Soft, centred set-downs score PERFECT &nbsp; ${K('C')} cab view &nbsp; drag to look around`,
        ok: () => this.t > 6.5,
      },
    ];
    session.timeFrozen = true;
    this._show(0);
  }

  _show(i) {
    this.i = i;
    this.t = 0;
    const st = this.steps[i];
    this.root.innerHTML = '';
    if (!st) {
      this.root.classList.add('hidden');
      return;
    }
    this.root.classList.remove('hidden');
    const body = h('div.body', { html: st.text + (st.sub ? `<small>${st.sub}</small>` : '') });
    this.root.appendChild(h(`div.tut${st.done ? '.done' : ''}`, h('div.step', st.done ? '✓' : String(i + 1)), body));
    if (i > 0) audio.play(st.done ? 'ui_confirm' : 'ui_toast', { vol: 0.8 });
  }

  update(dt) {
    if (this.done) return;
    const s = this.s;
    if (s.phase !== 'play') {
      this.root.classList.add('hidden');
      return;
    }
    this.root.classList.remove('hidden');
    this.t += dt;
    const st = this.steps[this.i];
    if (!st) return;
    // let players who race ahead skip prompts they have already satisfied
    let j = this.i;
    while (this.steps[j] && this.steps[j].ok(s) && (this.t > 0.35 || j > this.i)) j++;
    if (j !== this.i) {
      if (this.placed > 0) {
        s.timeFrozen = false;
        if (j < this.steps.length - 1) j = this.steps.length - 1;
      }
      if (j >= this.steps.length) this.finish();
      else this._show(j);
    }
  }

  finish() {
    if (this.done) return;
    this.done = true;
    this.s.timeFrozen = false;
    this.root.classList.add('hidden');
    this.root.innerHTML = '';
    for (const u of this.unsub) u();
    if (this.onDone) this.onDone();
  }

  dispose() {
    this.done = true;
    this.s.timeFrozen = false;
    this.root.classList.add('hidden');
    this.root.innerHTML = '';
    for (const u of this.unsub) u();
  }
}
