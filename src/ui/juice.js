// Screen-space feedback: comic bursts, floating points, toasts, banners, flashes,
// the container-door screen wipe and the cinematic letterbox.
import * as THREE from 'three';
import { h, clamp } from '../core/util.js';
import { icon } from './icons.js';
import { audio } from '../core/audio.js';

const _v = new THREE.Vector3();

export class Juice {
  constructor(camera) {
    this.camera = camera;
    this.bursts = document.getElementById('bursts');
    this.toasts = document.getElementById('toasts');
    this.wipe = document.getElementById('wipe');
    this.letter = document.getElementById('letterbox');
    this.flashEl = h('div.flash');
    this.bursts.appendChild(this.flashEl);
    this.toastKeys = new Map();
    this.wipeBusy = false;
    this.enabled = true;
  }

  /** World position -> CSS pixels. */
  project(pos) {
    _v.copy(pos).project(this.camera);
    const w = window.innerWidth;
    const hh = window.innerHeight;
    return { x: (_v.x * 0.5 + 0.5) * w, y: (-_v.y * 0.5 + 0.5) * hh, behind: _v.z > 1 };
  }

  _place(el, pos, marginX = 90, marginY = 70) {
    let x = window.innerWidth / 2;
    let y = window.innerHeight * 0.4;
    if (pos) {
      const p = this.project(pos);
      if (!p.behind) {
        x = p.x;
        y = p.y;
      }
    }
    x = clamp(x, marginX, window.innerWidth - marginX);
    y = clamp(y, marginY + 40, window.innerHeight - marginY);
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }

  burst({ text, pos, kind = 'good', sub, big }) {
    if (!this.enabled) return;
    const rot = (Math.random() * 14 - 7).toFixed(1);
    const el = h(`div.burst.${kind}${big ? '.big' : ''}`, h('div.b', { style: { '--rot': rot + 'deg' } }, h('div.shape'), h('div.txt', text), sub ? h('div.subt', sub) : null));
    el.firstChild.style.setProperty('--rot', rot + 'deg');
    this._place(el, pos);
    this.bursts.appendChild(el);
    setTimeout(() => el.remove(), 1300);
    // keep the layer from piling up if a lot happens at once
    while (this.bursts.children.length > 14) this.bursts.children[1].remove();
  }

  points({ pts, pos, mult, rough }) {
    if (!this.enabled || !pts) return;
    const neg = pts < 0;
    const el = h(`div.pts${neg ? '.neg' : ''}`, { html: `${neg ? '' : '+'}${pts}${mult > 1.01 ? `<small>x${mult.toFixed(1)}</small>` : ''}` });
    const wrap = h('div', { style: { position: 'absolute', left: 0, top: 0 } }, el);
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    if (pos) {
      const p = this.project(pos);
      if (!p.behind) {
        x = p.x;
        y = p.y + (rough ? 10 : 46);
      }
    }
    wrap.style.transform = `translate(${clamp(x, 60, window.innerWidth - 60)}px, ${clamp(y, 90, window.innerHeight - 60)}px)`;
    this.bursts.appendChild(wrap);
    setTimeout(() => wrap.remove(), 1350);
  }

  /**
   * Coins spring out of `pos` and fly to the wallet; `onCoin(share)` runs as each one lands.
   * @param target element the coins fly to
   */
  coins(pos, amount, target, onCoin) {
    if (!amount) return;
    const n = Math.max(3, Math.min(12, Math.round(amount / 25)));
    const from = pos && pos.screen ? { x: pos.x, y: pos.y } : pos ? this.project(pos) : { x: window.innerWidth / 2, y: window.innerHeight * 0.45 };
    const r = target ? target.getBoundingClientRect() : { left: window.innerWidth - 60, top: 40, width: 0, height: 0 };
    const tx = r.left + r.width * 0.25;
    const ty = r.top + r.height / 2;
    let left = amount;
    for (let i = 0; i < n; i++) {
      const share = i === n - 1 ? left : Math.round(amount / n);
      left -= share;
      const el = h('div.coin', { html: icon('coin') });
      const sx = from.x + (Math.random() - 0.5) * 70;
      const sy = from.y + (Math.random() - 0.5) * 40;
      el.style.transform = `translate(${from.x}px, ${from.y}px) scale(0.4)`;
      this.bursts.appendChild(el);
      // pop out, hang a beat, then sweep into the wallet
      setTimeout(() => {
        el.style.transition = 'transform 0.22s cubic-bezier(0.2, 1.4, 0.4, 1)';
        el.style.transform = `translate(${sx}px, ${sy - 30}px) scale(1)`;
      }, 16 + i * 18);
      setTimeout(() => {
        el.style.transition = 'transform 0.5s cubic-bezier(0.55, 0, 0.8, 0.4), opacity 0.5s';
        el.style.transform = `translate(${tx}px, ${ty}px) scale(0.6)`;
      }, 300 + i * 55);
      setTimeout(() => {
        el.remove();
        if (onCoin) onCoin(share, i === n - 1);
        if (i % 2 === 0) audio.play('ui_coin', { vol: 0.55, rate: 1 + i * 0.03 });
      }, 800 + i * 55);
    }
  }

  toast({ text, kind = 'info', key, dur = 3200, silent }) {
    if (!this.enabled) return;
    const now = performance.now();
    const k = key || text;
    if (this.toastKeys.has(k) && now - this.toastKeys.get(k) < 5200) return;
    this.toastKeys.set(k, now);
    const ic = kind === 'warn' ? 'warn' : kind === 'good' ? 'check' : 'info';
    const el = h(`div.toast.${kind}`, { html: icon(ic) + `<span></span>` });
    el.lastChild.textContent = text;
    this.toasts.appendChild(el);
    if (!silent) audio.play(kind === 'warn' ? 'ui_warn' : 'ui_toast', { vol: kind === 'warn' ? 0.6 : 1 });
    while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 260);
    }, dur);
  }

  clearToasts() {
    this.toasts.innerHTML = '';
    this.toastKeys.clear();
  }

  banner(t1, t2, dur = 2600) {
    const el = h('div.banner', h('div.t1', t1), t2 ? h('div.t2', t2) : null);
    el.style.animationDuration = dur + 'ms';
    this.bursts.appendChild(el);
    setTimeout(() => el.remove(), dur + 50);
  }

  flash(kind) {
    this.flashEl.classList.remove('on', 'red');
    void this.flashEl.offsetWidth;
    if (kind === 'red') this.flashEl.classList.add('red');
    this.flashEl.classList.add('on');
  }

  clear() {
    for (const el of [...this.bursts.children]) if (el !== this.flashEl) el.remove();
    this.clearToasts();
  }

  // ---------------------------------------------------------------- container-door wipe

  wipeClose() {
    return new Promise((res) => {
      this.wipe.classList.remove('opening');
      this.wipe.classList.add('closed');
      audio.play('whoosh_ui', { vol: 0.7 });
      setTimeout(() => audio.play('door_close'), 330);
      setTimeout(res, 560);
    });
  }

  wipeOpen() {
    return new Promise((res) => {
      this.wipe.classList.add('opening');
      this.wipe.classList.remove('closed');
      audio.play('door_open', { vol: 0.8 });
      setTimeout(() => {
        this.wipe.classList.remove('opening');
        res();
      }, 620);
    });
  }

  /** Close the doors, run `mid` (may be async) while hidden, then open. */
  async transition(mid) {
    if (this.wipeBusy) return;
    this.wipeBusy = true;
    try {
      await this.wipeClose();
      await mid();
      // let the new scene render a couple of frames behind the doors
      await new Promise((r) => setTimeout(r, 140));
      await this.wipeOpen();
    } finally {
      this.wipeBusy = false;
    }
  }

  // ---------------------------------------------------------------- cinematic bars

  letterbox(on, skipText) {
    const el = this.letter;
    if (on) {
      el.classList.remove('hidden');
      void el.offsetWidth;
      el.classList.add('on');
      el.querySelector('.skip').textContent = skipText || '';
    } else {
      el.classList.remove('on');
      this.caption(null);
      setTimeout(() => {
        if (!el.classList.contains('on')) el.classList.add('hidden');
      }, 720);
    }
  }

  caption(title, sub) {
    const c = this.letter.querySelector('.caption');
    if (!title) {
      c.classList.remove('on');
      return;
    }
    c.classList.remove('on');
    setTimeout(() => {
      c.innerHTML = '';
      c.appendChild(h('b', title));
      if (sub) c.appendChild(h('span', sub));
      c.classList.add('on');
    }, 220);
  }
}
