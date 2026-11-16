// config.js — every tunable of Yardline in one place: palette, weapons, economy, match rules.

export const PALETTE = {
  sky: 0x2e3d4d,
  fog: 0x2e3d4d,
  ground: 0x8a7a5f,
  groundDark: 0x77684f,
  wall: 0xb8a888,
  wallTrim: 0x8f8065,
  containerA: 0xb3552e,
  containerB: 0x2e6f79,
  containerC: 0x707a48,
  crate: 0x9a7b4f,
  crateDark: 0x7d6240,
  metal: 0x5c6068,
  siteA: 0xf2a33c,
  siteB: 0x57b7e8,
  friend: 0x3f7fbf,
  friendDark: 0x2c5a8a,
  foe: 0xbf4a3a,
  foeDark: 0x8a332a,
  skin: 0xc9a186,
  dark: 0x2a2c30,
};

// Damage is per pellet/bullet at point blank; headshots multiply by `headMult`.
// `falloff` = metres where damage starts dropping, halving by 3x that range.
export const WEAPONS = {
  p9: {
    name: 'P9 Sidearm', slot: 2, price: 0, damage: 26, headMult: 3.4, rpm: 340, auto: false,
    mag: 12, reserve: 120, reloadMs: 1500, spread: 0.011, moveSpread: 0.05, range: 60, falloff: 18,
    kick: 0.011, pellets: 1, zoom: 0,
  },
  kestrel: {
    name: 'Kestrel SMG', slot: 1, price: 1400, damage: 21, headMult: 2.6, rpm: 760, auto: true,
    mag: 32, reserve: 128, reloadMs: 2100, spread: 0.02, moveSpread: 0.075, range: 55, falloff: 14,
    kick: 0.008, pellets: 1, zoom: 0,
  },
  boomstick: {
    name: 'Boomstick Pump', slot: 1, price: 1800, damage: 11, headMult: 1.8, rpm: 68, auto: false,
    mag: 6, reserve: 30, reloadMs: 2600, spread: 0.055, moveSpread: 0.09, range: 26, falloff: 8,
    kick: 0.05, pellets: 8, zoom: 0,
  },
  longbow: {
    name: 'Longbow Rifle', slot: 1, price: 2700, damage: 34, headMult: 4, rpm: 600, auto: true,
    mag: 30, reserve: 120, reloadMs: 2400, spread: 0.007, moveSpread: 0.065, range: 90, falloff: 30,
    kick: 0.014, pellets: 1, zoom: 0,
  },
  deadeye: {
    name: 'Deadeye Bolt', slot: 1, price: 4300, damage: 112, headMult: 2.2, rpm: 42, auto: false,
    mag: 5, reserve: 30, reloadMs: 3200, spread: 0.0015, moveSpread: 0.12, range: 140, falloff: 60,
    kick: 0.07, pellets: 1, zoom: 2.6,
  },
};

export const BUY_ITEMS = [
  { key: 'kestrel', label: 'Kestrel SMG', desc: 'Fast, close-range shredder', kind: 'weapon' },
  { key: 'boomstick', label: 'Boomstick Pump', desc: '8 pellets, room clearer', kind: 'weapon' },
  { key: 'longbow', label: 'Longbow Rifle', desc: 'The all-rounder. One headshot kills', kind: 'weapon' },
  { key: 'deadeye', label: 'Deadeye Bolt', desc: 'One shot, one kill. Right-click to scope', kind: 'weapon' },
  { key: 'armor', label: 'Kevlar Vest', desc: 'Body shots deal 45% less', kind: 'gear', price: 650 },
  { key: 'grenade', label: 'Frag Grenade', desc: 'Press 3 / G. 90 damage at the core', kind: 'gear', price: 300 },
];

export const RULES = {
  roundSeconds: 115,
  buySeconds: 12,
  endSeconds: 4.5,
  bombSeconds: 40,
  plantMs: 3000,
  defuseMs: 5000,
  roundsToWin: 7,
  maxRounds: 12,
  startMoney: 800,
  winReward: 3000,
  lossReward: 1500,
  killReward: 300,
  plantBonus: 300,
  maxMoney: 16000,
  teamSize: 5,
};
