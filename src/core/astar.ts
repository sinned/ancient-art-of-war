/** Grid A* (8-directional, no corner cutting). cost(i) returns Infinity for blocked cells.
 *  stepCost may add a directional penalty (used for wind at sea). */
export function findPath(
  w: number, h: number, cost: (i: number) => number,
  sx: number, sy: number, tx: number, ty: number,
  stepCost?: (dx: number, dy: number) => number,
): number[] | null {
  const n = w * h, start = sy * w + sx, goal = ty * w + tx;
  if (sx < 0 || sy < 0 || sx >= w || sy >= h || tx < 0 || ty < 0 || tx >= w || ty >= h) return null;
  if (!isFinite(cost(goal))) return null;
  const g = new Float32Array(n).fill(Infinity), from = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap: number[] = [], f = new Float32Array(n);
  const push = (i: number) => {
    heap.push(i);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (f[heap[p]] <= f[heap[c]]) break;
      [heap[p], heap[c]] = [heap[c], heap[p]]; c = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let p = 0;
      for (;;) {
        let m = p; const l = p * 2 + 1, r = l + 1;
        if (l < heap.length && f[heap[l]] < f[heap[m]]) m = l;
        if (r < heap.length && f[heap[r]] < f[heap[m]]) m = r;
        if (m === p) break;
        [heap[p], heap[m]] = [heap[m], heap[p]]; p = m;
      }
    }
    return top;
  };
  const hfn = (i: number) => {
    const dx = Math.abs((i % w) - tx), dy = Math.abs(((i / w) | 0) - ty);
    return (Math.max(dx, dy) + 0.414 * Math.min(dx, dy)) * 0.5;
  };
  g[start] = 0; f[start] = hfn(start); push(start);
  while (heap.length) {
    const cur = pop();
    if (cur === goal) {
      const path: number[] = [];
      for (let c = cur; c !== -1; c = from[c]) path.push(c);
      return path.reverse();
    }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % w, cy = (cur / w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (closed[ni]) continue;
      const c = cost(ni);
      if (!isFinite(c)) continue;
      if (dx && dy && (!isFinite(cost(cy * w + nx)) || !isFinite(cost(ny * w + cx)))) continue;
      const ng = g[cur] + (dx && dy ? 1.414 : 1) * (c + cost(cur)) * 0.5 * (stepCost ? stepCost(dx, dy) : 1);
      if (ng < g[ni]) { g[ni] = ng; from[ni] = cur; f[ni] = ng + hfn(ni); push(ni); }
    }
  }
  return null;
}
