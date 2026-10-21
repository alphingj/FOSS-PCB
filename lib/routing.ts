// Octilinear A* router (TS mirror of the BFS in src-tauri router.rs, upgraded to
// 8-connected grid: orthogonal steps cost 1, diagonal steps cost √2, octile
// heuristic). Produces native 45° paths. `blocked` are coarse point obstacles
// (component centers) — a first pass, not clearance-aware routing.
export interface Pt { x: number; y: number }

const SQRT2 = Math.SQRT2;

export function bfsRoute(
  boardW: number, boardH: number,
  from: Pt, to: Pt,
  blocked: Pt[] = [],
  step = 1.0,
): Pt[] {
  const key = (x: number, y: number) => `${x.toFixed(1)},${y.toFixed(1)}`;
  const q = (v: number) => Math.round(v / step) * step;
  const sx = q(from.x), sy = q(from.y);
  const tx = q(to.x), ty = q(to.y);
  if (sx === tx && sy === ty) return [{ x: sx, y: sy }];
  const blockedSet = new Set(blocked.map((p) => key(q(p.x), q(p.y))));
  blockedSet.delete(key(tx, ty)); // never block the target itself
  const octile = (x: number, y: number) => {
    const dx = Math.abs(x - tx) / step, dy = Math.abs(y - ty) / step;
    return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
  };
  const gScore = new Map<string, number>([[key(sx, sy), 0]]);
  const came = new Map<string, string>();
  const open = new Map<string, { x: number; y: number; f: number }>([[key(sx, sy), { x: sx, y: sy, f: octile(sx, sy) }]]);
  const closed = new Set<string>();
  const DIRS: [number, number, number][] = [
    [step, 0, 1], [-step, 0, 1], [0, step, 1], [0, -step, 1],
    [step, step, SQRT2], [step, -step, SQRT2], [-step, step, SQRT2], [-step, -step, SQRT2],
  ];
  let found = false;
  let guard = Math.ceil((boardW / step + 1) * (boardH / step + 1)) + 10;
  while (open.size && guard-- > 0) {
    let ck = '';
    let best = Infinity;
    for (const [k, v] of open) {
      if (v.f < best) { best = v.f; ck = k; }
    }
    const cur = open.get(ck)!;
    open.delete(ck);
    if (closed.has(ck)) continue;
    closed.add(ck);
    if (Math.abs(cur.x - tx) < 1e-6 && Math.abs(cur.y - ty) < 1e-6) {
      found = true;
      break;
    }
    for (const [dx, dy, cost] of DIRS) {
      const nx = +(cur.x + dx).toFixed(2), ny = +(cur.y + dy).toFixed(2);
      if (nx < 0 || ny < 0 || nx > boardW || ny > boardH) continue;
      const k = key(nx, ny);
      if (closed.has(k) || blockedSet.has(k)) continue;
      const g = gScore.get(ck)! + cost;
      if (g < (gScore.get(k) ?? Infinity)) {
        gScore.set(k, g);
        came.set(k, ck);
        if (!open.has(k)) open.set(k, { x: nx, y: ny, f: 0 });
        open.get(k)!.f = g + octile(nx, ny);
      }
    }
  }
  if (!found) return [from, to]; // fallback straight
  const path: Pt[] = [];
  let ck: string | undefined = key(tx, ty);
  while (ck) {
    const [xs, ys] = ck.split(',').map(Number);
    path.unshift({ x: xs, y: ys });
    ck = came.get(ck);
  }
  return path.length ? path : [from, to];
}

/** A* that returns null when no path exists (unlike bfsRoute's straight
 *  fallback). Used by the rip-up-and-refit autorouter to detect blockers. */
export function tryRoute(
  boardW: number, boardH: number,
  from: Pt, to: Pt,
  blocked: Pt[] = [],
  step = 1.0,
): Pt[] | null {
  const key = (x: number, y: number) => `${x.toFixed(1)},${y.toFixed(1)}`;
  const q = (v: number) => Math.round(v / step) * step;
  const sx = q(from.x), sy = q(from.y);
  const tx = q(to.x), ty = q(to.y);
  if (sx === tx && sy === ty) return [{ x: sx, y: sy }];
  const blockedSet = new Set(blocked.map((p) => key(q(p.x), q(p.y))));
  blockedSet.delete(key(tx, ty));
  const octile = (x: number, y: number) => {
    const dx = Math.abs(x - tx) / step, dy = Math.abs(y - ty) / step;
    return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
  };
  const gScore = new Map<string, number>([[key(sx, sy), 0]]);
  const came = new Map<string, string>();
  const open = new Map<string, { x: number; y: number; f: number }>([[key(sx, sy), { x: sx, y: sy, f: octile(sx, sy) }]]);
  const closed = new Set<string>();
  const DIRS: [number, number, number][] = [
    [step, 0, 1], [-step, 0, 1], [0, step, 1], [0, -step, 1],
    [step, step, SQRT2], [step, -step, SQRT2], [-step, step, SQRT2], [-step, -step, SQRT2],
  ];
  let guard = Math.ceil((boardW / step + 1) * (boardH / step + 1)) + 10;
  while (open.size && guard-- > 0) {
    let ck = '', best = Infinity;
    for (const [k, v] of open) if (v.f < best) { best = v.f; ck = k; }
    const cur = open.get(ck)!;
    open.delete(ck);
    if (closed.has(ck)) continue;
    closed.add(ck);
    if (Math.abs(cur.x - tx) < 1e-6 && Math.abs(cur.y - ty) < 1e-6) {
      const path: Pt[] = [];
      let k: string | undefined = ck;
      while (k) { const [xs, ys] = k.split(',').map(Number); path.unshift({ x: xs, y: ys }); k = came.get(k); }
      return path;
    }
    for (const [dx, dy, cost] of DIRS) {
      const nx = +(cur.x + dx).toFixed(2), ny = +(cur.y + dy).toFixed(2);
      if (nx < 0 || ny < 0 || nx > boardW || ny > boardH) continue;
      const k = key(nx, ny);
      if (closed.has(k) || blockedSet.has(k)) continue;
      const g = gScore.get(ck)! + cost;
      if (g < (gScore.get(k) ?? Infinity)) {
        gScore.set(k, g); came.set(k, ck);
        if (!open.has(k)) open.set(k, { x: nx, y: ny, f: 0 });
        open.get(k)!.f = g + octile(nx, ny);
      }
    }
  }
  return null; // no path
}

/** Copper pour rectangle (zone) the router must keep other nets out of. */
export interface ZoneRect {
  net: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Pour-to-trace clearance for this net, in mm. */
  clearance_mm?: number;
}

/** Grid cells covering a zone plus its clearance and the routing trace's half
 *  width. Non-same-net routes are kept out; same-net copper may enter (the pour
 *  itself). The half width matters: a 1.5mm power trace needs its copper edge,
 *  not its centreline, clear of the pour. */
export function rasterZone(z: ZoneRect, step = 1, halfTrace = 0.25): Pt[] {
  const margin = (z.clearance_mm ?? 0.2) + halfTrace + 0.01;
  const out: Pt[] = [];
  const x0 = Math.floor((z.x1 - margin) / step) * step;
  const y0 = Math.floor((z.y1 - margin) / step) * step;
  for (let x = x0; x <= z.x2 + margin; x += step)
    for (let y = y0; y <= z.y2 + margin; y += step)
      out.push({ x: +x.toFixed(2), y: +y.toFixed(2) });
  return out;
}

/** Convert existing traces into obstacle points for the router. Vertices and
 *  intermediate 1mm cells are blocked so a new route cannot cross a segment
 *  between its endpoints. */
export function traceObstacles(traces: { pts_mm: [number, number][] }[], step = 1): Pt[] {
  const out: Pt[] = [];
  for (const t of traces) {
    for (let i = 0; i + 1 < t.pts_mm.length; i++) {
      const [x1, y1] = t.pts_mm[i];
      const [x2, y2] = t.pts_mm[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / step));
      for (let k = 0; k <= n; k++)
        out.push({ x: +(x1 + ((x2 - x1) * k) / n).toFixed(2), y: +(y1 + ((y2 - y1) * k) / n).toFixed(2) });
    }
  }
  return out;
}


export interface RipupResult {
  traces: { id: string; net: string; pts_mm: [number, number][]; width_mm: number }[];
  routed: number;
  ripped: number;
}

/** Rip-up-and-refit autorouter: route each net around existing traces; when a
 *  net is blocked, remove the traces that sit on the straight line, retry, then
 *  re-route the removed ones in a second pass. This gives push-and-shove
 *  behaviour without a full rip-up-and-refit engine: later nets can displace
 *  earlier ones, and every net still gets connected. */
export function ripupAutoroute(
  boardW: number, boardH: number,
  nets: { net_name: string; trace_width_mm: number }[],
  owners: Map<string, [Pt, Pt]>,   // net -> [from, to]
  staticBlocked: Pt[],
  zones: ZoneRect[] = [],
): RipupResult {
  const traces: RipupResult['traces'] = [];
  const ripped: RipupResult['traces'] = [];
  const zoneCells = new Map<string, Pt[]>();
  /** Zone obstacles for one net, widened by that net's trace half width. */
  const cellsFor = (net: string, width: number): Pt[] => {
    const key = `${net}:${width}`;
    let c = zoneCells.get(key);
    if (!c) {
      c = zones.filter((z) => z.net !== net).flatMap((z) => rasterZone(z, 1, width / 2));
      zoneCells.set(key, c);
    }
    return c;
  };
  /** Per-net obstacles: shared blockers, other nets' pours, placed traces. */
  const obstaclesFor = (net: string, width: number): Pt[] => [
    ...staticBlocked,
    ...cellsFor(net, width),
    ...traceObstacles(traces),
  ];
  let seq = 0;
  const add = (net: string, pts: Pt[], width: number) => {
    const clean = simplify(pts).map((p) => [p.x, p.y] as [number, number]);
    if (clean.length < 2) return;
    traces.push({ id: `rip-${net}-${seq++}`, net, pts_mm: clean, width_mm: width });
  };
  for (const n of nets) {
    const ends = owners.get(n.net_name);
    if (!ends) continue;
    const [from, to] = ends;
    let path = tryRoute(boardW, boardH, from, to, obstaclesFor(n.net_name, n.trace_width_mm));
    if (path) { add(n.net_name, path, n.trace_width_mm); continue; }
    // Blocked: rip up the traces that sit on the straight line, then retry.
    const keep: typeof traces = [];
    for (const t of traces) {
      if (segIntersects(t.pts_mm, from, to)) ripped.push(t);
      else keep.push(t);
    }
    traces.length = 0;
    traces.push(...keep);
    path = tryRoute(boardW, boardH, from, to, obstaclesFor(n.net_name, n.trace_width_mm));
    if (path) add(n.net_name, path, n.trace_width_mm);
  }
  // Re-route the ripped traces around everything now placed.
  for (const r of ripped) {
    const ends = owners.get(r.net);
    if (!ends) continue;
    const [from, to] = ends;
    const path = tryRoute(boardW, boardH, from, to, obstaclesFor(r.net, r.width_mm));
    if (path) add(r.net, path, r.width_mm);
  }
  return { traces, routed: traces.length, ripped: ripped.length };
}

/** Does any segment of a polyline come within ~step of the straight from→to? */
function segIntersects(pts: [number, number][], from: Pt, to: Pt): boolean {
  for (let i = 0; i + 1 < pts.length; i++) {
    if (segSegDist(from, to, { x: pts[i][0], y: pts[i][1] }, { x: pts[i + 1][0], y: pts[i + 1][1] }) < 0.5) return true;
  }
  return false;
}

/** Drop intermediate points that continue the same one of 8 directions. */
export function simplify(path: Pt[]): Pt[] {
  if (path.length < 3) return path;
  const dir = (a: Pt, b: Pt): string => `${Math.sign(b.x - a.x)},${Math.sign(b.y - a.y)}`;
  const out: Pt[] = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    if (dir(out[out.length - 1], path[i]) !== dir(path[i], path[i + 1])) out.push(path[i]);
  }
  out.push(path[path.length - 1]);
  return out;
}

/** Distance point → segment. */
export function ptSegDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.min(Math.max(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0), 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function orient(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** Minimum distance between segments ab and cd (0 when they touch/cross). */
export function segSegDist(a: Pt, b: Pt, c: Pt, d: Pt): number {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  if (o1 * o2 < 0 && o3 * o4 < 0) return 0;
  return Math.min(ptSegDist(a, c, d), ptSegDist(b, c, d), ptSegDist(c, a, b), ptSegDist(d, a, b));
}
