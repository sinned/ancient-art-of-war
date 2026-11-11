import { Vec, clamp, dist, rand, randRange, distToSeg } from '../core/util';
import { ARCHER_MELEE, ARROW, Counts, FORMATIONS, FormationId, LAND, Side, T, TROOP, TYPES, TroopType, VERSUS } from './data';
import { LandState, Squad, checkAnnihilation, fortPos, routeTo, total } from './sim';

export type Order = 'hold' | 'advance' | 'attack' | 'fallback' | 'move';
export const FIELD = { w: 1000, h: 600 };
export interface Soldier {
  id: number; side: Side; type: TroopType; x: number; y: number; hp: number; cd: number;
  sx: number; sy: number; st: 0 | 1 | 2; // 0 fighting, 1 dead, 2 left the field
  walk: number; atk: number; hit: number; face: number; charged: boolean; deadT: number; moving: boolean;
}
export interface Group { order: Order; ax: number; ay: number }
export interface Arrow { x0: number; y0: number; x1: number; y1: number; t: number; dur: number; target: number; dmg: number; side: Side; hit: boolean }
export interface BattleReport { winner: Side; terrain: T; start: [Counts, Counts]; end: [Counts, Counts]; fled: [boolean, boolean]; names: [string, string]; duration: number }
export interface Battle {
  phase: 'deploy' | 'fight' | 'over'; time: number; terrain: T; defender: Side | -1;
  soldiers: Soldier[]; groups: [Record<TroopType, Group>, Record<TroopType, Group>];
  formation: [FormationId, FormationId]; retreat: [boolean, boolean]; arrows: Arrow[];
  obstacles: { x: number; y: number; r: number; kind: 'tree' | 'house' | 'rock' }[];
  barrier: null | { x0: number; x1: number; g0: number; g1: number; slow: number; kind: 'bridge' | 'ford' | 'wall' };
  hill: null | { x: number; y: number; rx: number; ry: number };
  squads: [number, number]; names: [string, string]; start: [Counts, Counts]; fatigue: [number, number];
  aiT: number; lastHit: [number, number]; mayRetreat: [boolean, boolean]; report: BattleReport | null;
  fx: { x: number; y: number; t: number; kind: 'dust' | 'hit' | 'miss' }[];
}

/** Soldier positions for a formation, facing +x, relative to the squad centre. */
export function formationSlots(c: Counts, f: FormationId): Record<TroopType, Vec[]> {
  const out: Record<TroopType, Vec[]> = { knight: [], barbarian: [], archer: [] };
  const col = (n: number, x: number, gap: number, y0 = 0) => Array.from({ length: n }, (_, i) => ({ x, y: y0 + (i - (n - 1) / 2) * gap }));
  if (f === 'line') {
    out.knight = col(c.knight, 46, 25);
    const half = Math.ceil(c.barbarian / 2), edge = (c.knight * 25) / 2 + 14;
    for (let i = 0; i < c.barbarian; i++) out.barbarian.push({ x: 42, y: i < half ? -edge - i * 23 : edge + (i - half) * 23 });
    out.archer = col(c.archer, -34, 23);
  } else if (f === 'wedge') {
    const melee = c.knight + c.barbarian;
    for (let i = 0; i < melee; i++) {
      const r = (i + 1) >> 1, p = { x: 70 - r * 19, y: (i % 2 ? -1 : 1) * r * 21 };
      (i < c.knight ? out.knight : out.barbarian).push(p);
    }
    out.archer = col(c.archer, -60 - Math.max(0, melee - 8) * 6, 22);
  } else {
    out.archer = col(c.archer, 62, 34);
    out.knight = col(c.knight, -24, 26);
    const half = Math.ceil(c.barbarian / 2), edge = (c.knight * 26) / 2 + 16;
    for (let i = 0; i < c.barbarian; i++) out.barbarian.push({ x: -24, y: i < half ? -edge - i * 24 : edge + (i - half) * 24 });
  }
  return out;
}

const CENTER = [{ x: 190, y: 300 }, { x: 810, y: 300 }];

export function applyFormation(b: Battle, side: Side, f: FormationId) {
  b.formation[side] = f;
  const counts = countAlive(b, side), slots = formationSlots(counts, f), dir = side === 0 ? 1 : -1;
  for (const t of TYPES) {
    const ps = slots[t]; if (!ps.length) continue;
    const cx = ps.reduce((a, p) => a + p.x, 0) / ps.length, cy = ps.reduce((a, p) => a + p.y, 0) / ps.length;
    const g = b.groups[side][t];
    g.ax = CENTER[side].x + cx * dir; g.ay = CENTER[side].y + cy; g.order = 'hold';
    let i = 0;
    for (const s of b.soldiers) if (s.side === side && s.type === t && s.st === 0) {
      const p = ps[i++];
      s.sx = (p.x - cx) * dir; s.sy = p.y - cy; s.x = g.ax + s.sx; s.y = clamp(g.ay + s.sy, 14, FIELD.h - 14); s.sy = s.y - g.ay; s.face = dir;
    }
  }
}
export function countAlive(b: Battle, side: Side, includeFled = false): Counts {
  const c: Counts = { knight: 0, barbarian: 0, archer: 0 };
  for (const s of b.soldiers) if (s.side === side && (s.st === 0 || (includeFled && s.st === 2))) c[s.type]++;
  return c;
}
const bStrength = (b: Battle, side: Side) => { const c = countAlive(b, side); return TYPES.reduce((a, t) => a + c[t] * TROOP[t].strength, 0); };

export function createBattle(st: LandState, a: Squad, e: Squad, terrain: T, defender: Side | -1): Battle {
  const soldiers: Soldier[] = [];
  let id = 1;
  for (const q of [a, e]) for (const t of TYPES) for (let i = 0; i < q.counts[t]; i++)
    soldiers.push({ id: id++, side: q.side, type: t, x: 0, y: 0, hp: TROOP[t].hp, cd: rand(st.rng), sx: 0, sy: 0, st: 0, walk: rand(st.rng) * 6, atk: 0, hit: 0, face: 1, charged: false, deadT: 0, moving: false });
  const grp = (): Record<TroopType, Group> => ({ knight: { order: 'hold', ax: 0, ay: 0 }, barbarian: { order: 'hold', ax: 0, ay: 0 }, archer: { order: 'hold', ax: 0, ay: 0 } });
  const b: Battle = {
    phase: 'deploy', time: 0, terrain, defender, soldiers, groups: [grp(), grp()], formation: ['line', 'line'], retreat: [false, false], arrows: [],
    obstacles: [], barrier: null, hill: null, squads: [a.id, e.id], names: [a.name, e.name],
    start: [{ ...a.counts }, { ...e.counts }], fatigue: [a.fatigue, e.fatigue], aiT: 0.5, lastHit: [-99, -99],
    mayRetreat: [true, e.role !== 'garrison'], report: null, fx: [],
  };
  const r = st.rng;
  const scatter = (n: number, kind: 'tree' | 'house' | 'rock', rad: number, x0: number, x1: number) => {
    for (let i = 0, tries = 0; i < n && tries < 400; tries++) {
      const p = { x: randRange(r, x0, x1), y: randRange(r, 30, FIELD.h - 30) };
      if (dist(p, CENTER[0]) < 150 || dist(p, CENTER[1]) < 150 || b.obstacles.some((o) => dist(o, p) < o.r + rad + 16)) continue;
      b.obstacles.push({ ...p, r: rad, kind }); i++;
    }
  };
  if (terrain === T.Forest) scatter(34, 'tree', 13, 40, 960);
  else if (terrain === T.Village) { scatter(5, 'house', 26, 330, 670); scatter(5, 'tree', 13, 60, 940); }
  else if (terrain === T.Hill) { b.hill = { x: defender === 1 ? 770 : 230, y: 300, rx: 190, ry: 230 }; scatter(4, 'rock', 10, 380, 620); }
  else if (terrain === T.Fort) { const x = defender === 1 ? 660 : 340; b.barrier = { x0: x - 7, x1: x + 7, g0: 235, g1: 365, slow: 1, kind: 'wall' }; }
  else if (terrain === T.Bridge) { b.barrier = { x0: 462, x1: 538, g0: 262, g1: 338, slow: 1, kind: 'bridge' }; scatter(5, 'tree', 13, 60, 940); }
  else if (terrain === T.Ford) { b.barrier = { x0: 462, x1: 538, g0: 200, g1: 400, slow: 0.5, kind: 'ford' }; scatter(5, 'tree', 13, 60, 940); }
  else { scatter(3, 'tree', 13, 300, 700); scatter(3, 'rock', 10, 300, 700); }
  if (b.barrier && b.barrier.kind !== 'wall') b.obstacles = b.obstacles.filter((o) => o.x < 420 || o.x > 580);
  applyFormation(b, 0, 'line');
  applyFormation(b, 1, aiFormation(b, 1, st));
  return b;
}

function aiFormation(b: Battle, side: Side, st: LandState): FormationId {
  const c = countAlive(b, side), n = total(c), foe = countAlive(b, (1 - side) as Side);
  if (b.defender === side) return 'line';
  if (c.barbarian * 2 >= n) return 'wedge';
  if (c.archer * 2 >= n) return foe.barbarian * 2 >= total(foe) ? 'line' : 'skirmish';
  return rand(st.rng) < 0.5 ? 'line' : 'wedge';
}

export function beginFight(st: LandState) {
  const b = st.battle; if (!b || b.phase !== 'deploy') return;
  b.phase = 'fight';
  if (st.autoPlayer) applyFormation(b, 0, aiFormation(b, 0, st));
}
export function groupCentroid(b: Battle, side: Side, t: TroopType): Vec | null {
  let x = 0, y = 0, n = 0;
  for (const s of b.soldiers) if (s.side === side && s.type === t && s.st === 0) { x += s.x; y += s.y; n++; }
  return n ? { x: x / n, y: y / n } : null;
}
/** Player/AI command: give an order to one troop type (or all with t = null). */
export function setOrder(b: Battle, side: Side, t: TroopType | null, order: Order, at?: Vec) {
  const types = t ? [t] : TYPES;
  let shift: Vec | null = null;
  if (order === 'move' && at) {
    let x = 0, y = 0, n = 0;
    for (const s of b.soldiers) if (s.side === side && s.st === 0 && types.includes(s.type)) { x += s.x; y += s.y; n++; }
    if (n) shift = { x: at.x - x / n, y: at.y - y / n };
  }
  for (const ty of types) {
    const g = b.groups[side][ty], c = groupCentroid(b, side, ty);
    if (!c) continue;
    if (g.order === order && order !== 'move') continue;
    g.order = order;
    if (shift) { g.ax = clamp(c.x + shift.x, 20, FIELD.w - 20); g.ay = clamp(c.y + shift.y, 20, FIELD.h - 20); }
    else { g.ax = c.x; g.ay = c.y; }
  }
}
export function setRetreat(b: Battle, side: Side) { b.retreat[side] = true; }

const onHill = (b: Battle, s: Vec) => !!b.hill && ((s.x - b.hill.x) / b.hill.rx) ** 2 + ((s.y - b.hill.y) / b.hill.ry) ** 2 <= 1;
const fightMul = (b: Battle, side: Side) => 1 - (LAND.fatigueFightPenalty * b.fatigue[side]) / 100;

function moveToward(b: Battle, s: Soldier, tx: number, ty: number, speed: number, dt: number): boolean {
  const bar = b.barrier;
  let gx = tx, gy = ty;
  if (bar) {
    const sS = s.x < bar.x0 ? -1 : s.x > bar.x1 ? 1 : 0, sT = tx < bar.x0 ? -1 : tx > bar.x1 ? 1 : 0;
    if (sS === 0) { gy = clamp(sT === 0 ? ty : s.y, bar.g0 + 6, bar.g1 - 6); speed *= bar.slow; }
    else if (sS !== sT) {
      const yc = clamp(s.y, bar.g0 + 8, bar.g1 - 8);
      if (Math.abs(s.y - yc) > 3) { gx = sS < 0 ? bar.x0 - 10 : bar.x1 + 10; gy = yc; }
      else { gx = sT === 0 ? tx : sS < 0 ? bar.x1 + 12 : bar.x0 - 12; gy = s.y; }
    }
  }
  if (b.hill && b.defender !== s.side && onHill(b, s)) speed *= 0.8;
  const dx = gx - s.x, dy = gy - s.y, d = Math.hypot(dx, dy);
  if (d < 1.5) return false;
  const step = Math.min(d, speed * dt), px = s.x;
  s.x += (dx / d) * step; s.y += (dy / d) * step;
  constrain(b, s, px);
  if (Math.abs(dx) > 2) s.face = dx > 0 ? 1 : -1;
  s.walk += dt * (6 + speed * 0.12); s.moving = true;
  return true;
}
function constrain(b: Battle, s: Soldier, px: number) {
  const bar = b.barrier;
  if (bar && s.x > bar.x0 && s.x < bar.x1 && (s.y < bar.g0 + 3 || s.y > bar.g1 - 3)) {
    if (px <= bar.x0 || px >= bar.x1) s.x = px;
    else s.y = clamp(s.y, bar.g0 + 3, bar.g1 - 3);
  }
  s.y = clamp(s.y, 10, FIELD.h - 10);
  if (!b.retreat[s.side]) s.x = clamp(s.x, 10, FIELD.w - 10);
}

function hurt(st: LandState, b: Battle, s: Soldier, dmg: number) {
  s.hp -= dmg; s.hit = 0.25;
  if (s.hp <= 0 && s.st === 0) {
    s.st = 1; s.deadT = 0; st.events.push('death');
    if (s.side === 0) st.stats.losses++; else st.stats.kills++;
  }
}

export function stepBattle(st: LandState, dt: number) {
  const b = st.battle;
  if (!b) return;
  for (const s of b.soldiers) { if (s.st === 1) s.deadT += dt; s.atk = Math.max(0, s.atk - dt * 3); s.hit = Math.max(0, s.hit - dt); }
  for (const f of b.fx) f.t += dt;
  b.fx = b.fx.filter((f) => f.t < 0.7);
  if (b.phase !== 'fight') return;
  b.time += dt;
  b.aiT -= dt;
  if (b.aiT <= 0) { b.aiT = 0.8; battleAI(b, 1); if (st.autoPlayer) battleAI(b, 0); }
  const alive = b.soldiers.filter((s) => s.st === 0);
  const foesOf = [alive.filter((s) => s.side === 1), alive.filter((s) => s.side === 0)];
  // group anchors
  for (const side of [0, 1] as Side[]) for (const t of TYPES) {
    const g = b.groups[side][t], F = FORMATIONS[b.formation[side]];
    const v = TROOP[t].speed * fightMul(b, side) * (t === 'archer' ? 1 : F.speed) * 0.92 * dt;
    if (g.order === 'advance') {
      let ne: Soldier | null = null, nd = Infinity;
      for (const e of foesOf[side]) { const d = Math.hypot(e.x - g.ax, e.y - g.ay); if (d < nd) { nd = d; ne = e; } }
      const stop = t === 'archer' ? TROOP.archer.range * 0.88 : 24;
      if (ne && nd > stop) { g.ax += ((ne.x - g.ax) / nd) * v; g.ay += ((ne.y - g.ay) / nd) * v * 0.6; }
    } else if (g.order === 'fallback') {
      const ex = side === 0 ? 80 : FIELD.w - 80;
      if (Math.abs(g.ax - ex) > 2) g.ax += Math.sign(ex - g.ax) * Math.min(v, Math.abs(ex - g.ax));
    } else if (g.order === 'attack') {
      const c = groupCentroid(b, side, t); if (c) { g.ax = c.x; g.ay = c.y; }
    }
  }
  // soldiers
  for (const s of alive) {
    const foes = foesOf[s.side], g = b.groups[s.side][s.type], P = TROOP[s.type], F = FORMATIONS[b.formation[s.side]];
    const fm = fightMul(b, s.side);
    s.cd -= dt; s.moving = false;
    let speed = P.speed * fm * (s.type === 'archer' ? 1 : F.speed);
    if (b.retreat[s.side]) {
      moveToward(b, s, s.side === 0 ? -30 : FIELD.w + 30, s.y, speed * 1.1, dt);
      if (s.x < -8 || s.x > FIELD.w + 8) s.st = 2;
      continue;
    }
    let ne: Soldier | null = null, nd = Infinity, nm = Infinity;
    for (const e of foes) { const d = Math.hypot(e.x - s.x, e.y - s.y); if (d < nd) { nd = d; ne = e; } if (e.type !== 'archer' && d < nm) nm = d; }
    const slotX = g.ax + s.sx, slotY = g.ay + s.sy;
    if (!ne) { moveToward(b, s, slotX, slotY, speed, dt); continue; }
    if (s.type === 'archer') {
      const range = P.range * (onHill(b, s) ? ARROW.hillRange : 1);
      if (nd < 22) {
        if (s.cd <= 0) { s.cd = 1.2; s.atk = 1; hurt(st, b, ne, ARCHER_MELEE * fm); st.events.push('clash'); }
        if (F.kite) moveToward(b, s, s.x + (s.x - ne.x), s.y + (s.y - ne.y), speed, dt);
        continue;
      }
      if (F.kite && nm < 85 && g.order !== 'attack') { moveToward(b, s, s.x + (s.side === 0 ? -60 : 60), s.y, speed, dt); continue; }
      let moved = false;
      if (g.order === 'attack') { if (nd > range * 0.92) moved = moveToward(b, s, ne.x, ne.y, speed, dt); }
      else if (Math.hypot(slotX - s.x, slotY - s.y) > 4) moved = moveToward(b, s, slotX, slotY, speed, dt);
      if (!moved && s.cd <= 0) {
        let tg: Soldier | null = null, best = Infinity;
        for (const e of foes) {
          const d = Math.hypot(e.x - s.x, e.y - s.y);
          if (d > range) continue;
          const score = d * (e.type === 'knight' ? 0.8 : 1);
          if (score < best) { best = score; tg = e; }
        }
        if (tg) shoot(st, b, s, tg, fm);
      }
      if (!moved) s.face = ne.x > s.x ? 1 : -1;
      continue;
    }
    // melee
    let tg: Soldier | null = null, td = Infinity;
    if (g.order === 'attack') {
      let best = Infinity;
      for (const e of foes) {
        const d = Math.hypot(e.x - s.x, e.y - s.y);
        const pref = s.type === 'barbarian' ? (e.type === 'archer' ? 0.6 : 1) : e.type === 'barbarian' ? 0.75 : 1;
        if (d * pref < best) { best = d * pref; tg = e; td = d; }
      }
    } else {
      const eng = g.order === 'advance' ? 85 : g.order === 'hold' ? 50 : 26;
      if (nd < eng && (g.order !== 'hold' || Math.hypot(ne.x - slotX, ne.y - slotY) < 80)) { tg = ne; td = nd; }
    }
    if (tg) {
      if (td > P.reach) moveToward(b, s, tg.x, tg.y, speed, dt);
      else {
        s.face = tg.x > s.x ? 1 : -1;
        if (s.cd <= 0) {
          let dmg = P.dmg * VERSUS[s.type][tg.type] * fm * randRange(st.rng, 0.85, 1.15);
          if (onHill(b, s) && !onHill(b, tg)) dmg *= ARROW.hillDmg;
          if (!s.charged) { s.charged = true; if (g.order === 'attack' || g.order === 'advance') dmg *= F.charge; }
          s.cd = P.cd; s.atk = 1; hurt(st, b, tg, dmg);
          b.fx.push({ x: (s.x + tg.x) / 2, y: (s.y + tg.y) / 2 - 8, t: 0, kind: 'hit' }); st.events.push('clash');
        }
      }
    } else moveToward(b, s, slotX, slotY, speed, dt);
  }
  // arrows
  for (const a of b.arrows) {
    a.t += dt;
    if (a.t >= a.dur) {
      const tg = b.soldiers[a.target - 1];
      if (a.hit && tg.st === 0) { hurt(st, b, tg, a.dmg); b.lastHit[tg.side] = b.time; b.fx.push({ x: tg.x, y: tg.y - 8, t: 0, kind: 'hit' }); st.events.push('hit'); }
      else b.fx.push({ x: a.x1, y: a.y1, t: 0, kind: 'miss' });
    }
  }
  b.arrows = b.arrows.filter((a) => a.t < a.dur);
  // separation and obstacles
  for (let i = 0; i < alive.length; i++) {
    const p = alive[i], px = p.x;
    for (let j = i + 1; j < alive.length; j++) {
      const q = alive[j], dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy;
      if (d2 < 256 && d2 > 0.01) {
        const d = Math.sqrt(d2), push = (16 - d) * 0.5, qx = q.x;
        p.x -= (dx / d) * push; p.y -= (dy / d) * push; q.x += (dx / d) * push; q.y += (dy / d) * push;
        constrain(b, q, qx);
      }
    }
    for (const o of b.obstacles) {
      const dx = p.x - o.x, dy = p.y - o.y, d = Math.hypot(dx, dy), min = o.r + 5;
      if (d < min && d > 0.01) { p.x = o.x + (dx / d) * min; p.y = o.y + (dy / d) * min; }
    }
    constrain(b, p, px);
  }
  // end of battle
  const n0 = b.soldiers.some((s) => s.side === 0 && s.st === 0), n1 = b.soldiers.some((s) => s.side === 1 && s.st === 0);
  if (!n0 || !n1) {
    b.phase = 'over';
    const winner: Side = n0 ? 0 : n1 ? 1 : (b.retreat[0] ? 1 : 0);
    b.report = {
      winner, terrain: b.terrain, start: b.start, end: [countAlive(b, 0, true), countAlive(b, 1, true)],
      fled: [b.retreat[0] && total(countAlive(b, 0, true)) > 0, b.retreat[1] && total(countAlive(b, 1, true)) > 0], names: b.names, duration: b.time,
    };
    st.events.push(winner === 0 ? 'battle-won' : 'battle-lost');
    if (st.autoPlayer) concludeBattle(st);
  }
}

function shoot(st: LandState, b: Battle, s: Soldier, tg: Soldier, fm: number) {
  const F = FORMATIONS[b.formation[s.side]], d = Math.hypot(tg.x - s.x, tg.y - s.y);
  s.cd = (TROOP.archer.cd * F.archerCd * randRange(st.rng, 0.9, 1.15)) / fm; s.atk = 1;
  let chance = ARROW.hit * (tg.moving ? ARROW.movingPenalty : 1);
  for (const o of b.obstacles) if (o.kind !== 'rock' && distToSeg(o, s, tg) < o.r + 5) chance *= ARROW.treeBlock;
  const bar = b.barrier;
  if (bar && bar.kind === 'wall' && b.defender === tg.side && (tg.side === 1 ? tg.x > bar.x1 : tg.x < bar.x0) && (s.x < bar.x0) !== (tg.x < bar.x0)) chance *= ARROW.wallCover;
  const hit = rand(st.rng) < chance;
  const TF = FORMATIONS[b.formation[tg.side]], tgG = b.groups[tg.side][tg.type];
  let dmg = TROOP.archer.dmg * VERSUS.archer[tg.type] * randRange(st.rng, 0.85, 1.15);
  if (tg.type !== 'archer') dmg *= TF.meleeArrowTaken < 1 && tgG.order === 'attack' ? 1 : TF.meleeArrowTaken;
  if (onHill(b, s) && !onHill(b, tg)) dmg *= ARROW.hillDmg;
  const off = hit ? 0 : 14 + rand(st.rng) * 16, oa = rand(st.rng) * 6.28;
  b.arrows.push({ x0: s.x, y0: s.y - 10, x1: tg.x + Math.cos(oa) * off, y1: tg.y + Math.sin(oa) * off, t: 0, dur: Math.max(0.25, d / ARROW.speed), target: tg.id, dmg, side: s.side, hit });
  st.events.push('arrow');
}

/** Tactical opponent. Reads only what a commander could see; issues the same orders the player can. */
export function battleAI(b: Battle, me: Side) {
  if (b.retreat[me]) return;
  const foe = (1 - me) as Side, mine = countAlive(b, me), theirs = countAlive(b, foe);
  if (b.mayRetreat[me] && b.time > 6 && bStrength(b, me) < 0.3 * bStrength(b, foe) && total(mine) <= 4) { b.retreat[me] = true; return; }
  const underFire = b.time - b.lastHit[me] < 3;
  const defending = b.defender === me && (b.terrain === T.Fort || b.terrain === T.Hill);
  const near = (t: TroopType, ft?: TroopType) => {
    const c = groupCentroid(b, me, t); if (!c) return Infinity;
    let d = Infinity;
    for (const s of b.soldiers) if (s.side === foe && s.st === 0 && (!ft || s.type === ft)) d = Math.min(d, dist(s, c));
    return d;
  };
  if (defending && (mine.archer >= theirs.archer || !underFire)) {
    for (const t of TYPES) setOrder(b, me, t, t !== 'archer' && near(t) < 120 && b.terrain !== T.Fort ? 'attack' : 'hold');
    return;
  }
  if (mine.archer) {
    const threatened = Math.min(near('archer', 'knight'), near('archer', 'barbarian')) < 95;
    setOrder(b, me, 'archer', threatened && mine.knight + mine.barbarian > 0 ? 'fallback' : 'advance');
  }
  if (mine.knight) setOrder(b, me, 'knight', near('knight') < 170 || b.barrier ? (near('knight') < 420 || b.time > 10 ? 'attack' : 'advance') : 'advance');
  if (mine.barbarian) setOrder(b, me, 'barbarian', (theirs.archer && near('barbarian', 'archer') < 380) || near('barbarian') < 170 || b.time > 10 ? 'attack' : 'advance');
}

/** Write the battle's outcome back into the single authoritative strategic state. */
export function concludeBattle(st: LandState) {
  const b = st.battle;
  if (!b || !b.report) return;
  const rep = b.report;
  for (const side of [0, 1] as Side[]) {
    const sq = st.squads.find((q) => q.id === b.squads[side]);
    if (!sq) continue;
    sq.counts = { ...rep.end[side] };
    sq.fatigue = clamp(sq.fatigue + LAND.battleFatigue, 0, 100);
    sq.path = []; sq.immune = 2;
    if (total(sq.counts) === 0) { st.squads = st.squads.filter((q) => q !== sq); continue; }
    if (rep.winner !== side) {
      const home = fortPos(side), r = routeTo(sq, home.x, home.y);
      let left = LAND.retreatDistance;
      for (const p of r.path ?? []) { const d = dist(sq, p); if (d > left) break; left -= d; sq.x = p.x; sq.y = p.y; }
      sq.immune = LAND.retreatImmunity; sq.fatigue = clamp(sq.fatigue + 10, 0, 100);
    }
  }
  if (rep.winner === 0) st.stats.battlesWon++; else st.stats.battlesLost++;
  st.lastReport = rep; st.battle = null;
  checkAnnihilation(st);
}
