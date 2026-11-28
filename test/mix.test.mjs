// The mix: the water under the harbour (sea, waves, rain) sits well below the gameplay sounds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SOUNDS } from '../src/core/sounds.js';

const def = (name) => Object.values(SOUNDS).find((g) => g && g[name])[name];
const dB = (a, b) => 20 * Math.log10(a / b);

test('sea and waves sit at least 10 dB (rain 6 dB) under the lock clunk and the deck impacts at their loudest', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  // (the loudest each loop is driven in updateAmbience)
  assert.match(main, /a\.sea\.set\(\(0\.55 \+ w\.sea \* 0\.3\) \* menuDuck\)/, 'sea drive unchanged');
  assert.match(main, /a\.waves\.set\(clamp\(\(w\.sea - 0\.25\) \* 1\.3, 0, 1\) \* 0\.8 \* menuDuck\)/, 'waves drive unchanged');
  assert.match(main, /a\.rain\.set\(clamp\(w\.rain, 0, 1\) \* 0\.85 \*/, 'rain drive unchanged');
  const peak = { sea: def('sea_loop').vol * 0.85, waves: def('waves_loop').vol * 0.8, rain: def('rain_loop').vol * 0.85 };
  const ref = Math.min(def('lock').vol, def('impact_deck').vol);
  for (const [k, v] of Object.entries(peak)) assert.ok(dB(ref, v) >= (k === 'rain' ? 6 : 10), `${k} is ${dB(ref, v).toFixed(1)} dB under the gameplay`);
  // and clearly quieter than it was (sea 0.7, waves 0.6)
  assert.ok(dB(0.7, def('sea_loop').vol) >= 6 && dB(0.6, def('waves_loop').vol) >= 6, 'at least 6 dB down from 2.11');
});

test('the sea sits lower again (below 2.12) and every lock, drop and horn ducks the ambience under it', () => {
  assert.ok(dB(0.3, def('sea_loop').vol) >= 1.5 && dB(0.28, def('waves_loop').vol) >= 1.5, 'sea and waves at least 1.5 dB under 2.12');
  for (const n of ['lock', 'unlock', 'horn_ship', 'horn_crane', 'horn_truck']) assert.ok(def(n).duck > 0 && def(n).duck <= 0.6, n + ' ducks the ambience: ' + def(n).duck);
});
