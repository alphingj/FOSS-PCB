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
