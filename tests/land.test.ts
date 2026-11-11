import { describe, expect, test } from 'vitest';
import { LAND, T, TROOP, landMap, tileAt, tileCenter } from '../src/land/data';
import { createLand, orderMove, routeTo, stepLand, total, fortPos, LandState } from '../src/land/sim';
import { applyFormation, beginFight, concludeBattle, countAlive, createBattle, formationSlots, setOrder, setRetreat, stepBattle } from '../src/land/battle';

const DT = 1 / 30;
const run = (st: LandState, secs: number) => { for (let i = 0; i < secs * 30; i++) stepLand(st, DT); };
/** Stage a battle between two custom squads on chosen terrain. */
function stage(seed: number, a: [number, number, number], e: [number, number, number], terrain: T, defender: 0 | 1 | -1 = -1) {
  const st = createLand(seed);
  const p = st.squads[0], q = st.squads[4];
  p.counts = { knight: a[0], barbarian: a[1], archer: a[2] }; q.counts = { knight: e[0], barbarian: e[1], archer: e[2] };
  st.battle = createBattle(st, p, q, terrain, defender);
  return st;
}
const hpLost = (st: LandState, side: number) => st.battle!.soldiers.filter((s) => s.side === side).reduce((a, s) => a + (TROOP[s.type].hp - Math.max(0, s.hp)), 0);

describe('land: movement and pathfinding', () => {
  test('routes cross the river only at bridges or the ford', () => {
    const r = routeTo(fortPos(0), fortPos(1).x, fortPos(1).y);
    expect(r.path).toBeTruthy();
    const kinds = r.path!.map((p) => tileAt(p.x, p.y));
    expect(kinds).not.toContain(T.River); expect(kinds).not.toContain(T.Mountain);
    expect(kinds.some((k) => k === T.Bridge || k === T.Ford)).toBe(true);
  });
  test('unreachable destinations are explained', () => {
    const m = landMap();
    const find = (t: T) => { const i = Array.from(m.tiles).indexOf(t); return tileCenter(i % m.w, (i / m.w) | 0); };
    const st = createLand(1);
    expect(orderMove(st, 1, find(T.River).x, find(T.River).y)).toMatchObject({ ok: false, reason: expect.stringMatching(/bridge|ford/i) });
    expect(orderMove(st, 1, find(T.Mountain).x, find(T.Mountain).y)).toMatchObject({ ok: false, reason: expect.stringMatching(/impassable/i) });
  });
  test('a squad actually marches across the river and tires; rest restores it', () => {
    const st = createLand(2); st.squads = st.squads.filter((s) => s.id === 3 || s.id === 5);
    const s = st.squads[0], goal = tileCenter(30, 14);
    expect(orderMove(st, 3, goal.x, goal.y).ok).toBe(true);
    let peak = 0;
    for (let i = 0; i < 30 * 200 && s.path.length; i++) { stepLand(st, DT); peak = Math.max(peak, s.fatigue); }
    expect(Math.hypot(s.x - goal.x, s.y - goal.y)).toBeLessThan(2);
    expect(peak).toBeGreaterThan(15);
    const f = s.fatigue; run(st, 5); expect(s.fatigue).toBeLessThan(f);
  });
  test('forest slows the march compared with open ground', () => {
    expect(LAND.moveCost[T.Forest]).toBeGreaterThan(LAND.moveCost[T.Plain]);
    const open = routeTo(tileCenter(2, 12), tileCenter(8, 12).x, tileCenter(8, 12).y), wood = routeTo(tileCenter(11, 9), tileCenter(17, 9).x, tileCenter(17, 9).y);
    expect(wood.cost!).toBeGreaterThan(open.cost! * 1.3);
  });
});

describe('land: tactical battles', () => {
  test('formations place soldiers differently', () => {
    const c = { knight: 4, barbarian: 3, archer: 4 };
    const line = formationSlots(c, 'line'), wedge = formationSlots(c, 'wedge'), skirm = formationSlots(c, 'skirmish');
    expect(JSON.stringify(line)).not.toBe(JSON.stringify(wedge));
    const meanX = (ps: { x: number }[]) => ps.reduce((a, p) => a + p.x, 0) / ps.length;
    expect(meanX(line.archer)).toBeLessThan(meanX(line.knight));   // archers behind
    expect(meanX(skirm.archer)).toBeGreaterThan(meanX(skirm.knight)); // archers in front
  });
  test('battle line shields ranked knights from arrows better than a wedge', () => {
    const lost = (f: 'line' | 'wedge') => {
      let sum = 0;
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const st = stage(seed, [6, 0, 0], [0, 0, 8], T.Plain);
        applyFormation(st.battle!, 0, f); beginFight(st); st.battle!.aiT = 1e9;
        setOrder(st.battle!, 0, null, 'move', { x: 640, y: 300 }); setOrder(st.battle!, 1, null, 'hold');
        for (let i = 0; i < 30 * 12; i++) stepBattle(st, DT);
        sum += hpLost(st, 0);
      }
      return sum;
    };
    expect(lost('line')).toBeLessThan(lost('wedge') * 0.85);
  });
  test('terrain matters: forest blunts archery, high ground extends it', () => {
    const dmg = (terrain: T, enemy: 'advance' | 'hold') => {
      let s = 0;
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const st = stage(seed, [0, 0, 8], [6, 0, 0], terrain, 0); beginFight(st); st.battle!.aiT = 1e9;
        setOrder(st.battle!, 1, null, enemy);
        if (enemy === 'hold') setOrder(st.battle!, 0, null, 'move', { x: 610, y: 300 });
        for (let i = 0; i < 30 * 20; i++) stepBattle(st, DT);
        s += hpLost(st, 1);
      }
      return s;
    };
    expect(dmg(T.Forest, 'hold')).toBeLessThan(dmg(T.Plain, 'hold') * 0.9);
    expect(dmg(T.Hill, 'advance')).toBeGreaterThan(dmg(T.Plain, 'advance'));
  });
  test('the troop triangle holds: knights > barbarians > archers (in melee) and archers hurt knights at range', () => {
    const fight = (a: [number, number, number], e: [number, number, number]) => { let w = 0; for (const seed of [1, 2, 3, 4, 5, 6]) { const st = stage(seed, a, e, T.Plain); st.autoPlayer = true; beginFight(st); for (let i = 0; i < 30 * 200 && st.battle; i++) stepBattle(st, DT); if (st.lastReport!.winner === 0) w++; } return w; };
    expect(fight([5, 0, 0], [0, 7, 0])).toBeGreaterThanOrEqual(5);
    expect(fight([0, 6, 0], [0, 0, 7])).toBeGreaterThanOrEqual(4);
    expect(fight([0, 0, 9], [5, 0, 0])).toBeGreaterThanOrEqual(4);
  });
  test('the campaign clock and battle do not advance before the player begins', () => {
    const st = stage(3, [4, 2, 4], [4, 2, 4], T.Plain);
    const t = st.time, snap = JSON.stringify(st.battle!.soldiers.map((s) => [s.x, s.hp]));
    run(st, 5);
    expect(st.time).toBe(t); expect(st.battle!.time).toBe(0);
    expect(JSON.stringify(st.battle!.soldiers.map((s) => [s.x, s.hp]))).toBe(snap);
  });
  test('casualties persist to the strategic map', () => {
    const st = stage(4, [4, 3, 4], [3, 3, 3], T.Plain);
    beginFight(st); setOrder(st.battle!, 0, null, 'attack');
    for (let i = 0; i < 30 * 300 && st.battle!.phase !== 'over'; i++) stepBattle(st, DT);
    const rep = st.battle!.report!;
    concludeBattle(st);
    expect(st.battle).toBeNull();
    for (const side of [0, 1]) {
      const sq = st.squads.find((s) => s.id === [1, 5][side]);
      if (total(rep.end[side]) === 0) expect(sq).toBeUndefined(); else expect(sq!.counts).toEqual(rep.end[side]);
    }
    expect(total(rep.end[0]) + total(rep.end[1])).toBeLessThan(11 + 9);
    expect(st.squads.length).toBeLessThan(8);
  });
  test('retreat saves survivors, pushes the squad back and grants no instant rematch', () => {
    const st = stage(5, [3, 3, 3], [5, 3, 3], T.Plain);
    const sq = st.squads[0]; sq.x = 800; sq.y = 470; const before = { x: sq.x, y: sq.y };
    beginFight(st); setRetreat(st.battle!, 0);
    for (let i = 0; i < 30 * 120 && st.battle!.phase !== 'over'; i++) stepBattle(st, DT);
    const rep = st.battle!.report!;
    expect(rep.winner).toBe(1); expect(rep.fled[0]).toBe(true); expect(total(rep.end[0])).toBeGreaterThan(0);
    concludeBattle(st);
    expect(sq.counts).toEqual(rep.end[0]);
    expect(Math.hypot(sq.x - fortPos(0).x, sq.y - fortPos(0).y)).toBeLessThan(Math.hypot(before.x - fortPos(0).x, before.y - fortPos(0).y));
    expect(sq.immune).toBeGreaterThan(5);
  });
});

describe('land: campaign', () => {
  test('capturing the undefended enemy standard wins', () => {
    const st = createLand(6); st.squads = st.squads.filter((s) => s.side === 0 || s.id === 6);
    st.squads.find((s) => s.id === 6)!.x = 100; st.squads.find((s) => s.id === 6)!.y = 900; st.squads.find((s) => s.id === 6)!.role = 'hold';
    const s = st.squads[0]; Object.assign(s, fortPos(1));
    run(st, LAND.captureTime + 1);
    expect(st.result).toMatchObject({ winner: 0 });
  });
  test('the AI marches on the player standard and takes it if unopposed', () => {
    const st = createLand(7); st.squads = st.squads.filter((s) => s.side === 1);
    st.squads.push({ ...createLand(7).squads[0], x: 60, y: 60 });
    run(st, 600);
    expect(st.result).toMatchObject({ winner: 1 });
  });
  test('AI-vs-AI campaigns play through real battles to legitimate results', () => {
    let results = 0, wins = [0, 0];
    for (const seed of [11, 12, 13, 14, 15, 16]) {
      const st = createLand(seed); st.autoPlayer = true;
      st.squads[3].role = 'garrison'; st.squads[1].via = 1; st.squads[2].via = 2;
      let battles = 0;
      for (let i = 0; i < 30 * 60 * 30 && !st.result; i++) { if (st.battle?.phase === 'deploy') { battles++; beginFight(st); } stepLand(st, DT); }
      expect(battles).toBeGreaterThanOrEqual(3);
      if (st.result) { results++; wins[st.result.winner]++; }
    }
    console.log('land autoplay results', results, 'wins', wins);
    expect(results).toBeGreaterThanOrEqual(3);
  });
  test('restart yields a clean scenario and state survives a save/load round trip', () => {
    const a = createLand(9); run(a, 20);
    expect(JSON.stringify(createLand(9))).toBe(JSON.stringify(createLand(9)));
    expect(createLand(9).time).toBe(0);
    const b = JSON.parse(JSON.stringify(a)) as LandState;
    run(a, 10); run(b, 10);
    expect(JSON.stringify(b.squads)).toBe(JSON.stringify(a.squads));
  });
});
