import { Vec, distToSeg } from '../core/util';

export type Side = 0 | 1; // 0 = player (Crimson), 1 = enemy (Slate)
export type TroopType = 'knight' | 'barbarian' | 'archer';
export const TYPES: TroopType[] = ['knight', 'barbarian', 'archer'];
export type Counts = Record<TroopType, number>;

export const enum T { Plain, Forest, Hill, Mountain, River, Bridge, Ford, Village, Fort }
export const TERRAIN_NAME = ['Open ground', 'Forest', 'Hill', 'Mountain', 'River', 'Bridge', 'Ford', 'Village', 'Fort'];

/** ---- Balance: every tunable number for land play lives here. ---- */
export const LAND = {
  tile: 32, w: 48, h: 30,
  moveCost: [1, 1.8, 1.5, Infinity, Infinity, 1, 2.6, 1, 1] as number[],
  fatigueCost: [1, 1.5, 1.5, 0, 0, 1, 2.4, 0.8, 0.8] as number[],
  marchSpeed: { knight: 19, barbarian: 27, archer: 23 } as Record<TroopType, number>,
  marchFatigue: 0.6,      // fatigue per second marching on open ground
  restRecover: 2.6,        // per second resting in the field (needs supply)
  supplyRecover: 7,        // per second resting at a friendly fort / village
  supplyDrain: 0.32,       // supply per second
  supplyRefill: 14,
  starveFatigue: 0.9,      // extra fatigue per second with no supply
  fatigueMarchPenalty: 0.5,
  fatigueFightPenalty: 0.35,
  battleFatigue: 12,
  encounterRange: 26,
  captureTime: 5,
  captureRange: 30,
  retreatDistance: 150,
  retreatImmunity: 12,
};

export const TROOP = {
  knight:    { hp: 110, speed: 27, dmg: 22, cd: 1.1, reach: 20, range: 0,   strength: 3,   label: 'Knights',    blurb: 'Armoured and slow. Crush barbarians; suffer under arrows.' },
  barbarian: { hp: 70,  speed: 60, dmg: 16, cd: 0.85, reach: 19, range: 0,  strength: 2,   label: 'Barbarians', blurb: 'Fast and fierce. Run down archers; break on knights.' },
  archer:    { hp: 45,  speed: 40, dmg: 13, cd: 1.7, reach: 16, range: 235, strength: 2.2, label: 'Archers',    blurb: 'Strike from range. Punish knights; helpless up close.' },
} as const;
/** Damage multiplier attacker -> defender. */
export const VERSUS: Record<TroopType, Record<TroopType, number>> = {
  knight: { knight: 1, barbarian: 1.5, archer: 1 },
  barbarian: { knight: 0.8, barbarian: 1, archer: 1.5 },
  archer: { knight: 1.3, barbarian: 0.85, archer: 1 },
};
export const ARCHER_MELEE = 6;
export const ARROW = { speed: 300, hit: 0.8, movingPenalty: 0.82, treeBlock: 0.55, wallCover: 0.5, hillRange: 1.25, hillDmg: 1.15 };

export type FormationId = 'line' | 'wedge' | 'skirmish';
export const FORMATIONS: Record<FormationId, { name: string; desc: string; speed: number; charge: number; meleeArrowTaken: number; archerCd: number; kite: boolean }> = {
  line: { name: 'Battle Line', desc: 'Knights hold the centre, barbarians the flanks, archers behind. Ranked melee troops take 30% less arrow damage but advance slowly.', speed: 0.9, charge: 1, meleeArrowTaken: 0.7, archerCd: 1, kite: false },
  wedge: { name: 'Wedge', desc: 'Melee troops form a spearhead. 15% faster and the first blow of each charge hits 60% harder — but arrows bite 15% deeper.', speed: 1.15, charge: 1.6, meleeArrowTaken: 1.15, archerCd: 1, kite: false },
  skirmish: { name: 'Skirmish Screen', desc: 'Archers deploy forward in loose order and loose 20% faster, giving ground when threatened. Melee troops wait in reserve.', speed: 1, charge: 1, meleeArrowTaken: 1, archerCd: 0.8, kite: true },
};

export const SIDE_NAME = ['Crimson Host', 'Slate Legion'];
export const SIDE_COLOR = ['#a8323a', '#3b4a63'];
export const SIDE_LIGHT = ['#d8707a', '#8496b8'];

/** ---- Scenario: The River Crossing ---- */
const RIVER_CTRL: Vec[] = [[25, -1], [23.5, 3], [23, 6.5], [25.5, 10], [25, 14.5], [22.5, 19], [24, 24], [27, 27.5], [26, 31]].map(([x, y]) => ({ x, y }));
const RIVER: Vec[] = [];
for (let i = 0; i < RIVER_CTRL.length - 1; i++) {
  const p0 = RIVER_CTRL[Math.max(0, i - 1)], p1 = RIVER_CTRL[i], p2 = RIVER_CTRL[i + 1], p3 = RIVER_CTRL[Math.min(RIVER_CTRL.length - 1, i + 2)];
  for (let k = 0; k < 8; k++) {
    const t = k / 8, t2 = t * t, t3 = t2 * t;
    const c = (a: number, b: number, c2: number, d: number) => 0.5 * (2 * b + (-a + c2) * t + (2 * a - 5 * b + 4 * c2 - d) * t2 + (-a + 3 * b - 3 * c2 + d) * t3);
    RIVER.push({ x: c(p0.x, p1.x, p2.x, p3.x), y: c(p0.y, p1.y, p2.y, p3.y) });
  }
}
RIVER.push(RIVER_CTRL[RIVER_CTRL.length - 1]);
type Blob = [number, number, number, number];
const FORESTS: Blob[] = [[14, 9, 4.5, 3], [16, 20.5, 4, 3], [31, 6, 5, 3.4], [34, 17.5, 2.4, 2.6], [30, 27, 3, 2], [44, 8, 2.5, 3]];
const HILLS: Blob[] = [[20, 14.5, 2.2, 2.6], [37.5, 13, 1.8, 3.4], [10, 24, 3, 2], [38, 4.5, 3, 1.8]];
const MOUNTAINS: Blob[] = [[37.5, 22.5, 3.4, 2.6], [8.5, 3.2, 3.6, 1.9], [44.5, 26.5, 3, 2.4], [2, 27, 2, 2.4]];
export const PLACES = {
  forts: [{ x: 5, y: 15, name: 'Caer Wyn' }, { x: 42, y: 14, name: 'Dun Morrow' }],
  village: { x: 31, y: 22, name: 'Aldermere' },
  crossings: [
    { x: 23, y: 6, name: 'Northbridge', kind: T.Bridge, rows: [6] },
    { x: 25, y: 14, name: 'Heron Ford', kind: T.Ford, rows: [14, 15] },
    { x: 24, y: 24, name: 'Stonebridge', kind: T.Bridge, rows: [24] },
  ],
};

export interface LandMap { w: number; h: number; tile: number; tiles: Uint8Array; river: Vec[]; forests: Blob[]; hills: Blob[]; mountains: Blob[] }
let cached: LandMap | null = null;
export function landMap(): LandMap {
  if (cached) return cached;
  const { w, h, tile } = LAND;
  const tiles = new Uint8Array(w * h);
  const inBlob = (bs: Blob[], x: number, y: number) => bs.some(([cx, cy, rx, ry]) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const cx = x + 0.5, cy = y + 0.5;
    let t = T.Plain;
    if (inBlob(FORESTS, cx, cy)) t = T.Forest;
    if (inBlob(HILLS, cx, cy)) t = T.Hill;
    if (inBlob(MOUNTAINS, cx, cy)) t = T.Mountain;
    let rd = Infinity;
    for (let i = 0; i < RIVER.length - 1; i++) rd = Math.min(rd, distToSeg({ x: cx, y: cy }, RIVER[i], RIVER[i + 1]));
    if (rd < 0.85) {
      t = T.River;
      for (const c of PLACES.crossings) if (c.rows.includes(y)) t = c.kind;
    } else if (rd < 1.9 && t === T.Mountain) t = T.Plain;
    tiles[y * w + x] = t;
  }
  const clear = (px: number, py: number, to: T) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const i = (py + dy) * w + px + dx;
      if (tiles[i] !== T.River && tiles[i] < T.Bridge) tiles[i] = T.Plain;
    }
    tiles[py * w + px] = to;
  };
  PLACES.forts.forEach((f) => clear(f.x, f.y, T.Fort));
  clear(PLACES.village.x, PLACES.village.y, T.Village);
  cached = { w, h, tile, tiles, river: RIVER, forests: FORESTS, hills: HILLS, mountains: MOUNTAINS };
  return cached;
}
export const tileAt = (wx: number, wy: number): T => {
  const m = landMap(), x = Math.floor(wx / m.tile), y = Math.floor(wy / m.tile);
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return T.Mountain;
  return m.tiles[y * m.w + x];
};
export const tileCenter = (tx: number, ty: number): Vec => ({ x: (tx + 0.5) * LAND.tile, y: (ty + 0.5) * LAND.tile });
export const WORLD = { w: LAND.w * LAND.tile, h: LAND.h * LAND.tile };

export type Role = 'garrison' | 'assault' | 'raid' | 'hold' | 'reserve';
export const START_SQUADS: { side: Side; name: string; at: [number, number]; counts: [number, number, number]; role?: Role; via?: number }[] = [
  { side: 0, name: 'The Vanguard', at: [8, 13], counts: [5, 3, 4] },
  { side: 0, name: 'Greenwood Bows', at: [7, 17], counts: [2, 2, 8] },
  { side: 0, name: 'Border Reavers', at: [9, 15], counts: [2, 8, 2] },
  { side: 0, name: 'The Castle Guard', at: [5, 15], counts: [4, 1, 4] },
  { side: 1, name: 'Morrow Garrison', at: [42, 14], counts: [4, 2, 5], role: 'garrison' },
  { side: 1, name: 'Iron Column', at: [39, 17], counts: [6, 2, 3], role: 'assault', via: 2 },
  { side: 1, name: 'Wolf Pack', at: [38, 11], counts: [1, 9, 2], role: 'raid', via: 1 },
  { side: 1, name: 'Ridge Archers', at: [39, 14], counts: [2, 2, 7], role: 'hold', via: 0 },
];
