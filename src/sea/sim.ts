import { Vec, Rng, dist, clamp } from '../core/util';
import { findPath } from '../core/astar';
import { CLASS, GRID, PORTS, SEA, START_SHIPS, START_SQUADRONS, SeaRole, ShipClass, Side, W, pointOfSail, seaGrid, terrainAt, windAt } from './data';
import { SeaBattle, SeaReport, createSeaBattle, stepSeaBattle } from './battle';

export interface Ship { id: number; side: Side; origSide: Side; cls: ShipClass; name: string; hull: number; rig: number; crew: number; sq: number; sunk: boolean }
export interface Squadron { id: number; side: Side; name: string; x: number; y: number; heading: number; path: Vec[]; immune: number; role: SeaRole; aiT: number }
export interface SeaState {
  rng: Rng; time: number; clock: number; wind: number; ships: Ship[]; squadrons: Squadron[];
  battle: SeaBattle | null; lastReport: SeaReport | null;
  result: null | { winner: Side; reason: string }; pending: null | { winner: Side; reason: string; t: number };
  stats: { sunk: number; lost: number; captured: number; taken: number; battles: number };
  events: string[]; autoPlayer?: boolean;
}
export function createSea(seed = 1805): SeaState {
  return {
    rng: { seed }, time: 0, clock: 0, wind: windAt(0), battle: null, lastReport: null, result: null, pending: null,
    stats: { sunk: 0, lost: 0, captured: 0, taken: 0, battles: 0 }, events: [],
    ships: START_SHIPS.map((s, i) => ({ id: i + 1, side: s.side, origSide: s.side, cls: s.cls, name: s.name, hull: CLASS[s.cls].hull, rig: 100, crew: CLASS[s.cls].crew, sq: s.sq, sunk: false })),
    squadrons: START_SQUADRONS.map((q, i) => ({ ...q, heading: q.side === 0 ? 0 : Math.PI, path: [], immune: 0, aiT: 1 + i * 0.4 })),
  };
}
export const shipsOf = (st: SeaState, sq: Squadron) => st.ships.filter((s) => s.sq === sq.id && !s.sunk);
export const isDeep = (st: SeaState, sq: Squadron) => shipsOf(st, sq).some((s) => CLASS[s.cls].deep);
export const shipPower = (s: Ship) => CLASS[s.cls].guns * (0.3 + (0.7 * s.hull) / CLASS[s.cls].hull) * (0.4 + (0.6 * s.crew) / CLASS[s.cls].crew);
export const power = (st: SeaState, sq: Squadron) => shipsOf(st, sq).reduce((a, s) => a + shipPower(s), 0);
export const flagship = (st: SeaState, side: Side) => st.ships.find((s) => s.origSide === side && s.cls === 'flag');
export function squadSpeed(st: SeaState, sq: Squadron, heading = sq.heading): number {
  let v = Infinity;
  for (const s of shipsOf(st, sq)) v = Math.min(v, CLASS[s.cls].speed * (0.35 + (0.65 * s.rig) / 100));
  return (isFinite(v) ? v : 50) * SEA.stratSpeed * pointOfSail(heading, st.wind);
}

export function seaRoute(st: SeaState, sq: Squadron, x: number, y: number): { path: Vec[] | null; reason?: string } {
  const g = seaGrid(), deep = isDeep(st, sq), c = SEA.cell;
  if (x < 0 || y < 0 || x >= SEA.w || y >= SEA.h) return { path: null, reason: 'That lies off the chart.' };
  const t = terrainAt(x, y);
  const tx = Math.floor(x / c), ty = Math.floor(y / c), gt = g[ty * GRID.w + tx];
  if (t === W.Land || gt === W.Land) return { path: null, reason: 'Ships cannot sail over land.' };
  if (deep && gt === W.Shallow) return { path: null, reason: 'Too shallow for ships of the line. Only frigates can cross the shoals.' };
  const sx = clamp(Math.floor(sq.x / c), 0, GRID.w - 1), sy = clamp(Math.floor(sq.y / c), 0, GRID.h - 1);
  const cells = findPath(GRID.w, GRID.h, (i) => (g[i] === W.Land || (deep && g[i] === W.Shallow && i !== sy * GRID.w + sx) ? Infinity : 1), sx, sy, tx, ty,
    (dx, dy) => 1 / pointOfSail(Math.atan2(dy, dx), st.wind));
  if (!cells) return { path: null, reason: 'No navigable passage leads there.' };
  const path = cells.slice(1).map((i) => ({ x: ((i % GRID.w) + 0.5) * c, y: (((i / GRID.w) | 0) + 0.5) * c }));
  if (path.length) path[path.length - 1] = { x, y }; else path.push({ x, y });
  return { path };
}
export function orderSail(st: SeaState, id: number, x: number, y: number): { ok: boolean; reason?: string } {
  const sq = st.squadrons.find((q) => q.id === id);
  if (!sq) return { ok: false, reason: 'No such squadron.' };
  const r = seaRoute(st, sq, x, y);
  if (!r.path) return { ok: false, reason: r.reason };
  sq.path = r.path;
  return { ok: true };
}
export const portFor = (sq: Squadron) => PORTS.find((p) => (p.owner === -1 || p.owner === sq.side) && dist(p, sq) < SEA.portRange);

export function stepSea(st: SeaState, dt: number) {
  if (st.result) return;
  st.clock += dt; st.wind = windAt(st.clock);
  if (st.pending) { st.pending.t -= dt; if (st.pending.t <= 0) { st.result = { winner: st.pending.winner, reason: st.pending.reason }; return; } }
  if (st.battle) { stepSeaBattle(st, dt); return; }
  st.time += dt;
  for (const sq of st.squadrons) {
    if (sq.immune > 0) sq.immune -= dt;
    if (sq.side === 1 || st.autoPlayer) { sq.aiT -= dt; if (sq.aiT <= 0) { sq.aiT = 1.5; seaAI(st, sq); } }
    if (sq.path.length) {
      const p = sq.path[0], d = dist(sq, p);
      sq.heading = Math.atan2(p.y - sq.y, p.x - sq.x);
      const step = squadSpeed(st, sq) * dt;
      if (d <= step) { sq.x = p.x; sq.y = p.y; sq.path.shift(); } else { sq.x += ((p.x - sq.x) / d) * step; sq.y += ((p.y - sq.y) / d) * step; }
    } else if (portFor(sq)) {
      for (const s of shipsOf(st, sq)) {
        const C = CLASS[s.cls];
        s.hull = Math.min(C.hull, s.hull + (C.hull * SEA.repairHull * dt) / 100);
        s.rig = Math.min(100, s.rig + SEA.repairRig * dt);
        s.crew = Math.min(C.crew, s.crew + (C.crew * SEA.repairCrew * dt) / 100);
      }
    }
  }
  for (const a of st.squadrons) if (a.side === 0 && a.immune <= 0) for (const e of st.squadrons) {
    if (e.side !== 1 || e.immune > 0 || dist(a, e) > SEA.encounterRange) continue;
    const mid = { x: (a.x + e.x) / 2, y: (a.y + e.y) / 2 };
    const joined = st.squadrons.filter((q) => q === a || q === e || (q.immune <= 0 && dist(q, mid) < SEA.joinRange));
    st.battle = createSeaBattle(st, joined, mid);
    st.stats.battles++; st.events.push('battle');
    return;
  }
}
/** Flagship rules: called whenever a ship is sunk or changes hands. */
export function checkFlagships(st: SeaState) {
  if (st.pending || st.result) return;
  for (const side of [0, 1] as Side[]) {
    const f = flagship(st, side)!;
    if (f.sunk || f.side !== side) {
      const how = f.sunk ? 'sunk' : 'captured';
      st.pending = { winner: (1 - side) as Side, t: 2.5, reason: side === 1 ? `The enemy flagship ${f.name} has been ${how}. The Narrow Sea is yours.` : `Your flagship ${f.name} has been ${how}. The squadron strikes its colours.` };
    }
  }
}

/** Strategic opponent: hunts, guards and repairs using the same charts, wind and ports as the player. */
function seaAI(st: SeaState, sq: Squadron) {
  const me = sq.side, foes = st.squadrons.filter((q) => q.side !== me);
  const home = PORTS[me], ships = shipsOf(st, sq);
  if (!ships.length) return;
  const go = (p: Vec) => { if (dist(sq, p) < 8) { sq.path = []; return; } const r = seaRoute(st, sq, p.x, p.y); if (r.path) sq.path = r.path; };
  const health = ships.reduce((a, s) => a + s.hull / CLASS[s.cls].hull, 0) / ships.length;
  const mine = power(st, sq);
  let nf: Squadron | null = null, nd = Infinity;
  for (const f of foes) { const d = dist(sq, f); if (d < nd) { nd = d; nf = f; } }
  const docked = !!portFor(sq) && !sq.path.length;
  if (docked && health < 0.9 && nd > 160) return;
  if (sq.role === 'admiral' || (sq.role === 'player' && ships.some((s) => s.cls === 'flag') && st.time < 240)) {
    if (nf && nd < 230 && mine >= power(st, nf) * 1.25) go(nf); else go(home);
    return;
  }
  if (health < 0.5 && nd > 140) { go(home); return; }
  if (nf && nd < 320) {
    const ratio = mine / Math.max(1, power(st, nf));
    if (ratio >= 0.75) { go(nf); return; }
    if (ratio < 0.5) { go(home); return; }
  }
  if (sq.role === 'escort') {
    const threat = foes.filter((f) => dist(f, home) < 380)[0];
    if (threat) go(mine >= power(st, threat) * 0.6 ? threat : home);
    else go(st.time < 200 ? { x: 1290, y: 560 } : { x: 1010, y: 495 });
    return;
  }
  // raiders (and the test autopilot): hunt the weakest squadron, later the flagship
  const fl = flagship(st, (1 - me) as Side)!;
  const flSq = foes.find((f) => f.id === fl.sq);
  const prey = [...foes].sort((a, b) => power(st, a) - power(st, b))[0];
  const target = st.time > 300 && flSq && mine >= power(st, flSq) * 0.5 ? flSq : prey && mine >= power(st, prey) * 0.75 ? prey : null;
  if (target) go(target); else go(home);
}
