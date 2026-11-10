import React from 'react';
import { ARROW, FORMATIONS, LAND, TROOP } from '../land/data';
import { CLASS, SEA, SHOT } from '../sea/data';

export const LandGuide = () => (
  <div className="guide">
    <h3>Controls</h3>
    <table><tbody>
      <tr><td><b>Click / tap</b></td><td>Select a squad; then click a destination to march, or an enemy to attack. Right-click also orders a march.</td></tr>
      <tr><td><kbd>Space</kbd></td><td>Pause or resume. Orders can be given while paused.</td></tr>
      <tr><td><kbd>1</kbd>–<kbd>4</kbd></td><td>Map: select squad. Battle: All / Knights / Barbarians / Archers.</td></tr>
      <tr><td><kbd>A</kbd> <kbd>T</kbd> <kbd>H</kbd> <kbd>F</kbd></td><td>Battle orders: Advance, aTtack, Hold, Fall back. <kbd>Enter</kbd> begins a battle. <kbd>H</kbd> on the map halts.</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>Deselect, or open the menu.</td></tr>
    </tbody></table>
    <h3>The campaign map</h3>
    <ul>
      <li><b>Win</b> by keeping a squad on the enemy standard at Dun Morrow for {LAND.captureTime} seconds with no defender within reach, or by destroying every enemy squad. <b>Lose</b> if the enemy does the same to you.</li>
      <li>The river is crossed only at Northbridge, Heron Ford (slow, tiring) and Stonebridge. Mountains are impassable. Forest and hills slow the march and tire troops faster.</li>
      <li><b>Readiness</b> falls while marching and returns while halted. Tired squads march up to {LAND.fatigueMarchPenalty * 100}% slower and fight up to {LAND.fatigueFightPenalty * 100}% weaker.</li>
      <li><b>Supply</b> drains steadily. At zero a squad tires and cannot recover. Your fort, and Aldermere once one of your squads has occupied it, refill supply and restore readiness quickly.</li>
      <li>A squad marches at the pace of its slowest troop type. Each battle is one squad against one squad; the campaign map pauses while you fight.</li>
    </ul>
    <h3>Troops</h3>
    <table><tbody>{(['knight', 'barbarian', 'archer'] as const).map((t) => <tr key={t}><td><b>{TROOP[t].label}</b></td><td>{TROOP[t].blurb}</td></tr>)}</tbody></table>
    <h3>Formations (chosen before the fight)</h3>
    <table><tbody>{Object.values(FORMATIONS).map((f) => <tr key={f.name}><td><b>{f.name}</b></td><td>{f.desc}</td></tr>)}</tbody></table>
    <h3>Battle</h3>
    <ul>
      <li>Orders go to all troops or to one troop type. Click the field to move the selected troops; they hold on arrival.</li>
      <li>Archers shoot only when standing still. Trees and houses stop some arrows; high ground adds {Math.round((ARROW.hillRange - 1) * 100)}% range; a fort palisade halves hits on its defenders.</li>
      <li>The Battle Line’s arrow protection is lost while troops are on a free <i>Attack</i> order. The Wedge bonus applies to each soldier’s first blow.</li>
      <li><b>Retreat</b> sends the whole squad running for your edge. Those who reach it rejoin the map, pushed back toward your fort and unable to fight for {LAND.retreatImmunity} seconds.</li>
      <li>Survivors, losses and fatigue carry back to the campaign map exactly as the battle left them. Wounds on survivors are not tracked between battles.</li>
    </ul>
  </div>
);

export const SeaGuide = () => (
  <div className="guide">
    <h3>Controls</h3>
    <table><tbody>
      <tr><td><b>Click / tap</b></td><td>Select a squadron or ship; click open water to set a course. Right-click also sets a course.</td></tr>
      <tr><td><kbd>Space</kbd></td><td>Pause or resume. Orders can be given while paused.</td></tr>
      <tr><td><kbd>A</kbd> <kbd>D</kbd></td><td>Battle: put the helm over to port / starboard (15° per press).</td></tr>
      <tr><td><kbd>W</kbd> <kbd>S</kbd></td><td>Battle: more / less sail.</td></tr>
      <tr><td><kbd>Q</kbd> <kbd>E</kbd></td><td>Battle: fire the port / starboard broadside. <kbd>B</kbd> boards. <kbd>Tab</kbd> next ship.</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>Deselect, or open the menu.</td></tr>
    </tbody></table>
    <h3>The chart</h3>
    <ul>
      <li><b>Win</b> by sinking or capturing the enemy flagship <i>Basilisk</i>. <b>Lose</b> if your flagship <i>Sovereign</i> is sunk or captured.</li>
      <li>The wind shifts slowly. No ship can sail closer than about 30° to the wind; a beam or broad reach is fastest. Routes are plotted to tack around the wind’s eye.</li>
      <li>Pale stippled <b>shoals</b> stop ships of the line and flagships; frigates cross freely.</li>
      <li>A squadron lying stopped at a friendly or neutral port repairs hull and rigging and takes on crew. St. Elm’s Haven serves whoever lies there.</li>
      <li>When opposing squadrons meet, every squadron within reach joins the battle and the chart pauses.</li>
    </ul>
    <h3>Ships</h3>
    <table><tbody>{Object.values(CLASS).map((c) => <tr key={c.name}><td><b>{c.name}</b></td><td>{c.blurb} Hull {c.hull}, crew {c.crew}, {c.guns} guns a side.</td></tr>)}</tbody></table>
    <h3>Battle</h3>
    <ul>
      <li>Ships turn slowly and keep way on. Set a course by clicking, or steer with the helm. <b>Full sail</b> is fastest but rigging takes {Math.round((SEA.fullSailRigVuln - 1) * 100)}% more damage and gunnery is {Math.round((1 - SEA.fullSailAim) * 100)}% less accurate. <b>Furled</b> nearly stops the ship.</li>
      <li>Guns fire only through the <b>port and starboard arcs</b> (about ±35° off the beam). Closer is more accurate. Each broadside reloads separately; fewer crew reload slower.</li>
      <li><b>Raking</b> — firing along an enemy’s length through her bow or stern — does {Math.round((SEA.rakeMul - 1) * 100)}% more damage.</li>
      <li>{Object.values(SHOT).map((s) => `${s.name}: ${s.desc}`).join(' ')}</li>
      <li>Hull at zero sinks the ship. Damaged rigging cuts speed and turning. Lost crew slow reloading, thin the broadside and weaken boarding.</li>
      <li><b>Boarding</b> (a simplified action, resolved automatically): come within a pistol shot of an enemy with hull below {SEA.boardHull * 100}%, crew below {SEA.boardCrew * 100}% or rigging below {SEA.boardRig * 100}%, at a similar speed, and order <i>Board</i>. Both crews bleed until one breaks. Win and she is yours, manned by a prize crew taken from your ship; lose badly and your own ship may be taken.</li>
      <li>“Fire at will” lets gun crews fire whenever a target is in arc. “Engage” hands the helm to the ship’s captain; “Withdraw” runs for open sea.</li>
      <li>A ship <b>disengages</b> by sailing off the edge of the battle with no enemy within {SEA.disengageRange} yards. The side that leaves falls back toward its home port.</li>
      <li>Shoals in battle slow deep-draught ships to a crawl and damage their hulls; striking land stops a ship and damages her.</li>
      <li>All damage, losses and prizes carry back to the chart.</li>
    </ul>
  </div>
);
