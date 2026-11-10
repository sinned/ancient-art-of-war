import { Vec, TAU, inPoly, angNorm, lerp } from '../core/util';

export type Side = 0 | 1; // 0 = player (Royal squadron), 1 = enemy (Black fleet)
export type ShipClass = 'frigate' | 'line' | 'flag';
export type Shot = 'round' | 'chain' | 'grape';
export const SIDE_NAME = ['Royal Squadron', 'Black Fleet'];
export const SIDE_COLOR = ['#b23a3a', '#22262e'];
export const SIDE_TRIM = ['#f1e7cf', '#c9a24a'];

/** ---- Balance: every tunable number for naval play lives here. ---- */
export const SEA = {
  w: 1600, h: 1000, cell: 25,
  tacScale: 4,               // tactical arena shows a 320x200 slice of the chart at 4x
  stratSpeed: 0.25,           // strategic speed as a fraction of tactical speed
  encounterRange: 30, joinRange: 80,
  portRange: 46, repairHull: 1.3, repairRig: 2.2, repairCrew: 1.1, // % of max per second while docked
  range: 300, arc: 0.61,     // broadside reach (px) and half-arc (rad, ~35 deg)
  rakeArc: 0.44, rakeMul: 1.6,
  fullSailRigVuln: 1.3, fullSailAim: 0.85,
  boardRange: 78, boardRelSpeed: 34, boardHull: 0.4, boardCrew: 0.45, boardRig: 0.25,
  boardTick: 0.5, boardRate: 0.05, boardDefender: 1.15, boardBreak: 0.35,
  disengageRange: 380,
  shallowSlow: 0.3, shallowDamage: 2.5, agroundDamage: 4,
  retreatDistance: 150, retreatImmunity: 12,
  sail: [0.06, 0.62, 1] as number[],
};
export const SAIL_NAME = ['Furled', 'Battle sails', 'Full sail'];
export const CLASS: Record<ShipClass, { name: string; hull: number; crew: number; guns: number; speed: number; turn: number; len: number; reload: number; deep: boolean; blurb: string }> = {
  frigate: { name: 'Frigate', hull: 100, crew: 120, guns: 14, speed: 64, turn: 0.9, len: 58, reload: 7, deep: false, blurb: 'Fast, nimble, shallow-draught. Light broadside.' },
  line: { name: 'Ship of the Line', hull: 185, crew: 220, guns: 26, speed: 46, turn: 0.5, len: 75, reload: 9, deep: true, blurb: 'Slow and deep-draught. Devastating broadside.' },
  flag: { name: 'Flagship', hull: 215, crew: 260, guns: 30, speed: 42, turn: 0.46, len: 85, reload: 9.5, deep: true, blurb: 'The admiral’s ship. Lose her and the day is lost.' },
};
export const SHOT: Record<Shot, { name: string; hull: number; rig: number; crew: number; range: number; desc: string }> = {
  round: { name: 'Round shot', hull: 4.2, rig: 0.9, crew: 1.1, range: 1, desc: 'Smashes hulls at full range.' },
  chain: { name: 'Chain shot', hull: 0.8, rig: 5.5, crew: 0.4, range: 0.8, desc: 'Shreds sails and rigging to cripple speed.' },
  grape: { name: 'Grapeshot', hull: 0.5, rig: 0.8, crew: 5.2, range: 0.55, desc: 'Sweeps the decks at close range before boarding.' },
};

/** Speed factor for a heading relative to the wind. a = angle off the wind's eye (0 = dead upwind, PI = running). */
export function pointOfSail(heading: number, windTo: number): number {
  const a = Math.abs(angNorm(heading - (windTo + Math.PI)));
  if (a < 0.52) return 0.14;
  if (a < 1.05) return lerp(0.14, 0.72, (a - 0.52) / 0.53);
  if (a < 1.75) return lerp(0.72, 1, (a - 1.05) / 0.7);
  if (a < 2.6) return 1;
  return lerp(1, 0.86, (a - 2.6) / (Math.PI - 2.6));
}
export function sailingName(heading: number, windTo: number): string {
  const a = Math.abs(angNorm(heading - (windTo + Math.PI)));
  return a < 0.52 ? 'In irons — too close to the wind' : a < 1.05 ? 'Close-hauled' : a < 1.75 ? 'Beam reach' : a < 2.6 ? 'Broad reach' : 'Running before the wind';
}
export const windAt = (clock: number) => 0.45 + 0.6 * Math.sin(clock / 60) + 0.18 * Math.sin(clock / 19 + 1);

/** ---- Scenario geography: The Narrow Sea ---- */
function blob(cx: number, cy: number, rx: number, ry: number, seed: number, rough = 0.1, n = 56): Vec[] {
  const ph = [seed * 1.7, seed * 2.9 + 1, seed * 4.3 + 2, seed * 0.7 + 3];
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * TAU;
    const r = 1 + rough * (Math.sin(2 * t + ph[0]) * 0.9 + Math.sin(3 * t + ph[1]) * 0.7 + Math.sin(5 * t + ph[2]) * 0.45 + Math.sin(9 * t + ph[3]) * 0.22);
    return { x: cx + Math.cos(t) * rx * r, y: cy + Math.sin(t) * ry * r };
  });
}
export const ISLANDS: { name: string; poly: Vec[]; label?: Vec }[] = [
  { name: 'Sable Coast', poly: blob(-70, 500, 230, 620, 1, 0.06, 80), label: { x: 70, y: 300 } },
  { name: 'Black Shore', poly: blob(1680, 480, 240, 620, 2, 0.06, 80), label: { x: 1522, y: 720 } },
  { name: 'Isle of Terns', poly: blob(800, 265, 255, 165, 3, 0.09), label: { x: 800, y: 250 } },
  { name: 'Marrow Isle', poly: blob(790, 735, 285, 150, 4, 0.09), label: { x: 790, y: 735 } },
  { name: '', poly: blob(420, 170, 62, 48, 5, 0.12, 28) },
  { name: '', poly: blob(1210, 840, 70, 52, 6, 0.12, 28) },
  { name: '', poly: blob(1190, 150, 48, 40, 7, 0.12, 28) },
];
export const SHOALS: { name: string; poly: Vec[]; label: Vec }[] = [
  { name: 'Marrow Shoals', poly: blob(790, 935, 330, 62, 8, 0.08), label: { x: 790, y: 945 } },
  { name: 'Dogger Bank', poly: blob(1165, 500, 95, 70, 9, 0.1), label: { x: 1165, y: 500 } },
  { name: 'The Shallows', poly: blob(700, 560, 190, 30, 10, 0.08), label: { x: 640, y: 562 } },
  { name: '', poly: blob(430, 800, 80, 55, 11, 0.1), label: { x: 430, y: 800 } },
];
export const PORTS = [
  { name: 'Port Sable', x: 205, y: 520, owner: 0 as Side | -1, land: { x: 160, y: 520 } },
  { name: 'Blackwater', x: 1395, y: 470, owner: 1 as Side | -1, land: { x: 1440, y: 470 } },
  { name: "St. Elm's Haven", x: 815, y: 468, owner: -1 as Side | -1, land: { x: 815, y: 425 } },
];
export const enum W { Deep, Shallow, Land }
export function terrainAt(x: number, y: number): W {
  if (x < 0 || y < 0 || x > SEA.w || y > SEA.h) return W.Land;
  const p = { x, y };
  for (const i of ISLANDS) if (inPoly(p, i.poly)) return W.Land;
  for (const s of SHOALS) if (inPoly(p, s.poly)) return W.Shallow;
  return W.Deep;
}
export const GRID = { w: SEA.w / SEA.cell, h: SEA.h / SEA.cell };
let grid: Uint8Array | null = null;
export function seaGrid(): Uint8Array {
  if (grid) return grid;
  grid = new Uint8Array(GRID.w * GRID.h);
  const c = SEA.cell, o = [[0.5, 0.5], [0.12, 0.12], [0.88, 0.12], [0.12, 0.88], [0.88, 0.88]];
  for (let y = 0; y < GRID.h; y++) for (let x = 0; x < GRID.w; x++) {
    let t = W.Deep;
    for (const [ox, oy] of o) t = Math.max(t, terrainAt((x + ox) * c, (y + oy) * c));
    grid[y * GRID.w + x] = t;
  }
  return grid;
}

export const START_SHIPS: { side: Side; cls: ShipClass; name: string; sq: number }[] = [
  { side: 0, cls: 'frigate', name: 'Swift', sq: 1 }, { side: 0, cls: 'frigate', name: 'Kestrel', sq: 1 },
  { side: 0, cls: 'flag', name: 'Sovereign', sq: 2 }, { side: 0, cls: 'line', name: 'Resolute', sq: 2 },
  { side: 0, cls: 'line', name: 'Indomitable', sq: 3 },
  { side: 1, cls: 'frigate', name: 'Viper', sq: 4 }, { side: 1, cls: 'frigate', name: 'Adder', sq: 4 },
  { side: 1, cls: 'line', name: 'Leviathan', sq: 5 },
  { side: 1, cls: 'flag', name: 'Basilisk', sq: 6 }, { side: 1, cls: 'line', name: 'Gorgon', sq: 6 },
];
export type SeaRole = 'raid' | 'escort' | 'admiral' | 'player';
export const START_SQUADRONS: { id: number; side: Side; name: string; x: number; y: number; role: SeaRole }[] = [
  { id: 1, side: 0, name: 'The Vanguard', x: 300, y: 440, role: 'player' },
  { id: 2, side: 0, name: 'The Battle Line', x: 250, y: 520, role: 'player' },
  { id: 3, side: 0, name: 'The Rearguard', x: 290, y: 610, role: 'player' },
  { id: 4, side: 1, name: 'The Raiders', x: 1150, y: 330, role: 'raid' },
  { id: 5, side: 1, name: 'The Escort', x: 1290, y: 560, role: 'escort' },
  { id: 6, side: 1, name: "The Admiral's Division", x: 1385, y: 470, role: 'admiral' },
];
