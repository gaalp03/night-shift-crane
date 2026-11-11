// On-screen controls for phones / tablets: a floating stick (trolley + gantry),
// two hold buttons for the hoist and one big context button for lock / release.
import { h, clamp } from '../core/util.js';
import { input } from '../core/input.js';
import { icon } from './icons.js';

export class TouchControls {
  constructor() {
    this.root = document.getElementById('touch');
    this.active = false;
    this.pointerId = null;
    this.cx = 0;
    this.cy = 0;
    this._build();
  }

  _build() {
    const r = this.root;
    r.innerHTML = '';
    this.knob = h('div.knob');
    this.stick = h('div.stick', this.knob);
    this.zone = h('div.stick-zone');
    r.appendChild(this.zone);
    r.appendChild(this.stick);

    const zone = this.zone;
    const radius = () => this.stick.offsetWidth * 0.36;
    const setKnob = (dx, dy) => {
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const move = (e) => {
      const R = radius();
      let dx = e.clientX - this.cx;
      let dy = e.clientY - this.cy;
      const d = Math.hypot(dx, dy);
      if (d > R) {
        dx *= R / d;
        dy *= R / d;
      }
      setKnob(dx, dy);
      const dz = 0.14;
      const nx = dx / R;
      const ny = dy / R;
      const ax = Math.abs(nx) < dz ? 0 : (nx - Math.sign(nx) * dz) / (1 - dz);
      const ay = Math.abs(ny) < dz ? 0 : (ny - Math.sign(ny) * dz) / (1 - dz);
      input.touch.x = clamp(ax * 1.15, -1, 1);
      input.touch.z = clamp(ay * 1.15, -1, 1);
      input.lastDevice = 'touch';
    };
    const end = (e) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      input.touch.x = 0;
      input.touch.z = 0;
      setKnob(0, 0);
      this.stick.style.left = '';
      this.stick.style.bottom = '';
      this.stick.style.top = '';
    };
    zone.addEventListener('pointerdown', (e) => {
      if (this.pointerId !== null) return;
      this.pointerId = e.pointerId;
      try {
        zone.setPointerCapture(e.pointerId);
      } catch (err) {}
      // floating stick: the base jumps under the thumb (kept inside the screen)
      const w = this.stick.offsetWidth;
      const x = clamp(e.clientX, w * 0.55, window.innerWidth * 0.5);
      const y = clamp(e.clientY, w * 0.55, window.innerHeight - w * 0.55);
      this.cx = x;
      this.cy = y;
      this.stick.style.left = x - w / 2 + 'px';
      this.stick.style.top = y - w / 2 + 'px';
      this.stick.style.bottom = 'auto';
      move(e);
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.pointerId) move(e);
    });
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    // --- buttons
    const hold = (el, on, off) => {
      const down = (e) => {
        el.classList.add('down');
        try {
          el.setPointerCapture(e.pointerId);
        } catch (err) {}
        on();
        e.preventDefault();
      };
      const up = () => {
        el.classList.remove('down');
        off();
      };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    this.upBtn = h('button.tbtn.up', { html: icon('up') + '<small>Hoist</small>', 'aria-label': 'Hoist up' });
    this.downBtn = h('button.tbtn.dn', { html: icon('down') + '<small>Lower</small>', 'aria-label': 'Lower' });
    this.lockIcon = h('span', { html: icon('lock') });
    this.lockLabel = h('small', 'Lock');
    this.lockBtn = h('button.tbtn.lock', { 'aria-label': 'Lock or release' }, this.lockIcon, this.lockLabel);
    let hoist = 0;
    hold(
      this.upBtn,
      () => {
        hoist = 1;
        input.touch.hoist = hoist;
      },
      () => {
        if (hoist === 1) hoist = 0;
        input.touch.hoist = hoist;
      }
    );
    hold(
      this.downBtn,
      () => {
        hoist = -1;
        input.touch.hoist = hoist;
      },
      () => {
        if (hoist === -1) hoist = 0;
        input.touch.hoist = hoist;
      }
    );
    hold(
      this.lockBtn,
      () => input.fire('lock'),
      () => {}
    );
    r.appendChild(h('div.tbtns', this.lockBtn, this.upBtn, this.downBtn));
    this.lockState = '';
  }

  show(v) {
    this.active = v;
    this.root.classList.toggle('hidden', !v);
    if (!v) {
      input.touch.x = input.touch.z = input.touch.hoist = 0;
      this.pointerId = null;
    }
  }

  /** Reflect what the context button will do. */
  setAction(action, state) {
    const key = action + ':' + state;
    if (key === this.lockState) return;
    this.lockState = key;
    const b = this.lockBtn;
    b.classList.toggle('ready', action === 'lock');
    b.classList.toggle('release', action === 'release');
    b.classList.toggle('seated', action === 'release' && state === 'good');
    this.lockIcon.innerHTML = icon(action === 'release' ? 'unlock' : 'lock');
    this.lockLabel.textContent = action === 'release' ? 'Release' : 'Lock';
  }
}
