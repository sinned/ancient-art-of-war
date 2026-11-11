import { describe, expect, test } from 'vitest';
import { CLASS, GRID, PORTS, SEA, W, pointOfSail, seaGrid, terrainAt } from '../src/sea/data';
import { SeaState, createSea, orderSail, seaRoute, stepSea } from '../src/sea/sim';
import { ARENA, Unit, board, canBoard, concludeSeaBattle, createSeaBattle, fire, inArc, shipOf, stepSeaBattle } from '../src/sea/battle';

const DT = 1 / 30;
const run = (st: SeaState, secs: number) => { for (let i = 0; i < secs * 30; i++) stepSea(st, DT); };
/** Open-water duel between squadron 1 (player frigates) / 2 (flag + line) and an enemy squadron. */
function duel(seed: number, mine = 2, theirs = 6) {
  const st = createSea(seed);
  const a = st.squadrons.find((q) => q.id === mine)!, e = st.squadrons.find((q) => q.id === theirs)!;
  a.x = 380; a.y = 520; e.x = 400; e.y = 520;
  st.battle = createSeaBattle(st, [a, e], { x: 390, y: 520 });
  const us = st.battle.units; us.forEach((u) => { u.mode = 'manual'; u.fireAtWill = false; });
  return { st, b: st.battle, mineU: us.filter((u) => shipOf(st, u).side === 0), foeU: us.filter((u) => shipOf(st, u).side === 1) };
}
const place = (u: Unit, x: number, y: number, h: number, speed = 0) => { u.x = x; u.y = y; u.heading = u.course = h; u.speed = speed; u.wp = null; };

describe('sea: chart and wind', () => {
  test('points of sail: dead upwind is slow, a reach is fastest', () => {
    const w = 0; // wind blowing toward +x, so upwind heading is PI
    expect(pointOfSail(Math.PI, w)).toBeLessThan(0.2);
    expect(pointOfSail(Math.PI / 2, w)).toBeGreaterThan(pointOfSail(Math.PI * 0.75, w));
    expect(pointOfSail(Math.PI / 2, w)).toBeGreaterThanOrEqual(pointOfSail(0, w));
  });
  test('routes stay in navigable water; shoals bar deep-draught squadrons only', () => {
    const st = createSea(1), g = seaGrid();
    const line = st.squadrons[1], frig = st.squadrons[0];
    const r = seaRoute(st, line, PORTS[1].x - 40, PORTS[1].y);
    expect(r.path).toBeTruthy();
    for (const p of r.path!.slice(0, -1)) expect(g[Math.floor(p.y / SEA.cell) * GRID.w + Math.floor(p.x / SEA.cell)]).toBe(W.Deep);
    expect(terrainAt(790, 935)).toBe(W.Shallow);
    expect(orderSail(st, line.id, 790, 935)).toMatchObject({ ok: false, reason: expect.stringMatching(/shallow/i) });
    expect(orderSail(st, frig.id, 790, 935).ok).toBe(true);
    expect(orderSail(st, frig.id, 800, 265)).toMatchObject({ ok: false, reason: expect.stringMatching(/land/i) });
  });
  test('a squadron sails to its destination and a port repairs it', () => {
    const st = createSea(2); st.squadrons = st.squadrons.filter((q) => q.id === 1);
    const q = st.squadrons[0], s = st.ships[0]; s.hull = 40; s.rig = 30; s.crew = 50;
    expect(orderSail(st, 1, PORTS[2].x, PORTS[2].y + 10).ok).toBe(true);
    run(st, 500);
    expect(Math.hypot(q.x - PORTS[2].x, q.y - PORTS[2].y)).toBeLessThan(SEA.portRange);
    expect(s.hull).toBeGreaterThan(90); expect(s.rig).toBeGreaterThan(90); expect(s.crew).toBeGreaterThan(100);
  });
});

describe('sea: tactical rules', () => {
  test('wind and sail govern speed; turning is rate-limited', () => {
    const speedOn = (h: number, sail: 0 | 1 | 2) => { const { st, mineU } = duel(3); st.battle!.units.forEach((u) => { if (u !== mineU[0]) place(u, 100, 100 + 60 * u.ship, 0); u.sail = 0; }); const u = mineU[0]; place(u, 640, 400, h); u.sail = sail; for (let i = 0; i < 30 * 8; i++) { u.course = h; stepSeaBattle(st, DT); } return { v: u.speed, st }; };
    const { st } = duel(3), up = st.wind + Math.PI;
    const beam = speedOn(st.wind + Math.PI / 2, 2).v, eye = speedOn(up, 2).v, battle = speedOn(st.wind + Math.PI / 2, 1).v;
    expect(eye).toBeLessThan(beam * 0.4);
    expect(battle).toBeLessThan(beam * 0.8);
    const d = duel(3), u = d.mineU[0]; place(u, 640, 400, 0, 20); u.course = Math.PI * 0.9;
    for (let i = 0; i < 30; i++) stepSeaBattle(d.st, DT);
    expect(Math.abs(u.heading)).toBeLessThanOrEqual(CLASS[shipOf(d.st, u).cls].turn + 0.01);
    expect(Math.abs(u.heading)).toBeGreaterThan(0.1);
  });
  test('guns bear only through the broadside arcs and within range', () => {
    const { st, b, mineU, foeU } = duel(4);
    const u = mineU[0], t = foeU[0]; foeU.slice(1).forEach((x) => place(x, 1200, 80, 0)); mineU.slice(1).forEach((x) => place(x, 80, 80, 0));
    place(u, 600, 400, 0); place(t, 800, 400, 0);          // dead ahead
    expect(inArc(st, u, t, 0)).toBe(false); expect(inArc(st, u, t, 1)).toBe(false);
    expect(fire(st, b, u, 1)).toMatchObject({ ok: false, reason: expect.stringMatching(/arc/i) });
    place(t, 600, 580, 0);                                 // on the starboard beam (+y)
    expect(inArc(st, u, t, 1)).toBe(true); expect(inArc(st, u, t, 0)).toBe(false);
    place(t, 600, 400 + SEA.range + 40, 0);                // abeam but out of range
    expect(inArc(st, u, t, 1)).toBe(false);
  });
  test('a broadside damages its target after flight, then must reload; reload only advances with the simulation', () => {
    const { st, b, mineU, foeU } = duel(5);
    const u = mineU[0], t = foeU[0], ts = shipOf(st, t); foeU.slice(1).forEach((x) => place(x, 1200, 80, 0)); mineU.slice(1).forEach((x) => place(x, 80, 80, 0));
    st.battle!.units.forEach((x) => (x.sail = 0));
    place(u, 600, 400, 0); place(t, 600, 520, 0);
    const hull = ts.hull;
    expect(fire(st, b, u, 1).ok).toBe(true);
    expect(ts.hull).toBe(hull);                            // shot still in the air
    const r0 = u.reload[1]; expect(r0).toBeGreaterThan(5);
    expect(fire(st, b, u, 1)).toMatchObject({ ok: false, reason: expect.stringMatching(/reload/i) });
    expect(u.reload[1]).toBe(r0);                          // nothing changes without a step (pause)
    for (let i = 0; i < 30; i++) stepSeaBattle(st, DT);
    expect(ts.hull).toBeLessThan(hull);
    expect(u.reload[1]).toBeCloseTo(r0 - 1, 1);
    expect(u.reload[0]).toBe(0);                           // the other battery is independent
  });
  test('raking fire hits harder than fire into the beam', () => {
    const dmg = (targetHeading: number) => { let s = 0; for (let seed = 1; seed <= 12; seed++) { const { st, b, mineU, foeU } = duel(seed); const u = mineU[0], t = foeU[0], ts = shipOf(st, t); st.battle!.units.forEach((x) => (x.sail = 0)); foeU.slice(1).forEach((x) => place(x, 1200, 80, 0)); place(u, 600, 400, 0); place(t, 600, 520, targetHeading); const h = ts.hull; fire(st, b, u, 1); for (let i = 0; i < 30; i++) stepSeaBattle(st, DT); s += h - ts.hull; } return s; };
    expect(dmg(Math.PI / 2)).toBeGreaterThan(dmg(0) * 1.3);
  });
  test('chain shot wrecks rigging, which cuts speed', () => {
    const { st, b, mineU, foeU } = duel(6);
    const u = mineU[0], t = foeU[0], ts = shipOf(st, t); st.battle!.units.forEach((x) => (x.sail = 0)); foeU.slice(1).forEach((x) => place(x, 1200, 80, 0));
    place(u, 600, 400, 0); place(t, 600, 500, 0); u.shot = 'chain';
    fire(st, b, u, 1); for (let i = 0; i < 30; i++) stepSeaBattle(st, DT);
    expect(ts.rig).toBeLessThan(80);
  });
  test('boarding: refused against a fresh ship, then captures a weakened one and the prize persists', () => {
    const { st, b, mineU, foeU } = duel(7);
    const u = mineU[0], t = foeU[0], us = shipOf(st, u), ts = shipOf(st, t); st.battle!.units.forEach((x) => (x.sail = 0)); foeU.slice(1).forEach((x) => place(x, 1200, 80, 0)); mineU.slice(1).forEach((x) => place(x, 80, 80, 0));
    place(u, 600, 400, 0); place(t, 600, 700, 0);
    expect(canBoard(st, b, u, t)).toMatchObject({ ok: false, reason: expect.stringMatching(/alongside/i) });
    place(t, 600, 460, 0);
    expect(canBoard(st, b, u, t)).toMatchObject({ ok: false, reason: expect.stringMatching(/too strong/i) });
    ts.crew = 40; ts.hull = 50;
    const crew0 = us.crew;
    expect(board(st, b, u, t).ok).toBe(true);
    for (let i = 0; i < 30 * 30 && ts.side === 1; i++) stepSeaBattle(st, DT);
    expect(ts.side).toBe(0); expect(ts.sq).toBe(us.sq);
    expect(us.crew).toBeLessThan(crew0);                   // boarding costs men, and a prize crew
    expect(st.stats.captured).toBe(1);
    // send remaining enemy away so the action ends, then check the strategic state
    foeU.slice(1).forEach((x) => { x.st = 'escaped'; });
    stepSeaBattle(st, DT); expect(b.phase).toBe('over');
    concludeSeaBattle(st);
    expect(st.battle).toBeNull();
    expect(st.ships.filter((s) => s.side === 0 && !s.sunk).length).toBe(6);
    expect(st.ships.length).toBe(10);
  });
  test('capturing or sinking a flagship decides the campaign', () => {
    const { st, b, mineU, foeU } = duel(8);
    const flag = foeU.find((x) => shipOf(st, x).cls === 'flag')!, fs = shipOf(st, flag), u = mineU[0];
    st.battle!.units.forEach((x) => (x.sail = 0)); place(u, 600, 400, 0); place(flag, 600, 470, 0); fs.crew = 30; fs.hull = 60;
    expect(board(st, b, u, flag).ok).toBe(true);
    for (let i = 0; i < 30 * 40 && !st.result; i++) stepSea(st, DT);
    expect(st.result).toMatchObject({ winner: 0 });
    const d2 = duel(9), mf = d2.mineU.find((x) => shipOf(d2.st, x).cls === 'flag')!; shipOf(d2.st, mf).hull = 1;
    place(d2.foeU[0], 600, 400, 0); place(mf, 600, 500, 0); d2.st.battle!.units.forEach((x) => (x.sail = 0));
    fire(d2.st, d2.b, d2.foeU[0], 1); for (let i = 0; i < 30 * 5 && !d2.st.result; i++) stepSea(d2.st, DT);
    expect(shipOf(d2.st, mf).sunk).toBe(true); expect(d2.st.result).toMatchObject({ winner: 1 });
  });
  test('a ship can leave the action only when no enemy is close; damage follows her home', () => {
    const { st, b, mineU, foeU } = duel(10, 1, 4);
    const u = mineU[0], s = shipOf(st, u); s.hull = 33; mineU[1].st = 'escaped'; foeU.forEach((x, i) => { place(x, 1000, 300 + i * 120, 0); x.sail = 0; });
    place(u, 4, 400, Math.PI, 30); u.sail = 2; u.fleeing = true; place(foeU[0], 120, 400, Math.PI);
    for (let i = 0; i < 60; i++) { u.course = Math.PI; stepSeaBattle(st, DT); }
    expect(u.st).toBe('active'); expect(u.x).toBeGreaterThanOrEqual(0);
    u.fleeing = false; for (let i = 0; i < 90; i++) { u.course = Math.PI; stepSeaBattle(st, DT); }
    expect(u.st).toBe('active');                           // no order to withdraw: she stays in the action
    u.fleeing = true; place(foeU[0], 1000, 600, 0);
    for (let i = 0; i < 30 * 20 && u.st === 'active'; i++) { u.course = Math.PI; stepSeaBattle(st, DT); }
    expect(u.st).toBe('escaped'); expect(b.phase).toBe('over'); expect(b.report!.winner).toBe(1);
    const sq = st.squadrons.find((q) => q.id === 1)!, x0 = sq.x;
    concludeSeaBattle(st);
    expect(s.hull).toBe(33); expect(sq.immune).toBeGreaterThan(5); expect(sq.x).not.toBe(x0);
  });
  test('ships do not sail through land', () => {
    const st = createSea(11), a = st.squadrons[0], e = st.squadrons[3];
    a.x = 800; a.y = 470; e.x = 815; e.y = 480;
    st.battle = createSeaBattle(st, [a, e], { x: 808, y: 475 });
    const b = st.battle;
    for (const u of b.units) expect(terrainAt(b.ox + u.x / SEA.tacScale, b.oy + u.y / SEA.tacScale)).toBe(W.Deep);
    const u = b.units[0]; b.units.forEach((x) => { x.mode = 'manual'; x.fireAtWill = false; if (x !== u) x.sail = 0; });
    u.sail = 2; const north = -Math.PI / 2;
    for (let i = 0; i < 30 * 40; i++) { u.course = north; stepSeaBattle(st, DT); expect(terrainAt(b.ox + u.x / SEA.tacScale, b.oy + u.y / SEA.tacScale)).not.toBe(W.Land); }
  });
});

describe('sea: campaign', () => {
  test('AI-vs-AI campaigns reach a flagship result through real battles', () => {
    const wins = [0, 0]; let caps = 0, sunk = 0;
    for (const seed of [21, 22, 23, 24, 25, 26]) {
      const st = createSea(seed); st.autoPlayer = true; st.squadrons.forEach((q) => { if (q.side === 0) q.role = 'raid'; });
      for (let i = 0; i < 30 * 60 * 40 && !st.result; i++) stepSea(st, DT);
      expect(st.result).toBeTruthy(); expect(st.stats.battles).toBeGreaterThanOrEqual(1);
      wins[st.result!.winner]++; caps += st.stats.captured + st.stats.taken; sunk += st.stats.sunk + st.stats.lost;
    }
    console.log('sea autoplay wins', wins, 'captures', caps, 'sunk', sunk);
    expect(sunk).toBeGreaterThan(0);
  });
  test('restart is clean and state survives a save/load round trip', () => {
    expect(JSON.stringify(createSea(5))).toBe(JSON.stringify(createSea(5)));
    const a = createSea(5); a.autoPlayer = true; run(a, 30);
    const b = JSON.parse(JSON.stringify(a)) as SeaState;
    run(a, 20); run(b, 20);
    expect(JSON.stringify(b.ships)).toBe(JSON.stringify(a.ships));
  });
});
