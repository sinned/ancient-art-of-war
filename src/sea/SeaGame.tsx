import React, { useEffect, useRef, useState } from 'react';
import { View, fitView, toWorld } from '../core/draw';
import { sfx } from '../core/audio';
import { save, remove } from '../core/storage';
import { Vec, angNorm, dist } from '../core/util';
import { Bar, Coach, CoachStep, Modal, PauseMenu, Toast, TopBar, canvasPoint, useGameCanvas, useSettings, useToast } from '../ui/shell';
import { CLASS, PORTS, SAIL_NAME, SEA, SHOT, SIDE_NAME, Shot, W, sailingName, pointOfSail } from './data';
import { SeaState, Ship, Squadron, createSea, isDeep, orderSail, portFor, seaRoute, shipsOf, stepSea } from './sim';
import { ARENA, Broadside, Unit, arcTarget, board, boardTarget, canBoard, concludeSeaBattle, fire, reloadTime, shipOf, tacTerrain } from './battle';
import { drawSea, drawSeaBattle, drawShip, windFromName } from './render';
import { SeaGuide } from '../ui/guides';
import type { ResultData } from '../land/LandGame';

const COACH: CoachStep[] = [
  { text: <>Your squadrons lie off Port Sable inside <b>round rings</b>. <b>Click one</b> to select it.</>, wait: 'select' },
  { text: <>Now <b>click open water</b> to set a course (right-click works too). The route bends around land — and around the wind.</>, wait: 'move' },
  { text: <>The <b>compass</b> shows the wind. No ship can sail into the wind’s eye; she is fastest with it on her beam or quarter. The wind shifts as the day goes on.</>, button: 'Aye' },
  { text: <>Pale stippled <b>shoals</b> stop your heavy ships but not frigates. A squadron lying stopped inside a port’s dashed ring is <b>repaired and re-crewed</b>. Press <kbd>Space</kbd> to pause at any time.</>, button: 'Aye' },
  { text: <>Sink or capture the enemy flagship — she wears a <b>gold star</b> and lies at Blackwater. Guard your own <i>Sovereign</i>, starred in ivory. Squadrons close together join the same battle.</>, button: 'Make sail' },
];
const BATTLE_COACH: CoachStep[] = [
  { text: <>Battle stations! <b>Select one of your ships</b>, then <b>click the water</b> to set her course — or steer with <kbd>A</kbd> / <kbd>D</kbd>.</>, wait: 'course' },
  { text: <>The gold fans are her <b>broadsides</b>. Bring an enemy inside one and the guns fire when loaded (or press <kbd>Q</kbd> / <kbd>E</kbd>). Keep out of the red <b>no-go</b> wedge — that is the wind’s eye.</>, button: 'Aye' },
  { text: <>Cross an enemy’s bow or stern to <b>rake</b> her. A battered ship can be <b>boarded</b>: lay alongside at her speed and press Board. “Engage” lets a captain fight on his own.</>, button: 'Aye' },
];

function ShipIcon({ s }: { s: Ship }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { const c = ref.current!.getContext('2d')!; c.setTransform(2, 0, 0, 2, 0, 0); c.clearRect(0, 0, 50, 30); drawShip(c, s.cls, s.side, 23, 15, 0, { scale: 0.5, sail: 1, rig: s.rig, hull: s.hull / CLASS[s.cls].hull, id: s.id }); }, [s.cls, s.side, Math.round(s.rig / 15), Math.round(s.hull / 20)]);
  return <canvas ref={ref} width={100} height={60} style={{ width: 50, height: 30, flex: 'none' }} />;
}
const ShipBars = ({ s }: { s: Ship }) => { const C = CLASS[s.cls], h = s.hull / C.hull; return <>
  <div className="stat"><span>Hull</span><Bar v={s.hull} max={C.hull} color={h > 0.5 ? '#7fa650' : h > 0.25 ? '#d1a13c' : '#b8433a'} title="At zero the ship sinks." /></div>
  <div className="stat"><span>Sails</span><Bar v={s.rig} color="#b9ad8a" title="Damaged rigging cuts speed and turning." /></div>
  <div className="stat"><span>Crew {Math.round(s.crew)}</span><Bar v={s.crew} max={C.crew} color="#5d8fb5" title="Fewer hands: slower reloads, thinner broadsides, weaker boarders." /></div></>; };
const ShipRow = ({ s, sel, onClick, note }: { s: Ship; sel?: boolean; onClick?: () => void; note?: string }) => { const C = CLASS[s.cls]; return (
  <button className={'unit-row' + (sel ? ' sel' : '') + (onClick ? '' : ' foe')} onClick={onClick}>
    <ShipIcon s={s} /><span className="grow"><div className="nm">{s.cls === 'flag' ? '★ ' : ''}{s.name}</div><div className="meta">{C.name}{note ? ` · ${note}` : ''}</div>
      <div className="row" style={{ gap: 2 }}><span className="grow"><Bar v={s.hull} max={C.hull} color={s.hull / C.hull > 0.5 ? '#7fa650' : s.hull / C.hull > 0.25 ? '#d1a13c' : '#b8433a'} title="Hull" /></span><span className="grow"><Bar v={s.rig} color="#b9ad8a" title="Sails" /></span><span className="grow"><Bar v={s.crew} max={C.crew} color="#5d8fb5" title="Crew" /></span></div></span>
  </button>); };

export function SeaGame(p: { resume?: SeaState | null; onExit: () => void; onResult: (r: ResultData) => void; onRestart: () => void }) {
  const { settings, update, reduced } = useSettings();
  const stRef = useRef<SeaState>(null as any);
  if (!stRef.current) stRef.current = p.resume ?? createSea(1000 + Math.floor(Math.random() * 9000));
  const st = stRef.current;
  const [paused, setPaused] = useState(false), [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState<number | null>(null), [inspect, setInspect] = useState<number | null>(null), [shipSel, setShipSel] = useState<number | null>(null);
  const [menu, setMenu] = useState(false), [help, setHelp] = useState(false);
  const [coach, setCoach] = useState(settings.tutorialDone.sea || p.resume ? -1 : 0), [bcoach, setBcoach] = useState(settings.tutorialDone.sea ? -1 : 0);
  const { toast, say } = useToast();
  const ui = useRef({ view: { scale: 1, ox: 0, oy: 0 } as View, hover: null as number | null, preview: null as Vec[] | null, badAt: null as Vec | null, badT: 0, saveT: 0, done: false });
  const live = useRef({ selected, shipSel, coach, bcoach, menu, help }); live.current = { selected, shipSel, coach, bcoach, menu, help };
  (window as any).__sea = st;

  const done = () => update({ tutorialDone: { ...settings.tutorialDone, sea: true } });
  const nextCoach = () => { const i = live.current.coach; if (i + 1 >= COACH.length) { done(); setCoach(-1); } else setCoach(i + 1); };
  const nextB = () => setBcoach((i) => (i + 1 >= BATTLE_COACH.length ? -1 : i + 1));
  const skipCoach = () => { setCoach(-1); setBcoach(-1); done(); };
  const flag = (f: string) => { const L = live.current; if (!st.battle && L.coach >= 0 && COACH[L.coach]?.wait === f) nextCoach(); if (st.battle && L.bcoach >= 0 && BATTLE_COACH[L.bcoach]?.wait === f) nextB(); };

  useEffect(() => { if (menu && !st.battle && !st.result && !st.pending) save('save.sea', st); }, [menu]);
  const checkDone = () => {
    if (st.result && !ui.current.done) {
        ui.current.done = true; remove('save.sea'); sfx(st.result.winner === 0 ? 'win' : 'lose');
        const afloat = st.ships.filter((s) => s.side === 0 && !s.sunk).length;
        setTimeout(() => p.onResult({ mode: 'sea', win: st.result!.winner === 0, reason: st.result!.reason, time: st.time, stats: [['Enemy ships sunk', st.stats.sunk], ['Prizes taken', st.stats.captured], ['Ships lost', st.stats.lost], ['Ships taken by the enemy', st.stats.taken], ['Battles fought', st.stats.battles], ['Ships under your flag', afloat]] }), 1400);
      }
  };
  const canvasRef = useGameCanvas({
    paused: paused || menu || help, speed,
    step: (dt) => {
      stepSea(st, dt);
      for (const e of st.events) {
        if (e === 'cannon') sfx('cannon'); else if (e === 'hit') sfx('hit'); else if (e === 'clash') sfx('clash'); else if (e === 'board') sfx('board');
        else if (e === 'capture') sfx('capture'); else if (e === 'sunk') sfx('splash');
        else if (e === 'battle') { sfx('horn'); setSpeed(1); const first = st.battle!.units.find((u) => shipOf(st, u).side === 0); setShipSel(first ? first.ship : null); }
        else if (e === 'battle-won') sfx('capture'); else if (e === 'battle-lost') sfx('lose');
      }
      st.events.length = 0;
      checkDone();
    },
    draw: (ctx, w, h, t) => {
      const u = ui.current; checkDone();
      if (st.battle) { u.view = fitView(w, h, ARENA.w, ARENA.h, 12); drawSeaBattle(ctx, u.view, st, { selected: live.current.shipSel, t, reduced }, w, h); }
      else {
        u.view = fitView(w, h, SEA.w, SEA.h, 12);
        if (u.badAt && t - u.badT > 1.2) u.badAt = null;
        drawSea(ctx, u.view, st, { selected: live.current.selected, hover: u.hover, preview: u.preview, badAt: u.badAt, t, reduced }, w, h);
        if (t - u.saveT > 5 && !st.result && !st.pending) { u.saveT = t; save('save.sea', st); }
      }
    },
  });

  const b = st.battle;
  const sqAt = (w: Vec) => { let best: Squadron | null = null, bd = 34; for (const q of st.squadrons) { const d = dist(q, w); if (d < bd) { bd = d; best = q; } } return best; };
  const sel = st.squadrons.find((q) => q.id === selected && q.side === 0) ?? null;
  useEffect(() => { if (selected != null && !sel) setSelected(null); });
  const unit = b ? b.units.find((u) => u.ship === shipSel && shipOf(st, u).side === 0) ?? null : null;
  const uship = unit ? shipOf(st, unit) : null;
  const usable = (u: Unit | null): boolean => !!u && u.st === "active";

  const doSail = (w: Vec) => {
    if (!sel) return;
    const tq = sqAt(w), dest = tq && tq.side === 1 ? { x: tq.x, y: tq.y } : w;
    const r = orderSail(st, sel.id, dest.x, dest.y);
    if (r.ok) { sfx('order'); say(tq && tq.side === 1 ? `${sel.name} will close with ${tq.name}.` : `${sel.name}: course laid.`); flag('move'); }
    else { sfx('deny'); say(r.reason!, true); ui.current.badAt = w; ui.current.badT = performance.now() / 1000; }
  };
  const need = (): Unit | null => { if (!b) return null; if (!unit) { say('Select one of your ships first.', true); return null; } if (unit.st !== 'active') { say(`${uship!.name} is out of the fight.`, true); return null; } if (unit.grappled) { say('Her crew is fighting hand to hand.', true); return null; } return unit; };
  const helm = (d: number) => { const u = need(); if (!u) return; u.mode = 'manual'; u.wp = null; u.course = angNorm((Math.abs(angNorm(u.course - u.heading)) > 1.6 ? u.heading : u.course) + d); sfx('click'); flag('course'); };
  const setSail = (n: number) => { const u = need(); if (!u) return; const v = Math.max(0, Math.min(2, n)) as 0 | 1 | 2; if (u.mode !== 'manual') u.mode = 'manual'; u.sail = v; sfx('click'); say(`${uship!.name}: ${SAIL_NAME[v].toLowerCase()}.`); };
  const doFire = (side: Broadside) => { const u = need(); if (!u || !b) return; const r = fire(st, b, u, side); if (!r.ok) { sfx('deny'); say(r.reason!, true); } };
  const doBoard = () => { const u = need(); if (!u || !b) return; const t = boardTarget(st, b, u); if (!t) return say('No enemy ship to board.', true); const r = board(st, b, u, t); if (r.ok) say(`Boarders away! ${uship!.name} grapples ${shipOf(st, t).name}.`); else { sfx('deny'); say(r.reason!, true); } };
  const setMode = (m: Unit['mode'], all = false) => { if (!b) return; const us = all ? b.units.filter((u) => u.st === 'active' && shipOf(st, u).side === 0 && !u.grappled) : [need()].filter(Boolean) as Unit[]; for (const u of us) { u.mode = m; if (m === 'manual') { u.course = u.heading; u.wp = null; } } if (us.length) { sfx('order'); say(m === 'engage' ? 'Captains will engage the enemy on their own initiative.' : m === 'withdraw' ? 'Withdrawing — crowding sail for open water.' : 'You have the helm.'); } };

  const onDown = (e: React.PointerEvent) => {
    const w = toWorld(ui.current.view, ...Object.values(canvasPoint(e, canvasRef.current!)) as [number, number]);
    if (b) {
      if (b.phase === 'over') return;
      let hit: Unit | null = null, bd = 50;
      for (const u of b.units) if (u.st === 'active') { const d = dist(u, w); if (d < bd) { bd = d; hit = u; } }
      if (hit && shipOf(st, hit).side === 0 && e.button === 0) { setShipSel(hit.ship); sfx('click'); return; }
      const u = need(); if (!u) return;
      if (w.x < -20 || w.y < -20 || w.x > ARENA.w + 20 || w.y > ARENA.h + 20) return;
      const tt = tacTerrain(b, w.x, w.y);
      if (tt === W.Land) { sfx('deny'); return say('She cannot sail onto land.', true); }
      if (tt === W.Shallow && CLASS[uship!.cls].deep) say('Course set — but those are shoals: she will crawl and scrape her hull.', true); else say(`${uship!.name}: steering for the mark.`);
      u.mode = 'manual'; u.wp = { x: w.x, y: w.y }; sfx('order'); flag('course');
      return;
    }
    const q = sqAt(w);
    if (e.button === 2) { if (sel) doSail(w); else say('Select one of your squadrons first.', true); return; }
    if (q && q.side === 0) { setSelected(q.id); setInspect(null); sfx('click'); flag('select'); return; }
    if (sel) return doSail(w);
    if (q) { setInspect(q.id); sfx('click'); } else setInspect(null);
  };
  const onMove = (e: React.PointerEvent) => {
    if (b) return;
    const u = ui.current, w = toWorld(u.view, ...Object.values(canvasPoint(e, canvasRef.current!)) as [number, number]);
    u.hover = sqAt(w)?.id ?? null;
    const q = st.squadrons.find((x) => x.id === live.current.selected);
    u.preview = q && e.pointerType === 'mouse' ? (() => { const r = seaRoute(st, q, w.x, w.y); return r.path ? [{ x: q.x, y: q.y }, ...r.path] : null; })() : null;
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const L = live.current, k = e.key.toLowerCase();
      if (e.key === ' ') { e.preventDefault(); setPaused((v) => !v); }
      else if (e.key === 'Escape') { if (L.help) setHelp(false); else if (L.menu) setMenu(false); else if (!st.battle && L.selected != null) setSelected(null); else setMenu(true); }
      else if (L.menu || L.help) return;
      else if (st.battle) {
        if (k === 'a' || e.key === 'ArrowLeft') helm(-0.26); else if (k === 'd' || e.key === 'ArrowRight') helm(0.26);
        else if (k === 'w' || e.key === 'ArrowUp') { if (unit) setSail(unit.sail + 1); } else if (k === 's' || e.key === 'ArrowDown') { if (unit) setSail(unit.sail - 1); }
        else if (k === 'q') doFire(0); else if (k === 'e') doFire(1); else if (k === 'b') doBoard();
        else if (e.key === 'Tab') { e.preventDefault(); const mine = st.battle.units.filter((u) => u.st === 'active' && shipOf(st, u).side === 0); if (mine.length) setShipSel(mine[(mine.findIndex((u) => u.ship === L.shipSel) + 1) % mine.length].ship); }
      } else if ('123'.includes(e.key)) { const mine = st.squadrons.filter((q) => q.side === 0); if (mine[+e.key - 1]) { setSelected(mine[+e.key - 1].id); flag('select'); } }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const insp = st.squadrons.find((q) => q.id === inspect) ?? null, rep = b?.report;
  const SqCard = ({ q }: { q: Squadron }) => { const port = !q.path.length ? portFor(q) : null; return (
    <div className="card">
      <h3><span className={'badge ' + (q.side === 0 ? 'p' : 'sea-e')} />{q.name}</h3>
      <div className="sub">{SIDE_NAME[q.side]} · {q.path.length ? `Under way — ${sailingName(q.heading, st.wind).toLowerCase()}` : port ? `Refitting at ${port.name}` : 'Hove to'}{isDeep(st, q) ? ' · deep draught' : ' · can cross shoals'}</div>
      {shipsOf(st, q).map((s) => <div key={s.id} style={{ marginTop: 8 }}><div className="row"><ShipIcon s={s} /><b style={{ fontFamily: 'var(--serif)', fontSize: 16 }}>{s.cls === 'flag' ? '★ ' : ''}{s.name}</b><span className="hint">{CLASS[s.cls].name}{s.side !== s.origSide ? ' (prize)' : ''}</span></div><ShipBars s={s} /></div>)}
      {q.side === 0 && <div className="row" style={{ marginTop: 8 }}><button className="btn grow" disabled={!q.path.length} onClick={() => { q.path = []; say('Hove to.'); }}>Heave to</button><button className="btn grow" onClick={() => setSelected(null)}>Deselect</button></div>}
    </div>); };
  const ptT = unit && usable(unit) ? boardTarget(st, b!, unit) : null, cb = ptT && unit ? canBoard(st, b!, unit, ptT) : null;

  return (
    <div className="game">
      <TopBar scenario="The Narrow Sea" objective={b ? 'Bring your broadsides to bear: sink, take or drive off the enemy.' : 'Sink or capture the enemy flagship Basilisk (gold star). Keep your flagship Sovereign afloat.'}
        time={st.time} paused={paused} setPaused={setPaused} speed={speed} setSpeed={setSpeed} onMenu={() => setMenu(true)} onHelp={() => setHelp(true)} />
      <div className="main">
        <div className="stage">
          <canvas ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerLeave={() => { ui.current.preview = null; ui.current.hover = null; }} onContextMenu={(e) => e.preventDefault()} />
          {!b && coach >= 0 && <Coach steps={COACH} index={coach} onNext={nextCoach} onSkip={skipCoach} />}
          {b && b.phase !== 'over' && bcoach >= 0 && <Coach steps={BATTLE_COACH} index={bcoach} onNext={nextB} onSkip={skipCoach} />}
          {paused && !menu && !help && <div className="paused-tag">PAUSED</div>}
          <Toast t={toast} />
          {rep && !st.pending && !st.result && <Modal title={rep.winner === 0 ? 'The sea is yours' : rep.winner === 1 ? 'Driven off' : 'Action broken off'}>
            <p style={{ margin: '0 0 6px' }}>{rep.winner === 0 ? 'The enemy has no ship left in the fight.' : 'Your ships have left the action and fall back toward Port Sable.'}</p>
            {rep.lines.map((l, i) => <div key={i} style={{ fontSize: 13, borderBottom: '1px solid #cdbd95', padding: '3px 0' }}>{l}</div>)}
            <button className="btn primary big" style={{ width: '100%', marginTop: 12 }} autoFocus onClick={() => { concludeSeaBattle(st); setShipSel(null); }}>Return to the chart</button>
          </Modal>}
        </div>
        <aside className="panel">
          {!b && <>
            {sel ? <SqCard q={sel} /> : insp ? <SqCard q={insp} /> : <div className="card"><h3>Your command</h3><div className="sub">Select a squadron below or on the chart, then click open water to set a course. With a squadron selected, click an enemy to close with her.</div></div>}
            <div className="card"><div className="eyebrow"><span>Wind</span><span>from {windFromName(st.wind)}</span></div>
              <div className="hint">{sel ? (sel.path.length ? `${sailingName(sel.heading, st.wind)} — ${Math.round(pointOfSail(sel.heading, st.wind) * 100)}% speed.` : 'Set a course to see how she lies to the wind.') : 'Ships cannot sail into the wind’s eye. A reach is fastest.'}</div></div>
            <div className="card">
              <div className="eyebrow"><span>{SIDE_NAME[0]}</span><span>● round</span></div>
              {st.squadrons.filter((q) => q.side === 0).map((q, i) => <button key={q.id} className={'unit-row' + (q.id === selected ? ' sel' : '')} onClick={() => { setSelected(q.id); setInspect(null); sfx('click'); flag('select'); }}>
                <span className="badge p" /><span className="grow"><div className="nm">{q.name}</div><div className="meta">{shipsOf(st, q).map((s) => (s.cls === 'flag' ? '★ ' : '') + s.name).join(', ')}</div></span><kbd>{i + 1}</kbd></button>)}
              <div className="eyebrow" style={{ marginTop: 8 }}><span>{SIDE_NAME[1]}</span><span>◆ diamond</span></div>
              {st.squadrons.filter((q) => q.side === 1).map((q) => <button key={q.id} className={'unit-row foe' + (q.id === inspect && !sel ? ' sel' : '')} onClick={() => { setInspect(q.id); setSelected(null); }}>
                <span className="badge sea-e" /><span className="grow"><div className="nm">{q.name}</div><div className="meta">{shipsOf(st, q).map((s) => (s.cls === 'flag' ? '★ ' : '') + s.name).join(', ')}</div></span></button>)}
            </div>
            <div className="card hint">Ports (anchor marks): {PORTS.filter((x) => x.owner !== 1).map((x) => x.name).join(' and ')} repair your ships while they lie stopped inside the dashed ring.</div>
          </>}
          {b && <>
            <div className="card">
              <div className="eyebrow"><span>● Your ships</span><span>Tab cycles</span></div>
              {b.units.filter((u) => shipOf(st, u).side === 0).map((u) => { const s = shipOf(st, u); return <ShipRow key={u.ship} s={s} sel={u.ship === shipSel} onClick={() => { setShipSel(u.ship); sfx('click'); }} note={u.st === 'sunk' ? 'SUNK' : u.st === 'escaped' ? 'withdrawn' : u.grappled ? 'boarding!' : u.mode === 'manual' ? SAIL_NAME[u.sail] : u.mode} />; })}
              <div className="grid2" style={{ marginTop: 4 }}><button className="btn small" onClick={() => setMode('engage', true)} title="Every captain manoeuvres and fights on his own initiative.">All: engage</button><button className="btn small" onClick={() => setMode('withdraw', true)} title="Every ship runs for the edge of the action. A ship escapes once no enemy is close.">All: withdraw</button></div>
            </div>
            {unit && uship && <div className="card">
              <h3>{uship.cls === 'flag' ? '★ ' : ''}{uship.name}</h3>
              <div className="sub">{usable(unit) ? `${sailingName(unit.heading, st.wind)} · ${Math.round(unit.speed / 6)} knots` : unit.st === 'sunk' ? 'Lost with all hands.' : 'Withdrawn from the action.'}</div>
              {usable(unit) && <>
                <div className="eyebrow" style={{ marginTop: 8 }}><span>Helm &amp; sail</span><span>A D · W S</span></div>
                <div className="grid2"><button className="btn" onClick={() => helm(-0.26)} title="Turn 15° to port (A)">↶ Port</button><button className="btn" onClick={() => helm(0.26)} title="Turn 15° to starboard (D)">Starboard ↷</button></div>
                <div className="grid3" style={{ marginTop: 5 }}>{SAIL_NAME.map((n, i) => <button key={i} className={'btn small' + (unit.sail === i ? ' on' : '')} onClick={() => setSail(i)} title={i === 2 ? 'Fastest; rigging more vulnerable and gunnery less steady.' : i === 1 ? 'Fighting trim.' : 'Nearly stops the ship.'}>{n.split(' ')[0]}</button>)}</div>
                <div className="eyebrow" style={{ marginTop: 8 }}><span>Guns</span><span>Q · E</span></div>
                <div className="grid2">{([0, 1] as Broadside[]).map((sd) => { const rl = unit.reload[sd], tg = arcTarget(st, b, unit, sd), total = reloadTime(uship); return (
                  <button key={sd} className={'btn' + (rl <= 0 && tg ? ' primary' : '') + (rl > 0 || !tg ? ' na' : '')} onClick={() => doFire(sd)} title={rl > 0 ? 'Reloading' : tg ? `Fire on ${shipOf(st, tg).name}` : 'No enemy in this arc'} style={{ whiteSpace: 'normal', padding: '5px 4px' }}>
                    Fire {sd === 0 ? 'port' : 'starb’d'}<Bar v={total - rl} max={total} color={rl <= 0 ? '#d7af5f' : '#8d8a80'} label={rl <= 0 ? (tg ? 'TARGET' : 'ready') : `${rl.toFixed(0)}s`} /></button>); })}</div>
                <div className="grid3" style={{ marginTop: 5 }}>{(Object.keys(SHOT) as Shot[]).map((k) => <button key={k} className={'btn small' + (unit.shot === k ? ' on' : '')} onClick={() => { unit.shot = k; sfx('click'); }} title={`${SHOT[k].desc} Range ${Math.round(SHOT[k].range * 100)}%.`}>{SHOT[k].name.split(/[ s]hot/)[0]}</button>)}</div>
                <label className="row hint" style={{ marginTop: 5, cursor: 'pointer' }}><input type="checkbox" checked={unit.fireAtWill} onChange={(e) => { unit.fireAtWill = e.target.checked; }} /> Fire at will when a target is in arc</label>
                <div className="eyebrow" style={{ marginTop: 8 }}><span>Orders</span><span>{unit.mode}</span></div>
                <div className="grid3">
                  <button className={'btn small' + (unit.mode === 'manual' ? ' on' : '')} onClick={() => setMode('manual')} title="You steer and trim.">Helm</button>
                  <button className={'btn small' + (unit.mode === 'engage' ? ' on' : '')} onClick={() => setMode('engage')} title="Her captain manoeuvres for a broadside on his own.">Engage</button>
                  <button className={'btn small' + (unit.mode === 'withdraw' ? ' on' : '')} onClick={() => setMode('withdraw')} title="Run for open water and leave the action.">Withdraw</button>
                </div>
                <button className={'btn' + (cb?.ok ? ' primary' : ' na')} style={{ width: '100%', marginTop: 6 }} onClick={doBoard} title={cb?.ok ? 'Grapple and board!' : cb?.reason}>⚔ Board {ptT ? shipOf(st, ptT).name : ''} <kbd>B</kbd></button>
                {cb && !cb.ok && <div className="hint" style={{ marginTop: 3 }}>{cb.reason}</div>}
              </>}
              <ShipBars s={uship} />
            </div>}
            <div className="card">
              <div className="eyebrow"><span>◆ Enemy</span></div>
              {b.units.filter((u) => shipOf(st, u).side === 1).map((u) => <ShipRow key={u.ship} s={shipOf(st, u)} note={u.st === 'sunk' ? 'SUNK' : u.st === 'escaped' ? 'fled' : u.grappled ? 'boarding!' : ''} />)}
            </div>
          </>}
        </aside>
      </div>
      {menu && <PauseMenu onResume={() => setMenu(false)} onRestart={p.onRestart} onQuit={p.onExit} onHelp={() => { setMenu(false); setHelp(true); }} />}
      {help && <Modal title="Sailing Orders — At Sea" wide onClose={() => setHelp(false)}><SeaGuide /></Modal>}
    </div>
  );
}
