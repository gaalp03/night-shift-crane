// In-game HUD. Built once per shift, then patched only where values change.
import { h, fmtTime, fmtNum, clamp } from '../core/util.js';
import { ZONES, CARGO_TYPES } from '../config.js';
import { icon, TYPE_ICON } from './icons.js';

export function cargoChip(spec, cls = '') {
  const zone = ZONES[spec.zone] || ZONES.ANY;
  const type = spec.type || 'std';
  const isReefer = type === 'reefer';
  const sw = h('span.sw', { style: { '--c': isReefer ? '#d9d6cb' : zone.css }, html: TYPE_ICON[type] ? icon(TYPE_ICON[type]) : '' });
  if (isReefer) sw.style.color = zone.css;
  const label = (spec.zone === 'ANY' ? 'GEN' : zone.id) + (type !== 'std' ? ' · ' + CARGO_TYPES[type].label.toUpperCase() : '');
  return h(`span.chip${cls}`, sw, label);
}

export class Hud {
  constructor({ onPause, onCamera, touch }) {
    this.root = document.getElementById('hud');
    this.onPause = onPause;
    this.onCamera = onCamera;
    this.touch = touch;
    this.cache = {};
    this.el = {};
  }

  build(level, session) {
    const r = this.root;
    r.innerHTML = '';
    this.cache = {};
    const e = (this.el = {});
    const endless = !!level.endless;

    // --- top left: shift plate, manifest queue
    e.shipName = h('div.ship', session.ship.name);
    e.shiftNo = h('div.no', endless ? '∞' : String(level.n).padStart(2, '0'));
    e.shiftName = h('div.nm', endless ? 'Overtime' : level.name);
    const plate = h('div.shiftplate.plate', e.shiftNo, h('div.txt', e.shiftName, e.shipName));
    e.queueChips = h('div.chips');
    e.queue = h('div.queue.plate', h('div.lbl', 'Trucks inbound'), e.queueChips);
    r.appendChild(h('div.hud-tl', plate, e.queue));

    // --- top centre: clock + progress
    e.timeTxt = h('span', '0:00');
    e.timer = h('div.timer.plate', { html: icon('clock') }, e.timeTxt);
    e.progTxt = h('span', '0 / 0');
    e.pips = h('div.pips2');
    e.progress = h('div.progress.plate', { html: icon('box') }, e.progTxt, e.pips);
    r.appendChild(h('div.hud-tc', e.timer, e.progress));

    // --- top right: buttons, score, stars, strikes
    e.camBtn = h('button.btn.icon.ghost', { title: 'Camera (C)', html: icon('camera'), onclick: () => this.onCamera() });
    e.pauseBtn = h('button.btn.icon.ghost', { title: 'Pause (Esc)', html: icon('pause'), onclick: () => this.onPause() });
    e.score = h('div.val', '0');
    e.starFill = h('div.fill');
    e.starMk = [0, 1, 2].map(() => h('div.mk', { html: icon('star') }));
    e.starbar = h('div.starbar', e.starFill, ...e.starMk);
    e.scoreLbl = h('div.lbl', endless ? 'Overtime score' : 'Score');
    const scoreplate = h('div.scoreplate.plate', e.scoreLbl, e.score, endless ? null : e.starbar);
    e.combo = h('div.combo', 'COMBO');
    e.strikes = h('div.strikes.plate');
    r.appendChild(h('div.hud-tr', h('div.hud-btns', e.camBtn, e.pauseBtn), scoreplate, e.combo, e.strikes));

    // --- bottom left: wind, reefers
    e.windNeedle = h('i');
    e.windVal = h('div.val', { html: '0<small>WIND</small>' });
    e.wind = h('div.windplate.plate.calm', h('div.dial', e.windNeedle), e.windVal);
    e.reefers = h('div.reefers.plate.hidden');
    r.appendChild(h('div.hud-bl', e.reefers, e.wind));

    // --- bottom centre: status line + key hints
    e.statusTxt = h('span', '');
    e.statusKey = h('span.kbd', 'SPACE');
    e.alt = h('span.alt', '');
    e.carry = h('span.carrychip');
    e.status = h('div.status.plate', h('i.lamp'), e.carry, e.statusTxt, e.statusKey, e.alt);
    e.hints = h(
      'div.controls-hint.plate',
      h('span', { html: '<span class="kbd">A</span><span class="kbd">D</span> trolley' }),
      h('span', { html: '<span class="kbd">W</span><span class="kbd">S</span> gantry' }),
      h('span', { html: '<span class="kbd">E</span><span class="kbd">Q</span> hoist' }),
      h('span', { html: '<span class="kbd">C</span> view' })
    );
    r.appendChild(h('div.hud-bc', e.status, this.touch ? null : e.hints));

    this.thresholds = null;
    this.update(session.hud(), true);
  }

  show(v) {
    this.root.classList.toggle('hidden', !v);
  }

  _set(key, value, fn) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    fn(value);
  }

  update(s, force) {
    const e = this.el;
    if (!e.score) return;
    if (force) this.cache = {};
    // clock
    const hasClock = !s.endless || s.time > 0;
    this._set('time', hasClock ? Math.ceil(s.time) : -1, (v) => {
      e.timeTxt.textContent = v < 0 ? '--:--' : fmtTime(v);
    });
    this._set('low', hasClock && s.time <= 30 && s.phase === 'play', (v) => e.timer.classList.toggle('low', v));
    // progress
    const key = `${s.delivered}/${s.quota}/${s.strikes}/${s.endless ? s.shipIndex : ''}`;
    this._set('prog', key, () => {
      if (s.endless) {
        e.progTxt.textContent = `SHIP ${s.shipIndex + 1} · ${clamp(s.shipDelivered, 0, s.quota)} / ${s.quota}`;
        e.pips.innerHTML = '';
      } else {
        e.progTxt.textContent = `${s.delivered} / ${s.quota}`;
        e.pips.innerHTML = '';
        for (let i = 0; i < s.quota; i++) e.pips.appendChild(h(i < s.delivered ? 'i.on' : 'i'));
      }
    });
    // score
    this._set('score', s.score, (v) => {
      e.score.textContent = fmtNum(v);
      e.score.classList.add('bump');
      clearTimeout(this._bump);
      this._bump = setTimeout(() => e.score.classList.remove('bump'), 160);
      if (s.thresholds) {
        const t = s.thresholds;
        const max = t[2] * 1.12;
        e.starFill.style.width = clamp((v / max) * 100, 0, 100) + '%';
        e.starMk.forEach((m, i) => {
          m.style.left = (t[i] / max) * 100 + '%';
          m.classList.toggle('on', v >= t[i]);
        });
      }
    });
    this._set('combo', s.combo >= 2 ? s.combo : 0, (v) => {
      e.combo.classList.toggle('on', v >= 2);
      if (v >= 2) e.combo.textContent = `COMBO x${(1 + 0.1 * Math.min(10, v - 1)).toFixed(1)}`;
    });
    this._set('strikes', s.strikes + '/' + s.maxStrikes, () => {
      e.strikes.innerHTML = '';
      for (let i = 0; i < s.maxStrikes; i++) e.strikes.appendChild(h(i < s.strikes ? 'i.gone' : 'i'));
    });
    // queue: parked truck first, then what is still to arrive
    const qk = s.waiting.map((c) => c.id).join(',') + '|' + s.next.length + '|' + (s.next[0] ? s.next[0].zone + s.next[0].type : '') + '|' + s.shipIndex;
    this._set('queue', qk, () => {
      e.queueChips.innerHTML = '';
      for (const c of s.waiting) e.queueChips.appendChild(cargoChip(c, '.now'));
      for (const n of s.next.slice(0, 3)) e.queueChips.appendChild(cargoChip(n));
      e.queue.classList.toggle('hidden', !s.waiting.length && !s.next.length);
    });
    // wind
    const w = s.wind;
    this._set('wind', Math.round(w * 10), () => {
      e.windVal.innerHTML = `${Math.round(w * 9)}<small>KM/H WIND</small>`;
      e.wind.classList.toggle('calm', w < 0.12);
    });
    // needle: screen right = +X, screen up = -Z (matches both camera views)
    const ang = Math.atan2(Math.cos(s.windAngle), -Math.sin(s.windAngle));
    this._set('windA', Math.round(ang * 20), () => {
      e.windNeedle.style.transform = `rotate(${ang}rad)`;
    });
    this._set('gust', s.gustWarn > 0, (v) => e.wind.classList.toggle('gust', v));
    // reefers
    const rk = s.reefers.map((c) => c.id + ':' + Math.round(c.temp * 20)).join(',');
    this._set('reef', rk, () => {
      e.reefers.classList.toggle('hidden', !s.reefers.length);
      e.reefers.innerHTML = '';
      for (const c of s.reefers) {
        const bar = h('div.bar', h('i', { style: { width: Math.round(c.temp * 100) + '%' } }));
        e.reefers.appendChild(h('div.r', { html: icon('snow') }, (ZONES[c.zone] || ZONES.ANY).id, bar));
      }
    });
    // status line
    this._set('hint', s.hint + s.state, () => {
      e.statusTxt.textContent = s.hint;
      e.status.className = 'status plate ' + s.state;
      e.statusKey.style.display = s.action === 'lock' || (s.action === 'release' && s.state !== 'bad') ? '' : 'none';
    });
    this._set('carry', s.carry ? s.carry.id : 0, () => {
      e.carry.innerHTML = '';
      if (s.carry) e.carry.appendChild(cargoChip(s.carry, '.sm'));
    });
    this._set('alt', Math.round(s.altitude * 10), (v) => {
      e.alt.innerHTML = `${icon('down')} ${(v / 10).toFixed(1)} m`;
    });
    this._set('ship', s.ship.name, (v) => {
      e.shipName.textContent = v;
    });
  }

  setCameraMode(mode) {
    if (this.el.camBtn) this.el.camBtn.classList.toggle('primary', mode === 'cab');
  }
}
