// Menus and overlays: title, shift board, briefing, workshop, settings, credits, pause, results.
import { h, fmtNum, fmtTime, clamp } from '../core/util.js';
import { ZONES, GAME_VERSION } from '../config.js';
import { SHIFTS, UPGRADES, RIG_SETUPS, starThresholds } from '../game/levels.js';
import { PAINTS } from '../world/crane.js';
import { AWARDS } from '../game/awards.js';
import { icon } from './icons.js';
import { cargoChip } from './hud.js';
import { audio } from '../core/audio.js';
import { save } from '../core/save.js';
import { gfx } from '../core/gfx.js';
import { BLACK_BOXES, BLACK_ORDER, EPILOGUES, epilogue, tally, episodeFor } from '../game/story.js';
import { todayKey } from '../game/levels.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 'YYYY-MM-DD' -> '17 Nov' style label (English, to match the rest of the interface). */
function fmtDay(key, opts) {
  const [y, m, d] = key.split('-').map(Number);
  try {
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', opts);
  } catch (e) {
    return key;
  }
}

function weatherIcons(w) {
  const out = [];
  if ((w.rain || 0) > 0.45) out.push('rain');
  if ((w.snow || 0) > 0.3) out.push('snow');
  if ((w.wind || 0) > 0.6) out.push('wind');
  if ((w.sea || 0) > 0.42) out.push('wave');
  if ((w.fog || 0) > 0.02) out.push('fog');
  if ((w.storm || 0) > 0.3) out.push('bolt');
  if (!out.length) out.push('moon');
  return out;
}

function weatherPills(w) {
  const pills = [];
  const lvl = (v, a, b) => (v > b ? 'Heavy' : v > a ? 'Moderate' : 'Light');
  if ((w.rain || 0) > 0.1) pills.push(['rain', `${lvl(w.rain, 0.45, 0.8)} rain`]);
  if ((w.snow || 0) > 0.1) pills.push(['snow', `${lvl(w.snow, 0.45, 0.8)} snow`]);
  if ((w.wind || 0) > 0.15) pills.push(['wind', `Wind ${Math.round(w.wind * 9)} km/h${(w.gusts || 0) > 0.2 ? ' · gusts' : ''}`]);
  pills.push(['wave', `${(w.sea || 0) > 0.7 ? 'Heavy' : (w.sea || 0) > 0.3 ? 'Moderate' : 'Slight'} swell`]);
  if ((w.fog || 0) > 0.02) pills.push(['fog', 'Dense fog']);
  if ((w.storm || 0) > 0.3) pills.push(['bolt', 'Thunderstorm']);
  return pills;
}

export class Screens {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('screens');
    this.current = null;
    this.name = '';
    this.stack = [];
    // shared button sounds
    this.root.addEventListener('click', (e) => {
      const b = e.target.closest('.btn, .tcard, .paint, .seg button');
      if (!b || b.disabled || b.classList.contains('locked')) return;
      if (b.dataset.sound !== 'none') audio.play(b.dataset.sound || 'ui_click');
    });
    this.root.addEventListener(
      'pointerenter',
      (e) => {
        if (e.pointerType !== 'mouse') return;
        const b = e.target.closest && e.target.closest('.btn, .tcard:not(.locked)');
        if (b && b === e.target) audio.play('ui_hover');
      },
      true
    );
  }

  _mount(name, el) {
    const prev = this.current;
    if (prev) {
      prev.classList.remove('in');
      prev.style.pointerEvents = 'none';
      setTimeout(() => prev.remove(), 300);
    }
    this.current = el;
    this.name = name;
    gfx.setBackdrop(!!el && el.classList.contains('dim'));
    if (el) {
      this.root.appendChild(el);
      void el.offsetWidth;
      requestAnimationFrame(() => el.classList.add('in'));
    }
    return el;
  }

  hide() {
    this._mount('', null);
  }

  get open() {
    return !!this.current;
  }

  // ====================================================================== title

  title() {
    const app = this.app;
    const d = save.data;
    const stars = save.totalStars();
    const nextIdx = Math.min(
      SHIFTS.length - 1,
      SHIFTS.findIndex((s) => !(d.shifts[s.id] && d.shifts[s.id].stars > 0)) === -1 ? SHIFTS.length - 1 : SHIFTS.findIndex((s) => !(d.shifts[s.id] && d.shifts[s.id].stars > 0))
    );
    const next = SHIFTS[nextIdx];
    const fresh = stars === 0 && !d.flags.tutorialDone;
    const endlessOpen = app.endlessUnlocked();
    const dailyOpen = app.dailyUnlocked();
    const today = app.dailyRecord();
    const episode = d.flags.played ? episodeFor(d.story, todayKey()) : null;
    const col = h(
      'div.title-col',
      h('div', h('div.logo', h('span.logo-top', 'Night Shift'), h('span.logo-main', 'Crane')), h('div.tagline', { style: { marginTop: '1.2em' } }, 'Pier Seven · Graveyard shift')),
      h(
        'div.menu',
        // the night shift itself (endless, ship after ship) is the game; everything else hangs off it
        h('button.btn.primary.big.cta', { 'data-sound': 'ui_confirm', onclick: () => app.startEndless(), html: icon('play') + `<span class="grow">${d.flags.played ? 'Continue shift' : 'Clock in'}</span><span class="badge">${d.endless.best ? 'Best ' + fmtNum(d.endless.best) : 'Pier Seven'}</span>` }),
        h('div.weekline', { html: icon('trophy') + `<span>${app.weekLine()}</span>` }),
        episode ? h('div.episode', { html: icon('eye') + `<span><b>Tonight</b> · episode ${BLACK_ORDER.indexOf(episode) + 1} of the Pier Seven file is on its way</span>` }) : null,
        h(
          'div.menu-row.duo',
          h('button.btn' + (dailyOpen ? '.night' : ''), {
            disabled: !dailyOpen,
            onclick: () => app.startDaily(),
            html:
              icon(dailyOpen ? 'moon' : 'lock') +
              `<span class="grow"><b>Daily ship</b><small>${!dailyOpen ? 'After your first ship' : today.best ? 'Best today ' + fmtNum(today.best) : 'Same for all today'}</small></span>`,
          }),
          h('button.btn', {
            onclick: () => app.openBoard(),
            html: icon('board') + `<span class="grow"><b>Shift board</b><small>${icon('star')} ${stars}/${SHIFTS.length * 3} challenges</small></span>`,
          })
        ),
        h(
          'div.menu-row',
          h('button.btn', { onclick: () => app.openWorkshop('title'), html: icon('wrench') + '<span>Workshop</span>' }),
          h('button.btn.icon', { title: 'Logbook', onclick: () => app.openLogbook(), html: icon('trophy') }),
          h('button.btn.icon', { title: 'Settings', onclick: () => this.settings('title'), html: icon('gear') }),
          h('button.btn.icon', { title: 'Credits', onclick: () => this.credits(), html: icon('info') })
        )
      ),
      h('div.title-stats', h('span.money', { html: icon('coin') + `<span>${fmtNum(d.money)}</span>` }))
    );
    this.trackEl = h('span', '');
    const foot = h('div.title-foot', h('div', { html: icon('music') + ' ' }, this.trackEl), h('div', `v${GAME_VERSION}`));
    this._setTrack(app.nowPlaying);
    return this._mount('title', h('div.screen.shade', col, foot));
  }

  _setTrack(t) {
    if (this.trackEl) this.trackEl.innerHTML = t ? `<b>${t.title}</b> — ${t.artist}` : '';
  }

  // ====================================================================== shift board

  board() {
    const app = this.app;
    const d = save.data;
    const grid = h('div.board');
    const story = d.story || {};
    let nextFound = false;
    SHIFTS.forEach((s, i) => {
      const rec = d.shifts[s.id] || { stars: 0, best: 0 };
      const unlocked = app.shiftUnlocked(i);
      const isNext = unlocked && rec.stars === 0 && !nextFound;
      if (isNext) nextFound = true;
      const accent = ZONES[s.manifest[0].zone === 'ANY' ? 'ROT' : s.manifest[0].zone].css;
      const card = h(
        `button.tcard${unlocked ? '' : '.locked'}${isNext ? '.next' : ''}`,
        { style: { '--accent': accent }, onclick: () => unlocked && app.openBriefing(s) },
        h('div.no', String(s.n).padStart(2, '0')),
        h('div.nm', s.name),
        h('div.meta', s.clock, h('span.wx', { html: weatherIcons(s.weather).map((n) => icon(n)).join('') })),
        h('div.stars', { html: [0, 1, 2].map((k) => `<span class="${k < rec.stars ? 'on' : ''}">${icon('star')}</span>`).join('') }),
        rec.best ? h('div.best', fmtNum(rec.best)) : null,
        // corner marks: the foreman's order ticked off, and what became of that night's black box
        h(
          'div.marks',
          rec.order ? h('span.mk.order', { title: 'Foreman’s order done', html: icon('check') }) : null,
          story.boxes && story.boxes[s.id] ? h(`span.mk.box.${story.boxes[s.id]}`, { title: 'Unlisted box', html: icon('eye') }) : null
        ),
        unlocked ? null : h('div.lockico', { html: icon('lock') })
      );
      grid.appendChild(card);
    });
    const dOpen = app.dailyUnlocked();
    const today = app.dailyRecord();
    grid.appendChild(
      h(
        `button.tcard.daily${dOpen ? '' : '.locked'}`,
        { onclick: () => dOpen && app.openDailyBriefing() },
        h('div.no', { html: icon('moon') }),
        h('div.nm', 'Tonight'),
        h('div.meta', dOpen ? (today.streak ? `${today.streak} night${today.streak === 1 ? '' : 's'} worked` : 'A new shift every day') : 'Clear shift 2 to unlock'),
        dOpen ? h('div.stars', { html: [0, 1, 2].map((k) => `<span class="${k < today.stars ? 'on' : ''}">${icon('star')}</span>`).join('') }) : null,
        today.best ? h('div.best', fmtNum(today.best)) : null,
        dOpen ? null : h('div.lockico', { html: icon('lock') })
      )
    );
    const eo = app.endlessUnlocked();
    grid.appendChild(
      h(
        `button.tcard.endless${eo ? '' : '.locked'}`,
        { onclick: () => eo && app.openEndlessBriefing() },
        h('div.no', { html: icon('infinity') }),
        h('div.nm', 'Overtime'),
        h('div.meta', eo ? 'Endless · ship after ship' : 'Clear shift 3 to unlock'),
        d.endless.best ? h('div.best', 'BEST ' + fmtNum(d.endless.best)) : null,
        eo ? null : h('div.lockico', { html: icon('lock') })
      )
    );
    const card = h(
      'div.card.wide',
      h('div.card-head', h('h2', 'Shift board'), h('span.pill.star', { html: icon('star') + ` ${save.totalStars()} / ${SHIFTS.length * 3}` }), h('span.money', { html: icon('coin') + `<span>${fmtNum(d.money)}</span>` })),
      h('div.card-body', grid),
      h(
        'div.card-foot',
        h('button.btn.ghost', { 'data-sound': 'ui_back', onclick: () => app.gotoTitle(), html: icon('back') + 'Back' }),
        h('div.spacer'),
        h('button.btn', { onclick: () => app.openWorkshop('board'), html: icon('wrench') + 'Workshop' })
      )
    );
    return this._mount('board', h('div.screen.dim', card));
  }

  // ====================================================================== briefing

  briefing(level) {
    const app = this.app;
    const rec = save.shift(level.id);
    const th = starThresholds(level);
    const chips = h('div.chips');
    // (anything unlisted is, of course, not in the briefing)
    const listed = level.manifest.filter((c) => !c.black);
    for (const c of listed) chips.appendChild(cargoChip(c));
    const out = (level.preload || []).filter((p) => p.discharge);
    const checks = listed.filter((c) => c.check).length;
    const body = h(
      'div.card-body',
      h('div.brief-top', h('div.blurb', level.blurb)),
      level.feature ? h('div.feature', h('b', 'NEW · ' + level.feature.title), level.feature.text) : null,
      level.also ? h('div.feature.also', h('b', 'NEW · ' + level.also.title), level.also.text) : null,
      h('div.section-label', `Manifest · ${listed.length} to load${out.length ? ` · ${out.length} to discharge` : ''}${checks ? ` · ${checks} spot check${checks === 1 ? '' : 's'}` : ''}`),
      chips,
      h('div.section-label', 'Conditions'),
      h('div.wxrow', ...weatherPills(level.weather).map(([ic, t]) => h('span.pill', { html: icon(ic) + ' ' + t })), h('span.pill', { html: icon('clock') + ' ' + fmtTime(level.time * app.mods().timeMul) })),
      level.order
        ? h('div.section-label', 'Foreman’s order')
        : null,
      level.order
        ? h('div.goalrow', h(`span.pill.order${rec.order ? '.done' : ''}`, { html: icon(rec.order ? 'check' : 'wrench') + ' ' + level.order.text }), rec.order ? h('span.pill', 'Paid') : h('span.pill.cash', { html: icon('coin') + ' +' + fmtNum(level.order.cash) }))
        : null,
      h('div.section-label', 'Star targets'),
      h('div.goalrow', ...th.map((t, i) => h('span.goal.pill', { html: icon('star').repeat(i + 1) + ' ' + fmtNum(t) })), rec.best ? h('span.pill', `Best ${fmtNum(rec.best)}`) : null)
    );
    const card = h(
      'div.card.mid',
      h('div.card-head', h('h2', `Shift ${String(level.n).padStart(2, '0')} — ${level.name}`), h('span.tag', level.clock + ' · ' + level.ship.name)),
      body,
      h(
        'div.card-foot',
        h('button.btn.ghost', { 'data-sound': 'ui_back', onclick: () => app.openBoard(), html: icon('back') + 'Board' }),
        h('button.btn', { onclick: () => app.openWorkshop('brief:' + level.id), html: icon('wrench') + 'Workshop' }),
        h('div.spacer'),
        h('button.btn.primary', { 'data-sound': 'ui_confirm', onclick: () => app.startShift(level), html: icon('play') + 'Start shift' })
      )
    );
    return this._mount('briefing', h('div.screen.dim', card));
  }

  /** Tonight's Shift: the same generated shift for everyone today, two twists, today's record. */
  dailyBriefing(level) {
    const app = this.app;
    const rec = app.dailyRecord();
    const th = starThresholds(level);
    const chips = h('div.chips');
    for (const c of level.manifest) chips.appendChild(cargoChip(c));
    const when = fmtDay(level.date, { weekday: 'long', day: 'numeric', month: 'long' });
    const body = h(
      'div.card-body',
      h('div.brief-top', h('div.blurb', 'Every crane on the coast works this same shift today. A new one comes in at midnight — keep the run of nights going.')),
      h('div.twists', ...level.twists.map((t) => h('div.feature.twist', h('b', { html: icon(t.icon) + ' ' + t.name }), t.text))),
      h('div.section-label', `Manifest · ${level.manifest.length} to load${level.checks ? ` · ${level.checks} spot check${level.checks === 1 ? '' : 's'}` : ''}`),
      chips,
      h('div.section-label', 'Conditions'),
      h('div.wxrow', ...weatherPills(level.weather).map(([ic, t]) => h('span.pill', { html: icon(ic) + ' ' + t })), h('span.pill', { html: icon('clock') + ' ' + fmtTime(level.time * app.mods().timeMul) })),
      h('div.section-label', 'Foreman’s order'),
      h('div.goalrow', h(`span.pill.order${rec.order ? '.done' : ''}`, { html: icon(rec.order ? 'check' : 'wrench') + ' ' + level.order.text }), rec.order ? h('span.pill', 'Paid') : h('span.pill.cash', { html: icon('coin') + ' +' + fmtNum(level.order.cash) })),
      h('div.section-label', 'Star targets · today'),
      h(
        'div.goalrow',
        ...th.map((t, i) => h(`span.goal.pill${i < rec.stars ? '.got' : ''}`, { html: icon('star').repeat(i + 1) + ' ' + fmtNum(t) })),
        rec.best ? h('span.pill', `Best ${fmtNum(rec.best)}`) : null,
        h('span.pill.streak', { html: icon('moon') + ` ${rec.streak} night${rec.streak === 1 ? '' : 's'} worked` })
      )
    );
    const card = h(
      'div.card.mid',
      h('div.card-head', h('h2', 'Tonight’s shift'), h('span.tag', when + ' · ' + level.ship.name)),
      body,
      h(
        'div.card-foot',
        h('button.btn.ghost', { 'data-sound': 'ui_back', onclick: () => app.gotoTitle(), html: icon('back') + 'Back' }),
        h('button.btn', { onclick: () => app.openWorkshop('daily'), html: icon('wrench') + 'Workshop' }),
        h('div.spacer'),
        h('button.btn.primary', { 'data-sound': 'ui_confirm', onclick: () => app.startDaily(level), html: icon('play') + 'Start shift' })
      )
    );
    return this._mount('briefing', h('div.screen.dim', card));
  }

  endlessBriefing() {
    const app = this.app;
    const d = save.data.endless;
    const body = h(
      'div.card-body',
      h('div.brief-top', h('div.blurb', 'No manifest, no mercy. Ships keep coming; every full ship buys more time. Three lost boxes — or an empty clock — ends the run.')),
      h('div.feature', h('b', 'HOW IT SCORES'), 'Placement points plus a bonus for every ship you send out. Weather and cargo get meaner with each ship.'),
      h('div.section-label', 'Your record'),
      h('div.goalrow', h('span.pill', { html: icon('trophy') + ' Best ' + fmtNum(d.best || 0) }), h('span.pill', { html: icon('anchor') + ` Most ships ${d.bestShips || 0}` }), h('span.pill', `Runs ${d.runs || 0}`))
    );
    const card = h(
      'div.card.mid',
      h('div.card-head', h('h2', 'Overtime'), h('span.tag', 'Endless')),
      body,
      h(
        'div.card-foot',
        h('button.btn.ghost', { 'data-sound': 'ui_back', onclick: () => app.gotoTitle(), html: icon('back') + 'Back' }),
        h('button.btn', { onclick: () => app.openWorkshop('endless'), html: icon('wrench') + 'Workshop' }),
        h('div.spacer'),
        h('button.btn.teal', { 'data-sound': 'ui_confirm', onclick: () => app.startEndless(), html: icon('play') + 'Start overtime' })
      )
    );
    return this._mount('briefing', h('div.screen.dim', card));
  }

  // ====================================================================== workshop

  workshop(from) {
    const app = this.app;
    const d = save.data;
    const moneyEl = h('span', fmtNum(d.money));
    const shop = h('div.shop');
    const paints = h('div.paints');
    const render = () => {
      moneyEl.textContent = fmtNum(d.money);
      shop.innerHTML = '';
      // the crane's setup: a free trade-off, switchable any time (steadier vs faster)
      const seg = h('div.seg.rigseg');
      for (const r of Object.values(RIG_SETUPS)) {
        seg.appendChild(
          h('button' + (d.rigSetup === r.id ? '.on' : ''), {
            onclick: () => {
              d.rigSetup = d.rigSetup === r.id ? '' : r.id;
              save.checkpoint();
              audio.play('ui_click');
              if (app.upgradesChanged) app.upgradesChanged();
              render();
            },
            html: icon(r.id === 'steady' ? 'shield' : 'bolt') + r.name.toUpperCase(),
          })
        );
      }
      shop.appendChild(h('div.up.rigrow', h('div.glyph', { html: icon('motor') }), h('div.info', h('b', 'Crane setup'), h('span', d.rigSetup === 'steady' ? 'Less swing · slower' : d.rigSetup === 'fast' ? 'Faster · more swing' : 'Standard')), seg));
      for (const u of UPGRADES) {
        const lvl = d.upgrades[u.id] || 0;
        const max = u.costs.length;
        const cost = u.costs[lvl];
        const maxed = lvl >= max;
        const pips = h('div.pips', ...u.costs.map((_, i) => h(i < lvl ? 'i.on' : 'i')));
        const btn = maxed
          ? h('button.btn.small', { disabled: true, html: icon('check') + 'Max' })
          : h('button.btn.small' + (d.money >= cost ? '.primary' : ''), {
              disabled: d.money < cost,
              'data-sound': 'none',
              onclick: () => {
                if (d.money < cost) return;
                d.money -= cost;
                d.upgrades[u.id] = lvl + 1;
                save.checkpoint(); // (paid and saved in one step)
                audio.play('ui_buy');
                if (app.upgradesChanged) app.upgradesChanged({ id: u.id, level: lvl + 1, cost });
                audio.play('ui_coin', { delay: 0.1 });
                render();
              },
              html: icon('coin') + fmtNum(cost),
            });
        shop.appendChild(h(`div.up${maxed ? '.maxed' : ''}`, h('div.glyph', { html: icon(u.icon) }), h('div.info', h('b', u.name), h('span', lvl ? u.stat(lvl) : u.desc), pips), btn));
      }
      paints.innerHTML = '';
      const stars = save.totalStars();
      for (const id in PAINTS) {
        const p = PAINTS[id];
        const open = stars >= p.cost;
        paints.appendChild(
          h(
            `button.paint${d.paint === id ? '.sel' : ''}${open ? '' : '.locked'}`,
            {
              style: { '--c': '#' + p.main.toString(16).padStart(6, '0') },
              onclick: () => {
                if (!open) return;
                d.paint = id;
                save.commit();
                app.applyPaint();
                render();
              },
            },
            h('span.dot'),
            p.name.split(' ')[1] || p.name,
            open ? null : h('small', { html: `${icon('star')} ${p.cost}` })
          )
        );
      }
    };
    render();
    const back = () => {
      if (from === 'board') app.openBoard();
      else if (from === 'endless') app.openEndlessBriefing();
      else if (from === 'daily') app.openDailyBriefing();
      else if (from && from.startsWith('brief:')) app.openBriefing(SHIFTS.find((s) => s.id === from.slice(6)));
      else if (from === 'results') app.reopenResults();
      else if (from === 'play') {
        app.screens.hide();
        app.resume();
      }
      else app.gotoTitle();
    };
    const card = h(
      'div.card.wide',
      h('div.card-head', h('h2', 'Workshop'), h('span.money', { html: icon('coin') }, moneyEl)),
      h('div.card-body', shop, h('div.section-label', 'Crane paint · earned with stars'), paints),
      h('div.card-foot', h('button.btn.ghost', { 'data-sound': 'ui_back', onclick: back, html: icon('back') + 'Back' }))
    );
    return this._mount('workshop', h('div.screen.dim', card));
  }

  // ====================================================================== settings / credits

  settings(from) {
    const app = this.app;
    const st = save.data.settings;
    const slider = (key, onInput) => {
      const el = h('input', { type: 'range', min: 0, max: 100, value: Math.round(st[key] * 100) });
      const paint = () => el.style.setProperty('--p', el.value + '%');
      paint();
      el.addEventListener('input', () => {
        st[key] = el.value / 100;
        paint();
        onInput(st[key]);
        save.commit();
      });
      el.addEventListener('change', () => audio.play('ui_tick'));
      return el;
    };
    const seg = (options, value, onPick) => {
      const wrap = h('div.seg');
      for (const [val, label] of options) {
        const b = h('button' + (val === value ? '.on' : ''), { onclick: () => {
          for (const c of wrap.children) c.classList.remove('on');
          b.classList.add('on');
          onPick(val);
          save.commit();
        } }, label);
        wrap.appendChild(b);
      }
      return wrap;
    };
    let armed = false;
    const resetBtn = h('button.btn.small.danger', {
      onclick: () => {
        if (!armed) {
          armed = true;
          resetBtn.textContent = 'Tap again to erase everything';
          return;
        }
        save.reset();
        app.applySettings();
        app.applyPaint();
        app.gotoTitle();
      },
    }, 'Reset progress');
    const body = h(
      'div.card-body',
      h('div.set-row', h('label', { html: icon('music') + ' Music' }), h('div.ctl', slider('music', (v) => audio.setVolume('music', v)))),
      h('div.set-row', h('label', { html: icon('speaker') + ' Sound' }), h('div.ctl', slider('sfx', (v) => audio.setVolume('sfx', v)))),
      h(
        'div.set-row',
        h('label', 'Graphics'),
        h('div.ctl', seg([['auto', 'Auto'], ['low', 'Low'], ['medium', 'Med'], ['high', 'High']], st.quality, (v) => {
          st.quality = v;
          app.applySettings();
        }))
      ),
      h(
        'div.set-row',
        h('label', 'Screen shake'),
        h('div.ctl', seg([[true, 'On'], [false, 'Off']], st.shake, (v) => {
          st.shake = v;
          app.applySettings();
        }))
      ),
      h(
        'div.set-row',
        h('label', 'Flashing'),
        h('div.ctl', seg([[true, 'Full'], [false, 'Reduced']], st.flashes !== false, (v) => {
          st.flashes = v;
        }))
      ),
      h(
        'div.set-row',
        h('label', 'Start view'),
        h('div.ctl', seg([[false, 'Chase'], [true, 'Cab']], st.cabDefault, (v) => {
          st.cabDefault = v;
        }))
      ),
      from === 'pause' ? null : h('div.set-row', h('label', 'Save data'), h('div.ctl', resetBtn))
    );
    const back = () => (from === 'pause' ? this.pause() : app.gotoTitle());
    const card = h('div.card', h('div.card-head', h('h2', 'Settings')), body, h('div.card-foot', h('button.btn.primary', { 'data-sound': 'ui_back', onclick: back, html: icon('check') + 'Done' })));
    return this._mount('settings', h('div.screen.dim', card));
  }

  credits() {
    const app = this.app;
    const body = h('div.card-body.credits', {
      html: `
      <h3>NIGHT SHIFT CRANE</h3>
      <p>Design, code, models, shaders and interface made for this game. Every model and texture is built procedurally — no third-party art.</p>
      <h3>MUSIC · CC0</h3>
      <p>“3 am West End” — Statusq <small>(FreePD)</small><br>“Night Life”, “City Lights” — HoliznaCC0 <small>(Free Music Archive)</small><br>“Limit 70”, “Bass Meant Jazz” — Kevin MacLeod <small>(FreePD)</small></p>
      <h3>SOUND</h3>
      <p><b>Kenney</b> — Impact, RPG, Interface, UI, Digital, Sci-Fi and Jingle packs <small>(CC0 · kenney.nl)</small></p>
      <p><b>“Oculus Audio Pack 01”</b> by Oculus VR, LLC <small>(CC BY 4.0 · developers.meta.com/vr/downloads/package/oculus-audio-pack-1 · edited: trimmed, re-pitched, layered)</small></p>
      <p><b>Wyzowl SFX Kit</b> <small>(CC0)</small></p>
      <p><b>Freesound</b> <small>(CC0)</small> — maico201, bolkmar, Northern_Monkey, qubodup, Halgrimm, EcoDTR, davidworksonline</p>
      <h3>TYPE</h3>
      <p>Bungee — David Jonathan Ross · Barlow Condensed — Jeremy Tribby · Saira Stencil One — Omnibus-Type <small>(SIL OFL 1.1)</small></p>
      <h3>TECH</h3>
      <p>three.js <small>(MIT)</small> · Rapier physics <small>(Apache 2.0)</small></p>
      <p><small>Full details in CREDITS.md. No sound in this game is synthesised.</small></p>`,
    });
    const card = h('div.card.mid', h('div.card-head', h('h2', 'Credits')), body, h('div.card-foot', h('button.btn.primary', { 'data-sound': 'ui_back', onclick: () => app.gotoTitle(), html: icon('back') + 'Back' })));
    return this._mount('credits', h('div.screen.dim', card));
  }

  // ====================================================================== logbook

  logbook() {
    const app = this.app;
    const d = save.data;
    const st = d.stats;
    const got = d.awards || {};
    const earned = AWARDS.filter((a) => got[a.id]).length;
    const stat = (k, v) => h('div.stat', h('b', v), h('span', k));
    const stats = h(
      'div.stats',
      stat('Boxes locked', fmtNum(st.placed)),
      stat('Perfect drops', fmtNum(st.perfects)),
      stat('Lost at sea', fmtNum(st.lost)),
      stat('Best combo', 'x' + (st.bestCombo || 0)),
      stat('Total pay', '$' + fmtNum(st.earned)),
      stat('Overtime best', fmtNum(d.endless.best || 0))
    );
    const list = h('div.awards');
    for (const a of AWARDS) {
      const on = !!got[a.id];
      list.appendChild(h(`div.award${on ? '.on' : ''}`, h('div.seal', { html: icon(on ? a.icon : 'lock') }), h('div.info', h('b', a.name), h('span', a.desc))));
    }
    // ---- the Pier Seven file: one entry per unlisted box, written by what the player did with it
    const story = d.story || { boxes: {} };
    const file = h('div.casefile');
    const tagText = { ship: 'SAILED', customs: 'SEIZED', sea: 'OVERBOARD', left: 'ABANDONED' };
    let known = 0;
    for (const id of BLACK_ORDER) {
      const box = BLACK_BOXES[id];
      const out = story.boxes[id];
      if (out) known++;
      const shift = SHIFTS.find((x) => x.id === id);
      file.appendChild(
        out
          ? h('div.case', h('div.no', String(box.n)), h('div', h('b', box.title, h(`span.tag.${out}`, tagText[out] || '')), h('span', (box[out] && box[out].note) || '')))
          : h('div.case.locked', h('div.no', '?'), h('div', h('b', known || box.n === 1 ? 'Not yet seen' : '· · ·'), h('span', box.n === 1 || story.boxes[BLACK_ORDER[box.n - 2]] ? 'Due on a coming night: one box arrives each night you clock in.' : 'Keep working nights.')))
      );
    }
    const end = epilogue(story);
    const t = tally(story);
    const card = h(
      'div.card.wide',
      h('div.card-head', h('h2', 'Logbook'), h('span.pill.star', { html: icon('trophy') + ` ${earned} / ${AWARDS.length}` })),
      h(
        'div.card-body',
        stats,
        h('div.section-label', `The Pier Seven file · ${t.n} / ${BLACK_ORDER.length}`),
        file,
        h('div.section-label', 'Commendations'),
        list
      ),
      h(
        'div.card-foot',
        h('button.btn.ghost', { 'data-sound': 'ui_back', onclick: () => app.gotoTitle(), html: icon('back') + 'Back' }),
        h('div.spacer'),
        end && story.ending ? h('button.btn', { onclick: () => app.openEpilogue('logbook'), html: icon('file') + 'Morning paper' }) : null
      )
    );
    return this._mount('logbook', h('div.screen.dim', card));
  }

  // ====================================================================== the morning after

  /** How the night ended: a front page, written by what the player did with the five boxes. */
  epilogue(from) {
    const app = this.app;
    const story = save.data.story || {};
    const e = EPILOGUES[story.ending] || epilogue(story) || EPILOGUES.mixed;
    const t = tally(story);
    const paper = h(
      'div.paper',
      h('div.mast', h('span', 'Morning edition'), h('b', 'Harbour Gazette'), h('span', 'Pier 7')),
      h('h2', e.head),
      h('p', e.text),
      h('div.ending', h('span', `Ending · ${e.name}`), h('span', `Sailed ${t.ship} · Seized ${t.customs} · Sea ${t.sea}`))
    );
    const back = () => (from === 'results' ? app.reopenResults() : app.openLogbook());
    const hint = h('div', { style: { color: 'var(--dim)', textAlign: 'center', maxWidth: '26em', lineHeight: '1.3' } }, 'Replay shifts 3, 6, 8, 11 and 12 and choose differently to read another front page.');
    const wrap = h('div.paper-wrap.col', paper, hint, h('button.btn.primary', { 'data-sound': 'ui_back', onclick: back, html: icon('back') + 'Back' }));
    return this._mount('epilogue', h('div.screen.dim', wrap));
  }

  // ====================================================================== pause

  pause() {
    const app = this.app;
    const touch = app.touchMode;
    const help = touch
      ? 'Drag: move the crane · let go over a slot: it lands · tap: lock on / release · the hoist works by itself'
      : 'Mouse: drag to move · click to lock / release · right-drag to look · Keys: A/D W/S (or arrows) move · E/Q hoist · SPACE lock / release · C cab view';
    const tips = 'Amber-sealed boxes: lift, hold steady and read the scale. A match goes on the ship, a mismatch on the blue customs truck in lane 2.';
    const card = h(
      'div.card',
      h('div.card-head', h('h2', 'Break time'), h('span.tag', app.session && app.session.endless ? 'Overtime' : app.level && app.level.daily ? 'Tonight’s shift' : app.level ? `Shift ${app.level.n}` : '')),
      h(
        'div.card-body',
        h(
          'div.menu',
          { style: { width: '100%' } },
          h('button.btn.primary', { 'data-sound': 'ui_confirm', onclick: () => app.resume(), html: icon('play') + '<span class="grow">Back to work</span>' }),
          app.session && app.session.endless ? null : h('button.btn', { onclick: () => app.retry(), html: icon('retry') + '<span class="grow">Restart shift</span>' }),
          app.dailyUnlocked() && !(app.level && app.level.daily) ? h('button.btn.night', { onclick: () => app.startDaily(), html: icon('moon') + `<span class="grow">Daily ship</span><span class="badge">${app.dailyRecord().best ? fmtNum(app.dailyRecord().best) : 'NEW'}</span>` }) : null,
          h('button.btn', { onclick: () => this.settings('pause'), html: icon('gear') + '<span class="grow">Settings</span>' }),
          h('button.btn.ghost', { 'data-sound': 'ui_back', onclick: () => app.quitToBoard(), html: icon('home') + '<span class="grow">Clock out</span>' })
        ),
        h('div.section-label', 'Controls'),
        h('div', { style: { color: 'var(--dim)', lineHeight: '1.35' } }, help),
        app.level && app.level.checks ? h('div', { style: { color: 'var(--dim)', lineHeight: '1.35', marginTop: '0.5em' } }, tips) : null,
        app.level && app.level.order ? h('div.section-label', 'Foreman’s order') : null,
        app.level && app.level.order ? h('div', { style: { fontWeight: 700 } }, app.level.order.text) : null,
        this._tomorrow(4)
      )
    );
    return this._mount('pause', h('div.screen.dim', card));
  }

  /** "Come back tomorrow": what the next visit brings. */
  _tomorrow(max) {
    const lines = this.app.tomorrow ? this.app.tomorrow().slice(0, max) : [];
    if (!lines.length) return null;
    return h('div.tomorrow', h('b', 'Tomorrow night'), h('ul', ...lines.map((t) => h('li', t))));
  }

  // ====================================================================== results

  /**
   * @param res  session result
   * @param meta { level, payout, newStars, newBest, nextLevel, endless, bestEndless }
   */
  results(res, meta) {
    const app = this.app;
    const ok = res.success;
    const endless = meta.endless;
    const rows = [];
    const st = res.stats;
    // (rows marked optional are the first to go when a busy shift would overflow the clipboard)
    const R = (k, v, cls = '', optional = false) => {
      const el = h(`div.rrow${cls}`, h('span.k', k), h('span.dots'), h('span.v', v));
      el._optional = optional;
      rows.push(el);
    };
    if (endless) {
      R('Ships sent out', String(res.ships));
      R('Boxes placed', String(st.placed));
      R('Perfect drops', String(st.perfect));
      R('Best combo', 'x' + res.bestCombo);
      if (meta.week) R(meta.week.label, fmtNum(meta.week.best), meta.week.fresh ? '.good' : '');
      if (st.lost) R('Boxes lost', String(st.lost), '.neg');
      if (st.busted || st.smuggled) R('Customs · caught / slipped through', `${st.busted} / ${st.smuggled}`, st.smuggled ? '.neg' : '');
    } else {
      R('Boxes delivered', `${res.delivered} / ${res.quota}`);
      R('Perfect · Great · Good', `${st.perfect} · ${st.great} · ${st.good}`);
      if (st.sloppy) R('Left unsecured', String(st.sloppy), '.neg');
      R('Soft landings', String(st.soft), '', true);
      R('Best combo', 'x' + res.bestCombo, '', true);
      if (ok) R('Time bonus', '+' + fmtNum(st.timeBonus));
      if (st.lost) R('Boxes lost', String(st.lost), '.neg');
      if (st.rough) R('Rough handling', String(st.rough), '.neg', true);
      if (st.busted) R('Caught at the scale', String(st.busted), '', !!st.smuggled);
      if (st.falseAlarm) R('False alarms', String(st.falseAlarm), '.neg', true);
      if (st.smuggled) R('Mis-declared boxes shipped', `${st.smuggled} · customs found ${st.smuggled === 1 ? 'it' : 'them'}`, '.neg');
      if (meta.order) R('Foreman’s order', meta.order.done ? (meta.order.cash ? 'Done · +$' + fmtNum(meta.order.cash) : 'Done') : 'Missed', meta.order.done ? '.good' : '.neg');
      if (meta.level.daily && ok) {
        const rec = this.app.dailyRecord();
        R('Nights worked', String(rec.streak), '.good');
      }
      if (res.black) R('Unlisted box', { ship: 'Sailed with the ship', customs: 'Handed to customs', sea: 'Lost overboard', left: 'Left on the quay' }[res.black] || '—', '.hush');
    }
    for (let i = rows.length - 1; i >= 0 && rows.length > 9; i--) if (rows[i]._optional) rows.splice(i, 1);
    const totalV = h('span.v', '0');
    rows.push(h('div.rrow.total', h('span.k', 'Score'), h('span.dots'), totalV));
    if (meta.hush) rows.push(h('div.rrow.hush', h('span.k', 'Envelope in your locker'), h('span.dots'), h('span.v', '+$' + fmtNum(meta.hush))));
    const payV = h('span.v', '$0');
    rows.push(h('div.rrow.pay', h('span.k', 'Pay'), h('span.dots'), payV));
    const stars = [0, 1, 2].map(() => h('div.star', { html: `<svg viewBox="0 0 24 24"><path d="M12 1.8l3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.6 5.700 21.200l1.500-7.100L1.800 9.200 9 8.400z"/></svg>` }));
    const failText = { strikes: 'Too many boxes lost — the foreman pulled you off the crane.', time: endless ? 'The clock ran out.' : 'The ship sailed before the manifest was loaded.', complete: 'Not enough of the manifest made it on board.' };
    const title = endless ? 'Overtime slip' : ok ? 'Shift report' : 'Incident report';
    const mark = h(`div.stampmark${ok || endless ? '' : '.bad'}`, endless ? (meta.newBest ? 'NEW RECORD' : 'PAID') : ok ? (res.stars >= 3 ? 'FLAWLESS' : 'APPROVED') : 'REJECTED');
    const report = h(
      'div.report',
      h('h2', title),
      h('div.sub', h('span', endless ? `${res.ships} ship${res.ships === 1 ? '' : 's'} · ${fmtTime(res.time)}` : meta.level.daily ? `Tonight · ${fmtDay(meta.level.date, { day: 'numeric', month: 'short' })}` : `Shift ${String(meta.level.n).padStart(2, '0')} · ${meta.level.name}`), h('span', endless ? 'Pier 7' : meta.level.ship.name)),
      endless ? null : h('div.stars', ...stars),
      !ok && !endless ? h('div', { style: { fontWeight: 700, margin: '0 0 0.4em', lineHeight: '1.25' } }, failText[res.reason] || '') : null,
      h('div.rows', ...rows),
      h('div.stampzone', meta.newBest && !endless ? h('div.newbest', 'New best') : null, mark),
      endless ? this._tomorrow(3) : null
    );
    const actions = h('div.report-actions');
    const add = (cls, label, ic, fn, sound) => actions.appendChild(h('button.btn' + cls, { onclick: fn, 'data-sound': sound || 'ui_click', html: icon(ic) + label }));
    if (endless) {
      add('.teal', 'Again', 'retry', () => app.startEndless(true), 'ui_confirm');
      add('', 'Workshop', 'wrench', () => app.openWorkshop('results'));
      add('.ghost', 'Clock out', 'home', () => app.quitToBoard(), 'ui_back');
    } else if (ok) {
      if (meta.ending) add('.primary', 'Morning paper', 'file', () => app.openEpilogue('results'), 'ui_confirm');
      if (meta.nextLevel) add('.primary', 'Next shift', 'next', () => app.openBriefing(meta.nextLevel, true), 'ui_confirm');
      else if (!meta.level.daily && app.endlessUnlocked()) add('.teal', 'Overtime', 'infinity', () => app.openEndlessBriefing());
      if (meta.level.daily) {
        // a line to paste into a group chat: today's date, stars, score, the run of nights
        const shareBtn = add('', 'Share', 'file', () => {
          const rec = app.dailyRecord();
          const text = `Night Shift Crane · Tonight ${fmtDay(meta.level.date, { day: 'numeric', month: 'short' })}\n${'★'.repeat(res.stars)}${'☆'.repeat(3 - res.stars)} ${fmtNum(res.score)} · ${meta.level.twists.map((t) => t.name).join(' + ')}${rec.streak > 1 ? ` · ${rec.streak} nights worked` : ''}`;
          // (toasts sit under the report, so the button itself confirms)
          const done = () => {
            shareBtn.innerHTML = icon('check') + 'Copied';
            shareBtn.classList.add('teal');
          };
          const fallback = () => {
            const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            try {
              document.execCommand('copy');
              done();
            } catch (e) {}
            ta.remove();
          };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
          else fallback();
        });
      }
      add('', 'Retry', 'retry', () => app.retry());
      add('', 'Workshop', 'wrench', () => app.openWorkshop('results'));
      add('.ghost.icon', '', 'home', () => app.quitToBoard(), 'ui_back');
    } else {
      if (res.canContinue) {
        const ads = app.adsAvailable();
        const lbl = (res.reason === 'time' ? 'Second chance +50s' : 'Second chance') + (ads ? '' : ' · free');
        actions.appendChild(h('button.btn.teal', { onclick: () => app.rewardedContinue(), 'data-sound': 'ui_confirm', html: icon(ads ? 'ad' : 'play') + lbl }));
      }
      add('.primary', 'Retry', 'retry', () => app.retry(), 'ui_confirm');
      add('', 'Workshop', 'wrench', () => app.openWorkshop('results'));
      add('.ghost.icon', '', 'home', () => app.quitToBoard(), 'ui_back');
    }
    const el = this._mount('results', h('div.screen.dim', h('div.results-wrap.col', report, actions)));
    for (const b of actions.children) b.disabled = true;

    // ---- the reveal: rows tick in, stars get stamped, the total counts up (tap to hurry it along)
    const token = (this._resToken = (this._resToken || 0) + 1);
    const alive = () => this._resToken === token && this.current === el;
    let fast = false;
    const hurry = () => {
      fast = true;
    };
    el.addEventListener('pointerdown', hurry);
    const wait = (ms) => new Promise((r) => setTimeout(r, fast ? 0 : ms));
    (async () => {
      await wait(420);
      for (let i = 0; i < rows.length - 2; i++) {
        if (!alive()) return;
        rows[i].classList.add('in');
        audio.play('ui_tick', { rate: 1 + i * 0.04 });
        await wait(110);
      }
      if (!alive()) return;
      rows[rows.length - 2].classList.add('in');
      audio.play('ui_count');
      await new Promise((resolve) => {
        const t0 = performance.now();
        const dur = 800;
        const step = () => {
          if (!alive()) return resolve();
          const k = fast ? 1 : clamp((performance.now() - t0) / dur, 0, 1);
          totalV.textContent = fmtNum(res.score * (1 - Math.pow(1 - k, 3)));
          if (k < 1) requestAnimationFrame(step);
          else resolve();
        };
        step();
      });
      if (!endless) {
        for (let i = 0; i < res.stars; i++) {
          if (!alive()) return;
          await wait(i === 0 ? 150 : 330);
          stars[i].classList.add('on');
          audio.play('ui_stamp', { rate: 0.9 + i * 0.08 });
          audio.play('ui_star', { rate: [1, 1.26, 1.5][i], vol: 0.8 });
          app.shake(0.18 + i * 0.07);
        }
      }
      await wait(320);
      if (!alive()) return;
      rows[rows.length - 1].classList.add('in');
      payV.textContent = '$' + fmtNum(meta.payout);
      if (meta.payout > 0) audio.play('ui_cash');
      await wait(380);
      if (!alive()) return;
      mark.classList.add('in');
      audio.play('ui_stamp', { rate: 0.8 });
      app.shake(0.22);
      if (ok && res.stars >= 3) app.celebrate();
      el.removeEventListener('pointerdown', hurry);
      for (const b of actions.children) b.disabled = false;
    })();
    return el;
  }
}
