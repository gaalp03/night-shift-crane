// Shift (level) definitions, the endless "Overtime" generator and upgrade catalogue.
import { CARGO_TYPES, SCORE } from '../config.js';
import { makeRng } from '../core/util.js';
import { SHIP_NAMES } from '../world/ship.js';

const C = (zone, type = 'std') => ({ zone, type });
/** Spot-check box (amber customs seal). `bad` = the weight will not match its papers. */
const K = (zone, bad = false, type = 'std') => ({ zone, type, check: true, contra: !!bad });
/** An unlisted black box: not on the manifest, not part of the quota. */
const B = () => ({ zone: 'ANY', type: 'black', black: true });
/** A forty-footer: spans two neighbouring bays that must stand at the same height. */
const L = (zone = 'ANY') => ({ zone, type: 'long' });
const rep = (n, zone, type) => Array.from({ length: n }, () => C(zone, type));

/**
 * weather: rain 0..1, wind = acceleration on a standard box (m/s²), gusts 0..1, fog = FogExp2 density,
 * storm 0..1 (lightning), sea 0..1 (swell).
 * zones: one entry per bay (string) or per bay an array per row.
 * preload: [{ r, b, n, zone, type, discharge }]
 */
export const SHIFTS = [
  {
    id: 's01',
    name: 'First Night',
    clock: '22:00',
    blurb: 'Four boxes, flat water, a storm somewhere out at sea. Learn the ropes.',
    ship: { rows: 3, bays: 2, tiers: 2, style: 0, name: 'MV KESTREL', zones: ['ANY', 'ANY'] },
    manifest: rep(4, 'ANY'),
    time: 300,
    weather: { rain: 0.55, wind: 0.2, gusts: 0, fog: 0.011, sea: 0.1, clouds: 0.85, storm: 0.34 },
    tutorial: true,
    tour: true,
    start: { x: 0.5, z: 6 },
  },
  {
    id: 's02',
    name: 'Sort It Out',
    clock: '22:40',
    blurb: 'Colour-coded cargo, and the weather has turned: gusts off the estuary.',
    feature: { title: 'DESTINATION BAYS', text: 'Each container has a port code. Set it down in a bay painted with the same code for the zone bonus.' },
    also: { title: 'WIND GUSTS', text: 'Wind drags the hanging load. A warning flashes just before each gust — carry low and let it settle.' },
    ship: { rows: 3, bays: 2, tiers: 2, style: 0, name: 'MV MARIGOLD', zones: ['ROT', 'SIN'] },
    manifest: [C('ROT'), C('SIN'), C('ROT'), C('SIN'), C('SIN'), C('ROT')],
    time: 330,
    weather: { rain: 0.75, wind: 0.95, windDir: 0.25, gusts: 0.5, fog: 0.0115, sea: 0.24, clouds: 0.9, storm: 0.4 },
  },
  {
    id: 's03',
    name: 'No Papers',
    clock: '23:15',
    blurb: 'Customs are spot-checking on the quay, the swell is up — and something is coming that is not on the list.',
    also: { title: 'CUSTOMS ON THE QUAY', text: 'Amber-sealed boxes must be weighed. Lift, hold steady, read the scale.' },
    feature: { title: 'SWELL', text: 'The ship heaves and rolls. Wait for the deck to come up to the box, then release.' },
    ship: { rows: 3, bays: 3, tiers: 2, style: 1, name: 'MV NORDLYS', zones: ['ROT', 'NYC', 'SIN'] },
    preload: [{ r: 0, b: 0, n: 1, zone: 'ROT' }, { r: 2, b: 2, n: 1, zone: 'SIN' }],
    manifest: [C('NYC'), C('ROT'), K('SIN', true), C('NYC'), C('ROT'), K('SIN'), C('NYC')],
    time: 410,
    weather: { rain: 0.65, wind: 0.65, windDir: 1.2, gusts: 0.35, fog: 0.012, sea: 0.4, clouds: 0.8 },
  },
  {
    id: 's04',
    name: 'Crosswind',
    clock: '23:50',
    blurb: 'A full gale off the estuary, and the substation is groaning. Watch the windsock.',
    feature: { title: 'POWER CUTS', text: 'When the quay goes dark you still have the battery lamp on the trolley — slow down and trust the reticle.' },
    ship: { rows: 3, bays: 3, tiers: 3, style: 2, name: 'MV OSPREY', zones: ['SIN', 'SIN', 'ROT'] },
    preload: [{ r: 1, b: 0, n: 2, zone: 'SIN' }, { r: 0, b: 2, n: 1, zone: 'ROT' }, { r: 2, b: 1, n: 1, zone: 'SIN' }],
    manifest: [C('ROT'), C('SIN'), K('SIN'), C('ROT'), C('SIN'), K('ROT', true), C('SIN'), C('ROT')],
    time: 390,
    events: [{ type: 'blackout', at: 70, dur: 16 }],
    weather: { rain: 0.5, wind: 1.4, windDir: 0.25, gusts: 0.7, fog: 0.0115, sea: 0.3, clouds: 0.8 },
  },
  {
    id: 's05',
    name: 'Heavy Metal',
    clock: '00:30',
    blurb: 'Thirty-tonners on the manifest. Heavy boxes go at the bottom.',
    feature: { title: 'HEAVY CARGO', text: 'Striped HEAVY boxes must sit on the deck or on another heavy box — twist-locks will not hold them on a light one. Uneven loading makes the ship list.' },
    ship: { rows: 4, bays: 2, tiers: 3, style: 1, name: 'MV IRON LILY', zones: ['NYC', 'OSL'] },
    manifest: [C('NYC', 'heavy'), K('OSL', true), C('OSL', 'heavy'), C('NYC'), C('NYC', 'heavy'), C('OSL'), K('NYC'), C('OSL', 'heavy')],
    time: 380,
    weather: { rain: 0.35, wind: 0.7, windDir: 2.6, gusts: 0.3, fog: 0.0115, sea: 0.25 },
  },
  {
    id: 's06',
    name: 'Handle With Care',
    clock: '01:10',
    blurb: 'Glassware for the galleries. No bumps, no drops.',
    feature: { title: 'FRAGILE', text: 'White FRAGILE panels mean glass inside. Any real knock shatters it — creep in and land soft.' },
    ship: { rows: 3, bays: 3, tiers: 2, style: 3, name: 'MV HALCYON', zones: ['ROT', 'ROT', 'NYC'] },
    preload: [{ r: 1, b: 1, n: 1, zone: 'ROT' }],
    manifest: [C('ROT'), C('NYC', 'fragile'), C('ROT', 'fragile'), K('NYC', true), C('ROT'), C('NYC', 'fragile'), C('ROT'), C('NYC')],
    time: 410,
    weather: { rain: 0.7, wind: 0.55, windDir: 0.6, gusts: 0.25, fog: 0.0125, sea: 0.3, clouds: 0.8 },
  },
  {
    id: 's07',
    name: 'Rolling Deck',
    clock: '01:50',
    blurb: 'Long swell from a passing storm. Stacks get lively above the second tier.',
    ship: { rows: 3, bays: 3, tiers: 3, style: 4, name: 'MV TIDEWATER', zones: ['OSL', 'SIN', 'ROT'] },
    preload: [{ r: 0, b: 0, n: 2, zone: 'OSL' }, { r: 2, b: 2, n: 2, zone: 'ROT' }, { r: 1, b: 1, n: 1, zone: 'SIN' }],
    manifest: [K('SIN', true), C('OSL'), C('ROT', 'heavy'), C('SIN'), C('OSL'), K('ROT'), C('SIN', 'fragile'), C('OSL'), C('ROT')],
    time: 410,
    events: [{ type: 'blackout', at: 75, dur: 20, deep: true }],
    weather: { rain: 0.5, wind: 0.8, windDir: 1.9, gusts: 0.4, fog: 0.012, sea: 0.62, clouds: 0.8 },
  },
  {
    id: 's08',
    name: 'Cold Chain',
    clock: '02:30',
    blurb: 'Reefers are thawing on the trucks. Get them plugged in fast.',
    feature: { title: 'REEFERS', text: 'Refrigerated boxes lose freshness from the moment the truck parks. The faster they are locked on board, the bigger the bonus.' },
    ship: { rows: 4, bays: 2, tiers: 3, style: 0, name: 'MV BOREALIS', zones: ['SIN', 'NYC'] },
    preload: [{ r: 0, b: 0, n: 1, zone: 'SIN' }, { r: 3, b: 1, n: 1, zone: 'NYC' }],
    manifest: [C('SIN', 'reefer'), C('NYC'), C('NYC', 'reefer'), K('SIN'), C('SIN', 'heavy'), C('NYC', 'reefer'), K('SIN', true), C('NYC'), C('SIN', 'reefer')],
    time: 440,
    weather: { rain: 0.4, wind: 1.0, windDir: 3.5, gusts: 0.45, fog: 0.012, sea: 0.35 },
  },
  {
    id: 's09',
    name: 'Fog Bank',
    clock: '03:10',
    blurb: 'You can barely see the deck — and the first forty-footers are on the list.',
    feature: { title: 'FORTY-FOOTERS', text: 'Long boxes span two bays. Both columns underneath must stand at the same height, so plan where the short ones go. In the fog, the reticle and the cab view (C) are your eyes.' },
    ship: { rows: 3, bays: 3, tiers: 3, style: 2, name: 'MV LANTERN', zones: ['NYC', 'OSL', 'OSL'] },
    preload: [{ r: 0, b: 0, n: 2, zone: 'NYC' }, { r: 2, b: 0, n: 1, zone: 'NYC' }, { r: 1, b: 1, n: 1, zone: 'OSL' }, { r: 1, b: 2, n: 1, zone: 'OSL' }],
    manifest: [C('NYC'), L('OSL'), K('NYC', true), C('NYC', 'fragile'), C('OSL'), L('OSL'), K('NYC'), C('NYC'), C('OSL')],
    time: 450,
    events: [{ type: 'blackout', at: 95, dur: 24, deep: true }],
    weather: { rain: 0.15, wind: 0.3, gusts: 0, fog: 0.034, sea: 0.2, clouds: 1 },
  },
  {
    id: 's10',
    name: 'Turnaround',
    clock: '03:50',
    blurb: 'Three boxes come off before the new cargo goes on.',
    feature: { title: 'DISCHARGE', text: 'Boxes tagged with a teal arrow must leave the ship: lock onto them and set them on the empty trucks in Lane 2.' },
    ship: { rows: 3, bays: 3, tiers: 3, style: 3, name: 'MV PELICAN', zones: ['ROT', 'OSL', 'OSL'] },
    preload: [
      { r: 0, b: 0, n: 1, zone: 'ROT' },
      { r: 0, b: 0, n: 1, zone: 'NYC', discharge: true },
      { r: 2, b: 1, n: 1, zone: 'NYC', discharge: true },
      { r: 1, b: 2, n: 1, zone: 'OSL' },
      { r: 1, b: 2, n: 1, zone: 'NYC', discharge: true },
    ],
    manifest: [C('ROT'), C('OSL'), C('OSL', 'heavy'), C('ROT'), C('OSL'), C('ROT', 'fragile'), C('OSL')],
    time: 420,
    weather: { rain: 0.5, wind: 0.9, windDir: 0.9, gusts: 0.4, fog: 0.0125, sea: 0.4 },
  },
  {
    id: 's11',
    name: 'Dangerous Goods',
    clock: '04:30',
    blurb: 'Hazmat on the list. Keep them apart and do not, under any circumstances, drop one.',
    feature: { title: 'HAZMAT', text: 'Placarded boxes may not touch each other — not side by side, not stacked. Hit one hard and it goes up, taking its neighbours with it.' },
    ship: { rows: 4, bays: 3, tiers: 3, style: 1, name: 'MV SALT WIND', zones: ['SIN', 'ROT', 'NYC'] },
    preload: [{ r: 1, b: 0, n: 1, zone: 'SIN' }, { r: 2, b: 2, n: 2, zone: 'NYC' }, { r: 0, b: 1, n: 1, zone: 'ROT' }],
    manifest: [C('ROT', 'hazmat'), C('SIN'), C('NYC'), K('ROT', true), C('SIN', 'hazmat'), C('NYC', 'heavy'), C('ROT', 'hazmat'), C('SIN', 'reefer'), K('NYC'), C('ROT')],
    time: 490,
    weather: { rain: 0.65, wind: 1.1, windDir: 5.2, gusts: 0.5, fog: 0.013, sea: 0.45, clouds: 0.85 },
  },
  {
    id: 's12',
    name: 'The Storm',
    clock: '05:10',
    blurb: 'Everything at once. Last ship before dawn — bring it home.',
    ship: { rows: 4, bays: 3, tiers: 3, style: 4, name: 'MV LOW TIDE', zones: ['OSL', 'ROT', 'SIN'] },
    preload: [{ r: 0, b: 0, n: 2, zone: 'OSL' }, { r: 3, b: 2, n: 2, zone: 'SIN' }, { r: 1, b: 1, n: 1, zone: 'ROT' }, { r: 2, b: 1, n: 1, zone: 'ROT' }],
    manifest: [C('ROT'), C('OSL', 'heavy'), C('SIN', 'reefer'), C('ROT', 'heavy'), K('OSL', true), C('SIN', 'hazmat'), C('ROT', 'fragile'), C('OSL', 'reefer'), C('SIN'), C('ROT'), C('OSL', 'fragile')],
    time: 530,
    events: [{ type: 'blackout', at: 150, dur: 26, deep: true }],
    weather: { rain: 1, wind: 1.7, windDir: 0.35, gusts: 0.9, fog: 0.016, sea: 0.95, storm: 1, clouds: 1 },
    music: 'storm',
  },
];

/**
 * Foreman's orders: one side job per shift, paid once in cash. `test` gets the shift result
 * (only asked when the shift was completed).
 */
const ORDERS = {
  s02: { text: 'Three PERFECT set-downs', cash: 120, test: (r) => r.stats.perfect >= 3 },
  s03: { text: 'Catch the mis-declared box at the scale', cash: 150, test: (r) => r.stats.busted >= 1 && !r.stats.smuggled },
  s04: { text: 'No rough handling, no lost boxes', cash: 170, test: (r) => r.stats.rough === 0 && r.stats.lost === 0 },
  s05: { text: 'Lose nothing and ship nothing mis-declared', cash: 190, test: (r) => r.stats.lost === 0 && !r.stats.smuggled },
  s06: { text: 'Five soft landings', cash: 210, test: (r) => r.stats.soft >= 5 },
  s07: { text: 'Build a x5 combo', cash: 230, test: (r) => r.bestCombo >= 5 },
  s08: { text: 'Clock out with 90 seconds to spare', cash: 250, test: (r) => r.timeLeft >= 90 },
  s09: { text: 'No false alarms, nothing smuggled', cash: 270, test: (r) => !r.stats.falseAlarm && !r.stats.smuggled },
  s10: { text: 'Six PERFECT set-downs', cash: 290, test: (r) => r.stats.perfect >= 6 },
  s11: { text: 'Not a single strike', cash: 330, test: (r) => r.strikes === 0 },
  s12: { text: 'Home with 60 seconds left and no strikes', cash: 420, test: (r) => r.timeLeft >= 60 && r.strikes === 0 },
};

SHIFTS.forEach((s, i) => {
  s.n = i + 1;
  s.order = ORDERS[s.id] || null;
  s.strikes = 3;
  s.quota = s.quota || s.manifest.filter((c) => !c.black).length + (s.preload || []).filter((p) => p.discharge).length;
  s.checks = s.manifest.filter((c) => c.check).length;
  s.hasBlack = s.manifest.some((c) => c.black);
});

/** Theoretical clean-run score used for the star thresholds. */
export function parScore(level) {
  let base = 0;
  const zoned = level.ship.zones.some((z) => z !== 'ANY');
  for (const c of level.manifest) {
    if (c.black) continue;
    base += SCORE.great + SCORE.soft * 0.5 + (zoned ? SCORE.zone : 0) + SCORE.speedMax * (c.check ? 0.3 : 0.55) + (CARGO_TYPES[c.type] || CARGO_TYPES.std).value * 0.8;
    // a mis-declared box caught at the scale is worth more at customs than a zone bonus on board
    if (c.check && c.contra) base += SCORE.busted * 0.9 - (zoned ? SCORE.zone : 0);
  }
  for (const p of level.preload || []) if (p.discharge) base += SCORE.great + SCORE.speedMax * 0.5;
  // a tidy run finishes with a little under half the clock left (2 points per second)
  return Math.round(base * 1.12 + (level.time || 0) * 0.45 * 2);
}

export function starThresholds(level) {
  const par = parScore(level);
  return [Math.round(par * 0.42), Math.round(par * 0.72), Math.round(par * 1.06)];
}

export function starsFor(level, score) {
  const t = starThresholds(level);
  return score >= t[2] ? 3 : score >= t[1] ? 2 : score >= t[0] ? 1 : 0;
}

export function zoneFn(zones) {
  return (r, b) => {
    const z = zones[b];
    return Array.isArray(z) ? z[r] || 'ANY' : z || 'ANY';
  };
}

// -------------------------------------------------------------------------- Overtime (endless)

const ENDLESS_WEATHER = [
  { rain: 0.55, wind: 0.6, gusts: 0.3, fog: 0.0115, sea: 0.2, clouds: 0.8, storm: 0.35 },
  { rain: 0.6, wind: 0.8, gusts: 0.3, fog: 0.012, sea: 0.3, windDir: 0.4 },
  { rain: 0.4, wind: 1.2, gusts: 0.6, fog: 0.012, sea: 0.4, windDir: 2.4 },
  { rain: 0.2, wind: 0.4, gusts: 0.1, fog: 0.03, sea: 0.25 },
  { rain: 0.8, wind: 1.4, gusts: 0.7, fog: 0.014, sea: 0.65, windDir: 5.0 },
  { rain: 1, wind: 1.8, gusts: 0.9, fog: 0.016, sea: 0.95, storm: 1, windDir: 0.3 },
];

/** Definition for the n-th ship (0-based) of an Overtime run. */
export function endlessShip(n, seed) {
  const rng = makeRng(seed + n * 7919);
  const zonesAll = ['ROT', 'SIN', 'NYC', 'OSL'];
  rng.shuffle(zonesAll);
  const rows = n < 2 ? 3 : rng.chance(0.5) ? 4 : 3;
  const bays = n < 1 ? 2 : rng.chance(0.6) ? 3 : 2;
  const zones = [];
  for (let b = 0; b < bays; b++) zones.push(zonesAll[b % Math.min(zonesAll.length, 2 + Math.min(1, Math.floor(n / 2)))]);
  // a round is one ship: 4-6 boxes in 60-90 seconds
  const count = n < 2 ? 4 : Math.min(6, 4 + Math.floor((n + rng.int(0, 2)) / 3));
  const pool = ['std', 'std', 'std'];
  if (n >= 1) pool.push('heavy');
  if (n >= 2) pool.push('fragile');
  if (n >= 3) pool.push('reefer');
  if (n >= 4) pool.push('hazmat');
  const manifest = [];
  let haz = 0;
  for (let i = 0; i < count; i++) {
    let type = rng.pick(pool);
    if (type === 'hazmat' && ++haz > 2) type = 'std';
    const spec = C(rng.pick(zones), type);
    if (n >= 3 && bays >= 2 && type === 'std' && i < 4 && rng.chance(0.35)) {
      spec.type = 'long';
      spec.zone = 'ANY';
    } else if (n >= 1 && type === 'std' && rng.chance(0.24)) {
      spec.check = true;
      spec.contra = rng.chance(0.55);
    }
    manifest.push(spec);
  }
  // a new kind of decision on each of the first ships, guaranteed (not left to chance):
  //  ship 2: a heavy box (deck only) and a spot check that fails the scale (ship it, or customs?)
  //  ship 3: a fragile box, and an outbound box to take off first (unload order)
  //  ship 4: a forty-footer (needs two level columns) among blocked slots
  if (n === 1) {
    if (!manifest.some((m) => m.type === 'heavy')) manifest[0].type = 'heavy';
    const std = manifest.find((m) => m.type === 'std' && !m.check) || manifest[manifest.length - 1];
    std.type = 'std';
    std.check = true;
    std.contra = true;
  }
  if (n === 2 && !manifest.some((m) => m.type === 'fragile')) manifest[manifest.length - 1].type = 'fragile';
  if (n === 3 && bays >= 2 && !manifest.some((m) => m.type === 'long')) {
    const m = manifest.find((x) => x.type === 'std' && !x.check) || manifest[0];
    m.type = 'long';
    m.zone = 'ANY';
    m.check = false;
  }
  // preloads: distinct cells, so level pairs and deck space survive for what is coming
  const preload = [];
  const pre = Math.min(4, Math.floor(n / 2) + (n > 0 ? 1 : 0));
  const taken = new Set();
  for (let i = 0; i < pre; i++) {
    const b = rng.int(0, bays - 1);
    const r = rng.int(0, rows - 1);
    if (taken.has(r + ':' + b)) continue;
    taken.add(r + ':' + b);
    preload.push({ r, b, n: 1, zone: zones[b] });
  }
  // ship 3: something to take off before loading (it sits on a deck cell the new cargo wants)
  if (n === 2) {
    const b = 0;
    let r = 0;
    while (r < rows - 1 && taken.has(r + ':' + b)) r++;
    if (!taken.has(r + ':' + b)) {
      taken.add(r + ':' + b);
      preload.push({ r, b, n: 1, zone: zones[b], discharge: true });
    }
  }
  // forty-footers need level pairs: keep at least two rows free of preloads (one may go to a heavy box)
  if (manifest.some((m) => m.type === 'long')) {
    const clean = () => [...Array(rows).keys()].filter((r) => !preload.some((p) => p.r === r));
    while (clean().length < Math.min(2, rows)) {
      const used = [...new Set(preload.map((p) => p.r))];
      const r0 = used[rng.int(0, used.length - 1)];
      for (let i = preload.length - 1; i >= 0; i--) if (preload[i].r === r0) preload.splice(i, 1);
    }
  }
  // --- make the list stowable, like a real stow plan:
  // heavy boxes first (they need the deck), then forty-footers (they need level pairs), the rest after
  const deck = {};
  zones.forEach((z, b) => (deck[z] = (deck[z] || 0) + rows - preload.filter((p) => p.b === b).length));
  const hasLong = manifest.some((m) => m.type === 'long');
  let heavyLeft = hasLong ? 1 : Infinity;
  let hb = 0;
  for (const m of manifest) {
    if (m.type !== 'heavy') continue;
    // spread across bays, and never more thirty-tonners than a port has deck cells for
    const z = zones[hb++ % bays];
    if (heavyLeft-- <= 0 || deck[z] <= 0) {
      m.type = 'std';
      continue;
    }
    m.zone = z;
    deck[z]--;
  }
  const room = {};
  zones.forEach((z) => (room[z] = (room[z] || 0) + rows * 3));
  for (const p of preload) room[p.zone]--;
  // forty-footers take cells from two bays each: count them against every port
  const longs = manifest.filter((m) => m.type === 'long').length;
  for (const z in room) room[z] -= 1 + longs;
  for (const m of manifest) {
    if (m.zone === 'ANY') continue;
    if (room[m.zone] <= 0) m.zone = Object.keys(room).sort((a, b) => room[b] - room[a])[0];
    room[m.zone]--;
  }
  const rank = (m) => (m.type === 'heavy' ? 0 : m.type === 'long' ? 1 : 2);
  manifest.sort((a, b) => rank(a) - rank(b));
  // weather turns slowly: a new stage every two ships, the storm not before the eleventh
  const stage = Math.floor(n / 2);
  const w = ENDLESS_WEATHER[Math.min(ENDLESS_WEATHER.length - 1, stage)];
  const cycle = stage >= ENDLESS_WEATHER.length ? ENDLESS_WEATHER[2 + ((n * 3) % 4)] : w;
  return {
    id: 'endless',
    endless: true,
    n: n + 1,
    name: 'Overtime',
    ship: { rows, bays, tiers: 3, style: n % 5, name: SHIP_NAMES[(n * 5 + 3) % SHIP_NAMES.length], zones },
    manifest,
    preload,
    time: 0,
    // (the first two ships give a newcomer room to learn; after that it is 60-90 seconds a ship)
    roundTime: n < 2 ? 44 + count * 11 : 36 + count * 9,
    bonusTime: 40 + count * 21,
    weather: stage >= ENDLESS_WEATHER.length ? cycle : w,
    strikes: 3,
    quota: count,
  };
}

// -------------------------------------------------------------------------- Tonight's Shift (daily)

/** Local calendar date as YYYY-MM-DD (the daily shift turns over at the player's midnight). */
export function todayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** This week's key: the local date of its Monday. */
export function weekKey(d = new Date()) {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return todayKey(m);
}

/** Whole days left in this week, today included (Monday = 7, Sunday = 1). */
export function weekDaysLeft(d = new Date()) {
  return 7 - ((d.getDay() + 6) % 7);
}

export function dayBefore(key) {
  const [y, m, d] = key.split('-').map(Number);
  return todayKey(new Date(y, m - 1, d - 1));
}

function hashKey(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Twists: each night gets two. `kind` keeps the pair sensible (one cargo twist, one sky twist at most).
 */
export const DAILY_TWISTS = [
  { id: 'gale', kind: 'sky', icon: 'wind', name: 'Gale warning', text: 'Wind far above the usual, gusting hard.', apply: (d, r) => Object.assign(d.weather, { wind: r.range(1.5, 1.85), gusts: 0.85, windDir: r.range(0, 6.28) }) },
  { id: 'fog', kind: 'sky', icon: 'fog', name: 'Pea soup', text: 'Fog so thick the ship is more rumour than vessel.', apply: (d) => Object.assign(d.weather, { fog: 0.032, clouds: 1, rain: 0.15 }) },
  { id: 'storm', kind: 'sky', icon: 'bolt', name: 'Thunderstorm', text: 'Lightning over the basin, rain in sheets.', apply: (d) => { Object.assign(d.weather, { storm: 1, rain: 1, clouds: 1, wind: Math.max(d.weather.wind, 1.1), gusts: 0.6 }); d.music = 'storm'; } },
  { id: 'snow', kind: 'sky', icon: 'snow', name: 'First snow', text: 'Snow drifting across the quay, and settling. Quiet, slow, beautiful.', apply: (d) => Object.assign(d.weather, { rain: 0, snow: 0.85, fog: 0.0125, clouds: 0.85, wind: Math.min(d.weather.wind, 0.7) }) },
  { id: 'swell', kind: 'sea', icon: 'wave', name: 'Big swell', text: 'The ship rides a long, heavy swell. Time your set-downs.', apply: (d) => { d.weather.sea = 0.85; } },
  { id: 'glass', kind: 'cargo', icon: 'glass', name: 'Gallery night', text: 'Half the manifest is glassware.', cargo: 'fragile' },
  { id: 'heavy', kind: 'cargo', icon: 'weight', name: 'Steel mill', text: 'Thirty-tonners all night. Heavy goes on the deck or on heavy.', cargo: 'heavy' },
  { id: 'cold', kind: 'cargo', icon: 'snow', name: 'Cold chain', text: 'Reefers thawing on every other truck.', cargo: 'reefer' },
  { id: 'haz', kind: 'cargo', icon: 'flame', name: 'Hot cargo', text: 'Hazmat placards. Keep them apart, keep them gentle.', cargo: 'hazmat' },
  { id: 'long', kind: 'cargo', icon: 'box', name: 'Long haul', text: 'Forty-footers on the list: each needs two level columns.', cargo: 'long' },
  { id: 'customs', kind: 'law', icon: 'scale', name: 'Customs blitz', text: 'Inspectors everywhere: lots of amber seals to weigh.', checks: 4 },
  { id: 'brownout', kind: 'power', icon: 'bolt', name: 'Brownout', text: 'The substation will trip at least once.', apply: (d, r) => d.events.push({ type: 'blackout', at: r.int(55, 110), dur: r.int(18, 26), deep: r.chance(0.5) }) },
  { id: 'rush', kind: 'clock', icon: 'clock', name: 'Tight turnaround', text: 'The ship sails early: less time on the clock.', time: 0.8 },
];

const DAILY_ORDERS = [
  { text: 'Not a single strike', cash: 220, test: (r) => r.strikes === 0 },
  { text: 'Build a x5 combo', cash: 220, test: (r) => r.bestCombo >= 5 },
  { text: 'Four PERFECT set-downs', cash: 200, test: (r) => r.stats.perfect >= 4 },
  { text: 'Clock out with 60 seconds to spare', cash: 220, test: (r) => r.timeLeft >= 60 },
  { text: 'Five soft landings', cash: 200, test: (r) => r.stats.soft >= 5 },
];

/** The same shift for everyone on the same date: one ship, two twists, a fresh manifest. */
export function dailyShift(key = todayKey()) {
  const seed = hashKey('pier7:' + key);
  const r = makeRng(seed);
  // --- two twists that make sense together
  const pool = DAILY_TWISTS.slice();
  r.shuffle(pool);
  const twists = [];
  for (const t of pool) {
    if (twists.length >= 2) break;
    if (twists.some((o) => o.kind === t.kind)) continue;
    // fog and a storm would only hide each other
    if (t.kind === 'sea' && twists.some((o) => o.id === 'storm')) continue;
    twists.push(t);
  }
  // --- ship
  const zonesAll = ['ROT', 'SIN', 'NYC', 'OSL'];
  r.shuffle(zonesAll);
  const bays = r.chance(0.65) ? 3 : 2;
  const rows = r.chance(0.5) ? 4 : 3;
  const zones = [];
  for (let b = 0; b < bays; b++) zones.push(zonesAll[b % (r.chance(0.3) ? 2 : 3)]);
  const ship = { rows, bays, tiers: 3, style: r.int(0, 4), name: SHIP_NAMES[r.int(0, SHIP_NAMES.length - 1)], zones };
  // --- weather baseline, then twists
  const def = {
    id: 'daily',
    daily: true,
    date: key,
    n: 0,
    name: "Tonight's Shift",
    clock: `${String(r.int(0, 4)).padStart(2, '0')}:${String(r.int(0, 5) * 10).padStart(2, '0')}`,
    ship,
    weather: { rain: r.range(0.2, 0.6), wind: r.range(0.3, 0.9), windDir: r.range(0, 6.28), gusts: r.range(0.1, 0.4), fog: r.range(0.0105, 0.013), sea: r.range(0.15, 0.4), clouds: r.range(0.5, 0.9) },
    events: [],
    sky: r.pick(['evening', 'night', 'night', 'predawn']),
    twists: twists.map((t) => ({ id: t.id, name: t.name, text: t.text, icon: t.icon })),
  };
  for (const t of twists) if (t.apply) t.apply(def, r);
  // --- manifest
  const count = r.int(8, 10);
  const cargoTwist = twists.find((t) => t.cargo);
  const checks = (twists.find((t) => t.checks) || {}).checks || r.int(1, 2);
  const types = [];
  const special = ['heavy', 'fragile', 'reefer'];
  for (let i = 0; i < count; i++) {
    if (cargoTwist && cargoTwist.cargo === 'long') types.push(i < 3 ? 'long' : r.chance(0.3) ? r.pick(special) : 'std');
    else if (cargoTwist && i % 2 === 0) types.push(cargoTwist.cargo);
    else types.push(r.chance(0.3) ? r.pick(special) : 'std');
  }
  if (!cargoTwist && r.chance(0.35)) types[r.int(0, types.length - 1)] = 'long';
  // forty-footers eat deck space: with them aboard, at most one thirty-tonner
  if (types.includes('long')) {
    let hv = 0;
    for (let i = 0; i < types.length; i++) if (types[i] === 'heavy' && ++hv > 1) types[i] = 'std';
  }
  // feasibility: at most two hazmat, heavy no more than the deck can carry
  let haz = 0;
  let heavy = 0;
  for (let i = 0; i < types.length; i++) {
    if (types[i] === 'hazmat' && ++haz > 2) types[i] = 'std';
    if (types[i] === 'heavy' && ++heavy > bays * 2) types[i] = 'std';
  }
  r.shuffle(types);
  // heavy boxes and forty-footers come early, like a real stow plan: they need the deck before it fills up
  const early = (t) => (t === 'heavy' ? 0 : t === 'long' ? 1 : 2);
  types.sort((a, b) => early(a) - early(b));
  if (types[0] === 'heavy' && types.length > 2) [types[0], types[1]] = [types[1], types[0]];
  const manifest = [];
  let hb = 0;
  // never more boxes for a port than its bays can hold (with a little slack for preloads)
  const room = {};
  for (const z of zones) room[z] = (room[z] || 0) + rows * 3;
  const longCount = types.filter((t) => t === 'long').length;
  for (const z in room) room[z] -= 2 + longCount;
  for (const type of types) {
    // heavy and hazmat boxes are spread across the bays so every one has somewhere legal to go
    let zone = type === 'long' ? 'ANY' : type === 'heavy' || type === 'hazmat' ? zones[hb++ % bays] : r.pick(zones);
    if (zone !== 'ANY' && room[zone] <= 0) zone = Object.keys(room).sort((a, b) => room[b] - room[a])[0];
    if (zone !== 'ANY') room[zone]--;
    manifest.push(C(zone, type));
  }
  // spot checks go on ordinary boxes
  const plain = manifest.filter((m) => m.type === 'std');
  r.shuffle(plain);
  for (let i = 0; i < Math.min(checks, plain.length); i++) {
    plain[i].check = true;
    plain[i].contra = r.chance(0.5);
  }
  def.manifest = manifest;
  // --- a little cargo already aboard (at most one per bay, never heavy)
  const preload = [];
  const taken = new Set();
  for (let i = 0; i < r.int(1, 3); i++) {
    const b = r.int(0, bays - 1);
    const row = r.int(0, rows - 1);
    if (taken.has(b)) continue; // one per bay, so heavy boxes always find deck space
    taken.add(b);
    preload.push({ r: row, b, n: 1, zone: zones[b] });
  }
  def.preload = preload;
  const timeMul = twists.reduce((m, t) => m * (t.time || 1), 1);
  def.time = Math.round(((70 + count * 38) * timeMul) / 10) * 10;
  def.strikes = 3;
  def.quota = count;
  def.checks = manifest.filter((m) => m.check).length;
  def.order = DAILY_ORDERS[r.int(0, DAILY_ORDERS.length - 1)];
  def.seed = seed;
  return def;
}

// -------------------------------------------------------------------------- upgrades

export const UPGRADES = [
  {
    id: 'sway',
    name: 'Anti-Sway Damper',
    icon: 'sway',
    desc: 'The load stops swinging sooner.',
    costs: [250, 600, 1200, 2200],
    stat: (l) => `+${l * 30}% damping`,
  },
  {
    id: 'trolley',
    name: 'Drive Motors',
    icon: 'motor',
    desc: 'Faster trolley and gantry travel.',
    costs: [250, 600, 1200, 2200],
    stat: (l) => `+${l * 10}% travel speed`,
  },
  {
    id: 'magnet',
    name: 'Magnet Assist',
    icon: 'laser',
    desc: 'Pulls the spreader onto boxes and slots. Level 2 locks on by itself.',
    costs: [300, 700, 1400],
    stat: (l) => `+${l * 45}% pull${l >= 2 ? ', auto-lock' : ''}`,
  },
  {
    id: 'spreader',
    name: 'Wide Spreader',
    icon: 'hook',
    desc: 'Longer guide flippers: grabs and set-downs forgive more.',
    costs: [350, 800, 1600],
    stat: (l) => `+${l * 18}% tolerance`,
  },
  {
    id: 'hoist',
    name: 'Hoist Winch',
    icon: 'hoist',
    desc: 'Lift and lower quicker.',
    costs: [200, 500, 1000, 1800],
    stat: (l) => `+${l * 12}% hoist speed`,
  },
  {
    id: 'clock',
    name: 'Overtime Clause',
    icon: 'clock',
    desc: 'More time on every ship.',
    costs: [200, 500, 1000],
    stat: (l) => `+${l * 10}% round time`,
  },
];

/**
 * The crane's setup: one free choice with a real trade-off (no cash multipliers).
 * STEADY: the load swings much less, the crane travels slower. FAST: quicker travel, livelier swing.
 */
export const RIG_SETUPS = {
  steady: { id: 'steady', name: 'Steady', icon: 'sway', trolley: 0.82, swayMul: 1.7 },
  fast: { id: 'fast', name: 'Fast', icon: 'motor', trolley: 1.3, swayMul: 0.62 },
};

export function upgradeMods(levels = {}, setup = '') {
  const m = baseMods(levels);
  const r = RIG_SETUPS[setup];
  if (r) {
    m.trolley *= r.trolley;
    m.gantry *= r.trolley;
    m.swayMul *= r.swayMul;
  }
  return m;
}

function baseMods(levels) {
  const l = (id) => levels[id] || 0;
  const magnet = l('magnet') || l('guide'); // (older saves called it Laser Guides)
  return {
    trolley: 1 + 0.1 * l('trolley'),
    gantry: 1 + 0.1 * l('trolley'),
    hoist: 1 + 0.12 * l('hoist'),
    swayMul: 1 + 0.3 * l('sway'),
    tolMul: (1 + 0.06 * magnet) * (1 + 0.18 * l('spreader')),
    grabMul: 1 + 0.18 * l('spreader'),
    assist: 1 + 0.45 * magnet,
    autoLock: magnet >= 2,
    spreader: l('spreader'),
    timeMul: 1 + 0.1 * l('clock'),
    lossMul: 1,
    extraStrike: 0,
  };
}

/** Port size from everything ever moved across the quay (you and your night crew). */
export const PORT_STEPS = [0, 12, 35, 80, 160, 320];
export function portLevel(boxes) {
  let l = 0;
  for (let i = 0; i < PORT_STEPS.length; i++) if (boxes >= PORT_STEPS[i]) l = i;
  return l;
}
