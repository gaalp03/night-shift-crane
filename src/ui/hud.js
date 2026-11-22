// In-game HUD. Built once per shift, then patched only where values change.
import { h, fmtTime, fmtNum, clamp } from '../core/util.js';
import { ZONES, CARGO_TYPES } from '../config.js';
import { icon, TYPE_ICON } from './icons.js';

export function cargoChip(spec, cls = '') {
  const zone = ZONES[spec.zone] || ZONES.ANY;
  const type = spec.type || 'std';
  const isReefer = type === 'reefer';
  if (type === 'black') return h(`span.chip.black${cls}`, h('span.sw', { style: { '--c': '#0c0e10' }, html: icon('eye') }), 'NOT LISTED');
  const sw = h('span.sw', { style: { '--c': isReefer ? '#d9d6cb' : zone.css }, html: TYPE_ICON[type] ? icon(TYPE_ICON[type]) : '' });
  if (isReefer) sw.style.color = zone.css;
  const label = (spec.zone === 'ANY' ? 'GEN' : zone.id) + (type !== 'std' ? ' · ' + CARGO_TYPES[type].label.toUpperCase() : '');
  // amber seal = customs want it weighed
  return h(`span.chip${spec.check ? '.sealed' : ''}${cls}`, sw, label, spec.check ? h('span.seal', '?') : null);
}

export class Hud {
  constructor({ onPause, onCamera, onUpgrade, onDrop, onMute, isMuted, touch }) {
    this.onMute = onMute;
    this.isMuted = isMuted || (() => false);
    this.onDrop = onDrop;
    this.root = document.getElementById('hud');
    this.onPause = onPause;
    this.onCamera = onCamera;
    this.onUpgrade = onUpgrade;
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
    e.shiftNo = level.daily ? h('div.no', { html: icon('moon') }) : h('div.no', endless ? '∞' : String(level.n).padStart(2, '0'));
    e.shiftName = h('div.nm', endless ? 'Overtime' : level.daily ? 'Tonight' : level.name);
    const plate = h('div.shiftplate.plate', e.shiftNo, h('div.txt', e.shiftName, e.shipName));
    e.queueChips = h('div.chips');
    e.queue = h('div.queue.plate', h('div.lbl', 'Trucks inbound'), e.queueChips);
    // the foreman's side job for this shift, kept in the corner of the eye
    const order = !endless && level.order ? h('div.orderline.plate', h('span.lbl', 'Order'), level.order.text) : null;
    // always-visible goals in the endless night: tonight's goal (with its reward) and the next big thing
    e.goals = endless ? h('div.goals.plate') : null;
    e.goalRows = [];
    if (endless) {
      for (let i = 0; i < 2; i++) {
        const row = { lbl: h('span.lbl'), txt: h('span.txt'), bar: h('i'), rew: h('span.rew') };
        row.el = h('div.goal', h('div.gl', row.lbl, row.txt, row.rew), h('div.gbar', row.bar));
        e.goalRows.push(row);
        e.goals.appendChild(row.el);
      }
    }
    r.appendChild(h('div.hud-tl', plate, e.goals, e.queue, order));
    document.body.classList.toggle('goals-on', endless);

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
    // wallet: coins from every box fly in here; the upgrade chip lights up when something is affordable
    e.walletVal = h('span', '0');
    e.wallet = h('div.wallet.plate', { html: icon('coin') }, e.walletVal);
    e.upgrade = h('button.btn.small.upgrade.hidden', { onclick: () => this.onUpgrade && this.onUpgrade(), html: icon('wrench') + 'Upgrade' });
    e.muteBtn = h('button.btn.icon.ghost.mutebtn', { title: 'Sound (M)', html: icon(this.isMuted() ? 'mute' : 'speaker'), onclick: () => this.onMute && this.onMute() });
    r.appendChild(h('div.hud-tr', h('div.hud-btns', e.camBtn, e.muteBtn, e.pauseBtn), scoreplate, e.wallet, e.upgrade, e.combo));

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
    // load cell: only on screen for boxes whose weight matters (spot checks, unlisted boxes)
    e.scaleVal = h('b', '0.0');
    e.scaleDecl = h('span.decl', '');
    e.scaleBar = h('i');
    e.scaleVerdict = h('span.verdict', '');
    e.scale = h('div.scale.plate.hidden', h('span.ic', { html: icon('scale') }), h('div.read', e.scaleVal, h('small', 't')), h('div.papers', e.scaleDecl, h('div.bar', e.scaleBar)), e.scaleVerdict);
    e.hints = h(
      'div.controls-hint.plate',
      h('span', { html: '<span class="kbd">A</span><span class="kbd">D</span> trolley' }),
      h('span', { html: '<span class="kbd">W</span><span class="kbd">S</span> gantry' }),
      h('span', { html: '<span class="kbd">E</span><span class="kbd">Q</span> hoist' }),
      h('span', { html: '<span class="kbd">C</span> view' })
    );
    r.appendChild(h('div.hud-bc', e.scale, e.status, e.hints));

    // --- the big DROP button: the whole HUD of the first minute, and of portrait phones (its ring is the ship's clock)
    e.dropRing = h('i.dring');
    e.dropLbl = h('span.dlbl', 'DROP');
    e.dropSub = h('span.dsub', '');
    e.drop = h('button.dropbtn.hidden', { 'aria-label': 'Drop / grab', onpointerdown: (ev) => ev.stopPropagation(), onclick: (ev) => this.onDrop && this.onDrop(ev) }, e.dropRing, e.dropLbl, e.dropSub);
    r.appendChild(e.drop);

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
      if (v >= 2) e.combo.textContent = `COMBO x${s.mult.toFixed(1)}`;
    });
    // queue: parked truck first, then what is still to arrive
    const qk = s.waiting.map((c) => c.id).join(',') + '|' + s.next.length + '|' + (s.next[0] ? s.next[0].zone + s.next[0].type : '') + '|' + s.shipIndex;
    // (unlisted boxes are, naturally, not on the list of trucks inbound)
    this._set('queue', qk, () => {
      e.queueChips.innerHTML = '';
      for (const c of s.waiting) e.queueChips.appendChild(cargoChip(c, '.now'));
      for (const n of s.next.filter((x) => !x.black).slice(0, 3)) e.queueChips.appendChild(cargoChip(n));
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
    // load cell
    const sc = s.scale;
    this._set('scaleOn', !!sc, (v) => e.scale.classList.toggle('hidden', !v));
    if (sc) {
      // an unlisted box never gives the same number twice
      const shown = sc.black && Math.random() < 0.08 ? '--.-' : sc.read.toFixed(1);
      this._set('scaleRead', shown, (v) => {
        e.scaleVal.textContent = v;
      });
      this._set('scaleDecl', sc.black ? 'x' : sc.decl, () => {
        e.scaleDecl.textContent = sc.black ? 'NO PAPERS' : `PAPERS ${sc.decl.toFixed(1)} t`;
      });
      this._set('scaleK', sc.verdict ? 100 : Math.round(sc.k * 50), () => {
        e.scaleBar.style.width = (sc.verdict ? 100 : sc.k * 100) + '%';
      });
      this._set('scaleV', (sc.verdict || '') + (sc.black ? 'b' : ''), () => {
        e.scale.className = 'scale plate ' + (sc.black ? 'black' : sc.verdict || 'pending');
        e.scaleVerdict.textContent = sc.black ? '???' : sc.verdict === 'match' ? 'MATCH' : sc.verdict === 'mismatch' ? 'NO MATCH' : 'WEIGHING';
      });
    }
    this._set('ship', s.ship.name, (v) => {
      e.shipName.textContent = v;
    });
  }

  /** rows: [{ lbl, text, k (0..1), reward }] — at most two. */
  setGoals(rows) {
    const e = this.el;
    if (!e.goals) return;
    rows.forEach((g, i) => {
      const R = e.goalRows[i];
      if (!R) return;
      const key = g ? g.lbl + g.text + Math.round(g.k * 40) + (g.reward || '') : '';
      if (this.cache['goal' + i] === key) return;
      this.cache['goal' + i] = key;
      R.el.classList.toggle('hidden', !g);
      if (!g) return;
      R.lbl.textContent = g.lbl;
      R.txt.textContent = g.text;
      R.rew.textContent = g.reward ? '+$' + fmtNum(g.reward) : '';
      R.bar.style.width = Math.round(clamp(g.k, 0, 1) * 100) + '%';
      R.el.classList.toggle('done', g.k >= 1);
    });
  }

  /**
   * The big DROP button.
   * @param st { show, label, ready, sub, timeK (0..1 of the ship's clock left) }
   */
  setDrop(st) {
    const e = this.el;
    if (!e || !e.drop) return;
    const key = st.show ? `${st.label}|${st.ready}|${st.sub}|${Math.round((st.timeK == null ? 1 : st.timeK) * 60)}` : '';
    if (this.cache.drop === key) return;
    this.cache.drop = key;
    if (e.drop.classList.contains('hidden') === !!st.show) this._dropRect = null;
    e.drop.classList.toggle('hidden', !st.show);
    if (!st.show) return;
    e.dropLbl.textContent = st.label;
    e.dropSub.innerHTML = st.sub || '';
    e.drop.classList.toggle('ready', !!st.ready);
    const k = Math.max(0, Math.min(1, st.timeK == null ? 1 : st.timeK));
    e.dropRing.style.setProperty('--k', (k * 100).toFixed(1) + '%');
    e.drop.classList.toggle('late', k < 0.25);
  }

  /** Where the DROP button is (cached: no forced layout every frame). */
  dropRect() {
    const d = this.el && this.el.drop;
    if (!d || d.classList.contains('hidden')) return null;
    if (!this._dropRect || this._dropRectW !== window.innerWidth || this._dropRectH !== window.innerHeight) {
      this._dropRect = d.getBoundingClientRect();
      this._dropRectW = window.innerWidth;
      this._dropRectH = window.innerHeight;
    }
    return this._dropRect;
  }

  setMuted(m) {
    if (this.el && this.el.muteBtn) this.el.muteBtn.innerHTML = icon(m ? 'mute' : 'speaker');
  }

  /** Wallet readout; `canBuy` lights the upgrade chip. */
  setMoney(v, canBuy) {
    const e = this.el;
    if (!e.walletVal) return;
    if (this.cache.money !== v) {
      this.cache.money = v;
      e.walletVal.textContent = fmtNum(v);
      e.wallet.classList.remove('bump');
      void e.wallet.offsetWidth;
      e.wallet.classList.add('bump');
    }
    if (this.cache.canBuy !== canBuy) {
      this.cache.canBuy = canBuy;
      e.upgrade.classList.toggle('hidden', !canBuy);
    }
  }

  setCameraMode(mode) {
    if (this.el.camBtn) this.el.camBtn.classList.toggle('primary', mode === 'cab');
  }
}
