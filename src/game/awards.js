// Commendations: small long-term goals, checked whenever a run ends.
import { SHIFTS } from './levels.js';

export const AWARDS = [
  { id: 'first', name: 'First Lock', desc: 'Lock your first container on board.', icon: 'lock', test: (d) => d.stats.placed >= 1 },
  { id: 'steady', name: 'Steady Hands', desc: 'Five PERFECT set-downs in one shift.', icon: 'star', test: (d, r) => r && r.stats.perfect >= 5 },
  { id: 'feather', name: 'Featherweight', desc: 'Six soft landings in one shift.', icon: 'down', test: (d, r) => r && r.stats.soft >= 6 },
  { id: 'dry', name: 'Dry Docks', desc: 'Finish shift 3 or later without losing a box.', icon: 'wave', test: (d, r, l) => r && r.success && l && !l.endless && l.n >= 3 && r.stats.lost === 0 },
  { id: 'chain', name: 'Chain Gang', desc: 'Reach a x8 combo.', icon: 'bolt', test: (d, r) => r && r.bestCombo >= 8 },
  { id: 'gust', name: 'Gust Buster', desc: 'Three stars on Crosswind.', icon: 'wind', test: (d) => (d.shifts.s04 || {}).stars >= 3 },
  { id: 'glass', name: 'Glass Whisperer', desc: 'Clear Handle With Care without a single loss.', icon: 'glass', test: (d, r, l) => r && r.success && l && l.id === 's06' && r.stats.lost === 0 },
  { id: 'storm', name: 'Storm Rider', desc: 'Bring the last ship home in The Storm.', icon: 'rain', test: (d) => (d.shifts.s12 || {}).stars >= 1 },
  { id: 'night', name: 'Employee of the Night', desc: 'Three stars on every shift.', icon: 'trophy', test: (d) => SHIFTS.every((s) => (d.shifts[s.id] || {}).stars >= 3) },
  { id: 'overtime', name: 'Overtime Hero', desc: 'Send out three ships in one Overtime run.', icon: 'infinity', test: (d, r, l) => r && l && l.endless && r.ships >= 3 },
  { id: 'payday', name: 'Payday', desc: 'Earn $10,000 in total.', icon: 'coin', test: (d) => d.stats.earned >= 10000 },
  { id: 'butter', name: 'Butterfingers', desc: 'Lose ten containers. The harbour master is keeping count.', icon: 'box', test: (d) => d.stats.lost >= 10 },
];

/** Returns the awards newly earned by this result (and records them). */
export function checkAwards(data, result, level) {
  data.awards = data.awards || {};
  const fresh = [];
  for (const a of AWARDS) {
    if (data.awards[a.id]) continue;
    let ok = false;
    try {
      ok = !!a.test(data, result, level);
    } catch (e) {}
    if (ok) {
      data.awards[a.id] = Date.now();
      fresh.push(a);
    }
  }
  return fresh;
}
