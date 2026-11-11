# Banners & Broadsides: Land & Sea

An original real-time command game in the tradition of classic strategic-map-plus-tactical-battle
wargames, drawn as an illustrated military atlas. Two modes in one application:

- **Land — “The River Crossing”**: march squads of knights, barbarians and archers across a
  contested river, manage fatigue and supply, then command each battle yourself.
- **At Sea — “The Narrow Sea”**: lead an age-of-sail squadron through an island channel; read the
  wind, bring broadsides to bear, rake, and board weakened ships.

Everything runs in the browser. No backend, no API keys, no downloaded assets — all artwork is
drawn procedurally on Canvas 2D and all sound is synthesised.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build in dist/
npm test           # simulation rule tests (headless)
```

## Controls

| | Land | At Sea |
|---|---|---|
| Select | click / tap a crimson round banner | click / tap a round-ringed squadron or ship |
| Move / attack | click a destination or an enemy (right-click also works) | click open water or an enemy |
| Pause, speed | `Space`, and the 1× 2× 4× buttons | same |
| Zoom, pan | mouse wheel or pinch to zoom, drag to pan; `+` `−` `0` keys and the on-screen buttons (works in battles too) | same |
| Cancel / menu | `Esc` | `Esc` |
| Battle | `1`–`4` all / knights / barbarians / archers · `A` advance · `T` attack · `H` hold · `F` fall back · `Enter` begin · click the field to move | `A` `D` helm · `W` `S` sail · `Q` `E` fire port / starboard · `B` board · `Tab` next ship |

Every command is also a button in the side panel, with a tooltip. The in-game **Guide** lists the
full rules, including where they simplify history.

## Code map

```
src/core      seeded RNG, A* pathfinding, canvas helpers, audio, storage
src/land      data.ts (scenario + balance) · sim.ts (strategic state, orders, AI)
              battle.ts (tactical rules, AI, strategic hand-off) · render.ts · LandGame.tsx
src/sea       data.ts (chart + balance) · sim.ts · battle.ts · render.ts · SeaGame.tsx
src/ui        shared shell (fixed-step loop, top bar, tutorial, modals) and the rule guides
tests         rule and state-transition checks for both modes
```

Each mode keeps one plain-data state object (`LandState`, `SeaState`). Tactical battles live
inside it and write their outcome back when concluded, so casualties, damage and prizes cannot be
duplicated or lost between views. The simulation advances in fixed 1/30 s steps independent of
frame rate; pausing simply stops feeding it time. Balance values sit in the `LAND`, `TROOP`,
`FORMATIONS`, `SEA`, `CLASS` and `SHOT` tables at the top of each `data.ts`.

## Known limitations

- One scenario per mode; no campaign sequence, map editor, formation editor or scouting.
- Land battles are one squad against one squad. Wounds on surviving soldiers are not carried
  between battles — only who survived, plus the squad’s fatigue and supply.
- Boarding is resolved automatically as a crew-attrition duel rather than a separate minigame.
- Progress is autosaved on the strategic map only; a battle in progress is not saved.
- Sound is synthesised and simple. Fonts fall back to system serifs.
