import React, { useEffect, useRef, useState } from 'react';
import { View, fitView, toWorld } from '../core/draw';
import { sfx } from '../core/audio';
import { save, remove } from '../core/storage';
import { Vec, dist } from '../core/util';
import { Bar, Coach, CoachStep, Modal, PauseMenu, Toast, TopBar, canvasPoint, useGameCanvas, useSettings, useToast } from '../ui/shell';
import { FORMATIONS, FormationId, LAND, PLACES, SIDE_NAME, Side, T, TERRAIN_NAME, TROOP, TYPES, TroopType, WORLD, tileAt } from './data';
import { LandState, Squad, createLand, orderHalt, orderMove, routeTo, stepLand, total, fortPos, villagePos } from './sim';
import { FIELD, Order, applyFormation, beginFight, concludeBattle, countAlive, setOrder, setRetreat } from './battle';
import { drawBattle, drawLand, drawSoldier } from './render';
import { LandGuide } from '../ui/guides';

export interface ResultData { mode: 'land' | 'sea'; win: boolean; reason: string; time: number; stats: [string, string | number][] }

const COACH: CoachStep[] = [
  { text: <>Your squads fly <b>crimson round banners</b> on the west bank. <b>Click one</b> to select it.</>, wait: 'select' },
  { text: <>Now <b>click a destination</b> on the map (right-click works too). The dotted line previews the route; crossings are the only way over the river.</>, wait: 'move' },
  { text: <>Time is yours to command. Press <kbd>Space</kbd> to pause — you can still give orders — and use <b>1× 2× 4×</b> to set the pace.</>, wait: 'pause' },
  { text: <>Marching wears troops down: the <b>green bar</b> is readiness, the <b>pale bar</b> supply. Halt to rest. Your fort — and Aldermere village, once you hold it — resupplies and restores squads quickly.</>, button: 'Understood' },
  { text: <>Win by standing a squad on the <b>gold-ringed standard at Dun Morrow</b> with no defenders near — and guard your own at Caer Wyn. When squads meet, you command the battle yourself.</>, button: 'To war' },
];
const BATTLE_COACH: CoachStep[] = [
  { text: <>Battle! First <b>choose a formation</b> in the panel — it changes where soldiers stand and how they fight — then press <b>Begin battle</b>.</>, wait: 'begin' },
  { text: <>Pick <b>All</b> or one troop type, then give an order: Advance, Attack, Hold or Fall back. <b>Click the field</b> to move the selected troops. Knights beat barbarians, barbarians beat archers, archers punish knights.</>, wait: 'order' },
];
const TERRAIN_NOTE: Partial<Record<T, string>> = {
  [T.Plain]: 'Open ground — nothing hinders arrows or a charge.',
  [T.Forest]: 'Woodland — trunks block movement and stop many arrows. Poor ground for archers.',
  [T.Hill]: 'High ground — troops on the hill shoot 25% farther and strike 15% harder downhill; climbing attackers are slowed.',
  [T.Bridge]: 'Bridge — the river can only be crossed on the narrow span. A perfect chokepoint.',
  [T.Ford]: 'Ford — a wide crossing, but troops wade at half speed under fire.',
  [T.Village]: 'Village — houses break up lines of sight and movement.',
  [T.Fort]: 'Fort — defenders behind the palisade are hit by only half of incoming arrows; attackers must force the gate.',
};
const ORDERS: { id: Order; name: string; key: string; tip: string }[] = [
  { id: 'advance', name: 'Advance', key: 'A', tip: 'March toward the enemy in formation. Archers halt at bow range.' },
  { id: 'attack', name: 'Attack', key: 'T', tip: 'Break ranks and charge the nearest enemy (barbarians hunt archers, knights hunt barbarians).' },
  { id: 'hold', name: 'Hold', key: 'H', tip: 'Stand fast here. Archers shoot what comes in range; melee troops fight what comes close.' },
  { id: 'fallback', name: 'Fall back', key: 'F', tip: 'Withdraw toward your own edge in good order.' },
];

export function TroopIcon({ type, side }: { type: TroopType; side: Side }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { const c = ref.current!.getContext('2d')!; c.setTransform(2, 0, 0, 2, 0, 0); c.clearRect(0, 0, 26, 30); drawSoldier(c, type, side, 11, 28, { scale: 0.95 }); }, [type, side]);
  return <canvas ref={ref} width={52} height={60} aria-label={TROOP[type].label} />;
}
const Troops = ({ c, side }: { c: Record<TroopType, number>; side: Side }) => (
  <div className="troops">{TYPES.map((t) => <span className="troop" key={t} title={`${TROOP[t].label} — ${TROOP[t].blurb}`} style={{ opacity: c[t] ? 1 : 0.35 }}><TroopIcon type={t} side={side} />{c[t]}</span>)}</div>
);

export function LandGame(p: { resume?: LandState | null; onExit: () => void; onResult: (r: ResultData) => void; onRestart: () => void }) {
  const { settings, update, reduced } = useSettings();
  const stRef = useRef<LandState>(null as any);
  if (!stRef.current) stRef.current = p.resume ?? createLand(1000 + Math.floor(Math.random() * 9000));
  const st = stRef.current;
  const [paused, setPaused] = useState(false), [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState<number | null>(null), [inspect, setInspect] = useState<number | null>(null);
  const [group, setGroup] = useState<TroopType | null>(null);
  const [menu, setMenu] = useState(false), [help, setHelp] = useState(false);
  const [coach, setCoach] = useState(settings.tutorialDone.land || p.resume ? -1 : 0), [bcoach, setBcoach] = useState(settings.tutorialDone.land ? -1 : 0);
  const { toast, say } = useToast();
  const ui = useRef({ view: { scale: 1, ox: 0, oy: 0 } as View, hover: null as Vec | null, hoverSquad: null as number | null, preview: null as Vec[] | null, badAt: null as Vec | null, badT: 0, saveT: 0, done: false });
  const live = useRef({ selected, group, coach, bcoach, paused, menu, help }); live.current = { selected, group, coach, bcoach, paused, menu, help };
  (window as any).__land = st;

  const flag = (f: string) => {
    const L = live.current;
    if (!st.battle && L.coach >= 0 && COACH[L.coach]?.wait === f) nextCoach();
    if (st.battle && L.bcoach >= 0 && BATTLE_COACH[L.bcoach]?.wait === f) setBcoach((i) => (i + 1 >= BATTLE_COACH.length ? -1 : i + 1));
  };
  const nextCoach = () => { const i = live.current.coach; if (i + 1 >= COACH.length) { update({ tutorialDone: { ...settings.tutorialDone, land: true } }); setCoach(-1); } else setCoach(i + 1); };
  const skipCoach = () => { setCoach(-1); setBcoach(-1); update({ tutorialDone: { ...settings.tutorialDone, land: true } }); };

  const canvasRef = useGameCanvas({
    paused: paused || menu || help, speed,
    step: (dt) => {
      stepLand(st, dt);
      for (const e of st.events) {
        if (e === 'arrow') sfx('arrow'); else if (e === 'clash') sfx('clash'); else if (e === 'hit' || e === 'death') sfx('hit');
        else if (e === 'battle') { sfx('horn'); setGroup(null); setSpeed(1); }
        else if (e === 'battle-won') sfx('capture'); else if (e === 'battle-lost') sfx('lose');
        else if (e === 'village-ours') { sfx('capture'); say('Aldermere is yours — squads resting there resupply.'); }
        else if (e === 'village-lost') say('The enemy has taken Aldermere village.', true);
      }
      st.events.length = 0;
      if (st.result && !ui.current.done) {
        ui.current.done = true; remove('save.land'); sfx(st.result.winner === 0 ? 'win' : 'lose');
        const own = st.squads.filter((s) => s.side === 0).reduce((a, s) => a + total(s.counts), 0);
        setTimeout(() => p.onResult({ mode: 'land', win: st.result!.winner === 0, reason: st.result!.reason, time: st.time, stats: [['Battles won', st.stats.battlesWon], ['Battles lost', st.stats.battlesLost], ['Enemy soldiers felled', st.stats.kills], ['Soldiers lost', st.stats.losses], ['Soldiers remaining', own], ['Village', st.villageOwner === 0 ? 'Held' : 'Not held']] }), 1400);
      }
    },
    draw: (ctx, w, h, t) => {
      const u = ui.current;
      if (st.battle) { u.view = fitView(w, h, FIELD.w, FIELD.h, 12); drawBattle(ctx, u.view, st.battle, { group: live.current.group, t, reduced }); }
      else {
        u.view = fitView(w, h, WORLD.w, WORLD.h, 12);
        if (u.badAt && t - u.badT > 1.2) u.badAt = null;
        drawLand(ctx, u.view, st, { selected: live.current.selected, hoverSquad: u.hoverSquad, preview: u.preview, badAt: u.badAt, t, reduced });
        if (t - u.saveT > 5 && !st.result) { u.saveT = t; save('save.land', st); }
      }
    },
  });

  const squadAt = (w: Vec) => { let best: Squad | null = null, bd = 30; for (const s of st.squads) { const d = dist(s, w); if (d < bd) { bd = d; best = s; } } return best; };
  const sel = st.squads.find((s) => s.id === selected && s.side === 0) ?? null;
  useEffect(() => { if (selected != null && !sel) setSelected(null); });

  const doMove = (w: Vec) => {
    if (!sel) return;
    const target = squadAt(w), dest = target && target.side === 1 ? { x: target.x, y: target.y } : w;
    const r = orderMove(st, sel.id, dest.x, dest.y);
    if (r.ok) { sfx('order'); say(target && target.side === 1 ? `${sel.name} will attack ${target.name}.` : `${sel.name} marching — ${TERRAIN_NAME[tileAt(dest.x, dest.y)].toLowerCase()}.`); flag('move'); }
    else { sfx('deny'); say(r.reason!, true); ui.current.badAt = w; ui.current.badT = performance.now() / 1000; }
  };
  const giveOrder = (o: Order) => {
    const b = st.battle; if (!b || b.phase !== 'fight') return say('Begin the battle first.', true);
    if (b.retreat[0]) return say('The squad is already in full retreat.', true);
    const c = countAlive(b, 0);
    if (group && !c[group]) return say(`No ${TROOP[group].label.toLowerCase()} left in this squad.`, true);
    setOrder(b, 0, group, o); sfx('order'); say(`${group ? TROOP[group].label : 'All troops'}: ${ORDERS.find((x) => x.id === o)!.name}.`); flag('order');
  };
  const begin = () => { if (st.battle?.phase === 'deploy') { beginFight(st); sfx('horn'); flag('begin'); setPaused(false); } };
  const retreat = () => { const b = st.battle; if (!b || b.phase !== 'fight') return say('Begin the battle first.', true); if (b.retreat[0]) return; setRetreat(b, 0); sfx('deny'); say('Retreat sounded — survivors who reach your edge will escape.'); };

  const onDown = (e: React.PointerEvent) => {
    const cv = canvasRef.current!, pt = canvasPoint(e, cv), w = toWorld(ui.current.view, pt.x, pt.y);
    const b = st.battle;
    if (b) {
      if (b.phase === 'over') return;
      let hit: TroopType | null = null, bd = 18;
      for (const s of b.soldiers) if (s.side === 0 && s.st === 0) { const d = Math.hypot(s.x - w.x, s.y - 10 - w.y); if (d < bd) { bd = d; hit = s.type; } }
      if (hit && e.button === 0) { setGroup(hit); sfx('click'); return; }
      if (b.phase === 'deploy') return say('Choose a formation, then press Begin battle.');
      if (w.x < 0 || w.y < 0 || w.x > FIELD.w || w.y > FIELD.h) return;
      if (b.retreat[0]) return say('The squad is already in full retreat.', true);
      const bar = b.barrier;
      if (bar && w.x > bar.x0 && w.x < bar.x1 && (w.y < bar.g0 || w.y > bar.g1)) { sfx('deny'); return say(bar.kind === 'wall' ? 'The palisade blocks the way — use the gate.' : 'The river is impassable here — cross at the span.', true); }
      setOrder(b, 0, group, 'move', w); sfx('order'); say(`${group ? TROOP[group].label : 'All troops'} moving.`); flag('order');
      return;
    }
    const s = squadAt(w);
    if (e.button === 2) { if (sel) doMove(w); else say('Select one of your squads first.', true); return; }
    if (s && s.side === 0) { setSelected(s.id); setInspect(null); sfx('click'); flag('select'); return; }
    if (sel) return doMove(w);
    if (s) { setInspect(s.id); sfx('click'); return; }
    setInspect(null);
  };
  const onMove = (e: React.PointerEvent) => {
    if (st.battle) return;
    const u = ui.current, w = toWorld(u.view, ...Object.values(canvasPoint(e, canvasRef.current!)) as [number, number]);
    u.hoverSquad = squadAt(w)?.id ?? null;
    const s = st.squads.find((q) => q.id === live.current.selected);
    u.preview = s && e.pointerType === 'mouse' ? (() => { const r = routeTo(s, w.x, w.y); return r.path ? [{ x: s.x, y: s.y }, ...r.path] : null; })() : null;
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const L = live.current, b = st.battle;
      if (e.key === ' ') { e.preventDefault(); if (b?.phase === 'deploy') return; setPaused((v) => !v); flag('pause'); }
      else if (e.key === 'Escape') { if (L.help) setHelp(false); else if (L.menu) setMenu(false); else if (!b && L.selected != null) setSelected(null); else setMenu(true); }
      else if (L.menu || L.help) return;
      else if (e.key === 'Enter' && b?.phase === 'deploy') begin();
      else if (b && '1234'.includes(e.key)) setGroup(e.key === '1' ? null : TYPES[+e.key - 2]);
      else if (b?.phase === 'fight') { const o = ORDERS.find((x) => x.key.toLowerCase() === e.key.toLowerCase()); if (o) giveOrder(o.id); }
      else if (!b && '1234'.includes(e.key)) { const mine = st.squads.filter((s) => s.side === 0); if (mine[+e.key - 1]) { setSelected(mine[+e.key - 1].id); flag('select'); } }
      else if (!b && e.key.toLowerCase() === 'h' && L.selected != null) { orderHalt(st, L.selected); say('Halted — resting.'); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const b = st.battle, rep = b?.report;
  const status = (s: Squad) => {
    const atFort = dist(s, fortPos(s.side)) < 44, atVil = st.villageOwner === s.side && dist(s, villagePos()) < 44;
    return s.path.length ? 'Marching' : atFort || atVil ? `Resupplying at ${atFort ? PLACES.forts[s.side].name : PLACES.village.name}` : s.supply <= 0 ? 'Out of supply — cannot recover' : s.fatigue > 1 ? 'Resting' : 'Ready';
  };
  const SquadCard = ({ s }: { s: Squad }) => (
    <div className="card">
      <h3><span className={'badge ' + (s.side === 0 ? 'p' : 'e')} />{s.name}</h3>
      <div className="sub">{SIDE_NAME[s.side]} · {status(s)} · {TERRAIN_NAME[tileAt(s.x, s.y)]}</div>
      <div style={{ marginTop: 6 }}><Troops c={s.counts} side={s.side} /></div>
      <div className="stat"><span>Readiness</span><Bar v={100 - s.fatigue} color={s.fatigue < 40 ? '#7fa650' : s.fatigue < 70 ? '#d1a13c' : '#b8433a'} title="Tired troops march up to 50% slower and fight up to 35% weaker." /></div>
      <div className="stat"><span>Supply</span><Bar v={s.supply} color="#c9b072" title="Supply drains steadily. At zero, troops tire and cannot recover until resupplied at a fort or held village." /></div>
      {s.side === 0 && <div className="row" style={{ marginTop: 8 }}>
        <button className="btn grow" disabled={!s.path.length} onClick={() => { orderHalt(st, s.id); say('Halted — resting.'); }} title="Stop and rest (H)">Halt &amp; rest</button>
        <button className="btn grow" onClick={() => setSelected(null)} title="Deselect (Esc)">Deselect</button>
      </div>}
    </div>
  );
  const insp = st.squads.find((s) => s.id === inspect) ?? null;
  const mineAlive = b ? countAlive(b, 0) : null, theirsAlive = b ? countAlive(b, 1) : null;

  return (
    <div className="game">
      <TopBar scenario="The River Crossing" objective={b ? `Win the fight at the ${TERRAIN_NAME[b.terrain].toLowerCase()} — or retreat to save the squad.` : 'Capture the enemy standard at Dun Morrow (gold ring). Protect your own at Caer Wyn.'}
        time={st.time} paused={paused} setPaused={(v) => { setPaused(v); flag('pause'); }} speed={speed} setSpeed={(v) => { setSpeed(v); flag('pause'); }} onMenu={() => setMenu(true)} onHelp={() => setHelp(true)} />
      <div className="main">
        <div className="stage">
          <canvas ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerLeave={() => { ui.current.preview = null; ui.current.hoverSquad = null; }} onContextMenu={(e) => e.preventDefault()} />
          {!b && coach >= 0 && <Coach steps={COACH} index={coach} onNext={nextCoach} onSkip={skipCoach} />}
          {b && b.phase !== 'over' && bcoach >= 0 && <Coach steps={BATTLE_COACH} index={bcoach} onNext={() => setBcoach(-1)} onSkip={skipCoach} />}
          {b?.phase === 'deploy' && bcoach < 0 && <div className="banner"><h2>{b.names[0]} <i>meets</i> {b.names[1]}</h2><p>Choose a formation, then begin the battle.</p></div>}
          {paused && !menu && !help && <div className="paused-tag">PAUSED</div>}
          <Toast t={toast} />
          {rep && <Modal title={rep.winner === 0 ? 'Victory in the field' : rep.fled[0] ? 'Withdrawn from battle' : 'The squad is lost'}>
            <p style={{ margin: 0 }}>{rep.winner === 0 ? (rep.fled[1] ? `${rep.names[1]} broke and fled the field.` : `${rep.names[1]} was destroyed.`) : rep.fled[0] ? `${rep.names[0]} fell back toward Caer Wyn and needs time to rally.` : `${rep.names[0]} fought to the last.`}</p>
            <table className="report-table"><thead><tr><th>Survivors</th>{TYPES.map((t) => <th key={t}>{TROOP[t].label}</th>)}</tr></thead>
              <tbody>{[0, 1].map((s) => <tr key={s}><td><span className={'badge ' + (s === 0 ? 'p' : 'e')} /> {rep.names[s]}</td>{TYPES.map((t) => <td key={t}>{rep.end[s][t]} <small>/ {rep.start[s][t]}</small></td>)}</tr>)}</tbody></table>
            <button className="btn primary big" style={{ width: '100%' }} autoFocus onClick={() => { concludeBattle(st); setGroup(null); }}>Return to the map</button>
          </Modal>}
        </div>
        <aside className="panel">
          {!b && <>
            {sel ? <SquadCard s={sel} /> : insp ? <SquadCard s={insp} /> : <div className="card"><h3>Your command</h3><div className="sub">Select a squad below or on the map, then click a destination. Click an enemy to scout it; with a squad selected, click an enemy to attack.</div></div>}
            <div className="card">
              <div className="eyebrow"><span>{SIDE_NAME[0]}</span><span>● round</span></div>
              {st.squads.filter((s) => s.side === 0).map((s, i) => <button key={s.id} className={'unit-row' + (s.id === selected ? ' sel' : '')} onClick={() => { setSelected(s.id); setInspect(null); sfx('click'); flag('select'); }}>
                <span className="badge p" /><span className="grow"><div className="nm">{s.name}</div><div className="meta">{s.counts.knight}K · {s.counts.barbarian}B · {s.counts.archer}A — {status(s).split(' at ')[0]}</div><Bar v={100 - s.fatigue} color={s.fatigue < 40 ? '#7fa650' : s.fatigue < 70 ? '#d1a13c' : '#b8433a'} /></span><kbd>{i + 1}</kbd></button>)}
              <div className="eyebrow" style={{ marginTop: 8 }}><span>{SIDE_NAME[1]}</span><span>◆ diamond</span></div>
              {st.squads.filter((s) => s.side === 1).map((s) => <button key={s.id} className={'unit-row foe' + (s.id === inspect && !sel ? ' sel' : '')} onClick={() => { setInspect(s.id); setSelected(null); }}>
                <span className="badge e" /><span className="grow"><div className="nm">{s.name}</div><div className="meta">{s.counts.knight}K · {s.counts.barbarian}B · {s.counts.archer}A</div></span></button>)}
            </div>
            <div className="card hint">Village: {st.villageOwner === 0 ? 'yours — resupply there.' : st.villageOwner === 1 ? 'held by the enemy.' : 'unclaimed. Occupy Aldermere for a forward supply base.'}<br />Bars under each banner: readiness (top), supply (bottom).</div>
          </>}
          {b && <>
            <div className="card"><h3>Battle at the {TERRAIN_NAME[b.terrain].toLowerCase()}</h3><div className="sub">{TERRAIN_NOTE[b.terrain]}{b.defender >= 0 && (b.terrain === T.Fort || b.terrain === T.Hill) ? ` ${b.defender === 0 ? 'You hold' : 'The enemy holds'} the position.` : ''}</div></div>
            <div className="card">
              <div className="eyebrow"><span>● {b.names[0]}</span><span>{FORMATIONS[b.formation[0]].name}</span></div><Troops c={mineAlive!} side={0} />
              <div className="eyebrow" style={{ marginTop: 6 }}><span>◆ {b.names[1]}</span><span>{FORMATIONS[b.formation[1]].name}</span></div><Troops c={theirsAlive!} side={1} />
              {(b.fatigue[0] > 30 || b.fatigue[1] > 30) && <div className="hint" style={{ marginTop: 4 }}>{b.fatigue[0] > 30 ? `Your troops are tired (−${Math.round(b.fatigue[0] * LAND.fatigueFightPenalty)}% speed & blows). ` : ''}{b.fatigue[1] > 30 ? `The enemy is tired (−${Math.round(b.fatigue[1] * LAND.fatigueFightPenalty)}%).` : ''}</div>}
            </div>
            {b.phase === 'deploy' && <div className="card">
              <div className="eyebrow"><span>Formation</span></div>
              {(Object.keys(FORMATIONS) as FormationId[]).map((f) => <button key={f} className={'btn form-card' + (b.formation[0] === f ? ' on' : '')} onClick={() => { applyFormation(b, 0, f); sfx('click'); }}><b>{FORMATIONS[f].name}</b><span>{FORMATIONS[f].desc}</span></button>)}
              <button className="btn primary big" style={{ width: '100%' }} onClick={begin} title="Begin (Enter)">Begin battle</button>
            </div>}
            {b.phase === 'fight' && <div className="card">
              <div className="eyebrow"><span>Command</span><span>keys 1–4</span></div>
              <div className="grid2">
                <button className={'btn' + (group === null ? ' on' : '')} onClick={() => setGroup(null)}>All troops</button>
                {TYPES.map((t) => <button key={t} className={'btn' + (group === t ? ' on' : '')} disabled={!mineAlive![t]} onClick={() => setGroup(t)} title={TROOP[t].blurb}>{TROOP[t].label} {mineAlive![t]}</button>)}
              </div>
              <div className="eyebrow" style={{ marginTop: 8 }}><span>Orders</span><span>{group ? b.groups[0][group].order : ''}</span></div>
              <div className="grid2">{ORDERS.map((o) => <button key={o.id} className={'btn' + (group && b.groups[0][group].order === o.id ? ' on' : '')} onClick={() => giveOrder(o.id)} title={`${o.tip} (${o.key})`}>{o.name} <kbd>{o.key}</kbd></button>)}</div>
              <button className="btn danger" style={{ width: '100%', marginTop: 6 }} disabled={b.retreat[0]} onClick={retreat} title="The whole squad runs for your edge of the field. Survivors escape toward Caer Wyn; runners can be cut down.">{b.retreat[0] ? 'Retreating…' : 'Retreat from battle'}</button>
              <div className="hint" style={{ marginTop: 6 }}>Click the field to move the selected troops. The dashed fan shows archer range.</div>
            </div>}
          </>}
        </aside>
      </div>
      {menu && <PauseMenu onResume={() => setMenu(false)} onRestart={p.onRestart} onQuit={p.onExit} onHelp={() => { setMenu(false); setHelp(true); }} />}
      {help && <Modal title="Field Manual — Land" wide onClose={() => setHelp(false)}><LandGuide /></Modal>}
    </div>
  );
}
