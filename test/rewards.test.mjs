// Reasons to return (Node, no browser): the daily ladder, the port fund cap, the fund shop, story
// perks, and which ships are storm ships.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DAILY_LADDER, ladderAt, claimLadder, awardFund, FUND_CAP, buyWithFund, FUND_SHOP, unlockEpisodePerk, EPISODE_PERKS, applyPerks } from '../src/game/rewards.js';
import { endlessShip, isStormShip, upgradeMods, STORM_EVERY } from '../src/game/levels.js';

test('daily ladder: day 2 paint, day 7 rig, day 14 berth; each step once, a skipped one caught up; no cash anywhere', () => {
  assert.equal(ladderAt(2).now.id, 'paint_dawn');
  assert.equal(ladderAt(7).now.id, 'rig_owl');
  assert.equal(ladderAt(14).now.id, 'berth_b');
  for (let d = 2; d <= 7; d++) assert.ok(ladderAt(d).now, `the first week pays every day (day ${d})`);
  assert.equal(ladderAt(8).now, null);
  assert.equal(ladderAt(8).next.day, 10, 'between steps: the next one is named');
  for (const r of DAILY_LADDER) assert.ok(!('cash' in r) && !('money' in r), 'cosmetics and unlocks only: ' + r.id);
  const d = {};
  assert.deepEqual(claimLadder(d, 1), []);
  assert.deepEqual(
    claimLadder(d, 2).map((r) => r.id),
    ['paint_dawn']
  );
  assert.deepEqual(claimLadder(d, 2), [], 'once');
  // (a returning player who skipped the app for a while still gets every step they passed)
  assert.deepEqual(
    claimLadder(d, 7).map((r) => r.id),
    ['lamp_led', 'paint_rust', 'paint_ice', 'lamp_green', 'rig_owl']
  );
});

test('port fund: only from the daily ship, capped per calendar day; spent on things money cannot buy', () => {
  const d = { money: 1e9 };
  assert.equal(awardFund(d, { success: true, stars: 3 }, '2026-11-26'), 3);
  assert.equal(awardFund(d, { success: true, stars: 3 }, '2026-11-26'), 0, `the cap is ${FUND_CAP} a day`);
  assert.equal(awardFund(d, { success: false, stars: 0 }, '2026-11-27'), 0, 'a failed shift pays no fund');
  assert.equal(awardFund(d, { success: true, stars: 1 }, '2026-11-27'), 1);
  assert.equal(d.fund.n, 4);
  const gold = FUND_SHOP.find((x) => x.id === 'paint_gold');
  assert.ok(!buyWithFund(d, 'paint_gold') || d.fund.n >= 0, 'never below zero');
  d.fund.n = gold.cost;
  assert.ok(buyWithFund(d, 'paint_gold'));
  assert.equal(d.fund.n, 0);
  assert.equal(d.money, 1e9, 'money is not touched');
  assert.ok(!buyWithFund(d, 'paint_gold'), 'owned once');
});

test('story: every episode unlocks a crane perk that changes the numbers', () => {
  const d = {};
  const base = upgradeMods({}, '', {}, '');
  for (const key of Object.keys(EPISODE_PERKS)) assert.ok(unlockEpisodePerk(d, key), key);
  assert.equal(unlockEpisodePerk(d, 's03'), null, 'once');
  const m = upgradeMods({}, '', d.unlocks, '');
  assert.ok(m.tolMul > base.tolMul && m.swayMul > base.swayMul && m.timeMul > base.timeMul && m.hoist > base.hoist && m.payMul > base.payMul);
  // Berth B: only once unlocked and chosen
  assert.equal(applyPerks(upgradeMods(), { berth_b: true }, 'A').berthB, false);
  assert.equal(applyPerks(upgradeMods(), { berth_b: true }, 'B').payMul, 1.25);
});

test('storm ships: every fifth ship, telegraphed by her definition; the others are ordinary', () => {
  const storms = [];
  for (let n = 0; n < 16; n++) if (isStormShip(n)) storms.push(n + 1);
  assert.deepEqual(storms, [5, 10, 15], 'ships 5, 10, 15');
  assert.equal(STORM_EVERY, 5);
  const s = endlessShip(4, 1234);
  assert.equal(s.storm, true);
  assert.equal(s.name, 'Storm ship');
  assert.ok(s.weather.storm >= 1, 'she brings the storm');
  assert.equal(endlessShip(3, 1234).storm, false);
});
