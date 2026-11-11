// Shared dimensions, palette and tunables for Night Shift Crane.
// World axes: +X = seaward (quay on the left, ship on the right), +Y = up, Z = along the quay.
// The default camera sits on the +Z side looking towards -Z.

export const DIM = {
  CONT_W: 2.4, // container width  (X)
  CONT_H: 2.6, // container height (Y)
  CONT_L: 6.0, // container length (Z)
  CELL_X: 2.75, // slot pitch across the ship
  CELL_Z: 6.5, // slot pitch along the ship
  QUAY_Y: 2.4, // quay surface height above still water
  DECK_Y: 3.1, // ship cargo deck height (ship-local = world when at rest)
  HULL_X0: 1.9, // quay-side hull plate (world X at rest)
  RAIL_Y: 25.0, // trolley rail height
  TROLLEY_MIN_X: -15.5,
  TROLLEY_MAX_X: 17.5,
  GANTRY_RANGE: 14.5,
  ROPE_MIN: 3.2,
  ROPE_MAX: 21.6,
  SPR_H: 0.42, // spreader thickness
  LANE_X: -7.2, // truck lane centre
  TRAILER_Y: 1.25, // trailer bed above quay
  LEG_WATER_X: -2.4,
  LEG_LAND_X: -18.4,
  LEG_HALF_Z: 9.2,
};

export const PAL = {
  skyTop: 0x04080f,
  skyMid: 0x0b1522,
  skyGlow: 0x4a2f22,
  fog: 0x0b1a22,
  waterDeep: 0x04121a,
  waterMid: 0x0c2a33,
  sodium: 0xffa84a,
  sodiumHot: 0xffd9a0,
  coolLamp: 0xbfe3ff,
  moon: 0x7f9fc8,
  concrete: 0x70767a,
  concreteDark: 0x4b5156,
  asphalt: 0x2b3035,
  lineYellow: 0xe3ac2f,
  lineWhite: 0xd8d4c8,
  craneYellow: 0xe8a61c,
  craneDark: 0x1f2529,
  craneRed: 0xc23d2b,
  craneWhite: 0xe2ddd0,
  hull: 0x1b2a3a,
  hullRed: 0x8c2f27,
  deck: 0x2d5a4d,
  deckDark: 0x224439,
  shipWhite: 0xd9d5c8,
  steel: 0x59646d,
  rust: 0x7a3d27,
  vestOrange: 0xff7a1a,
  vestYellow: 0xd8e63a,
};

// Destination zones: each has a colour (container paint + bay markings) and a port code.
export const ZONES = {
  ROT: { id: 'ROT', name: 'Rotterdam', color: 0xb8452d, css: '#e0593b' },
  SIN: { id: 'SIN', name: 'Singapore', color: 0x2c8f85, css: '#3cc2b4' },
  NYC: { id: 'NYC', name: 'New York', color: 0xd59b22, css: '#f0b93a' },
  OSL: { id: 'OSL', name: 'Oslo', color: 0x34609f, css: '#5a8fe0' },
  ANY: { id: 'ANY', name: 'Any bay', color: 0x7a8791, css: '#aab6bf' },
};

export const CARGO_TYPES = {
  std: { id: 'std', label: 'Standard', mass: 1.0, value: 0 },
  heavy: { id: 'heavy', label: 'Heavy', mass: 2.1, value: 60 },
  fragile: { id: 'fragile', label: 'Fragile', mass: 0.8, value: 140 },
  reefer: { id: 'reefer', label: 'Reefer', mass: 1.1, value: 120 },
  hazmat: { id: 'hazmat', label: 'Hazmat', mass: 1.2, value: 150 },
};

export const UI = {
  amber: '#ffb347',
  hot: '#ff7a3c',
  teal: '#49d1c4',
  text: '#f3ecdd',
  red: '#ff5a4d',
  green: '#7ee08a',
};

export const TUNE = {
  gravity: -24,
  trolleySpeed: 7.6,
  trolleyAccel: 7.0,
  gantrySpeed: 4.8,
  gantryAccel: 4.2,
  hoistSpeed: 6.4,
  hoistAccel: 26,
  swayDamp: 0.45, // base horizontal damping on the hanging load
  lockTol: 0.52, // max horizontal error (m) for a twist-lock placement
  grabTolX: 0.5,
  grabTolZ: 0.75,
  perfect: 0.14,
  great: 0.3,
  softLanding: 1.6, // landing speed (m/s) under which a touchdown is "soft"
  hardLanding: 7.0,
  lockBreakImpulse: 5.2, // delta-v that knocks a locked container loose
};

export const SCORE = {
  perfect: 300,
  great: 210,
  good: 130,
  sloppy: 40,
  soft: 60,
  zone: 80,
  speedMax: 120,
  special: 140,
  lost: -150,
  rough: -30,
};

export const GAME_VERSION = '1.0.0';
