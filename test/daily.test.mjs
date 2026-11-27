// The daily challenge (Node): one ship per UTC day, the same for everyone, one scored attempt then
// practice, a consecutive-day streak, the countdown to the next one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyShift, dailyTask, utcDayKey, msToNextUtcDay, nextChallengeIn, recordDaily } from '../src/game/levels.js';

test('the challenge day is the UTC date, wherever the player is', () => {
  // 23:30 in New York on the 26th is already the 27th in UTC; 00:30 in Tokyo on the 28th is still the 27th
  assert.equal(utcDayKey(new Date(Date.UTC(2026, 10, 27, 4, 30))), '2026-11-27');
  assert.equal(utcDayKey(new Date(Date.UTC(2026, 10, 27, 15, 30))), '2026-11-27');
  assert.equal(utcDayKey(new Date(Date.UTC(2026, 10, 27, 23, 59))), '2026-11-27');
  assert.equal(utcDayKey(new Date(Date.UTC(2026, 10, 28, 0, 0))), '2026-11-28');
  assert.equal(msToNextUtcDay(new Date(Date.UTC(2026, 10, 27, 22, 30))), 90 * 60000);
  assert.equal(nextChallengeIn(new Date(Date.UTC(2026, 10, 27, 22, 30))), '01:30');
});

test('same day, same ship and task for everyone; another day, another ship', () => {
  const a = dailyShift('2026-11-27');
  const b = dailyShift('2026-11-27');
  const sig = (d) => JSON.stringify({ m: d.manifest, t: d.time, w: d.weather, tw: d.twists.map((x) => x.id), ship: d.ship, pre: d.preload, seed: d.seed });
  assert.equal(sig(a), sig(b));
  assert.equal(dailyTask(a), dailyTask(b));
  assert.match(dailyTask(a), /^[A-Z][a-z]+ Pier: load \d+ in \d+ s$/, dailyTask(a));
  const other = new Set();
  for (let d = 1; d <= 14; d++) other.add(sig(dailyShift(`2026-12-${String(d).padStart(2, '0')}`)));
  assert.equal(other.size, 14, 'a different ship every day');
});

test('one scored attempt per day, then practice; the streak counts consecutive days', () => {
  const dd = {};
  let r = recordDaily(dd, '2026-11-25', { success: true, score: 900, stars: 2 });
  assert.equal(r.practice, false);
  assert.equal(dd.best, 900);
  assert.equal(dd.streak, 1);
  r = recordDaily(dd, '2026-11-25', { success: true, score: 2000, stars: 3 });
  assert.equal(r.practice, true, 'the second run that day is practice');
  assert.equal(dd.best, 900, 'the scored result stands');
  assert.equal(dd.practiceBest, 2000);
  recordDaily(dd, '2026-11-26', { success: true, score: 1200, stars: 2 });
  assert.equal(dd.streak, 2, 'the next day extends the streak');
  assert.equal(dd.allBest, 1200);
  recordDaily(dd, '2026-11-28', { success: true, score: 300, stars: 1 });
  assert.equal(dd.streak, 1, 'a missed day starts again');
  assert.equal(dd.bestStreak, 2);
  const f = {};
  recordDaily(f, '2026-11-25', { success: false, score: 120, stars: 0 });
  assert.equal(f.streak || 0, 0, 'a failed scored attempt keeps no streak');
  assert.equal(recordDaily(f, '2026-11-25', { success: true, score: 999, stars: 3 }).practice, true, 'and the retry is practice');
});

test('hot box: exactly one per ship (never the first box, never sealed, unlisted or forty-foot); the daily’s is the same for everyone', async () => {
  const { endlessShip } = await import('../src/game/levels.js');
  for (let n = 0; n < 12; n++) {
    const m = endlessShip(n, 777).manifest;
    const hot = m.map((x, i) => (x.hot ? i : -1)).filter((i) => i >= 0);
    assert.equal(hot.length, 1, `ship ${n + 1}: one hot box`);
    const b = m[hot[0]];
    assert.ok(hot[0] > 0 && !b.check && !b.black && b.type !== 'long', `ship ${n + 1}: a fair one (${b.type})`);
  }
  const a = dailyShift('2026-11-27').manifest.findIndex((x) => x.hot);
  const b = dailyShift('2026-11-27').manifest.findIndex((x) => x.hot);
  assert.ok(a > 0 && a === b, 'the daily’s hot box is fixed by the day');
});
