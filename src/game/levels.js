// Shift (level) definitions, the endless "Overtime" generator and upgrade catalogue.
import { CARGO_TYPES, SCORE } from '../config.js';
import { makeRng } from '../core/util.js';
import { SHIP_NAMES } from '../world/ship.js';

const C = (zone, type = 'std') => ({ zone, type });
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
    blurb: 'Four boxes, flat water. Learn the ropes.',
    ship: { rows: 3, bays: 2, tiers: 2, style: 0, name: 'MV KESTREL', zones: ['ANY', 'ANY'] },
    manifest: rep(4, 'ANY'),
    time: 300,
    weather: { rain: 0.25, wind: 0, fog: 0.0105, sea: 0.08, clouds: 0.5 },
    tutorial: true,
    tour: true,
  },
  {
    id: 's02',
    name: 'Sort It Out',
    clock: '22:40',
    blurb: 'Boxes are colour-coded by port. Match the bay markings.',
    feature: { title: 'DESTINATION BAYS', text: 'Each container has a port code. Set it down in a bay painted with the same code for the zone bonus.' },
    ship: { rows: 3, bays: 2, tiers: 2, style: 0, name: 'MV MARIGOLD', zones: ['ROT', 'SIN'] },
    manifest: [C('ROT'), C('SIN'), C('ROT'), C('SIN'), C('SIN'), C('ROT')],
    time: 300,
    weather: { rain: 0.2, wind: 0, fog: 0.0105, sea: 0.1 },
  },
  {
    id: 's03',
    name: 'Light Rain',
    clock: '23:15',
    blurb: 'A swell is coming in. Time your set-downs with the roll.',
    feature: { title: 'SWELL', text: 'The ship heaves and rolls. Wait for the deck to come up to the box, then release.' },
    ship: { rows: 3, bays: 3, tiers: 2, style: 1, name: 'MV NORDLYS', zones: ['ROT', 'NYC', 'SIN'] },
    preload: [{ r: 0, b: 0, n: 1, zone: 'ROT' }, { r: 2, b: 2, n: 1, zone: 'SIN' }],
    manifest: [C('NYC'), C('ROT'), C('SIN'), C('NYC'), C('ROT'), C('SIN'), C('NYC')],
    time: 330,
    weather: { rain: 0.6, wind: 0.25, gusts: 0, fog: 0.012, sea: 0.34, clouds: 0.75 },
  },
  {
    id: 's04',
    name: 'Crosswind',
    clock: '23:50',
    blurb: 'Gusts off the estuary push the load around. Watch the windsock.',
    feature: { title: 'WIND GUSTS', text: 'Wind drags the hanging load. A warning flashes just before each gust — carry low and let it settle.' },
    ship: { rows: 3, bays: 3, tiers: 3, style: 2, name: 'MV OSPREY', zones: ['SIN', 'SIN', 'ROT'] },
    preload: [{ r: 1, b: 0, n: 2, zone: 'SIN' }, { r: 0, b: 2, n: 1, zone: 'ROT' }, { r: 2, b: 1, n: 1, zone: 'SIN' }],
    manifest: [C('ROT'), C('SIN'), C('SIN'), C('ROT'), C('SIN'), C('ROT'), C('SIN'), C('ROT')],
    time: 345,
    weather: { rain: 0.3, wind: 1.25, windDir: 0.25, gusts: 0.6, fog: 0.011, sea: 0.22, clouds: 0.6 },
  },
  {
    id: 's05',
    name: 'Heavy Metal',
    clock: '00:30',
    blurb: 'Thirty-tonners on the manifest. Heavy boxes go at the bottom.',
    feature: { title: 'HEAVY CARGO', text: 'Striped HEAVY boxes must sit on the deck or on another heavy box — twist-locks will not hold them on a light one. Uneven loading makes the ship list.' },
    ship: { rows: 4, bays: 2, tiers: 3, style: 1, name: 'MV IRON LILY', zones: ['NYC', 'OSL'] },
    manifest: [C('NYC', 'heavy'), C('OSL'), C('OSL', 'heavy'), C('NYC'), C('NYC', 'heavy'), C('OSL'), C('NYC'), C('OSL', 'heavy')],
    time: 345,
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
    manifest: [C('ROT'), C('NYC', 'fragile'), C('ROT', 'fragile'), C('NYC'), C('ROT'), C('NYC', 'fragile'), C('ROT'), C('NYC')],
    time: 360,
    weather: { rain: 0.7, wind: 0.55, windDir: 0.6, gusts: 0.25, fog: 0.0125, sea: 0.3, clouds: 0.8 },
  },
  {
    id: 's07',
    name: 'Rolling Deck',
    clock: '01:50',
    blurb: 'Long swell from a passing storm. Stacks get lively above the second tier.',
    ship: { rows: 3, bays: 3, tiers: 3, style: 4, name: 'MV TIDEWATER', zones: ['OSL', 'SIN', 'ROT'] },
    preload: [{ r: 0, b: 0, n: 2, zone: 'OSL' }, { r: 2, b: 2, n: 2, zone: 'ROT' }, { r: 1, b: 1, n: 1, zone: 'SIN' }],
    manifest: [C('SIN'), C('OSL'), C('ROT', 'heavy'), C('SIN'), C('OSL'), C('ROT'), C('SIN', 'fragile'), C('OSL'), C('ROT')],
    time: 380,
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
    manifest: [C('SIN', 'reefer'), C('NYC'), C('NYC', 'reefer'), C('SIN'), C('SIN', 'heavy'), C('NYC', 'reefer'), C('SIN'), C('NYC'), C('SIN', 'reefer')],
    time: 380,
    weather: { rain: 0.4, wind: 1.0, windDir: 3.5, gusts: 0.45, fog: 0.012, sea: 0.35 },
  },
  {
    id: 's09',
    name: 'Fog Bank',
    clock: '03:10',
    blurb: 'You can barely see the deck. Trust the lasers and the cab view.',
    feature: { title: 'FOG', text: 'Visibility is down to a few boxes. The drop reticle and the cab view (C) are your eyes.' },
    ship: { rows: 3, bays: 3, tiers: 3, style: 2, name: 'MV LANTERN', zones: ['NYC', 'OSL', 'SIN'] },
    preload: [{ r: 0, b: 1, n: 2, zone: 'OSL' }, { r: 2, b: 0, n: 1, zone: 'NYC' }, { r: 1, b: 2, n: 2, zone: 'SIN' }],
    manifest: [C('NYC'), C('SIN'), C('OSL'), C('NYC', 'fragile'), C('SIN'), C('OSL', 'heavy'), C('NYC'), C('SIN'), C('OSL')],
    time: 400,
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
    manifest: [C('ROT', 'hazmat'), C('SIN'), C('NYC'), C('ROT'), C('SIN', 'hazmat'), C('NYC', 'heavy'), C('ROT', 'hazmat'), C('SIN', 'reefer'), C('NYC'), C('ROT')],
    time: 430,
    weather: { rain: 0.65, wind: 1.1, windDir: 5.2, gusts: 0.5, fog: 0.013, sea: 0.45, clouds: 0.85 },
  },
  {
    id: 's12',
    name: 'The Storm',
    clock: '05:10',
    blurb: 'Everything at once. Last ship before dawn — bring it home.',
    ship: { rows: 4, bays: 3, tiers: 3, style: 4, name: 'MV LOW TIDE', zones: ['OSL', 'ROT', 'SIN'] },
    preload: [{ r: 0, b: 0, n: 2, zone: 'OSL' }, { r: 3, b: 2, n: 2, zone: 'SIN' }, { r: 1, b: 1, n: 1, zone: 'ROT' }, { r: 2, b: 1, n: 1, zone: 'ROT' }],
    manifest: [C('ROT'), C('OSL', 'heavy'), C('SIN', 'reefer'), C('ROT', 'fragile'), C('OSL'), C('SIN', 'hazmat'), C('ROT', 'heavy'), C('OSL', 'reefer'), C('SIN'), C('ROT'), C('OSL', 'fragile')],
    time: 470,
    weather: { rain: 1, wind: 1.7, windDir: 0.35, gusts: 0.9, fog: 0.016, sea: 0.95, storm: 1, clouds: 1 },
    music: 'storm',
  },
];

SHIFTS.forEach((s, i) => {
  s.n = i + 1;
  s.strikes = 3;
  s.quota = s.quota || s.manifest.length + (s.preload || []).filter((p) => p.discharge).length;
});

/** Theoretical clean-run score used for the star thresholds. */
export function parScore(level) {
  let base = 0;
  const zoned = level.ship.zones.some((z) => z !== 'ANY');
  for (const c of level.manifest) base += SCORE.great + SCORE.soft * 0.5 + (zoned ? SCORE.zone : 0) + SCORE.speedMax * 0.55 + (CARGO_TYPES[c.type] || CARGO_TYPES.std).value * 0.8;
  for (const p of level.preload || []) if (p.discharge) base += SCORE.great + SCORE.speedMax * 0.5;
  return Math.round(base * 1.12);
}

export function starThresholds(level) {
  const par = parScore(level);
  return [Math.round(par * 0.42), Math.round(par * 0.7), Math.round(par * 0.98)];
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
  { rain: 0.3, wind: 0.2, gusts: 0, fog: 0.011, sea: 0.15 },
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
  const count = Math.min(11, 5 + Math.floor(n * 0.9));
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
    manifest.push(C(rng.pick(zones), type));
  }
  const preload = [];
  const pre = Math.min(4, Math.floor(n / 2) + (n > 0 ? 1 : 0));
  for (let i = 0; i < pre; i++) {
    const b = rng.int(0, bays - 1);
    preload.push({ r: rng.int(0, rows - 1), b, n: 1, zone: zones[b] });
  }
  const w = ENDLESS_WEATHER[Math.min(ENDLESS_WEATHER.length - 1, n % 7 === 6 ? 5 : Math.min(n, 5))];
  const cycle = n >= ENDLESS_WEATHER.length ? ENDLESS_WEATHER[2 + ((n * 3) % 4)] : w;
  return {
    id: 'endless',
    endless: true,
    n: n + 1,
    name: 'Overtime',
    ship: { rows, bays, tiers: 3, style: n % 5, name: SHIP_NAMES[(n * 5 + 3) % SHIP_NAMES.length], zones },
    manifest,
    preload,
    time: 0,
    bonusTime: 40 + count * 21,
    weather: n >= ENDLESS_WEATHER.length ? cycle : w,
    strikes: 3,
    quota: count,
  };
}

// -------------------------------------------------------------------------- upgrades

export const UPGRADES = [
  {
    id: 'trolley',
    name: 'Drive Motors',
    icon: 'motor',
    desc: 'Faster trolley and gantry travel.',
    costs: [220, 480, 860, 1400],
    stat: (l) => `+${l * 9}% travel speed`,
  },
  {
    id: 'hoist',
    name: 'Hoist Winch',
    icon: 'hoist',
    desc: 'Lift and lower quicker.',
    costs: [200, 440, 800, 1300],
    stat: (l) => `+${l * 11}% hoist speed`,
  },
  {
    id: 'sway',
    name: 'Anti-Sway Damper',
    icon: 'sway',
    desc: 'The load stops swinging sooner.',
    costs: [260, 560, 980, 1600],
    stat: (l) => `+${l * 40}% damping`,
  },
  {
    id: 'guide',
    name: 'Laser Guides',
    icon: 'laser',
    desc: 'Wider twist-lock tolerance and stronger flipper assist.',
    costs: [240, 540, 1000],
    stat: (l) => `+${l * 12}% lock tolerance`,
  },
  {
    id: 'clock',
    name: 'Overtime Clause',
    icon: 'clock',
    desc: 'More time on every shift.',
    costs: [180, 420, 820],
    stat: (l) => `+${l * 8}% shift time`,
  },
  {
    id: 'insure',
    name: 'Cargo Insurance',
    icon: 'shield',
    desc: 'Lost boxes cost less. At max level you get a fourth strike.',
    costs: [300, 700, 1300],
    stat: (l) => `-${l * 25}% loss penalty${l >= 3 ? ', +1 strike' : ''}`,
  },
];

export function upgradeMods(levels = {}) {
  const l = (id) => levels[id] || 0;
  return {
    trolley: 1 + 0.09 * l('trolley'),
    gantry: 1 + 0.09 * l('trolley'),
    hoist: 1 + 0.11 * l('hoist'),
    swayMul: 1 + 0.4 * l('sway'),
    tolMul: 1 + 0.12 * l('guide'),
    assist: 1 + 0.35 * l('guide'),
    timeMul: 1 + 0.08 * l('clock'),
    lossMul: 1 - 0.25 * l('insure'),
    extraStrike: l('insure') >= 3 ? 1 : 0,
  };
}
