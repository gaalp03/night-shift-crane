// VHF handset: short typed-out messages from the tower, customs — and a caller nobody can trace.
import { h } from '../core/util.js';
import { icon } from './icons.js';
import { audio } from '../core/audio.js';
import { WHO } from '../game/story.js';

export class Radio {
  constructor() {
    this.root = document.getElementById('radio');
    this.queue = [];
    this.cur = null;
    this.t = 0;
    this.shown = 0;
    this.paused = false;
  }

  /** Queue one or more lines: { who, text, dur? }. `urgent` jumps the queue. */
  say(lines, { urgent = false, key } = {}) {
    if (!lines) return;
    const list = (Array.isArray(lines) ? lines : [lines]).map((l) => ({ ...l, key }));
    if (key && (this.queue.some((q) => q.key === key) || (this.cur && this.cur.key === key))) return;
    if (urgent) this.queue.unshift(...list);
    else this.queue.push(...list);
  }

  clear() {
    this.queue.length = 0;
    this.cur = null;
    this.root.classList.remove('on');
    this.root.innerHTML = '';
  }

  get busy() {
    return !!this.cur || this.queue.length > 0;
  }

  _open(line) {
    const who = WHO[line.who] || WHO.dispatch;
    this.cur = line;
    this.t = 0;
    this.shown = 0;
    this.len = line.text.length;
    this.hold = line.dur ? line.dur / 1000 : 1.6 + this.len * 0.045;
    this.textEl = h('p');
    this.root.innerHTML = '';
    this.root.className = 'on ' + who.cls;
    this.root.appendChild(h('div.rx', h('div.av', { html: icon(who.icon) }), h('div.msg', h('div.who', h('b', who.name), h('span', who.sub), h('i.sig', h('i'), h('i'), h('i'))), this.textEl)));
    audio.play('radio_in', { vol: line.who === 'unknown' ? 0.9 : 0.7, rate: line.who === 'unknown' ? 0.82 : 1 });
  }

  update(dt) {
    if (this.paused) return;
    if (!this.cur) {
      if (!this.queue.length) return;
      this.gap = (this.gap || 0) - dt;
      if (this.gap > 0) return;
      this._open(this.queue.shift());
      return;
    }
    this.t += dt;
    const n = Math.min(this.len, Math.floor(this.t * 46));
    if (n !== this.shown) {
      this.shown = n;
      this.textEl.textContent = this.cur.text.slice(0, n);
    }
    if (this.t > this.len / 46 + this.hold) {
      audio.play('radio_out', { vol: 0.6 });
      this.cur = null;
      this.gap = 0.45;
      if (!this.queue.length) this.root.classList.remove('on');
    }
  }
}
