import { TAU, Vec, rand, Rng, clamp } from '../core/util';
import { BRASS, INK, IVORY, View, atlasFrame, dashedPath, drawFlag, label, makeCanvas, paperGrain, vignette } from '../core/draw';
import { LAND, PLACES, SIDE_COLOR, SIDE_LIGHT, Side, T, TROOP, TYPES, TroopType, WORLD, landMap, tileCenter } from './data';
import { LandState, Squad, fortPos, routeTo, total, villagePos } from './sim';
import { Battle, FIELD, groupCentroid } from './battle';

const S = 2;
const px = (t: number) => t * LAND.tile;

function wobble(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, seed: number, amp = 0.07) {
  ctx.beginPath();
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * TAU, r = 1 + amp * (Math.sin(a * 3 + seed) + 0.6 * Math.sin(a * 5 + seed * 2.3));
    const x = cx + Math.cos(a) * rx * r, y = cy + Math.sin(a) * ry * r;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
}
function tree(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, conifer: boolean) {
  ctx.fillStyle = 'rgba(40,40,20,0.18)'; ctx.beginPath(); ctx.ellipse(x + 2, y + 1, 7 * s, 2.6 * s, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#5a4028'; ctx.fillRect(x - 1.1 * s, y - 5 * s, 2.2 * s, 6 * s);
  ctx.lineWidth = 0.8; ctx.strokeStyle = 'rgba(40,35,20,0.55)';
  if (conifer) {
    for (let i = 0; i < 3; i++) {
      const w = (8 - i * 2) * s, by = y - (4 + i * 5.5) * s;
      ctx.beginPath(); ctx.moveTo(x - w, by); ctx.lineTo(x, by - 9 * s); ctx.lineTo(x + w, by); ctx.closePath();
      ctx.fillStyle = i === 2 ? '#5b7a50' : '#496445'; ctx.fill(); ctx.stroke();
    }
  } else {
    const cy = y - 12 * s, r = 8.5 * s;
    ctx.beginPath(); ctx.arc(x, cy, r, 0, TAU); ctx.fillStyle = '#58733f'; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(x + r * 0.25, cy + r * 0.25, r * 0.72, 0.1, 1.9); ctx.fillStyle = 'rgba(40,60,30,0.45)'; ctx.fill();
    ctx.beginPath(); ctx.arc(x - r * 0.3, cy - r * 0.32, r * 0.42, 0, TAU); ctx.fillStyle = 'rgba(150,175,105,0.75)'; ctx.fill();
  }
}
function house(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, roof = '#a5553f') {
  ctx.fillStyle = 'rgba(40,30,20,0.2)'; ctx.fillRect(x - w / 2 + 2, y - 1, w, 3);
  ctx.fillStyle = '#efe5c8'; ctx.strokeStyle = INK; ctx.lineWidth = 0.9;
  ctx.fillRect(x - w / 2, y - h, w, h); ctx.strokeRect(x - w / 2, y - h, w, h);
  ctx.beginPath(); ctx.moveTo(x - w / 2 - 2, y - h); ctx.lineTo(x, y - h - w * 0.55); ctx.lineTo(x + w / 2 + 2, y - h); ctx.closePath();
  ctx.fillStyle = roof; ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#4a3323'; ctx.fillRect(x - 1.5, y - h * 0.55, 3, h * 0.55);
}
function rock(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x - r * 0.6, y - r * 0.9); ctx.lineTo(x + r * 0.3, y - r * 1.1); ctx.lineTo(x + r, y - r * 0.2); ctx.lineTo(x + r * 0.8, y + r * 0.3); ctx.lineTo(x - r * 0.7, y + r * 0.35); ctx.closePath();
  ctx.fillStyle = '#a3a79f'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 0.9; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + r * 0.3, y - r * 1.1); ctx.lineTo(x + r * 0.1, y + r * 0.3); ctx.strokeStyle = 'rgba(60,50,40,0.4)'; ctx.stroke();
}
function riverPath(ctx: CanvasRenderingContext2D, pts: Vec[]) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(px(p.x), px(p.y)) : ctx.moveTo(px(p.x), px(p.y))));
}
function fortArt(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = 'rgba(160,130,80,0.35)'; ctx.beginPath(); ctx.arc(x, y, 27, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#6a4c2e'; ctx.lineWidth = 3.5; ctx.setLineDash([3, 2]); ctx.beginPath(); ctx.arc(x, y, 25, 0.75, TAU + 0.25 - 0.5); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = INK; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(x, y, 27, 0, TAU); ctx.stroke();
  ctx.fillStyle = '#c2bba8'; ctx.strokeStyle = INK; ctx.lineWidth = 1.1;
  ctx.fillRect(x - 11, y - 16, 22, 22); ctx.strokeRect(x - 11, y - 16, 22, 22);
  for (let i = 0; i < 4; i++) { ctx.fillRect(x - 12 + i * 6.4, y - 20, 4.2, 5); ctx.strokeRect(x - 12 + i * 6.4, y - 20, 4.2, 5); }
  ctx.fillStyle = 'rgba(60,50,40,0.25)'; ctx.fillRect(x + 3, y - 16, 8, 22);
  ctx.fillStyle = '#3a2b1c'; ctx.beginPath(); ctx.moveTo(x - 3.5, y + 6); ctx.lineTo(x - 3.5, y - 2); ctx.arc(x, y - 2, 3.5, Math.PI, 0); ctx.lineTo(x + 3.5, y + 6); ctx.fill();
}

let mapC: HTMLCanvasElement | null = null;
export function landMapCanvas(): HTMLCanvasElement {
  if (mapC) return mapC;
  const m = landMap(), W = WORLD.w, H = WORLD.h, c = makeCanvas(W * S, H * S), ctx = c.getContext('2d')!;
  ctx.scale(S, S);
  const r: Rng = { seed: 77 };
  ctx.fillStyle = '#e4d6b2'; ctx.fillRect(0, 0, W, H);
  const wash = ['185,198,140', '168,186,124', '214,194,120', '200,208,152', '176,190,130'];
  for (let i = 0; i < 300; i++) {
    const x = rand(r) * W, y = rand(r) * H, rad = 50 + rand(r) * 130, col = wash[(rand(r) * wash.length) | 0];
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(${col},0.3)`); g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  paperGrain(ctx, W, H, r, 5000);
  // grass tufts
  ctx.strokeStyle = 'rgba(90,110,60,0.35)'; ctx.lineWidth = 0.8;
  for (let i = 0; i < 900; i++) { const x = rand(r) * W, y = rand(r) * H; ctx.beginPath(); ctx.moveTo(x - 2, y); ctx.lineTo(x - 1, y - 3); ctx.moveTo(x, y); ctx.lineTo(x, y - 4); ctx.moveTo(x + 2, y); ctx.lineTo(x + 1.5, y - 3); ctx.stroke(); }
  // hills with contours and hachures
  m.hills.forEach(([cx, cy, rx, ry], i) => {
    const X = px(cx), Y = px(cy), RX = px(rx), RY = px(ry);
    wobble(ctx, X, Y, RX, RY, i * 3 + 1); ctx.fillStyle = 'rgba(205,188,125,0.55)'; ctx.fill();
    const g = ctx.createRadialGradient(X - RX * 0.3, Y - RY * 0.3, 0, X, Y, Math.max(RX, RY));
    g.addColorStop(0, 'rgba(250,240,200,0.5)'); g.addColorStop(1, 'rgba(120,95,50,0.18)'); ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(122,92,52,0.7)'; ctx.lineWidth = 1;
    [1, 0.74, 0.5, 0.26].forEach((k, j) => { wobble(ctx, X - (1 - k) * RX * 0.15, Y - (1 - k) * RY * 0.15, RX * k, RY * k, i * 3 + 1 + j * 0.4); ctx.stroke(); });
    ctx.lineWidth = 0.8;
    for (let a = -0.2; a < 2.4; a += 0.11) { const x0 = X + Math.cos(a) * RX * 1.02, y0 = Y + Math.sin(a) * RY * 1.02; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + Math.cos(a) * 7, y0 + Math.sin(a) * 7); ctx.stroke(); }
  });
  // roads
  const F0 = fortPos(0), F1 = fortPos(1), V = villagePos(), cr = PLACES.crossings.map((c2) => tileCenter(c2.x, c2.y));
  const legs: [Vec, Vec][] = [[F0, cr[0]], [cr[0], F1], [F0, cr[1]], [cr[1], F1], [F0, cr[2]], [cr[2], V], [V, F1]];
  for (const [a, b] of legs) { const p = routeTo(a, b.x, b.y).path; if (p) dashedPath(ctx, [a, ...p.filter((_, i) => i % 2 === 0), b], 'rgba(120,90,55,0.55)', 2.2, [1, 6]); }
  // river
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  riverPath(ctx, m.river); ctx.strokeStyle = 'rgba(70,95,85,0.6)'; ctx.lineWidth = 60; ctx.stroke();
  riverPath(ctx, m.river); ctx.strokeStyle = '#8db6c2'; ctx.lineWidth = 54; ctx.stroke();
  riverPath(ctx, m.river); ctx.strokeStyle = 'rgba(175,212,220,0.6)'; ctx.lineWidth = 34; ctx.stroke();
  ctx.setLineDash([9, 24]); ctx.strokeStyle = 'rgba(250,250,240,0.6)'; ctx.lineWidth = 1.2;
  for (const off of [-14, 0, 13]) { ctx.save(); ctx.translate(off, 0); ctx.lineDashOffset = off * 3; riverPath(ctx, m.river); ctx.stroke(); ctx.restore(); }
  ctx.setLineDash([]);
  // crossings
  for (const c2 of PLACES.crossings) {
    let x0 = Infinity, x1 = -Infinity;
    for (const row of c2.rows) for (let x = 0; x < m.w; x++) if (m.tiles[row * m.w + x] === c2.kind) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); }
    const X0 = px(x0) - 8, X1 = px(x1) + 8, Y = px(c2.rows[0]), Hh = c2.rows.length * LAND.tile;
    if (c2.kind === T.Bridge) {
      const y = Y + 6, h = 20;
      ctx.fillStyle = '#8f8a7c'; ctx.fillRect(X0 - 4, y - 3, 8, h + 6); ctx.fillRect(X1 - 4, y - 3, 8, h + 6);
      ctx.fillStyle = 'rgba(30,40,40,0.25)'; ctx.fillRect(X0, y + 4, X1 - X0, h);
      ctx.fillStyle = '#ab8552'; ctx.fillRect(X0, y, X1 - X0, h);
      ctx.strokeStyle = 'rgba(70,45,25,0.6)'; ctx.lineWidth = 0.8;
      for (let x = X0 + 5; x < X1; x += 5) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + h); ctx.stroke(); }
      ctx.strokeStyle = '#4f3620'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(X0, y); ctx.lineTo(X1, y); ctx.moveTo(X0, y + h); ctx.lineTo(X1, y + h); ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(214,228,214,0.8)'; ctx.fillRect(X0 + 6, Y + 3, X1 - X0 - 12, Hh - 6);
      ctx.strokeStyle = 'rgba(80,70,50,0.7)'; ctx.lineWidth = 1.2; ctx.setLineDash([4, 4]); ctx.strokeRect(X0 + 6, Y + 3, X1 - X0 - 12, Hh - 6); ctx.setLineDash([]);
      for (let i = 0; i < 26; i++) { ctx.fillStyle = i % 2 ? '#9a9a8e' : '#b7b5a6'; ctx.beginPath(); ctx.ellipse(X0 + 10 + rand(r) * (X1 - X0 - 20), Y + 8 + rand(r) * (Hh - 16), 2 + rand(r) * 2.5, 1.5 + rand(r) * 1.5, 0, 0, TAU); ctx.fill(); }
    }
  }
  // village fields and houses
  for (const [fx, fy, w, h, col] of [[-78, -34, 44, 26, '#d8be6c'], [44, 20, 50, 28, '#c9b25e'], [-70, 30, 40, 24, '#b9c07a'], [36, -54, 40, 24, '#d8be6c']] as [number, number, number, number, string][]) {
    ctx.save(); ctx.translate(V.x + fx, V.y + fy); ctx.transform(1, 0, -0.25, 1, 0, 0);
    ctx.fillStyle = col; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = 'rgba(100,80,40,0.5)'; ctx.lineWidth = 0.7; ctx.strokeRect(0, 0, w, h);
    for (let x = 4; x < w; x += 4) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    ctx.restore();
  }
  for (const [hx, hy, w, h] of [[-20, -8, 12, 9], [16, -12, 13, 9], [-10, 14, 12, 8], [22, 10, 11, 8], [-28, 8, 10, 8]]) house(ctx, V.x + hx, V.y + hy, w, h);
  house(ctx, V.x, V.y + 2, 11, 16, '#7d6a58'); ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(V.x, V.y - 20); ctx.lineTo(V.x, V.y - 28); ctx.moveTo(V.x - 2.5, V.y - 25); ctx.lineTo(V.x + 2.5, V.y - 25); ctx.stroke();
  fortArt(ctx, F0.x, F0.y); fortArt(ctx, F1.x, F1.y);
  // forests and mountains, sorted by y for overlap
  const things: { x: number; y: number; d: () => void }[] = [];
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const t = m.tiles[y * m.w + x];
    if (t === T.Forest) for (let k = 0; k < 3; k++) {
      const tx = px(x) + rand(r) * 32, ty = px(y) + 6 + rand(r) * 28, s = 0.8 + rand(r) * 0.45, con = rand(r) < 0.3;
      things.push({ x: tx, y: ty, d: () => tree(ctx, tx, ty, s, con) });
    }
  }
  m.mountains.forEach(([cx, cy, rx, ry]) => {
    const n = Math.round(rx * ry * 2.2);
    for (let k = 0; k < n; k++) {
      const a = rand(r) * TAU, d = Math.sqrt(rand(r)) * 0.86, X = px(cx + Math.cos(a) * rx * d), Y = px(cy + Math.sin(a) * ry * d) + 14, w = 22 + rand(r) * 16, h = 34 + rand(r) * 30, lean = (rand(r) - 0.5) * 8;
      things.push({ x: X, y: Y, d: () => {
        ctx.beginPath(); ctx.moveTo(X - w, Y); ctx.lineTo(X + lean, Y - h); ctx.lineTo(X + w, Y); ctx.closePath(); ctx.fillStyle = '#9aa2aa'; ctx.fill();
        ctx.beginPath(); ctx.moveTo(X + lean, Y - h); ctx.lineTo(X + w, Y); ctx.lineTo(X + lean * 0.3 + 3, Y); ctx.closePath(); ctx.fillStyle = '#6c7682'; ctx.fill();
        ctx.beginPath(); ctx.moveTo(X + lean, Y - h); ctx.lineTo(X + lean - w * 0.3, Y - h * 0.68); ctx.lineTo(X + lean - 2, Y - h * 0.74); ctx.lineTo(X + lean + 3, Y - h * 0.62); ctx.lineTo(X + lean + w * 0.3, Y - h * 0.7); ctx.closePath(); ctx.fillStyle = IVORY; ctx.fill();
        ctx.beginPath(); ctx.moveTo(X - w, Y); ctx.lineTo(X + lean, Y - h); ctx.lineTo(X + w, Y); ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.stroke();
      } });
    }
  });
  things.sort((a, b) => a.y - b.y).forEach((t) => t.d());
  // labels
  PLACES.forts.forEach((f, i) => label(ctx, f.name, px(f.x + 0.5), px(f.y + 0.5) + 44, 17, { bold: true, color: i === 0 ? '#6e1f26' : '#27324a' }));
  label(ctx, PLACES.village.name, V.x, V.y + 36, 15, { italic: true });
  PLACES.crossings.forEach((c2) => label(ctx, c2.name, px(c2.x + 0.5) + 6, px(c2.rows[0]) - 10, 13, { italic: true, color: '#2f4a55' }));
  label(ctx, 'R. Greywater', px(27.6), px(11.4), 13, { italic: true, color: '#3b6272', spacing: 1 });
  label(ctx, 'Westwood', px(14), px(9.3), 14, { italic: true, color: '#2e4023', spacing: 2 });
  label(ctx, 'Morrow Wood', px(31), px(6.3), 14, { italic: true, color: '#2e4023', spacing: 2 });
  label(ctx, 'Slate Tors', px(37.5), px(24.6), 13, { italic: true, color: '#3c4450', spacing: 2 });
  label(ctx, "Warden's Rise", px(20), px(17.8), 12, { italic: true, color: '#6a5230' });
  label(ctx, 'Morrow Ridge', px(37.5), px(8.9), 12, { italic: true, color: '#6a5230' });
  // cartouche and compass
  const cxx = W - 190, cyy = 46;
  ctx.fillStyle = 'rgba(240,230,200,0.85)'; ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.fillRect(cxx - 130, cyy - 22, 260, 44); ctx.strokeRect(cxx - 130, cyy - 22, 260, 44); ctx.lineWidth = 0.6; ctx.strokeRect(cxx - 126, cyy - 18, 252, 36);
  label(ctx, 'THE RIVER CROSSING', cxx, cyy - 4, 18, { bold: true, spacing: 3, halo: '' });
  label(ctx, 'a chart of the Greywater marches', cxx, cyy + 12, 11, { italic: true, halo: '' });
  compass(ctx, 62, H - 66, 30);
  atlasFrame(ctx, W, H);
  vignette(ctx, W, H);
  mapC = c;
  return c;
}
function compass(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = 'rgba(240,230,200,0.8)'; ctx.beginPath(); ctx.arc(0, 0, r + 6, 0, TAU); ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, r + 6, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, TAU); ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const len = i % 2 ? r * 0.6 : r;
    ctx.save(); ctx.rotate((i * TAU) / 8);
    ctx.beginPath(); ctx.moveTo(0, -len); ctx.lineTo(5, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.fillStyle = INK; ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, -len); ctx.lineTo(-5, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.fillStyle = i === 0 ? '#a8323a' : '#d9cba3'; ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  label(ctx, 'N', 0, -r - 14, 12, { bold: true });
  ctx.restore();
}

/** ---------- soldiers ---------- */
export function drawSoldier(ctx: CanvasRenderingContext2D, type: TroopType, side: Side, x: number, y: number, o: { walk?: number; atk?: number; face?: number; scale?: number; moving?: boolean } = {}) {
  const sc = o.scale ?? 1, col = SIDE_COLOR[side], lite = SIDE_LIGHT[side];
  const sw = o.moving ? Math.sin(o.walk ?? 0) * 2.2 : 0, bob = o.moving ? -Math.abs(Math.sin(o.walk ?? 0)) * 1.2 : 0, atk = o.atk ?? 0;
  const swing = Math.sin(atk * Math.PI) * 1.5;
  ctx.save(); ctx.translate(x, y); ctx.scale((o.face ?? 1) * sc, sc);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(35,25,15,0.85)'; ctx.lineWidth = 0.8;
  const box = (bx: number, by: number, w: number, h: number, fill: string) => { ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(bx, by, w, h, 1.6); ctx.fill(); ctx.stroke(); };
  if (type === 'knight') {
    box(-4 + sw * 0.5, -7, 3.2, 7, '#59616b'); box(0.8 - sw * 0.5, -7, 3.2, 7, '#6b737d');
    box(-5.5, -18 + bob, 11, 12, '#b3bbc4'); ctx.fillStyle = col; ctx.fillRect(-2.6, -17.5 + bob, 5.2, 11);
    ctx.fillStyle = '#c9d0d7'; ctx.beginPath(); ctx.arc(0.3, -21.5 + bob, 4.4, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#23262c'; ctx.fillRect(1, -22.4 + bob, 3.6, 1.5);
    ctx.strokeStyle = col; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(-0.5, -25.5 + bob); ctx.quadraticCurveTo(-5, -30 + bob, -7.5, -25 + bob); ctx.stroke();
    ctx.save(); ctx.translate(3, -14 + bob); ctx.rotate(0.35 + swing);
    ctx.strokeStyle = '#3a2b1c'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(-2.4, -1.5); ctx.lineTo(2.4, -1.5); ctx.stroke();
    ctx.strokeStyle = '#eef1f4'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(0, -15); ctx.stroke();
    ctx.strokeStyle = 'rgba(35,25,15,0.6)'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(1, -2); ctx.lineTo(1, -14); ctx.stroke(); ctx.restore();
    ctx.beginPath(); ctx.moveTo(2.5, -17 + bob); ctx.lineTo(9, -17 + bob); ctx.lineTo(9, -11 + bob); ctx.quadraticCurveTo(8.5, -6.5 + bob, 5.7, -4.5 + bob); ctx.quadraticCurveTo(3, -6.5 + bob, 2.5, -11 + bob); ctx.closePath();
    ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = IVORY; ctx.lineWidth = 1.1; ctx.stroke();
    ctx.fillStyle = IVORY; ctx.fillRect(5.2, -15.5 + bob, 1.1, 8); ctx.fillRect(3.6, -13 + bob, 4.4, 1.1);
  } else if (type === 'barbarian') {
    box(-3.6 + sw, -7, 2.8, 7, col); box(0.8 - sw, -7, 2.8, 7, lite);
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(-4.5, -12 + bob, 4, 0, TAU); ctx.fill(); ctx.strokeStyle = IVORY; ctx.lineWidth = 1; ctx.stroke(); ctx.strokeStyle = 'rgba(35,25,15,0.85)'; ctx.lineWidth = 0.8;
    box(-4.5, -16.5 + bob, 9, 10, '#cf9f72');
    ctx.fillStyle = '#5b4028'; ctx.beginPath(); ctx.moveTo(-4.8, -16.8 + bob); ctx.lineTo(4.8, -16.8 + bob); ctx.lineTo(-4.8, -9.5 + bob); ctx.closePath(); ctx.fill();
    ctx.fillStyle = col; ctx.fillRect(-4.5, -9 + bob, 9, 2.6);
    ctx.fillStyle = '#3d2a18'; ctx.beginPath(); ctx.moveTo(-4.6, -17 + bob); ctx.lineTo(-6.5, -23 + bob); ctx.lineTo(-3, -24.8 + bob); ctx.lineTo(-1.5, -26.4 + bob); ctx.lineTo(1.5, -25 + bob); ctx.lineTo(3, -22 + bob); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#d9aa7e'; ctx.beginPath(); ctx.arc(0.6, -20 + bob, 3.6, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-2.6, -21.6 + bob); ctx.lineTo(3.8, -21.6 + bob); ctx.stroke();
    ctx.save(); ctx.translate(4, -13 + bob); ctx.rotate(0.5 + swing);
    ctx.strokeStyle = '#4f3620'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(0, 3); ctx.lineTo(0, -15); ctx.stroke();
    ctx.fillStyle = '#c5ccd3'; ctx.strokeStyle = 'rgba(35,25,15,0.85)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(0, -15.5); ctx.quadraticCurveTo(7.5, -16.5, 6.5, -8.5); ctx.quadraticCurveTo(3.5, -11.5, 0, -10.5); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  } else {
    box(-3.2 + sw * 0.7, -7, 2.6, 7, '#6b5a3e'); box(0.6 - sw * 0.7, -7, 2.6, 7, '#7b6a4c');
    ctx.fillStyle = '#6a4c2e'; ctx.save(); ctx.translate(-4.4, -13 + bob); ctx.rotate(-0.3); ctx.fillRect(-1.5, -6, 3, 9); ctx.strokeStyle = IVORY; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-0.8, -6); ctx.lineTo(-1.2, -9); ctx.moveTo(0.8, -6); ctx.lineTo(1, -9.4); ctx.stroke(); ctx.restore();
    ctx.strokeStyle = 'rgba(35,25,15,0.85)'; ctx.lineWidth = 0.8;
    box(-4, -16.5 + bob, 8, 10, lite); ctx.fillStyle = col; ctx.fillRect(-4, -16.5 + bob, 8, 3.4); ctx.fillStyle = '#4f3620'; ctx.fillRect(-4, -9.6 + bob, 8, 1.5);
    ctx.fillStyle = '#e2b88e'; ctx.beginPath(); ctx.arc(0.4, -19.8 + bob, 3.4, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, -20.6 + bob, 3.9, Math.PI * 0.95, Math.PI * 2.05); ctx.lineTo(5, -20.4 + bob); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = IVORY; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(-1, -24 + bob); ctx.lineTo(-4.5, -28 + bob); ctx.stroke();
    const draw = atk > 0.55 ? 3.5 : 0;
    ctx.strokeStyle = '#4f3620'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(2.5, -13 + bob, 9, -1.15, 1.15); ctx.stroke();
    ctx.strokeStyle = 'rgba(250,245,225,0.9)'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(6.2, -21.2 + bob); ctx.lineTo(6.2 - draw, -13 + bob); ctx.lineTo(6.2, -4.8 + bob); ctx.stroke();
    if (draw) { ctx.strokeStyle = '#3a2b1c'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(2.5, -13 + bob); ctx.lineTo(13, -13 + bob); ctx.stroke(); }
  }
  ctx.restore();
}

/** ---------- strategic view ---------- */
export interface LandUI { selected: number | null; hoverSquad: number | null; preview: Vec[] | null; badAt: Vec | null; t: number; reduced: boolean }
export function drawLand(ctx: CanvasRenderingContext2D, v: View, st: LandState, ui: LandUI) {
  ctx.save(); ctx.translate(v.ox, v.oy); ctx.scale(v.scale, v.scale);
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 18; ctx.fillStyle = '#e4d6b2'; ctx.fillRect(0, 0, WORLD.w, WORLD.h); ctx.shadowBlur = 0;
  ctx.drawImage(landMapCanvas(), 0, 0, WORLD.w, WORLD.h);
  const t = ui.reduced ? 0 : ui.t;
  // objectives: standards and village
  for (const side of [0, 1] as Side[]) {
    const f = fortPos(side), cap = st.capture[(1 - side) as Side] / LAND.captureTime;
    if (side === 1) { ctx.strokeStyle = `rgba(184,147,74,${0.55 + 0.3 * Math.sin(t * 3)})`; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.lineDashOffset = -t * 8; ctx.beginPath(); ctx.arc(f.x, f.y, 36, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
    drawFlag(ctx, f.x, f.y - 18, 34, SIDE_COLOR[side], IVORY, t + side, side);
    if (cap > 0) { ctx.strokeStyle = SIDE_COLOR[(1 - side) as Side]; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(f.x, f.y, 33, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(cap, 0, 1)); ctx.stroke(); }
  }
  const vp = villagePos();
  drawFlag(ctx, vp.x + 12, vp.y - 14, 22, st.villageOwner < 0 ? '#d8d0bb' : SIDE_COLOR[st.villageOwner as Side], IVORY, t + 2, st.villageOwner === 1 ? 1 : 0);
  // planned movement
  for (const s of st.squads) if (s.side === 0 && s.path.length) {
    const sel = s.id === ui.selected, pts = [{ x: s.x, y: s.y }, ...s.path], end = pts[pts.length - 1];
    dashedPath(ctx, pts, sel ? 'rgba(246,239,220,0.95)' : 'rgba(246,239,220,0.45)', sel ? 3.4 : 2, [7, 6], -t * 14);
    if (sel) dashedPath(ctx, pts, SIDE_COLOR[0], 1.4, [7, 6], -t * 14);
    ctx.strokeStyle = sel ? SIDE_COLOR[0] : 'rgba(168,50,58,0.5)'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(end.x - 5, end.y - 5); ctx.lineTo(end.x + 5, end.y + 5); ctx.moveTo(end.x + 5, end.y - 5); ctx.lineTo(end.x - 5, end.y + 5); ctx.stroke();
  }
  if (ui.preview) dashedPath(ctx, ui.preview, 'rgba(61,47,34,0.55)', 1.8, [3, 5]);
  if (ui.badAt) { ctx.strokeStyle = '#8c1c1c'; ctx.lineWidth = 3; const b = ui.badAt; ctx.beginPath(); ctx.arc(b.x, b.y, 9, 0, TAU); ctx.moveTo(b.x - 6, b.y - 6); ctx.lineTo(b.x + 6, b.y + 6); ctx.stroke(); }
  for (const s of [...st.squads].sort((a, b) => a.y - b.y)) drawSquad(ctx, s, s.id === ui.selected, s.id === ui.hoverSquad, t);
  ctx.restore();
}
function drawSquad(ctx: CanvasRenderingContext2D, s: Squad, sel: boolean, hover: boolean, t: number) {
  const col = SIDE_COLOR[s.side], moving = s.path.length > 0, x = 0, y = 0;
  ctx.save(); ctx.translate(s.x, s.y); ctx.scale(1.3, 1.3);
  if (s.immune > 2) ctx.globalAlpha = 0.6;
  ctx.fillStyle = 'rgba(30,20,10,0.28)'; ctx.beginPath(); ctx.ellipse(x, y + 9, 19, 6, 0, 0, TAU); ctx.fill();
  if (sel || hover) {
    ctx.strokeStyle = sel ? IVORY : 'rgba(246,239,220,0.7)'; ctx.lineWidth = sel ? 2.6 : 1.6; ctx.setLineDash(sel ? [7, 5] : []); ctx.lineDashOffset = -t * 10;
    ctx.beginPath(); ctx.arc(x, y, 25, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    if (sel) { ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, 28, 0, TAU); ctx.stroke(); }
  }
  ctx.beginPath();
  if (s.side === 0) ctx.arc(x, y, 16, 0, TAU); else { ctx.moveTo(x, y - 19); ctx.lineTo(x + 19, y); ctx.lineTo(x, y + 19); ctx.lineTo(x - 19, y); ctx.closePath(); }
  ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = IVORY; ctx.lineWidth = 2.2; ctx.stroke(); ctx.strokeStyle = INK; ctx.lineWidth = 0.8; ctx.stroke();
  const present = TYPES.filter((ty) => s.counts[ty] > 0).sort((a, b) => s.counts[b] - s.counts[a]);
  const spots = present.length === 1 ? [[0, 8]] : present.length === 2 ? [[-6, 8], [6, 8]] : [[0, 5], [-8, 10], [8, 10]];
  present.map((ty, i) => ({ ty, p: spots[i] })).sort((a, b) => a.p[1] - b.p[1]).forEach(({ ty, p }) => drawSoldier(ctx, ty, s.side, x + p[0], y + p[1], { scale: 0.82, walk: t * 9 + p[0], moving, face: s.side === 0 ? 1 : -1 }));
  drawFlag(ctx, x + (s.side === 0 ? -13 : 13), y + 6, 34, col, IVORY, t + s.id, s.side, s.side === 0 ? -1 : 1);
  // strength, readiness and supply
  const n = total(s.counts);
  ctx.fillStyle = IVORY; ctx.strokeStyle = INK; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.roundRect(x + 9, y + 9, 17, 12, 3); ctx.fill(); ctx.stroke();
  label(ctx, String(n), x + 17.5, y + 15.5, 11, { bold: true, halo: '' });
  const ready = 1 - s.fatigue / 100;
  ctx.fillStyle = 'rgba(30,20,10,0.75)'; ctx.fillRect(x - 16, y + 23, 32, 7);
  ctx.fillStyle = ready > 0.6 ? '#7fa650' : ready > 0.3 ? '#d1a13c' : '#b8433a'; ctx.fillRect(x - 15, y + 24, 30 * ready, 2.4);
  ctx.fillStyle = '#e8d9a8'; ctx.fillRect(x - 15, y + 27, (30 * s.supply) / 100, 2);
  ctx.restore();
}

/** ---------- tactical view ---------- */
const fieldCache = new WeakMap<Battle, HTMLCanvasElement>();
function fieldCanvas(b: Battle): HTMLCanvasElement {
  let c = fieldCache.get(b);
  if (c) return c;
  c = makeCanvas(FIELD.w * S, FIELD.h * S);
  const ctx = c.getContext('2d')!, r: Rng = { seed: 5 + b.terrain * 13 }, W = FIELD.w, H = FIELD.h;
  ctx.scale(S, S);
  ctx.fillStyle = b.terrain === T.Forest ? '#c9cc9a' : b.terrain === T.Village ? '#dccf9f' : '#d6d3a2'; ctx.fillRect(0, 0, W, H);
  const wash = b.terrain === T.Forest ? ['120,150,90', '150,170,105', '100,130,80'] : ['185,198,140', '168,186,124', '214,194,120', '200,208,152'];
  for (let i = 0; i < 150; i++) {
    const x = rand(r) * W, y = rand(r) * H, rad = 50 + rand(r) * 120, col = wash[(rand(r) * wash.length) | 0], g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(${col},0.33)`); g.addColorStop(1, `rgba(${col},0)`); ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  paperGrain(ctx, W, H, r, 2500);
  if (b.hill) {
    const h = b.hill;
    wobble(ctx, h.x, h.y, h.rx, h.ry, 2, 0.04); ctx.fillStyle = 'rgba(214,196,130,0.6)'; ctx.fill();
    const g = ctx.createRadialGradient(h.x - 40, h.y - 60, 0, h.x, h.y, h.ry); g.addColorStop(0, 'rgba(255,246,205,0.55)'); g.addColorStop(1, 'rgba(120,95,50,0.2)'); ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(122,92,52,0.6)'; ctx.lineWidth = 1.1;
    [1, 0.78, 0.55, 0.32].forEach((k, j) => { wobble(ctx, h.x, h.y, h.rx * k, h.ry * k, 2 + j * 0.5, 0.04); ctx.stroke(); });
    label(ctx, 'HIGH GROUND', h.x, h.y - h.ry * 0.9, 13, { italic: true, color: '#6a5230', spacing: 3 });
  }
  ctx.strokeStyle = 'rgba(90,110,60,0.4)'; ctx.lineWidth = 0.9;
  for (let i = 0; i < 500; i++) { const x = rand(r) * W, y = rand(r) * H; ctx.beginPath(); ctx.moveTo(x - 2, y); ctx.lineTo(x - 1, y - 4); ctx.moveTo(x, y); ctx.lineTo(x, y - 5); ctx.moveTo(x + 2, y); ctx.lineTo(x + 1.5, y - 4); ctx.stroke(); }
  const bar = b.barrier;
  if (bar && bar.kind !== 'wall') {
    ctx.fillStyle = 'rgba(70,95,85,0.6)'; ctx.fillRect(bar.x0 - 4, 0, bar.x1 - bar.x0 + 8, H);
    ctx.fillStyle = '#8db6c2'; ctx.fillRect(bar.x0, 0, bar.x1 - bar.x0, H);
    ctx.fillStyle = 'rgba(175,212,220,0.6)'; ctx.fillRect(bar.x0 + 14, 0, bar.x1 - bar.x0 - 28, H);
    ctx.strokeStyle = 'rgba(250,250,240,0.6)'; ctx.lineWidth = 1.2;
    for (let i = 0; i < 60; i++) { const x = bar.x0 + 8 + rand(r) * (bar.x1 - bar.x0 - 16), y = rand(r) * H; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 3, y + 6, x, y + 12); ctx.stroke(); }
    if (bar.kind === 'bridge') {
      ctx.fillStyle = '#8f8a7c'; ctx.fillRect(bar.x0 - 14, bar.g0 - 8, 14, bar.g1 - bar.g0 + 16); ctx.fillRect(bar.x1, bar.g0 - 8, 14, bar.g1 - bar.g0 + 16);
      ctx.fillStyle = 'rgba(30,40,40,0.3)'; ctx.fillRect(bar.x0 - 6, bar.g0 + 8, bar.x1 - bar.x0 + 12, bar.g1 - bar.g0);
      ctx.fillStyle = '#ab8552'; ctx.fillRect(bar.x0 - 10, bar.g0, bar.x1 - bar.x0 + 20, bar.g1 - bar.g0);
      ctx.strokeStyle = 'rgba(70,45,25,0.6)'; ctx.lineWidth = 1; for (let x = bar.x0 - 4; x < bar.x1 + 10; x += 7) { ctx.beginPath(); ctx.moveTo(x, bar.g0); ctx.lineTo(x, bar.g1); ctx.stroke(); }
      ctx.strokeStyle = '#4f3620'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(bar.x0 - 10, bar.g0); ctx.lineTo(bar.x1 + 10, bar.g0); ctx.moveTo(bar.x0 - 10, bar.g1); ctx.lineTo(bar.x1 + 10, bar.g1); ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(214,228,214,0.85)'; ctx.fillRect(bar.x0, bar.g0, bar.x1 - bar.x0, bar.g1 - bar.g0);
      for (let i = 0; i < 70; i++) { ctx.fillStyle = i % 2 ? '#9a9a8e' : '#b7b5a6'; ctx.beginPath(); ctx.ellipse(bar.x0 + 4 + rand(r) * (bar.x1 - bar.x0 - 8), bar.g0 + 5 + rand(r) * (bar.g1 - bar.g0 - 10), 3 + rand(r) * 4, 2 + rand(r) * 2, 0, 0, TAU); ctx.fill(); }
      label(ctx, 'FORD · slow going', (bar.x0 + bar.x1) / 2, bar.g0 - 12, 11, { italic: true, color: '#2f4a55' });
    }
  }
  if (bar && bar.kind === 'wall') {
    const x = (bar.x0 + bar.x1) / 2;
    for (let y = 4; y < H; y += 9) {
      if (y > bar.g0 - 4 && y < bar.g1 + 2) continue;
      ctx.fillStyle = '#7a5a36'; ctx.strokeStyle = INK; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(x - 5, y + 6); ctx.lineTo(x - 5, y - 8); ctx.lineTo(x, y - 14); ctx.lineTo(x + 5, y - 8); ctx.lineTo(x + 5, y + 6); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    for (const gy of [bar.g0 - 10, bar.g1 + 10]) { ctx.fillStyle = '#c2bba8'; ctx.fillRect(x - 11, gy - 14, 22, 24); ctx.strokeStyle = INK; ctx.strokeRect(x - 11, gy - 14, 22, 24); for (let i = 0; i < 3; i++) ctx.fillRect(x - 11 + i * 8, gy - 19, 5.5, 5); }
    label(ctx, 'GATE', x, (bar.g0 + bar.g1) / 2, 11, { italic: true, color: '#6a5230', spacing: 2 });
  }
  atlasFrame(ctx, W, H);
  vignette(ctx, W, H, '60,40,20', 0.2);
  fieldCache.set(b, c);
  return c;
}

export interface BattleUI { group: TroopType | null; t: number; reduced: boolean }
export const ORDER_LABEL: Record<string, string> = { hold: 'HOLD', advance: 'ADVANCE', attack: 'ATTACK', fallback: 'FALL BACK', move: 'MOVE' };
export function drawBattle(ctx: CanvasRenderingContext2D, v: View, b: Battle, ui: BattleUI) {
  ctx.save(); ctx.translate(v.ox, v.oy); ctx.scale(v.scale, v.scale);
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 18; ctx.fillRect(0, 0, FIELD.w, FIELD.h); ctx.shadowBlur = 0;
  ctx.drawImage(fieldCanvas(b), 0, 0, FIELD.w, FIELD.h);
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, FIELD.w, FIELD.h); ctx.clip();
  const t = ui.reduced ? 0 : ui.t;
  // orders, anchors and range for the player's groups
  for (const ty of TYPES) {
    const g = b.groups[0][ty], c = groupCentroid(b, 0, ty);
    if (!c || b.retreat[0]) continue;
    const sel = ui.group === null || ui.group === ty;
    if (sel && b.phase !== 'over') {
      if (Math.hypot(g.ax - c.x, g.ay - c.y) > 14) {
        dashedPath(ctx, [c, { x: g.ax, y: g.ay }], 'rgba(246,239,220,0.9)', 2.2, [6, 5], -t * 12);
        ctx.fillStyle = IVORY; ctx.strokeStyle = SIDE_COLOR[0]; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(g.ax, g.ay, 5, 0, TAU); ctx.fill(); ctx.stroke();
      }
      if (ty === 'archer') {
        const foe = groupCentroid(b, 1, 'knight') ?? groupCentroid(b, 1, 'barbarian') ?? groupCentroid(b, 1, 'archer');
        const a = foe ? Math.atan2(foe.y - c.y, foe.x - c.x) : 0;
        ctx.strokeStyle = 'rgba(246,239,220,0.75)'; ctx.fillStyle = 'rgba(246,239,220,0.07)'; ctx.lineWidth = 1.4; ctx.setLineDash([3, 6]);
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.arc(c.x, c.y, TROOP.archer.range, a - 0.6, a + 0.6); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
      }
    }
  }
  // bodies of the fallen
  for (const s of b.soldiers) if (s.st === 1) {
    ctx.save(); ctx.globalAlpha = clamp(1 - s.deadT * 0.25, 0.3, 1); ctx.translate(s.x, s.y); ctx.rotate((Math.min(1, s.deadT * 4) * Math.PI) / 2 * s.face);
    drawSoldier(ctx, s.type, s.side, 0, 0, { face: s.face }); ctx.restore();
  }
  const list: { y: number; d: () => void }[] = [];
  for (const o of b.obstacles) list.push({ y: o.y, d: () => (o.kind === 'tree' ? tree(ctx, o.x, o.y + 4, 1.7, (o.x * 7) % 3 < 1) : o.kind === 'house' ? house(ctx, o.x, o.y + 14, 40, 26) : rock(ctx, o.x, o.y + 3, o.r)) });
  for (const s of b.soldiers) if (s.st === 0) list.push({ y: s.y, d: () => {
    const sel = s.side === 0 && (ui.group === null || ui.group === s.type);
    ctx.strokeStyle = s.side === 0 ? (sel ? IVORY : SIDE_LIGHT[0]) : SIDE_LIGHT[1]; ctx.lineWidth = sel ? 1.8 : 1.2; ctx.fillStyle = s.side === 0 ? 'rgba(168,50,58,0.35)' : 'rgba(59,74,99,0.4)';
    ctx.beginPath();
    if (s.side === 0) ctx.ellipse(s.x, s.y, 10, 4.4, 0, 0, TAU); else { ctx.moveTo(s.x - 11.5, s.y); ctx.lineTo(s.x, s.y - 5.2); ctx.lineTo(s.x + 11.5, s.y); ctx.lineTo(s.x, s.y + 5.2); ctx.closePath(); }
    ctx.fill(); ctx.stroke();
    drawSoldier(ctx, s.type, s.side, s.x, s.y, { walk: s.walk, atk: s.atk, face: s.face, moving: s.moving, scale: 1.4 });
    if (s.hit > 0) { ctx.fillStyle = `rgba(255,240,220,${s.hit * 2.4})`; ctx.beginPath(); ctx.arc(s.x, s.y - 13, 9, 0, TAU); ctx.fill(); }
    const max = TROOP[s.type].hp;
    if (s.hp < max) { ctx.fillStyle = 'rgba(30,20,10,0.7)'; ctx.fillRect(s.x - 7, s.y - 42, 14, 3); ctx.fillStyle = s.hp / max > 0.5 ? '#8fb85a' : '#c8523f'; ctx.fillRect(s.x - 6.5, s.y - 41.5, (13 * s.hp) / max, 2); }
  } });
  list.sort((a, c) => a.y - c.y).forEach((l) => l.d());
  for (const a of b.arrows) {
    const u = a.t / a.dur, d = Math.hypot(a.x1 - a.x0, a.y1 - a.y0), arc = d * 0.2;
    const x = a.x0 + (a.x1 - a.x0) * u, y = a.y0 + (a.y1 - a.y0) * u - Math.sin(u * Math.PI) * arc;
    const dx = (a.x1 - a.x0) / d, dy = (a.y1 - a.y0) / d - (Math.cos(u * Math.PI) * Math.PI * arc) / d, l = Math.hypot(dx, dy);
    ctx.strokeStyle = '#3a2b1c'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x - (dx / l) * 9, y - (dy / l) * 9); ctx.lineTo(x, y); ctx.stroke();
    ctx.strokeStyle = IVORY; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x - (dx / l) * 9, y - (dy / l) * 9); ctx.lineTo(x - (dx / l) * 6, y - (dy / l) * 6); ctx.stroke();
  }
  for (const f of b.fx) {
    const k = f.t / 0.7;
    if (f.kind === 'hit') { ctx.strokeStyle = `rgba(255,245,220,${1 - k})`; ctx.lineWidth = 1.6; for (let i = 0; i < 5; i++) { const a = i * 1.26 + f.x; ctx.beginPath(); ctx.moveTo(f.x + Math.cos(a) * 3, f.y + Math.sin(a) * 3); ctx.lineTo(f.x + Math.cos(a) * (5 + k * 9), f.y + Math.sin(a) * (5 + k * 9)); ctx.stroke(); } }
    else { ctx.fillStyle = `rgba(150,125,85,${0.5 * (1 - k)})`; ctx.beginPath(); ctx.arc(f.x, f.y, 2 + k * 6, 0, TAU); ctx.fill(); ctx.strokeStyle = `rgba(58,43,28,${1 - k})`; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x - 3, f.y - 8); ctx.stroke(); }
  }
  // order tags
  if (b.phase === 'fight' && !b.retreat[0]) for (const ty of TYPES) {
    const c = groupCentroid(b, 0, ty); if (!c) continue;
    const txt = ORDER_LABEL[b.groups[0][ty].order], sel = ui.group === null || ui.group === ty;
    ctx.font = '700 10px Georgia, serif'; const w = ctx.measureText(txt).width + 10;
    let top = Infinity; for (const s of b.soldiers) if (s.side === 0 && s.type === ty && s.st === 0) top = Math.min(top, s.y);
    ctx.globalAlpha = sel ? 1 : 0.6; ctx.fillStyle = sel ? IVORY : 'rgba(246,239,220,0.8)'; ctx.strokeStyle = SIDE_COLOR[0]; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(c.x - w / 2, top - 60, w, 14, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#6e1f26'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, c.x, top - 52.5); ctx.globalAlpha = 1;
  }
  ctx.restore();
  ctx.fillStyle = BRASS; void 0;
  ctx.restore();
}
