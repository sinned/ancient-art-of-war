import { Vec, angDiff, angNorm, clamp, dist, rand, randRange } from '../core/util';
import { CLASS, PORTS, SEA, SHOT, Shot, Side, W, pointOfSail, terrainAt } from './data';
import { SeaState, Ship, Squadron, checkFlagships, seaRoute, shipsOf } from './sim';

export const ARENA = { w: 1280, h: 800 };
export type Broadside = 0 | 1; // 0 = port (left of heading), 1 = starboard
export interface Unit {
  ship: number; x: number; y: number; heading: number; speed: number; sail: 0 | 1 | 2;
  course: number; wp: Vec | null; reload: [number, number]; shot: Shot;
  st: 'active' | 'sunk' | 'escaped'; mode: 'manual' | 'engage' | 'withdraw'; fireAtWill: boolean;
  grappled: boolean; fleeing: boolean; boardCd: number; sinkT: number; aground: number; aiT: number; flash: number;
}
export interface Boarding { a: number; t: number; time: number; tick: number; a0: number; t0: number; done: '' | 'captured' | 'repelled' | 'reversed'; doneT: number }
export interface SeaReport { winner: Side | -1; lines: string[]; sunk: string[]; captured: string[]; lost: string[]; taken: string[]; duration: number }
export interface SeaBattle {
  phase: 'fight' | 'over'; time: number; ox: number; oy: number; units: Unit[]; squads: number[];
  volleys: { target: number; from: number; hull: number; rig: number; crew: number; t: number; dur: number; raked: boolean }[];
  balls: { x0: number; y0: number; x1: number; y1: number; t: number; dur: number; hit: boolean }[];
  fx: { x: number; y: number; t: number; life: number; kind: 'smoke' | 'splash' | 'text' | 'debris'; text?: string; vx: number; vy: number }[];
  boardings: Boarding[]; report: SeaReport | null; log: { sunk: string[]; captured: string[]; lost: string[]; taken: string[] };
  notice: string; noticeT: number;
}
export const shipOf = (st: SeaState, u: Unit): Ship => st.ships[u.ship - 1];
export const tacTerrain = (b: SeaBattle, x: number, y: number): W =>
  x < 0 || y < 0 || x > ARENA.w || y > ARENA.h ? W.Deep : terrainAt(b.ox + x / SEA.tacScale, b.oy + y / SEA.tacScale);
const blocked = (b: SeaBattle, s: Ship, x: number, y: number) => {
  const t = tacTerrain(b, x, y);
  return t === W.Land || (t === W.Shallow && CLASS[s.cls].deep);
};

export function createSeaBattle(st: SeaState, squads: Squadron[], mid: Vec): SeaBattle {
  const vw = ARENA.w / SEA.tacScale, vh = ARENA.h / SEA.tacScale;
  const b: SeaBattle = {
    phase: 'fight', time: 0, ox: clamp(mid.x - vw / 2, 0, SEA.w - vw), oy: clamp(mid.y - vh / 2, 0, SEA.h - vh), units: [], squads: squads.map((q) => q.id),
    volleys: [], balls: [], fx: [], boardings: [], report: null, log: { sunk: [], captured: [], lost: [], taken: [] }, notice: '', noticeT: 0,
  };
  const cen = [0, 1].map((side) => {
    const qs = squads.filter((q) => q.side === side);
    return { x: qs.reduce((a, q) => a + q.x, 0) / qs.length, y: qs.reduce((a, q) => a + q.y, 0) / qs.length };
  });
  let ang = Math.atan2(cen[1].y - cen[0].y, cen[1].x - cen[0].x);
  if (dist(cen[0], cen[1]) < 1) ang = 0;
  for (const side of [0, 1] as Side[]) {
    const dir = side === 0 ? ang + Math.PI : ang, ships = squads.filter((q) => q.side === side).flatMap((q) => shipsOf(st, q));
    ships.forEach((s, i) => {
      const off = (i - (ships.length - 1) / 2) * 150;
      let px = ARENA.w / 2 + Math.cos(dir) * 380 - Math.sin(dir) * off, py = ARENA.h / 2 + Math.sin(dir) * 380 * 0.75 + Math.cos(dir) * off;
      px = clamp(px, 90, ARENA.w - 90); py = clamp(py, 90, ARENA.h - 90);
      // find clear water near the intended station
      search: for (let r = 0; r < 700; r += 35) for (let k = 0; k < 12; k++) {
        const qx = px + Math.cos(k * 0.52) * r, qy = py + Math.sin(k * 0.52) * r;
        if (qx < 70 || qy < 70 || qx > ARENA.w - 70 || qy > ARENA.h - 70) continue;
        let ok = true;
        for (let m = 0; m < 8 && ok; m++) ok = !blocked(b, s, qx + Math.cos(m * 0.785) * 70, qy + Math.sin(m * 0.785) * 70);
        if (ok && !b.units.some((u) => Math.hypot(u.x - qx, u.y - qy) < 110)) { px = qx; py = qy; break search; }
      }
      const h = dir + Math.PI;
      b.units.push({ ship: s.id, x: px, y: py, heading: h, speed: CLASS[s.cls].speed * 0.3, sail: 1, course: h, wp: null, reload: [0, 0], shot: 'round', st: 'active',
        mode: side === 1 || st.autoPlayer ? 'engage' : 'manual', fireAtWill: true, grappled: false, fleeing: false, boardCd: 0, sinkT: 0, aground: 0, aiT: rand(st.rng) * 0.4, flash: 0 });
    });
  }
  return b;
}

export const sideOf = (st: SeaState, u: Unit) => shipOf(st, u).side;
export const maxSpeed = (st: SeaState, u: Unit) => {
  const s = shipOf(st, u), C = CLASS[s.cls];
  return C.speed * SEA.sail[u.sail] * pointOfSail(u.heading, st.wind) * (0.3 + (0.7 * s.rig) / 100);
};
export const reloadTime = (s: Ship) => CLASS[s.cls].reload / (0.4 + (0.6 * s.crew) / CLASS[s.cls].crew);

/** Bearing test: is `t` inside u's port or starboard arc and in range for the loaded shot? */
export function inArc(st: SeaState, u: Unit, t: Unit, side: Broadside, shot: Shot = u.shot): boolean {
  const d = Math.hypot(t.x - u.x, t.y - u.y);
  if (d > SEA.range * SHOT[shot].range) return false;
  const beam = u.heading + (side === 0 ? -Math.PI / 2 : Math.PI / 2);
  return Math.abs(angDiff(beam, Math.atan2(t.y - u.y, t.x - u.x))) <= SEA.arc;
}
export function arcTarget(st: SeaState, b: SeaBattle, u: Unit, side: Broadside): Unit | null {
  let best: Unit | null = null, bd = Infinity;
  for (const t of b.units) {
    if (t.st !== 'active' || sideOf(st, t) === sideOf(st, u) || !inArc(st, u, t, side)) continue;
    const d = Math.hypot(t.x - u.x, t.y - u.y);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}
export function fire(st: SeaState, b: SeaBattle, u: Unit, side: Broadside): { ok: boolean; reason?: string } {
  if (u.st !== 'active') return { ok: false, reason: 'She is out of the fight.' };
  if (u.grappled) return { ok: false, reason: 'Her crew is fighting hand to hand.' };
  if (u.reload[side] > 0) return { ok: false, reason: `Still reloading — ${u.reload[side].toFixed(0)}s.` };
  const t = arcTarget(st, b, u, side);
  if (!t) return { ok: false, reason: `No enemy inside the ${side === 0 ? 'port' : 'starboard'} arc. Turn to bring her abeam.` };
  const s = shipOf(st, u), C = CLASS[s.cls], S = SHOT[u.shot], ts = shipOf(st, t);
  const d = Math.hypot(t.x - u.x, t.y - u.y), R = SEA.range * S.range;
  const n = Math.max(2, Math.round((C.guns * (0.35 + (0.65 * s.crew) / C.crew)) / 2));
  const chance = clamp(1.02 - (d / R) * 0.55, 0.3, 0.95) * (u.sail === 2 ? SEA.fullSailAim : 1);
  const shotAng = Math.atan2(t.y - u.y, t.x - u.x);
  const keel = Math.abs(angNorm(shotAng - t.heading));
  const raked = keel < SEA.rakeArc || keel > Math.PI - SEA.rakeArc;
  let hits = 0;
  const bx = Math.cos(u.heading), by = Math.sin(u.heading), dur = clamp(d / 520, 0.2, 0.8);
  for (let i = 0; i < n; i++) {
    const hit = rand(st.rng) < chance; if (hit) hits++;
    const along = (i / (n - 1) - 0.5) * C.len * 0.7, spread = hit ? CLASS[ts.cls].len * 0.3 : 40 + rand(st.rng) * 40, a = rand(st.rng) * 6.28;
    const x0 = u.x + bx * along, y0 = u.y + by * along;
    b.balls.push({ x0, y0, x1: t.x + Math.cos(a) * spread * (hit ? rand(st.rng) : 1), y1: t.y + Math.sin(a) * spread * (hit ? rand(st.rng) : 1), t: -i * 0.03, dur, hit });
    b.fx.push({ x: x0 + Math.cos(shotAng) * 14, y: y0 + Math.sin(shotAng) * 14, t: -i * 0.03, life: 1.6, kind: 'smoke', vx: Math.cos(shotAng) * 22 + Math.cos(st.wind) * 8, vy: Math.sin(shotAng) * 22 + Math.sin(st.wind) * 8 });
  }
  const mul = (raked ? SEA.rakeMul : 1) * randRange(st.rng, 0.9, 1.1);
  b.volleys.push({ target: t.ship, from: u.ship, hull: hits * S.hull * mul, rig: hits * S.rig * mul * (t.sail === 2 ? SEA.fullSailRigVuln : 1), crew: hits * S.crew * mul, t: 0, dur, raked: raked && hits > 0 });
  u.reload[side] = reloadTime(s); u.flash = 0.3;
  st.events.push('cannon');
  return { ok: true };
}

export function canBoard(st: SeaState, b: SeaBattle, u: Unit, t: Unit): { ok: boolean; reason?: string } {
  const s = shipOf(st, u), ts = shipOf(st, t), T = CLASS[ts.cls];
  if (u.st !== 'active' || t.st !== 'active' || s.side === ts.side) return { ok: false, reason: 'No enemy ship to board.' };
  if (u.grappled || t.grappled) return { ok: false, reason: 'A boarding action is already under way.' };
  if (u.boardCd > 0) return { ok: false, reason: `The crew is regrouping after being thrown back (${u.boardCd.toFixed(0)}s).` };
  if (dist(u, t) > SEA.boardRange) return { ok: false, reason: `Bring her alongside ${ts.name} — within a pistol shot.` };
  const rv = Math.hypot(Math.cos(u.heading) * u.speed - Math.cos(t.heading) * t.speed, Math.sin(u.heading) * u.speed - Math.sin(t.heading) * t.speed);
  if (rv > SEA.boardRelSpeed) return { ok: false, reason: 'Passing too fast to grapple. Match her course and speed.' };
  if (ts.hull > T.hull * SEA.boardHull && ts.crew > T.crew * SEA.boardCrew && ts.rig > SEA.boardRig * 100)
    return { ok: false, reason: `${ts.name} is still too strong to board. Batter her hull, crew or rigging first.` };
  return { ok: true };
}
export function boardTarget(st: SeaState, b: SeaBattle, u: Unit): Unit | null {
  let best: Unit | null = null, bd = Infinity;
  for (const t of b.units) if (t.st === 'active' && sideOf(st, t) !== sideOf(st, u)) { const d = dist(u, t); if (d < bd) { bd = d; best = t; } }
  return best;
}
export function board(st: SeaState, b: SeaBattle, u: Unit, t: Unit): { ok: boolean; reason?: string } {
  const c = canBoard(st, b, u, t);
  if (!c.ok) return c;
  u.grappled = t.grappled = true; u.wp = t.wp = null;
  b.boardings.push({ a: u.ship, t: t.ship, time: 0, tick: 0, a0: shipOf(st, u).crew, t0: shipOf(st, t).crew, done: '', doneT: 0 });
  st.events.push('board');
  return { ok: true };
}

function sink(st: SeaState, b: SeaBattle, u: Unit) {
  const s = shipOf(st, u);
  if (u.st !== 'active') return;
  u.st = 'sunk'; s.sunk = true; s.hull = 0; u.grappled = false;
  (s.side === 0 ? b.log.lost : b.log.sunk).push(s.name);
  if (s.side === 0) st.stats.lost++; else st.stats.sunk++;
  for (const bd of b.boardings) if (!bd.done && (bd.a === s.id || bd.t === s.id)) { bd.done = 'repelled'; const o = b.units.find((x) => x.ship === (bd.a === s.id ? bd.t : bd.a)); if (o) o.grappled = false; }
  st.events.push('sunk'); checkFlagships(st);
}
function capture(st: SeaState, b: SeaBattle, victor: Unit, prize: Unit) {
  const vs = shipOf(st, victor), ps = shipOf(st, prize);
  const prizeCrew = Math.max(10, Math.round(vs.crew * 0.3));
  vs.crew -= prizeCrew; ps.crew = prizeCrew; ps.side = vs.side; ps.sq = vs.sq;
  prize.sail = 0; prize.mode = vs.side === 0 && !st.autoPlayer ? 'manual' : 'engage'; prize.reload = [reloadTime(ps), reloadTime(ps)]; prize.wp = null; prize.course = prize.heading;
  (vs.side === 0 ? b.log.captured : b.log.taken).push(ps.name);
  if (vs.side === 0) st.stats.captured++; else st.stats.taken++;
  b.fx.push({ x: prize.x, y: prize.y - 40, t: 0, life: 3, kind: 'text', text: `${ps.name} captured!`, vx: 0, vy: -6 });
  st.events.push('capture'); checkFlagships(st);
}

export function stepSeaBattle(st: SeaState, dt: number) {
  const b = st.battle;
  if (!b) return;
  for (const f of b.fx) { f.t += dt; if (f.t > 0) { f.x += f.vx * dt; f.y += f.vy * dt; } }
  b.fx = b.fx.filter((f) => f.t < f.life);
  for (const u of b.units) if (u.st === 'sunk') u.sinkT += dt;
  if (b.phase !== 'fight') return;
  b.time += dt; b.noticeT -= dt;
  const act = b.units.filter((u) => u.st === 'active');
  for (const u of act) {
    const s = shipOf(st, u), C = CLASS[s.cls];
    u.reload[0] = Math.max(0, u.reload[0] - dt); u.reload[1] = Math.max(0, u.reload[1] - dt);
    u.boardCd = Math.max(0, u.boardCd - dt); u.flash = Math.max(0, u.flash - dt);
    if (u.grappled) { u.speed *= Math.max(0, 1 - dt * 2); continue; }
    if (u.mode !== 'manual') { u.aiT -= dt; if (u.aiT <= 0) { u.aiT = 0.35; shipAI(st, b, u); } }
    if (u.wp) { if (dist(u, u.wp) < 34) u.wp = null; else u.course = Math.atan2(u.wp.y - u.y, u.wp.x - u.x); }
    const rate = C.turn * (0.6 + 0.4 * Math.min(1, u.speed / (C.speed * 0.45))) * (0.55 + (0.45 * s.rig) / 100);
    u.heading = angNorm(u.heading + clamp(angDiff(u.heading, u.course), -rate * dt, rate * dt));
    let target = maxSpeed(st, u);
    const here = tacTerrain(b, u.x, u.y);
    if (here === W.Shallow && C.deep) {
      target *= SEA.shallowSlow; u.aground += dt;
      if (u.aground > 1) { u.aground = 0; s.hull -= SEA.shallowDamage; note(b, u, 'Scraping the shoals!'); if (s.hull <= 0) { sink(st, b, u); continue; } }
    }
    u.speed += (target - u.speed) * Math.min(1, dt * (target > u.speed ? 0.45 : 0.8));
    const nx = u.x + Math.cos(u.heading) * u.speed * dt, ny = u.y + Math.sin(u.heading) * u.speed * dt;
    const bowX = nx + Math.cos(u.heading) * C.len * 0.45, bowY = ny + Math.sin(u.heading) * C.len * 0.45;
    if (tacTerrain(b, bowX, bowY) === W.Land || tacTerrain(b, nx, ny) === W.Land) {
      if (u.speed > 12) { s.hull -= SEA.agroundDamage; note(b, u, 'Aground!'); st.events.push('hit'); if (s.hull <= 0) { sink(st, b, u); continue; } }
      u.speed = 0;
      // slide gently off the shore so a ship can always work free
      u.x -= Math.cos(u.heading) * 6 * dt; u.y -= Math.sin(u.heading) * 6 * dt;
    } else { u.x = nx; u.y = ny; }
    // leaving the arena = disengaging
    if (u.x < 0 || u.y < 0 || u.x > ARENA.w || u.y > ARENA.h) {
      const near = act.some((e) => e !== u && e.st === 'active' && sideOf(st, e) !== s.side && dist(e, u) < SEA.disengageRange);
      const leaving = u.mode === 'withdraw' || u.fleeing;
      if (!leaving) { u.x = clamp(u.x, 0, ARENA.w); u.y = clamp(u.y, 0, ARENA.h); if (s.side === 0) note(b, u, 'Order “Withdraw” to leave the action'); }
      else if (near) { u.x = clamp(u.x, 0, ARENA.w); u.y = clamp(u.y, 0, ARENA.h); if (s.side === 0) note(b, u, 'Cannot disengage — enemy too close'); }
      else { u.st = 'escaped'; continue; }
    }
    if (u.fireAtWill) for (const side of [0, 1] as Broadside[]) if (u.reload[side] <= 0 && arcTarget(st, b, u, side)) fire(st, b, u, side);
  }
  // hull contact
  for (let i = 0; i < act.length; i++) for (let j = i + 1; j < act.length; j++) {
    const p = act[i], q = act[j];
    if (p.st !== 'active' || q.st !== 'active' || (p.grappled && q.grappled)) continue;
    const min = (CLASS[shipOf(st, p).cls].len + CLASS[shipOf(st, q).cls].len) * 0.36, dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
    if (d < min && d > 0.1) {
      const push = (min - d) * 0.5;
      if (!p.grappled) { p.x -= (dx / d) * push; p.y -= (dy / d) * push; p.speed *= 1 - dt * 0.4; }
      if (!q.grappled) { q.x += (dx / d) * push; q.y += (dy / d) * push; q.speed *= 1 - dt * 0.4; }
    }
  }
  // shot in flight
  for (const bl of b.balls) { bl.t += dt; if (bl.t >= bl.dur && !bl.hit) b.fx.push({ x: bl.x1, y: bl.y1, t: 0, life: 0.7, kind: 'splash', vx: 0, vy: 0 }); }
  b.balls = b.balls.filter((bl) => bl.t < bl.dur);
  for (const v of b.volleys) {
    v.t += dt;
    if (v.t < v.dur) continue;
    const tu = b.units.find((u) => u.ship === v.target)!, ts = st.ships[v.target - 1];
    if (tu.st !== 'active') continue;
    ts.hull -= v.hull; ts.rig = Math.max(0, ts.rig - v.rig); ts.crew = Math.max(8, ts.crew - v.crew);
    if (v.hull + v.rig + v.crew > 0) { st.events.push('hit'); for (let k = 0; k < 4; k++) b.fx.push({ x: tu.x, y: tu.y, t: 0, life: 0.8, kind: 'debris', vx: randRange(st.rng, -40, 40), vy: randRange(st.rng, -40, 40) }); }
    if (v.raked) b.fx.push({ x: tu.x, y: tu.y - 34, t: 0, life: 1.6, kind: 'text', text: 'Raked!', vx: 0, vy: -10 });
    if (ts.hull <= 0) sink(st, b, tu);
  }
  b.volleys = b.volleys.filter((v) => v.t < v.dur);
  // boarding actions
  for (const bd of b.boardings) {
    if (bd.done) { bd.doneT += dt; continue; }
    const ua = b.units.find((u) => u.ship === bd.a)!, ut = b.units.find((u) => u.ship === bd.t)!;
    const sa = st.ships[bd.a - 1], sT = st.ships[bd.t - 1];
    bd.time += dt; bd.tick += dt;
    if (bd.tick < SEA.boardTick) continue;
    bd.tick = 0;
    const la = sT.crew * SEA.boardRate * SEA.boardDefender * randRange(st.rng, 0.6, 1.4), lt = sa.crew * SEA.boardRate * randRange(st.rng, 0.6, 1.4);
    sa.crew = Math.max(4, sa.crew - la); sT.crew = Math.max(4, sT.crew - lt);
    st.events.push('clash');
    const finish = (r: Boarding['done']) => { bd.done = r; ua.grappled = ut.grappled = false; };
    if (sT.crew <= bd.t0 * SEA.boardBreak || sT.crew < sa.crew * 0.3) { finish('captured'); capture(st, b, ua, ut); }
    else if (sa.crew <= bd.a0 * SEA.boardBreak || sa.crew < sT.crew * 0.3) {
      if (sa.crew < CLASS[sa.cls].crew * 0.15) { finish('reversed'); capture(st, b, ut, ua); }
      else {
        finish('repelled'); ua.boardCd = 15;
        const a = Math.atan2(ua.y - ut.y, ua.x - ut.x); ua.x += Math.cos(a) * 14; ua.y += Math.sin(a) * 14;
        b.fx.push({ x: ua.x, y: ua.y - 40, t: 0, life: 2.5, kind: 'text', text: 'Boarders repelled!', vx: 0, vy: -6 });
      }
    }
  }
  b.boardings = b.boardings.filter((bd) => bd.doneT < 2.5);
  // end
  const live = [0, 1].map((side) => b.units.some((u) => u.st === 'active' && sideOf(st, u) === side));
  if (!live[0] || !live[1]) endBattle(st, b, live[0] ? 0 : live[1] ? 1 : -1);
}
function note(b: SeaBattle, u: Unit, text: string) {
  if (b.noticeT > 0 && b.notice === text) return;
  b.notice = text; b.noticeT = 2;
  b.fx.push({ x: u.x, y: u.y - 36, t: 0, life: 1.6, kind: 'text', text, vx: 0, vy: -8 });
}
function endBattle(st: SeaState, b: SeaBattle, winner: Side | -1) {
  b.phase = 'over';
  const lines: string[] = [];
  for (const u of b.units) {
    const s = shipOf(st, u), C = CLASS[s.cls];
    lines.push(`${s.side === 0 ? '⚑' : '◆'} ${s.name} (${C.name}) — ${u.st === 'sunk' ? 'sunk' : `${s.side !== s.origSide ? 'captured, ' : ''}${u.st === 'escaped' ? 'withdrew, ' : ''}hull ${Math.round((100 * s.hull) / C.hull)}%, rigging ${Math.round(s.rig)}%, crew ${Math.round(s.crew)}`}`);
  }
  b.report = { winner, lines, ...b.log, duration: b.time };
  st.events.push(winner === 0 ? 'battle-won' : 'battle-lost');
  if (st.autoPlayer) concludeSeaBattle(st);
}

/** Write the battle back into the strategic state: prizes change squadron, the beaten side falls back. */
export function concludeSeaBattle(st: SeaState) {
  const b = st.battle;
  if (!b || !b.report) return;
  for (const id of b.squads) {
    const sq = st.squadrons.find((q) => q.id === id);
    if (!sq) continue;
    sq.path = []; sq.immune = 2;
    if (b.report.winner !== sq.side && shipsOf(st, sq).length) {
      const home = PORTS[sq.side], r = seaRoute(st, sq, home.x, home.y);
      let left = SEA.retreatDistance;
      for (const p of r.path ?? []) { const d = dist(sq, p); if (d > left) break; left -= d; sq.x = p.x; sq.y = p.y; }
      sq.immune = SEA.retreatImmunity;
    }
  }
  st.squadrons = st.squadrons.filter((q) => shipsOf(st, q).length > 0);
  st.lastReport = b.report; st.battle = null;
}

/** Tactical captain. Used by every enemy ship and by player ships given the "Engage" or "Withdraw" order. */
export function shipAI(st: SeaState, b: SeaBattle, u: Unit) {
  const s = shipOf(st, u), C = CLASS[s.cls], me = s.side;
  const foes = b.units.filter((t) => t.st === 'active' && sideOf(st, t) !== me);
  if (!foes.length) return;
  const auto = me === 1 || !!st.autoPlayer;
  let tg = foes[0], best = Infinity;
  for (const t of foes) {
    const ts = shipOf(st, t), score = dist(u, t) + (ts.hull / CLASS[ts.cls].hull) * 160 - (ts.cls === 'flag' ? 60 : 0);
    if (score < best) { best = score; tg = t; }
  }
  const ts = shipOf(st, tg), d = dist(u, tg), bearing = Math.atan2(tg.y - u.y, tg.x - u.x);
  const myPow = b.units.filter((x) => x.st === 'active' && sideOf(st, x) === me).reduce((a, x) => a + shipOf(st, x).hull, 0);
  const foePow = foes.reduce((a, x) => a + shipOf(st, x).hull, 0);
  const flee = u.mode === 'withdraw' || (auto && s.hull < C.hull * (s.cls === 'flag' ? 0.3 : 0.22) && foePow > myPow * 0.6);
  let want: number, sail: 0 | 1 | 2 = 1;
  u.fleeing = flee;
  if (flee) {
    const away = bearing + Math.PI;
    want = pointOfSail(away, st.wind) > 0.6 ? away : st.wind + (angDiff(st.wind, away) > 0 ? 0.5 : -0.5);
    sail = 2;
  } else if (d > 230) {
    want = bearing; sail = d > 380 ? 2 : 1;
    if (pointOfSail(want, st.wind) < 0.45) {
      const up = st.wind + Math.PI, a = up + 0.95, c = up - 0.95;
      want = Math.abs(angDiff(u.heading, a)) < Math.abs(angDiff(u.heading, c)) ? a : c;
    }
  } else {
    const wantBoard = auto && canBoardSoon(ts) && s.crew > ts.crew * 1.5 && !tg.grappled;
    if (wantBoard) { want = d > 74 ? bearing : tg.heading; sail = d > 130 ? 1 : tg.speed > u.speed + 6 ? 1 : 0; }
    else {
      const a = bearing + Math.PI / 2, c = bearing - Math.PI / 2;
      want = Math.abs(angDiff(u.heading, a)) < Math.abs(angDiff(u.heading, c)) ? a : c;
      const toward = angDiff(want, bearing) > 0 ? 1 : -1;
      want += toward * (d > 190 ? 0.35 : d < 120 ? -0.4 : 0);
      if (pointOfSail(want, st.wind) < 0.3) want = want === a ? c : a;
    }
    if (auto) u.shot = d < SEA.range * 0.5 && ts.crew > s.crew * 0.5 && s.crew > ts.crew ? 'grape' : (tg.mode === 'withdraw' || ts.hull < CLASS[ts.cls].hull * 0.25) && ts.rig > 40 && d > 120 ? 'chain' : 'round';
    if (wantBoard && canBoard(st, b, u, tg).ok) board(st, b, u, tg);
  }
  // keep station: do not run aboard a consort
  for (const f of b.units) if (f !== u && f.st === 'active' && sideOf(st, f) === me && !(tg === f)) {
    const fd = dist(u, f);
    if (fd < 150) { const rel = angDiff(want, Math.atan2(f.y - u.y, f.x - u.x)); if (Math.abs(rel) < 1.1) want -= (rel >= 0 ? 1 : -1) * 0.8 * (1 - fd / 150); }
  }
  // steer clear of land, shoals and the arena edge
  const clear = (h: number) => {
    for (const r of [50, 100, 150]) {
      const x = u.x + Math.cos(h) * r, y = u.y + Math.sin(h) * r;
      if (blocked(b, s, x, y)) return false;
      if (!flee && (x < 30 || y < 30 || x > ARENA.w - 30 || y > ARENA.h - 30)) return false;
    }
    return true;
  };
  if (!clear(want)) for (const off of [0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2, -2, 2.6, -2.6]) if (clear(want + off)) { want += off; break; }
  // never settle on a heading inside the wind's eye: bear away to the nearer close-hauled tack
  if (pointOfSail(want, st.wind) < 0.45) {
    const up = st.wind + Math.PI, a1 = up + 1.0, a2 = up - 1.0;
    const pick = Math.abs(angDiff(want, a1)) < Math.abs(angDiff(want, a2)) ? a1 : a2;
    want = clear(pick) ? pick : clear(pick === a1 ? a2 : a1) ? (pick === a1 ? a2 : a1) : want;
  }
  u.course = angNorm(want); u.wp = null; u.sail = sail;
}
const canBoardSoon = (ts: Ship) => { const T = CLASS[ts.cls]; return ts.hull <= T.hull * SEA.boardHull || ts.crew <= T.crew * SEA.boardCrew || ts.rig <= SEA.boardRig * 100; };
