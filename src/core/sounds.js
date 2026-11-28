// Sound manifest: logical names -> files in assets/audio (see CREDITS.md for sources).
const v = (n, count, ext = 'mp3') => Array.from({ length: count }, (_, i) => `${n}_${i + 1}.${ext}`);

export const SOUNDS = {
  sfx: {
    // interface
    ui_click: { files: ['ui_click.mp3'], vol: 0.5, bus: 'ui', rateVar: 0.03 },
    ui_hover: { files: ['ui_hover.mp3'], vol: 0.22, bus: 'ui', rateVar: 0.04 },
    ui_tick: { files: ['ui_tick.mp3'], vol: 0.35, bus: 'ui', rateVar: 0.02 },
    ui_back: { files: ['ui_back.mp3'], vol: 0.6, bus: 'ui' },
    ui_open: { files: ['ui_open.mp3'], vol: 0.6, bus: 'ui' },
    ui_close: { files: ['ui_close.mp3'], vol: 0.55, bus: 'ui' },
    ui_confirm: { files: ['ui_confirm.mp3'], vol: 0.7, bus: 'ui' },
    ui_error: { files: ['ui_error.mp3'], vol: 0.6, bus: 'ui' },
    ui_toggle: { files: ['ui_toggle.mp3'], vol: 0.6, bus: 'ui' },
    ui_toast: { files: ['ui_toast.mp3'], vol: 0.4, bus: 'ui' },
    ui_warn: { files: ['ui_warn.mp3'], vol: 0.6, bus: 'ui' },
    ui_buy: { files: ['ui_buy.mp3'], vol: 0.6, bus: 'ui', rateVar: 0 },
    ui_star: { files: ['ui_star.mp3'], vol: 0.7, bus: 'ui', rateVar: 0 },
    ui_stamp: { files: ['ui_stamp.mp3'], vol: 0.85, bus: 'ui' },
    ui_coin: { files: ['ui_coin.mp3'], vol: 0.5, bus: 'ui', rateVar: 0.08 },
    ui_cash: { files: ['ui_cash.mp3'], vol: 0.55, bus: 'ui', rateVar: 0 },
    ui_count: { files: ['ui_count.mp3'], vol: 0.5, bus: 'ui', rateVar: 0 },
    whoosh_ui: { files: v('whoosh_ui', 3), vol: 0.45, bus: 'ui', rateVar: 0.08 },
    door_close: { files: ['door_close.mp3'], vol: 0.8, bus: 'ui', rateVar: 0.02 },
    door_open: { files: ['door_open.mp3'], vol: 0.7, bus: 'ui', rateVar: 0.02 },
    // feedback
    perfect: { files: ['perfect.mp3'], vol: 0.55, bus: 'ui', rateVar: 0.02 },
    great: { files: ['great.mp3'], vol: 0.55, bus: 'ui', rateVar: 0.02 },
    good: { files: ['good.mp3'], vol: 0.45, bus: 'ui', rateVar: 0.02 },
    strike: { files: ['strike.mp3'], vol: 0.75, bus: 'ui', rateVar: 0 },
    sting_win: { files: ['sting_win.mp3'], vol: 0.7, bus: 'ui', rateVar: 0 },
    sting_win3: { files: ['sting_win3.mp3'], vol: 0.7, bus: 'ui', rateVar: 0 },
    sting_fail: { files: ['sting_fail.mp3'], vol: 0.7, bus: 'ui', rateVar: 0 },
    sting_levelup: { files: ['sting_levelup.mp3'], vol: 0.6, bus: 'ui', rateVar: 0 },
    sax_start: { files: ['sax_start.mp3'], vol: 0.55, bus: 'ui', rateVar: 0 },
    sax_combo: { files: ['sax_combo.mp3'], vol: 0.5, bus: 'ui', rateVar: 0 },
    tick_alarm: { files: ['tick_alarm.mp3'], vol: 0.5, bus: 'ui', rateVar: 0 },
    // crane
    motor_trolley: { files: ['motor_trolley.wav'], vol: 0.5, bus: 'sfx' },
    motor_hoist: { files: ['motor_hoist.wav'], vol: 0.42, bus: 'sfx' },
    motor_gantry: { files: ['motor_gantry.wav'], vol: 0.5, bus: 'sfx' },
    truck_idle: { files: ['truck_idle.wav'], vol: 0.35, bus: 'sfx' },
    cab_hum: { files: ['cab_hum.wav'], vol: 0.5, bus: 'amb' },
    beep: { files: ['beep.mp3'], vol: 0.16, rateVar: 0 },
    hydraulic: { files: ['hydraulic.mp3'], vol: 0.35 },
    servo: { files: ['servo.mp3'], vol: 0.4 },
    lock: { files: ['lock.mp3'], vol: 0.95, rateVar: 0.03 },
    clang: { files: ['clang.mp3'], vol: 1, bus: 'ui', rateVar: 0.04 },
    unlock: { files: ['unlock.mp3'], vol: 0.8, rateVar: 0.03 },
    chain: { files: ['chain.mp3'], vol: 0.45, rateVar: 0.1 },
    air_brake: { files: ['air_brake.mp3'], vol: 0.3, rateVar: 0.06 },
    // steel
    impact_heavy: { files: v('impact_heavy', 5), vol: 1.0, rateVar: 0.07 },
    impact_med: { files: v('impact_med', 4), vol: 0.85, rateVar: 0.08 },
    impact_light: { files: v('impact_light', 3), vol: 0.6, rateVar: 0.1 },
    impact_deck: { files: v('impact_deck', 3), vol: 0.9, rateVar: 0.07 },
    boom: { files: v('boom', 2), vol: 0.9, rateVar: 0.05 },
    scrape: { files: v('scrape', 2), vol: 0.4, rateVar: 0.1 },
    creak: { files: v('creak', 3), vol: 0.3, rateVar: 0.12 },
    glass: { files: v('glass', 3), vol: 0.9, rateVar: 0.08 },
    explosion: { files: ['explosion.mp3'], vol: 1.0, rateVar: 0.04 },
    whoosh: { files: v('whoosh', 3), vol: 0.35, rateVar: 0.12 },
    // water + weather
    splash_big: { files: ['splash_big.mp3'], vol: 1.0, rateVar: 0.06 },
    splash_small: { files: ['splash_small.mp3'], vol: 0.7, rateVar: 0.1 },
    bubbles: { files: ['bubbles.mp3'], vol: 0.5, rateVar: 0.08 },
    sea_loop: { files: ['sea_loop.mp3'], vol: 0.3, bus: 'amb', x: 1.3 }, // (under the gameplay: about -7 dB from before)
    waves_loop: { files: ['waves_loop.mp3'], vol: 0.28, bus: 'amb', x: 1.3 },
    rain_loop: { files: ['rain_loop.mp3'], vol: 0.5, bus: 'amb', x: 1.3 },
    rain_cab_loop: { files: ['rain_cab_loop.mp3'], vol: 0.8, bus: 'amb', x: 1.3 },
    wind_loop: { files: ['wind_loop.mp3'], vol: 0.9, bus: 'amb', x: 1.3 },
    gust: { files: v('gust', 2), vol: 0.5, bus: 'amb', rateVar: 0.12 },
    thunder: { files: v('thunder', 2), vol: 0.95, bus: 'amb', rateVar: 0.08 },
    // harbour life
    horn_ship: { files: ['horn_ship.mp3'], vol: 0.85, rateVar: 0.02 },
    horn_crane: { files: ['horn_crane.mp3'], vol: 0.7, rateVar: 0.01 },
    horn_truck: { files: ['horn_truck.mp3'], vol: 0.4, rateVar: 0.04 },
    crow: { files: ['crow.mp3'], vol: 0.2, bus: 'amb', rateVar: 0.1 },
    bell_buoy: { files: ['bell_buoy.mp3'], vol: 0.16, bus: 'amb', rateVar: 0.03 },
    vox_hey: { files: ['vox_hey.mp3'], vol: 0.5, rateVar: 0.1 },
    vox_laugh: { files: ['vox_laugh.mp3'], vol: 0.4, rateVar: 0.08 },
    vox_yell: { files: ['vox_yell.mp3'], vol: 0.4, rateVar: 0.08 },
    car_door: { files: ['car_door.mp3'], vol: 0.4, rateVar: 0.06 },
    // the Pier Seven file
    radio_in: { files: ['radio_in.mp3'], vol: 0.5, bus: 'ui', rateVar: 0.03 },
    radio_out: { files: ['radio_out.mp3'], vol: 0.4, bus: 'ui', rateVar: 0.03 },
    thump: { files: ['thump.mp3'], vol: 0.9, rateVar: 0.05 },
    power_down: { files: ['power_down.mp3'], vol: 0.8, bus: 'ui', rateVar: 0 },
    power_up: { files: ['power_up.mp3'], vol: 0.6, bus: 'ui', rateVar: 0 },
    deep_call: { files: ['deep_call.mp3'], vol: 0.75, bus: 'amb', rateVar: 0.03 },
    box_hum: { files: ['box_hum.wav'], vol: 0.5, bus: 'sfx' },
  },
  music: {
    menu: { file: 'music_menu.mp3', title: '3 am West End', artist: 'Statusq', vol: 1 },
    shift_a: { file: 'music_shift_a.mp3', title: 'Night Life', artist: 'HoliznaCC0', vol: 0.95 },
    shift_b: { file: 'music_shift_b.mp3', title: 'City Lights', artist: 'HoliznaCC0', vol: 0.95 },
    shift_c: { file: 'music_shift_c.mp3', title: 'Limit 70', artist: 'Kevin MacLeod', vol: 0.95 },
    storm: { file: 'music_storm.mp3', title: 'Bass Meant Jazz', artist: 'Kevin MacLeod', vol: 0.9 },
  },
};

/**
 * Progressive loading groups. CORE = the first box (loaded right after the first frame), PLAY = the
 * first minutes of any shift, the rest only when a ship / shift that uses it is coming up.
 */
export const SOUND_GROUPS = {
  core: ['clang', 'lock', 'unlock', 'perfect', 'great', 'good', 'ui_coin', 'ui_cash', 'impact_deck', 'impact_light', 'impact_med', 'chain', 'ui_click', 'ui_toast', 'air_brake', 'motor_trolley', 'motor_hoist', 'motor_gantry', 'radio_in', 'radio_out', 'beep', 'hydraulic'],
  // the first minutes of play
  play: ['sea_loop', 'waves_loop', 'horn_ship', 'sting_win', 'sting_levelup', 'ui_warn', 'ui_error', 'ui_open', 'ui_close', 'ui_confirm', 'ui_back', 'ui_buy', 'ui_tick', 'strike', 'tick_alarm', 'truck_idle', 'servo', 'impact_heavy', 'splash_big', 'splash_small', 'horn_crane', 'horn_truck', 'vox_hey'],
  // menus, results, flavour: after the first ship (or when a menu opens)
  later: ['cab_hum', 'ui_hover', 'ui_toggle', 'ui_count', 'ui_star', 'ui_stamp', 'whoosh_ui', 'door_close', 'door_open', 'sting_win3', 'sting_fail', 'sax_start', 'sax_combo', 'boom', 'scrape', 'creak', 'whoosh', 'bubbles', 'crow', 'bell_buoy', 'vox_laugh', 'vox_yell', 'car_door'],
  fragile: ['glass'],
  hazmat: ['explosion'],
  rain: ['rain_loop', 'rain_cab_loop'],
  wind: ['wind_loop', 'gust'],
  storm: ['thunder'],
  mystery: ['thump', 'power_down', 'power_up', 'deep_call', 'box_hum'],
};

/** The sounds a level (a shift, the daily, or one ship of the night) will use beyond CORE/PLAY. */
export function soundsForLevel(def) {
  if (!def) return [];
  const G = SOUND_GROUPS;
  const out = [];
  const types = new Set([...(def.manifest || []).map((m) => m.type), ...(def.preload || []).map((p) => p.type || 'std')]);
  const black = (def.manifest || []).some((m) => m.black || m.type === 'black');
  if (types.has('fragile')) out.push(...G.fragile);
  if (types.has('hazmat')) out.push(...G.hazmat);
  if (black || (def.events || []).length) out.push(...G.mystery);
  const w = def.weather || {};
  if ((w.rain || 0) > 0.12 || w.snow) out.push(...G.rain);
  if ((w.wind || 0) > 0.45 || (w.gusts || 0) > 0) out.push(...G.wind);
  if ((w.storm || 0) > 0.3) out.push(...G.storm); // (lightning starts above 0.3)
  return out;
}
