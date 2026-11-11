import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Progress, Settings, load, loadProgress, loadSettings, remove, save } from './core/storage';
import { setMuted, sfx, unlockAudio } from './core/audio';
import { fmtTime } from './core/util';
import { Modal, SettingsCtx } from './ui/shell';
import { LandGuide, SeaGuide } from './ui/guides';
import { LandGame, ResultData } from './land/LandGame';
import { SeaGame } from './sea/SeaGame';
import { landMapCanvas } from './land/render';
import { seaChartCanvas } from './sea/render';
import { LandState } from './land/sim';
import { SeaState } from './sea/sim';

type Mode = 'land' | 'sea';
type Screen = { k: 'menu' } | { k: 'brief'; mode: Mode } | { k: 'game'; mode: Mode; resume: any; n: number } | { k: 'result'; data: ResultData };

function Preview({ mode, crop }: { mode: Mode; crop?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const src = mode === 'land' ? landMapCanvas() : seaChartCanvas(), cv = ref.current!, ctx = cv.getContext('2d')!;
    if (crop) { const sh = (src.width * cv.height) / cv.width; ctx.drawImage(src, 0, (src.height - sh) / 2, src.width, sh, 0, 0, cv.width, cv.height); }
    else ctx.drawImage(src, 0, 0, cv.width, cv.height);
  }, [mode]);
  return crop ? <canvas ref={ref} width={960} height={540} /> : <canvas ref={ref} width={1200} height={mode === 'land' ? 750 : 750} />;
}

const BRIEF = {
  land: {
    title: 'The River Crossing', tag: 'Land campaign', lead: 'The Greywater divides two hosts. Three crossings, one village, and a standard on a far hill.',
    objective: 'Capture the enemy standard at Dun Morrow by standing a squad on it unopposed — or destroy every enemy squad. Do not lose your own standard at Caer Wyn.',
    points: ['Four squads of knights, barbarians and archers answer to you. The Slate Legion fields four of its own and will come for your standard.', 'Northbridge leads through Morrow Wood; Heron Ford is direct but slow and overlooked by a ridge; Stonebridge opens the road to Aldermere, a village that resupplies whoever holds it.', 'Marching tires troops. Arrive rested, pick your ground, and choose a formation to suit the enemy in front of you.', 'When squads meet you take personal command of the fight.'],
    blurb: 'Command squads of knights, barbarians and archers across a contested river. March, rest, seize the crossings — then take the field yourself.',
  },
  sea: {
    title: 'The Narrow Sea', tag: 'Naval campaign', lead: 'Two islands pinch the sea to a single channel. Beyond it the Black Fleet’s admiral lies at Blackwater.',
    objective: 'Sink or capture the enemy flagship Basilisk. Do not lose your own flagship, Sovereign.',
    points: ['Five ships in three squadrons: two frigates, two ships of the line and your flagship. The enemy has the same, with raiders already at sea.', 'The wind shifts through the day. Ships cannot sail into its eye — approach on a reach, and hold the weather gauge when you can.', 'Shoals bar the heavy ships from the southern passage and Dogger Bank; frigates may cross. St. Elm’s Haven in the channel repairs any squadron that lies there.', 'In battle you set courses and sail, fire broadsides through limited arcs, rake, and board weakened ships to take them as prizes.'],
    blurb: 'Lead an age-of-sail squadron through an island channel. Read the wind, cross the enemy’s bow, and bring your broadsides to bear.',
  },
};

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [progress, setProgress] = useState<Progress>(loadProgress);
  const [screen, setScreen] = useState<Screen>({ k: 'menu' });
  const [guide, setGuide] = useState<Mode | null>(null);
  const sysReduced = useMemo(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  const reduced = settings.reducedMotion ?? sysReduced;
  const update = (p: Partial<Settings>) => setSettings((s) => { const n = { ...s, ...p }; save('settings', n); return n; });
  useEffect(() => { setMuted(settings.muted); }, [settings.muted]);
  useEffect(() => { const u = () => unlockAudio(); window.addEventListener('pointerdown', u); window.addEventListener('keydown', u); return () => { window.removeEventListener('pointerdown', u); window.removeEventListener('keydown', u); }; }, []);
  const ctx = { settings, update, reduced };
  const start = (mode: Mode, resume: any = null) => { sfx('order'); if (!resume) remove('save.' + mode); setScreen({ k: 'game', mode, resume, n: Date.now() }); };
  const finish = (data: ResultData) => {
    if (data.win) setProgress((p) => { const o = p[data.mode], n = { ...p, [data.mode]: { wins: (o?.wins ?? 0) + 1, best: o ? Math.min(o.best, data.time) : data.time } }; save('progress', n); return n; });
    setScreen({ k: 'result', data });
  };

  let body: React.ReactNode;
  if (screen.k === 'game') {
    const common = { onExit: () => setScreen({ k: 'menu' }), onResult: finish, onRestart: () => start(screen.mode) };
    body = screen.mode === 'land' ? <LandGame key={screen.n} {...common} resume={screen.resume as LandState | null} /> : <SeaGame key={screen.n} {...common} resume={screen.resume as SeaState | null} />;
  } else if (screen.k === 'brief') {
    const B = BRIEF[screen.mode];
    body = (
      <div className="screen"><div className="sheet"><div className="brief">
        <div><Preview mode={screen.mode} /><p className="hint" style={{ marginTop: 8 }}>{screen.mode === 'land' ? 'Crimson (you) holds the west bank; the Slate Legion the east.' : 'Port Sable (you) lies west; Blackwater east. Pale stippled water marks the shoals.'}</p></div>
        <div>
          <div className="mode"><span className="tag" style={{ padding: 0 }}>{B.tag} · about 10–15 minutes</span></div>
          <h1>{B.title}</h1>
          <p className="lead">{B.lead}</p>
          <div className="objbox"><b>Objective</b>{B.objective}</div>
          <ul>{B.points.map((t, i) => <li key={i}>{t}</li>)}</ul>
          <label className="row" style={{ margin: '10px 0', cursor: 'pointer' }}><input type="checkbox" checked={!settings.tutorialDone[screen.mode]} onChange={(e) => update({ tutorialDone: { ...settings.tutorialDone, [screen.mode]: !e.target.checked } })} /> Show the short interactive lessons</label>
          <div className="row wrap">
            <button className="btn primary big" autoFocus onClick={() => start(screen.mode)}>Begin the campaign</button>
            <button className="btn big" onClick={() => setGuide(screen.mode)}>Controls &amp; rules</button>
            <button className="btn big ghost" onClick={() => setScreen({ k: 'menu' })}>Back</button>
          </div>
        </div>
      </div></div></div>
    );
  } else if (screen.k === 'result') {
    const d = screen.data;
    body = (
      <div className="screen"><div className="sheet results">
        <div className="title"><div className="over">{BRIEF[d.mode].title} · {fmtTime(d.time)} on campaign</div></div>
        <h1 className={d.win ? 'win' : 'loss'}>{d.win ? 'Victory' : 'Defeat'}</h1>
        <p className="lead">{d.reason}</p>
        <div className="rule">❦</div>
        <div className="statgrid">{d.stats.map(([k, v]) => <div key={k}><b>{v}</b><span>{k}</span></div>)}</div>
        <div className="acts-c">
          <button className="btn primary big" autoFocus onClick={() => start(d.mode)}>Play again</button>
          <button className="btn big" onClick={() => setScreen({ k: 'brief', mode: d.mode === 'land' ? 'sea' : 'land' })}>Try {d.mode === 'land' ? 'At Sea' : 'Land'}</button>
          <button className="btn big" onClick={() => setScreen({ k: 'menu' })}>Main menu</button>
        </div>
      </div></div>
    );
  } else {
    body = (
      <div className="screen"><div className="sheet">
        <div className="title">
          <div className="over">An illustrated atlas of command</div>
          <h1>Banners <em>&amp;</em> Broadsides</h1>
          <div className="sub">Land &amp; Sea</div>
        </div>
        <div className="rule">❦</div>
        <div className="modes">
          {(['land', 'sea'] as Mode[]).map((m) => {
            const saved = load<any>('save.' + m, null), pr = progress[m];
            return (
              <div className="mode" key={m}>
                <Preview mode={m} crop />
                <div className="body">
                  <span className="tag">{m === 'land' ? 'Land' : 'At Sea'}</span>
                  <h2>{BRIEF[m].title}</h2>
                  <p>{BRIEF[m].blurb}</p>
                  <div className="acts">
                    <button className="btn primary big" onClick={() => { sfx('click'); setScreen({ k: 'brief', mode: m }); }}>{m === 'land' ? 'Take the field' : 'Put to sea'}</button>
                    {saved && !saved.result && <button className="btn big" onClick={() => start(m, saved)}>Continue ({fmtTime(saved.time)})</button>}
                    {pr && <span className="medal">★ Won {pr.wins}× · best {fmtTime(pr.best)}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="foot">
          <span>Single-player · runs entirely in your browser · progress is saved on this device when storage is available</span>
          <span className="row">
            <button className="btn" onClick={() => update({ muted: !settings.muted })}>{settings.muted ? '🔇 Sound off' : '🔊 Sound on'}</button>
            <button className="btn" onClick={() => update({ reducedMotion: !reduced })}>Reduced motion: {reduced ? 'on' : 'off'}</button>
            <button className="btn" onClick={() => setGuide('land')}>Guide</button>
          </span>
        </div>
      </div></div>
    );
  }
  return (
    <SettingsCtx.Provider value={ctx}>
      {body}
      {guide && <Modal title={guide === 'land' ? 'Field Manual — Land' : 'Sailing Orders — At Sea'} wide onClose={() => setGuide(null)}>
        <div className="row" style={{ marginBottom: 10 }}><button className={'btn' + (guide === 'land' ? ' on' : '')} onClick={() => setGuide('land')}>Land</button><button className={'btn' + (guide === 'sea' ? ' on' : '')} onClick={() => setGuide('sea')}>At Sea</button></div>
        {guide === 'land' ? <LandGuide /> : <SeaGuide />}
      </Modal>}
    </SettingsCtx.Provider>
  );
}
