// "The Pier Seven file": radio chatter, the unlisted black boxes and what becomes of them.
// Pure data + a few helpers; the session only reports what the player did with each box.

export const WHO = {
  control: { name: 'HARBOUR CONTROL', sub: 'Pier Seven · VHF 14', cls: 'dispatch', icon: 'radio' },
  dispatch: { name: 'DISPATCH', sub: 'Marta · Tower', cls: 'dispatch', icon: 'radio' },
  unknown: { name: 'UNKNOWN', sub: 'No caller ID', cls: 'unknown', icon: 'eye' },
  customs: { name: 'CUSTOMS', sub: 'Insp. Okafor', cls: 'customs', icon: 'badge' },
};

const D = (text, dur) => ({ who: 'dispatch', text, dur });

/** The very first night opens on the box nobody listed. */
export const OPENING_CALL = [{ who: 'control', text: 'Pier Seven, Harbour Control. That one’s not on the manifest. Set it down soft.', dur: 5200 }];
export const OPENING_NOTED = [{ who: 'control', text: '…noted.', dur: 2200 }];

/** The shift report's teaser for the next night (one line, never a spoiler). */
export const NIGHT_TEASERS = [
  'Tomorrow’s box has a name on it.',
  'The gate log has a truck booked with no plates.',
  'Something followed the last one in.',
  'The lights are on at the old fish quay.',
  'Four tanks empty. The fifth is not.',
  'Customs wants a word about the scale readings.',
  'A ship with no flag is asking for berth seven.',
];
const U = (text, dur) => ({ who: 'unknown', text, dur });
const C = (text, dur) => ({ who: 'customs', text, dur });

/** One-liners from the tower as a shift starts (first play of each shift only). */
export const SHIFT_OPEN = {
  s02: [D('Colours tonight, Seven. Paint on the box matches paint on the deck. And hold on to your load — the wind is getting up.')],
  s03: [D('Customs are on the quay tonight. If a box wears an amber seal, weigh it before you load it.'), D('And Seven — if anyone calls you on this channel who is not me, you tell me.')],
  s04: [D('Gale warning, and the substation has been tripping since midnight. If the lamps go, hold what you have got.')],
  s05: [D('Thirty-tonners. Low and slow.')],
  s06: [D('Glass tonight. Whoever was on this channel last shift, I could not trace them.')],
  s07: [D('Long swell from a storm out at sea. The pilots say something came in with it.')],
  s08: [D('Reefers. The clock is their enemy, not yours.')],
  s09: [D('Fog bank. The pilots say something is following the ships in. Probably a seal.')],
  s10: [D('Three off before the new ones go on. Lane two for the empties.')],
  s11: [D('Placards tonight. Okafor wants a word if another black one turns up.')],
  s12: [D('Last ship before dawn, Seven. Whatever you have been doing with those boxes — finish it.')],
};

/** Small beats mid-shift, keyed by how many boxes are down (first play of the shift only). */
export const SHIFT_BEATS = {
  s01: { at: 3, lines: [D('Not bad for a first night. The harbour is quiet — enjoy it while it lasts.')] },
  s02: { at: 4, lines: [U('Crane Seven. You have steady hands. We will be in touch.', 3400), D('Seven, did somebody just key this channel? …Never mind. Carry on.')] },
};

/** The first forty-footer of the night. */
export const LONG_INTRO = [
  D('Forty-footer on lane one. The spreader telescopes out by itself when you line up on it.'),
  D('It spans two bays, Seven. Both stacks underneath have to be the same height or the locks will not meet.'),
];

/** Explains the spot check the first time an amber-sealed box parks. */
export const CHECK_INTRO = [
  D('That one has a customs seal. Lift it clear and hold it still — your load cell does the rest.'),
  D('Weight matches the papers: load it. Does not match: set it on the customs truck in lane two.'),
];

/** The five boxes. `arrive` plays when its truck parks; the others when the player has dealt with it. */
export const BLACK_BOXES = {
  s03: {
    n: 1,
    title: 'Box one · no papers',
    arrive: [U('Crane Seven. The next box is not on your list. Put it on the ship anyway.'), U('There will be an envelope in your locker.', 3200), D('Seven, who was that? Anything unlisted goes to customs, lane two. Your call.')],
    ship: { say: [U('Good. Nobody saw anything.')], note: 'Stowed as asked. It was colder than the rain, and the scale would not settle on a number.' },
    customs: { say: [C('We have it. No seal number, no shipper. And it is wet on the inside.')], note: 'Handed to Insp. Okafor. No seal, no shipper. Salt water was running out of the door gasket.' },
    sea: { say: [D('…Seven? The water under you just lit up.')], note: 'It went into the harbour. For a few seconds the water glowed where it sank, then something carried the glow away.' },
    left: { note: 'Left on the quay. By morning the doors were open and there was nothing inside but a puddle.' },
  },
  s06: {
    n: 2,
    title: 'Box two · it knocks',
    arrive: [U('Another one. Gently — it does not like being swung.'), D('It is knocking, Seven. Boxes do not knock.')],
    ship: { say: [U('Your locker again. You are easy to work with.')], note: 'Second box aboard. It knocked twice when I locked it down. I knocked back. It answered.' },
    customs: { say: [C('Something in there is moving. We are not opening it on the quay.')], note: 'Okafor took the second one. His scanner showed a tank of water and a shape that turned to face the beam.' },
    sea: { say: [D('The light is back. It is circling the berth.')], note: 'The second box went over the side. The glow came up to meet it before it had finished sinking.' },
    left: { note: 'Left where it stood. The knocking stopped around four. The seal was broken from the inside.' },
  },
  s08: {
    n: 3,
    title: 'Box three · NOCTILUCA',
    arrive: [U('Top tier. Keep it away from the reefers — it must not get any colder.'), D('I pulled the gate log. Those trucks have no plates, Seven.')],
    ship: { say: [U('Three of five. Do not stop now.')], note: 'Third box loaded. Under the black paint somebody had scratched one word: NOCTILUCA.' },
    customs: { say: [C('NOCTILUCA Marine Holdings. A company with one address and no employees.')], note: 'Customs traced the scratched name — NOCTILUCA Marine Holdings. One mailbox, no staff, five boxes on the water.' },
    sea: { say: [D('There are two lights down there now.')], note: 'Third one returned to the water. There were two lights under the ship afterwards, moving together.' },
    left: { note: 'Third box abandoned on the apron. The day shift found it empty and warm, as if something had just left.' },
  },
  s11: {
    n: 4,
    title: 'Box four · the last but one',
    arrive: [U('You have seen what follows them. Then you know why they must leave on a ship. Tonight.'), C('Crane Seven, this is Okafor. Put that box on my truck and I can end this.')],
    ship: { say: [U('The envelope is thicker this time.')], note: 'Fourth box aboard. The light followed the ship as far as the breakwater and then stopped, like a dog at a fence.' },
    customs: { say: [C('That is four of the five accounted for. One more and I have a case.')], note: 'Fourth box in evidence. Okafor says they are being taken out of deep water somewhere and sold to somebody who wants them alive.' },
    sea: { say: [D('…it is singing, Seven. Can you hear that up there?')], note: 'Fourth box over the side. The whole basin hummed for a minute. The tower windows rattled.' },
    left: { note: 'Fourth box left on the quay. At dawn it was simply gone. Nobody signed for it.' },
  },
  s12: {
    n: 5,
    title: 'Box five · before dawn',
    arrive: [U('Last one. Load it and you never hear from me again.'), C('Seven — lane two. Please.'), D('Or you could do what the harbour has been asking you to do all night.')],
    ship: { say: [U('It is done. Forget this channel exists.')], note: 'The fifth box sailed into the storm.' },
    customs: { say: [C('That is all five. Thank you, Seven.')], note: 'The fifth box went to customs. Okafor closed the gate behind his truck himself.' },
    sea: { say: [D('…they are leaving. All of them. Look at the water.')], note: 'The fifth box went home.' },
    left: { note: 'The fifth box stayed on the quay, and the storm took it.' },
  },
};

export const BLACK_ORDER = ['s03', 's06', 's08', 's11', 's12'];

/** One episode a night: each box ends on a line that makes tomorrow's shift worth turning up for. */
export const CLIFFHANGERS = {
  s03: [D('Seven — the gate log has another truck booked for tomorrow night. No plates. Same time.')],
  s06: [U('Tomorrow there is a bigger one. Something followed this one in.')],
  s08: [D('I traced the trucks to a warehouse on the old fish quay. The lights are on. Tomorrow I am going to look.')],
  s11: [D('…Seven, I am at the warehouse. There are tanks in here. Four are empty. The fifth is not— '), D('[static]', 2600)],
  s12: [D('It is over, Seven. Get some sleep. The papers will have it in the morning.')],
};

/** Today's episode, or null if tonight's box has already come through (or the file is complete). */
export function episodeFor(story, today) {
  story = story || {};
  if (story.lastEpisode === today) return null;
  const done = story.boxes || {};
  return BLACK_ORDER.find((k) => !done[k]) || null;
}

/** Radio lines for the scripted power cuts. */
export const BLACKOUT = {
  start: [D('Substation is gone. You are on the battery lamp — carry on if you can see.')],
  deep: [D('Seven… look at the water. Seaward side.')],
  end: [D('Power is back. Did you see— never mind. Carry on.')],
};

export const SMUGGLE_FOUND = [C('We swept that ship. One of your boxes was not what its papers said. That comes out of your score.')];

/** Which way the night ended, from the player's choices. */
export function tally(story) {
  const t = { ship: 0, customs: 0, sea: 0, left: 0, n: 0 };
  for (const id of BLACK_ORDER) {
    const o = story && story.boxes && story.boxes[id];
    if (o && t[o] != null) {
      t[o]++;
      t.n++;
    }
  }
  return t;
}

export const EPILOGUES = {
  sea: {
    id: 'sea',
    name: 'High Tide',
    head: 'HARBOUR GLOWS FOR ONE NIGHT',
    text: 'Fishermen coming in at first light say the whole basin shone green, bright enough to read by, and that the light went out past the breakwater in a line — five small ones and one very large. No black boxes have come through Pier Seven since. The caller never rang again. Some nights the buoy bell rings with no swell at all.',
  },
  customs: {
    id: 'customs',
    name: 'The Okafor File',
    head: 'CUSTOMS RAID EMPTY OFFICE',
    text: 'NOCTILUCA Marine Holdings turned out to be a mailbox, a bank account and a tank lorry. Inspector Okafor will not say what was in the five boxes, only that they have been “returned to where they were taken from, at some depth.” There is a commendation with your crane number on it. The light under the pier has not been seen again.',
  },
  ship: {
    id: 'ship',
    name: 'Hush Money',
    head: 'FREIGHTER FOUND ADRIFT',
    text: 'The LOW TIDE was sighted forty miles out with her engines running and nobody at the wheel. Five black containers stood open on deck, bent outward from the inside, and the holds were full of sea. Your locker has been very generous to you. The harbour has not: the water at Pier Seven stays dark now, and the tower says the ships are being followed out.',
  },
  mixed: {
    id: 'mixed',
    name: 'Loose Ends',
    head: 'QUESTIONS AT PIER SEVEN',
    text: 'Some boxes sailed, some were seized, some never left the harbour. Customs has half a case. Somebody has half a cargo. And something under the pier is still waiting for the rest. The night shift goes on.',
  },
};

export function epilogue(story) {
  const t = tally(story);
  if (t.n < BLACK_ORDER.length) return null;
  const best = ['sea', 'customs', 'ship'].sort((a, b) => t[b] - t[a])[0];
  return t[best] >= 3 ? EPILOGUES[best] : EPILOGUES.mixed;
}
