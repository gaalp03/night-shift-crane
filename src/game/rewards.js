// Reasons to come back that are not cash: the daily ladder (cosmetics and unlocks, one step per day
// visited, never lost), the port fund (earned only on the daily ship, capped per day, spent on
// things money cannot buy) and the story file (every episode box unlocks a crane perk, read or not).
// Pure data + rules: no DOM, no three.js (unit-tested in Node).

/** The daily ladder: the reward for the n-th day visited. Days in between show the next step. */
export const DAILY_LADDER = [
  { day: 2, id: 'paint_dawn', kind: 'paint', paint: 'dawn', name: 'Dawn Orange paint', icon: 'paint' },
  { day: 3, id: 'lamp_led', kind: 'lamp', lamp: 'led', name: 'LED floodlight', icon: 'eye' },
  { day: 5, id: 'paint_ice', kind: 'paint', paint: 'ice', name: 'Ice Blue paint', icon: 'paint' },
  { day: 7, id: 'rig_owl', kind: 'rig', paint: 'owl', lamp: 'cyan', name: 'Night Owl rig', icon: 'moon' },
  { day: 10, id: 'plate_gold', kind: 'plate', name: 'Gold cab plate', icon: 'badge' },
  { day: 14, id: 'berth_b', kind: 'berth', name: 'Berth B: bigger ships, +25% pay', icon: 'anchor' },
];

/** The ladder step reached exactly on `day` (or null), and the next one still ahead. */
export function ladderAt(day) {
  return {
    now: DAILY_LADDER.find((r) => r.day === day) || null,
    next: DAILY_LADDER.find((r) => r.day > day) || null,
  };
}

/** Grant every ladder step up to `day` (idempotent; a skipped grant is caught up). Returns the new ones. */
export function claimLadder(data, day) {
  const u = (data.unlocks = data.unlocks || {});
  const got = [];
  for (const r of DAILY_LADDER) {
    if (r.day > day || u[r.id]) continue;
    u[r.id] = true;
    got.push(r);
  }
  return got;
}

/** Port fund: only the daily ship pays it, at most FUND_CAP a calendar day. */
export const FUND_CAP = 3;

/** Fund for one daily result: 1 for a finished shift, +1 at two stars, +1 at three (capped per day). */
export function awardFund(data, res, date) {
  const f = (data.fund = data.fund || { n: 0, date: '', today: 0, total: 0 });
  if (f.date !== date) {
    f.date = date;
    f.today = 0;
  }
  const want = res && res.success ? 1 + (res.stars >= 2 ? 1 : 0) + (res.stars >= 3 ? 1 : 0) : 0;
  const give = Math.max(0, Math.min(want, FUND_CAP - f.today));
  f.today += give;
  f.n += give;
  f.total = (f.total || 0) + give;
  return give;
}

/** What the port fund buys (never sold for money). */
export const FUND_SHOP = [
  { id: 'lamp_amber', kind: 'lamp', lamp: 'amber', name: 'Amber work lamp', cost: 2, icon: 'eye' },
  { id: 'paint_gold', kind: 'paint', paint: 'gold', name: 'Gold Leaf paint', cost: 5, icon: 'paint' },
  { id: 'perk_spotter', kind: 'perk', name: 'Spotter on the quay: lock window +8%', cost: 8, icon: 'eye' },
];

export function buyWithFund(data, id) {
  const it = FUND_SHOP.find((x) => x.id === id);
  const f = (data.fund = data.fund || { n: 0, date: '', today: 0, total: 0 });
  const u = (data.unlocks = data.unlocks || {});
  if (!it || u[id] || f.n < it.cost) return false;
  f.n -= it.cost;
  u[id] = true;
  return true;
}

/** Every story episode unlocks a crane perk when its box is dealt with, whatever the player read. */
export const EPISODE_PERKS = {
  s03: { id: 'perk_gate', name: 'Gate log', desc: 'lock window +6%' },
  s06: { id: 'perk_knot', name: 'Rigger’s knot', desc: '15% less swing' },
  s08: { id: 'perk_pass', name: 'Night pass', desc: '+8% time on every ship' },
  s11: { id: 'perk_winch', name: 'Winch tune-up', desc: 'hoist +10%' },
  s12: { id: 'perk_master', name: 'Harbour master', desc: '+10% pay' },
};

export function unlockEpisodePerk(data, key) {
  const p = EPISODE_PERKS[key];
  if (!p) return null;
  const u = (data.unlocks = data.unlocks || {});
  if (u[p.id]) return null;
  u[p.id] = true;
  return p;
}

/** The perks folded into the crane's numbers (upgradeMods applies this). `berth`: 'B' once chosen. */
export function applyPerks(m, unlocks = {}, berth = '') {
  const u = unlocks || {};
  if (u.perk_gate) m.tolMul *= 1.06;
  if (u.perk_spotter) m.tolMul *= 1.08;
  if (u.perk_knot) m.swayMul *= 1.15;
  if (u.perk_pass) m.timeMul *= 1.08;
  if (u.perk_winch) m.hoist *= 1.1;
  m.berthB = !!(u.berth_b && berth === 'B');
  m.payMul = (m.payMul || 1) * (u.perk_master ? 1.1 : 1) * (m.berthB ? 1.25 : 1);
  return m;
}
