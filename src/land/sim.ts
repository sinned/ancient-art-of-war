import { Vec, Rng, dist, clamp } from '../core/util';
import { findPath } from '../core/astar';
import { LAND, T, TYPES, TROOP, Side, Counts, Role, START_SQUADS, PLACES, landMap, tileAt, tileCenter, WORLD } from './data';
import { Battle, BattleReport, createBattle, stepBattle } from './battle';

export interface Squad {
  id: number; side: Side; name: string; x: number; y: number; counts: Counts;
  fatigue: number; supply: number; path: Vec[]; immune: number;
  role: Role; via: number; viaDone: boolean; aiT: number; resting: boolean;
}
export interface LandState {
  rng: Rng; time: number; squads: Squad[]; villageOwner: -1 | 0 | 1; capture: [number, number];
  battle: Battle | null; lastReport: BattleReport | null;
  result: null | { winner: Side; reason: string };
  stats: { battlesWon: number; battlesLost: number; kills: number; losses: number };
  events: string[]; autoPlayer?: boolean;
}

export const total = (c: Counts) => c.knight + c.barbarian + c.archer;
export const strength = (s: Squad) =>
  TYPES.reduce((a, t) => a + s.counts[t] * TROOP[t].strength, 0) * (1 - (LAND.fatigueFightPenalty * s.fatigue) / 100);
export const fortPos = (side: Side): Vec => tileCenter(PLACES.forts[side].x, PLACES.forts[side].y);
export const villagePos = (): Vec => tileCenter(PLACES.village.x, PLACES.village.y);

export function createLand(seed = 1066): LandState {
  return {
    rng: { seed }, time: 0, villageOwner: -1, capture: [0, 0], battle: null, lastReport: null, result: null,
    stats: { battlesWon: 0, battlesLost: 0, kills: 0, losses: 0 }, events: [],
    squads: START_SQUADS.map((q, i) => ({
      id: i + 1, side: q.side, name: q.name, ...tileCenter(q.at[0], q.at[1]),
      counts: { knight: q.counts[0], barbarian: q.counts[1], archer: q.counts[2] },
      fatigue: 0, supply: 100, path: [], immune: 0, role: q.role ?? 'assault', via: q.via ?? 0, viaDone: false, aiT: 1 + i * 0.3, resting: false,
    })),
  };
}

export function squadSpeed(s: Squad): number {
  let v = Infinity;
  for (const t of TYPES) if (s.counts[t] > 0) v = Math.min(v, LAND.marchSpeed[t]);
  return (isFinite(v) ? v : 20) * (1 - (LAND.fatigueMarchPenalty * s.fatigue) / 100);
}

/** Plan a route. Returns waypoints or the reason the destination cannot be reached. */
export function routeTo(from: Vec, x: number, y: number): { path: Vec[] | null; reason?: string; cost?: number } {
  const m = landMap();
  if (x < 0 || y < 0 || x >= WORLD.w || y >= WORLD.h) return { path: null, reason: 'That lies beyond the edge of the map.' };
  const t = tileAt(x, y);
  if (t === T.Mountain) return { path: null, reason: 'Mountains are impassable — march around them.' };
  if (t === T.River) return { path: null, reason: 'The river is too deep here. Cross at a bridge or the ford.' };
  const sx = clamp(Math.floor(from.x / m.tile), 0, m.w - 1), sy = clamp(Math.floor(from.y / m.tile), 0, m.h - 1);
  const tx = Math.floor(x / m.tile), ty = Math.floor(y / m.tile);
  const cells = findPath(m.w, m.h, (i) => LAND.moveCost[m.tiles[i]], sx, sy, tx, ty);
  if (!cells) return { path: null, reason: 'No route leads there.' };
  const path = cells.slice(1).map((c) => tileCenter(c % m.w, (c / m.w) | 0));
  const special = t === T.Fort || t === T.Village || t === T.Bridge;
  if (path.length && !special) path[path.length - 1] = { x, y };
  else if (!path.length && !special) path.push({ x, y });
  let cost = 0, p = from;
  for (const q of path) { cost += dist(p, q) * LAND.moveCost[tileAt(q.x, q.y)]; p = q; }
  return { path, cost };
}

export function orderMove(st: LandState, id: number, x: number, y: number): { ok: boolean; reason?: string } {
  const s = st.squads.find((q) => q.id === id);
  if (!s) return { ok: false, reason: 'No such squad.' };
  const r = routeTo(s, x, y);
  if (!r.path) return { ok: false, reason: r.reason };
  s.path = r.path; s.resting = false;
  return { ok: true };
}
export function orderHalt(st: LandState, id: number) {
  const s = st.squads.find((q) => q.id === id);
  if (s) s.path = [];
}

const atSupply = (st: LandState, s: Squad) =>
  dist(s, fortPos(s.side)) < 44 || (st.villageOwner === s.side && dist(s, villagePos()) < 44);

export function stepLand(st: LandState, dt: number) {
  if (st.result) return;
  if (st.battle) { stepBattle(st, dt); return; }
  st.time += dt;
  for (const s of st.squads) {
    if (s.immune > 0) s.immune -= dt;
    if (s.side === 1 || st.autoPlayer) { s.aiT -= dt; if (s.aiT <= 0) { s.aiT = 1.2; landAI(st, s); } }
    const t = tileAt(s.x, s.y), supplied = atSupply(st, s);
    if (s.path.length) {
      const v = squadSpeed(s) / (isFinite(LAND.moveCost[t]) ? LAND.moveCost[t] : 1);
      let step = v * dt;
      while (step > 0 && s.path.length) {
        const p = s.path[0], d = dist(s, p);
        if (d <= step) { s.x = p.x; s.y = p.y; s.path.shift(); step -= d; }
        else { s.x += ((p.x - s.x) / d) * step; s.y += ((p.y - s.y) / d) * step; step = 0; }
      }
      s.fatigue += LAND.marchFatigue * LAND.fatigueCost[t] * dt;
    } else if (s.supply > 0 || supplied) s.fatigue -= (supplied ? LAND.supplyRecover : LAND.restRecover) * dt;
    if (supplied) s.supply += LAND.supplyRefill * dt;
    else s.supply -= LAND.supplyDrain * dt;
    if (s.supply <= 0) s.fatigue += LAND.starveFatigue * dt;
    s.supply = clamp(s.supply, 0, 100); s.fatigue = clamp(s.fatigue, 0, 100);
  }
  // village ownership
  const vp = villagePos();
  for (const side of [0, 1] as Side[]) {
    const here = st.squads.some((s) => s.side === side && dist(s, vp) < 34);
    const contested = st.squads.some((s) => s.side !== side && dist(s, vp) < 60);
    if (here && !contested && st.villageOwner !== side) { st.villageOwner = side; st.events.push(side === 0 ? 'village-ours' : 'village-lost'); }
  }
  // standards
  for (const side of [0, 1] as Side[]) {
    const fp = fortPos((1 - side) as Side);
    const on = st.squads.some((s) => s.side === side && dist(s, fp) < LAND.captureRange);
    const guarded = st.squads.some((s) => s.side !== side && dist(s, fp) < 70);
    st.capture[side] = on && !guarded ? st.capture[side] + dt : Math.max(0, st.capture[side] - dt * 2);
    if (st.capture[side] >= LAND.captureTime) {
      st.result = { winner: side, reason: side === 0 ? 'Your troops tore down the enemy standard at Dun Morrow.' : 'The enemy seized your standard at Caer Wyn.' };
      return;
    }
  }
  checkAnnihilation(st);
  if (st.result) return;
  // encounters
  for (const a of st.squads) if (a.side === 0 && a.immune <= 0) for (const e of st.squads) {
    if (e.side !== 1 || e.immune > 0 || dist(a, e) > LAND.encounterRange) continue;
    startBattle(st, a, e);
    return;
  }
}
export function checkAnnihilation(st: LandState) {
  for (const side of [0, 1] as Side[]) if (!st.squads.some((s) => s.side === side)) {
    st.result = { winner: (1 - side) as Side, reason: side === 0 ? 'Your host has been destroyed in the field.' : 'Every enemy squad has been destroyed or scattered.' };
  }
}

function startBattle(st: LandState, a: Squad, e: Squad) {
  const rank = (t: T) => (t === T.Fort ? 5 : t === T.Bridge || t === T.Ford ? 4 : t === T.Village ? 3 : t === T.Hill ? 2 : t === T.Forest ? 1 : 0);
  const ta = tileAt(a.x, a.y), te = tileAt(e.x, e.y);
  let terrain = ta, defender: Side | -1 = -1;
  if (rank(te) > rank(ta) || (rank(te) === rank(ta) && !e.path.length && a.path.length)) terrain = te;
  if (terrain === T.Fort || terrain === T.Hill || terrain === T.Village) defender = terrain === te && (rank(te) > rank(ta) || !e.path.length) ? 1 : 0;
  if (terrain === T.Fort) defender = dist(e, fortPos(1)) < dist(a, fortPos(0)) ? 1 : 0;
  st.battle = createBattle(st, a, e, terrain, defender);
  st.events.push('battle');
}

/** Strategic opponent: rule-based, uses the same routes, fatigue and supply as the player. */
function landAI(st: LandState, s: Squad) {
  const me = s.side, foeSide = (1 - me) as Side;
  const foes = st.squads.filter((q) => q.side === foeSide);
  const home = fortPos(me), goal = fortPos(foeSide);
  const go = (p: Vec) => { const r = routeTo(s, p.x, p.y); if (r.path) s.path = r.path; };
  let nf: Squad | null = null, nd = Infinity;
  for (const f of foes) { const d = dist(s, f); if (d < nd) { nd = d; nf = f; } }
  const own = strength(s);
  if (s.role === 'garrison') {
    if (nf && dist(nf, home) < 170 && nd > 30 && strength(nf) < own * 0.7 && s.fatigue < 50) go(nf);
    else if (dist(s, home) > 6) go(home); else s.path = [];
    return;
  }
  if (s.resting) {
    if (s.fatigue < 22 || (nf && nd < 130)) s.resting = false; else { s.path = []; return; }
  }
  if (nf && nd < 240) {
    const ratio = own / Math.max(0.1, strength(nf));
    if (ratio >= 0.8) { go(nf); return; }
    if (ratio < 0.55) { go(home); return; }
  }
  if (s.supply < 14) {
    const sp = st.villageOwner === me && dist(s, villagePos()) < dist(s, home) ? villagePos() : home;
    if (dist(s, sp) > 20) { go(sp); return; }
    s.path = []; if (s.supply < 90) return;
  }
  if (s.fatigue > 70 && nd > 200) { s.resting = true; s.path = []; return; }
  // defend the standard
  const threat = foes.filter((f) => dist(f, home) < 300).sort((p, q) => dist(p, home) - dist(q, home))[0];
  if (threat) {
    const mates = st.squads.filter((q) => q.side === me && q.role !== 'garrison').sort((p, q) => dist(p, home) - dist(q, home));
    if (mates[0] === s && dist(s, home) < 520) { go(threat); return; }
  }
  if (s.role === 'hold') {
    const post = tileCenter(37, 13);
    if (st.time < 150 && foes.length >= 3) { if (dist(s, post) > 10) go(post); else s.path = []; return; }
    s.role = 'assault';
  }
  if (s.role === 'raid' && !s.viaDone) {
    if (st.villageOwner === me) s.viaDone = true;
    else { go(villagePos()); return; }
  }
  const c = PLACES.crossings[s.via], cp = tileCenter(c.x, c.y);
  const crossed = me === 1 ? s.x < cp.x - 20 : s.x > cp.x + 20;
  if (!crossed && dist(s, cp) > 40) go(cp); else go(goal);
}
