import type { FossPcb } from './foss-schema';
import { segSegDist, ptSegDist, type Pt } from './routing';
import { bodySizeForFootprint } from './models-3d';

export interface DrcIssue {
  severity: 'error' | 'warning';
  message: string;
}

const DEFAULT_CLEARANCE_MM = 0.2;
const MAX_TRACE_VIOLATIONS = 10;

type Seg = { a: Pt; b: Pt };

function traceSegs(pcb: FossPcb): { net: string; id: string; segs: Seg[] }[] {
  return (pcb.pcb_traces ?? []).map((t) => ({
    net: t.net,
    id: t.pts_mm.length ? t.pts_mm[0].join(',') : t.id,
    segs: t.pts_mm.slice(0, -1).map(([x1, y1], i) => {
      const [x2, y2] = t.pts_mm[i + 1];
      return { a: { x: x1, y: y1 }, b: { x: x2, y: y2 } };
    }),
  }));
}

/** Trace geometry: bounds, widths, and different-net clearance. */
function traceIssues(pcb: FossPcb): DrcIssue[] {
  const issues: DrcIssue[] = [];
  const { board_width_mm: W, board_height_mm: H } = pcb.project_metadata.pcb_specifications;
  const clearanceOf = new Map(pcb.nets.map((n) => [n.net_name, n.clearance_mm ?? DEFAULT_CLEARANCE_MM]));
  const traces = pcb.pcb_traces ?? [];

  for (const t of traces) {
    if (t.pts_mm.length < 2) {
      issues.push({ severity: 'error', message: `Trace ${t.id} (${t.net}) has fewer than 2 points` });
      continue;
    }
    if (!(t.width_mm > 0)) issues.push({ severity: 'error', message: `Trace ${t.id} (${t.net}) has non-positive width` });
    for (const [x, y] of t.pts_mm) {
      if (x < 0 || y < 0 || x > W || y > H) {
        issues.push({ severity: 'error', message: `Trace ${t.id} (${t.net}) leaves the board at (${x},${y})` });
        break;
      }
    }
  }

  const segs = traceSegs(pcb);
  let violations = 0;
  for (let i = 0; i < segs.length && violations < MAX_TRACE_VIOLATIONS; i++) {
    for (let j = i + 1; j < segs.length && violations < MAX_TRACE_VIOLATIONS; j++) {
      if (segs[i].net === segs[j].net) continue;
      const need = Math.max(clearanceOf.get(segs[i].net) ?? DEFAULT_CLEARANCE_MM, clearanceOf.get(segs[j].net) ?? DEFAULT_CLEARANCE_MM);
      let best = Infinity;
      for (const s1 of segs[i].segs) {
        for (const s2 of segs[j].segs) {
          const d = segSegDist(s1.a, s1.b, s2.a, s2.b);
          if (d < best) best = d;
          if (best < need) break;
        }
        if (best < need) break;
      }
      if (best < need) {
        violations += 1;
        issues.push({ severity: 'error', message: `${segs[i].net} ↔ ${segs[j].net} clearance ${best.toFixed(2)}mm < ${need.toFixed(2)}mm` });
      }
    }
  }

  // Trace-to-part: segments too close to a component body that carries NO pin
  // on the trace's net (same-net copper touching is electrically fine).
  // Body rects ignore odd-angle rotation (90° swaps w/d) — documented approx.
  for (const t of traces) {
    if (t.net === 'GND') continue; // plane pours intentionally touch everything
    const need = clearanceOf.get(t.net) ?? DEFAULT_CLEARANCE_MM;
    for (const c of pcb.components) {
      if (Object.values(c.pins).includes(t.net)) continue;
      const [bw, bd] = bodySizeForFootprint(c.footprint);
      const rot = ((c.pcb_placement_mm.rotation % 180) + 180) % 180;
      const [w, d] = Math.abs(rot - 90) < 1 ? [bd, bw] : [bw, bd];
      const cx = c.pcb_placement_mm.x, cy = c.pcb_placement_mm.y;
      const rect = { x1: cx - w / 2, y1: cy - d / 2, x2: cx + w / 2, y2: cy + d / 2 };
      const pts = t.pts_mm;
      for (let i = 0; i + 1 < pts.length && violations < MAX_TRACE_VIOLATIONS; i++) {
        const a = { x: pts[i][0], y: pts[i][1] };
        const b = { x: pts[i + 1][0], y: pts[i + 1][1] };
        if (segRectDist(a, b, rect) < need) {
          violations += 1;
          issues.push({ severity: 'error', message: `Trace ${t.id} (${t.net}) too close to ${c.designator} (< ${need.toFixed(2)}mm)` });
          break;
        }
      }
    }
  }
  return issues;
}

/** Minimum distance segment ab to axis-aligned rect (0 when crossing/inside). */
export function segRectDist(a: Pt, b: Pt, r: { x1: number; y1: number; x2: number; y2: number }): number {
  const inside = (p: Pt) => p.x >= r.x1 && p.x <= r.x2 && p.y >= r.y1 && p.y <= r.y2;
  if (inside(a) || inside(b)) return 0;
  const corners: Pt[] = [
    { x: r.x1, y: r.y1 }, { x: r.x2, y: r.y1 }, { x: r.x2, y: r.y2 }, { x: r.x1, y: r.y2 },
  ];
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const c = corners[i], d = corners[(i + 1) % 4];
    const dist = segSegDist(a, b, c, d);
    if (dist < best) best = dist;
  }
  return best;
}

/** Pure code checks — never trust the LLM for these. */
export function runDrc(pcb: FossPcb): DrcIssue[] {
  const issues: DrcIssue[] = [];
  const { board_width_mm: W, board_height_mm: H } = pcb.project_metadata.pcb_specifications;

  for (const c of pcb.components) {
    const { x, y } = c.pcb_placement_mm;
    if (x < 0 || y < 0 || x > W || y > H)
      issues.push({ severity: 'error', message: `${c.designator} out of board bounds (${x},${y})` });
  }

  const nets = new Map(pcb.nets.map((n) => [n.net_name, n]));
  if (!nets.has('GND')) issues.push({ severity: 'error', message: 'Missing GND net' });

  const byDes = new Map(pcb.components.map((c) => [c.designator, c]));
  const seen = new Set<string>();
  for (const c of pcb.components) {
    if (seen.has(c.designator))
      issues.push({ severity: 'error', message: `Duplicate designator ${c.designator}` });
    seen.add(c.designator);
  }
  const netNames = new Set(pcb.nets.map((n) => n.net_name));
  for (const n of pcb.nets) {
    for (const node of n.nodes) {
      if (!node.includes('.')) {
        // Bare net label (e.g. "GND"): valid only if it names a known net.
        if (!netNames.has(node))
          issues.push({ severity: 'error', message: `Net ${n.net_name}: bare reference "${node}" matches no net` });
        continue;
      }
      const [des] = node.split('.');
      if (!byDes.has(des))
        issues.push({ severity: 'error', message: `Net ${n.net_name}: unknown ${node}` });
    }
  }

  // Buck-boost heuristic only applies to buck/boost topologies.
  const topo = (pcb.project_metadata.topology ?? '').toLowerCase();
  const c1 = byDes.get('C1');
  const q1 = byDes.get('Q1');
  if ((topo.includes('buck') || topo.includes('boost')) && c1 && q1) {
    const dx = c1.pcb_placement_mm.x - q1.pcb_placement_mm.x;
    const dy = c1.pcb_placement_mm.y - q1.pcb_placement_mm.y;
    if (Math.hypot(dx, dy) > 8)
      issues.push({ severity: 'warning', message: 'C1 far from Q1 — input loop inductance risk' });
  }

  // SW polygon area check
  for (const z of pcb.pcb_layout_zones) {
    if (z.net === 'SW') {
      const area =
        Math.abs(z.bounding_box_mm.x2 - z.bounding_box_mm.x1) *
        Math.abs(z.bounding_box_mm.y2 - z.bounding_box_mm.y1);
      if (area > 300)
        issues.push({ severity: 'warning', message: `SW polygon large (${area.toFixed(0)}mm²) — EMI risk` });
    }
  }

  // Zone geometry: bounds and clearance to different-net copper.
  const zones = pcb.pcb_layout_zones ?? [];
  const clearanceOf = new Map(pcb.nets.map((n) => [n.net_name, n.clearance_mm ?? DEFAULT_CLEARANCE_MM]));
  const allTraceSegs = traceSegs(pcb);
  for (const z of zones) {
    const { x1, y1, x2, y2 } = z.bounding_box_mm;
    const need = clearanceOf.get(z.net) ?? DEFAULT_CLEARANCE_MM;
    // Zone must be within board bounds.
    if (x1 < 0 || y1 < 0 || x2 > W || y2 > H)
      issues.push({ severity: 'error', message: `Zone "${z.net}" leaves board bounds (${x1},${y1})-(${x2},${y2})` });
    // Zone clearance vs different-net traces: traces must not enter the zone
    // bounding box shrunk by the clearance margin.
    const padNeed = need; // pad-to-pour clearance (thermal reliefs handle pads)
    for (const s of allTraceSegs) {
      if (s.net === z.net) continue; // same-net copper connects freely
      const sNeed = Math.max(need, clearanceOf.get(s.net) ?? DEFAULT_CLEARANCE_MM);
      for (const seg of s.segs) {
        if (segRectDist(seg.a, seg.b, {
          x1: x1 - sNeed, y1: y1 - sNeed, x2: x2 + sNeed, y2: y2 + sNeed
        }) < sNeed) {
          issues.push({ severity: 'error', message: `Zone "${z.net}" too close to trace "${s.net}" (< ${sNeed.toFixed(2)}mm)` });
          break;
        }
      }
    }
    // Zone vs zone: different-net zones on the same layer must not overlap.
    const zLayer = z.layer.toLowerCase().startsWith('bottom') ? 'Bottom' : 'Top';
    for (const z2 of zones) {
      if (z2 === z || z2.net === z.net) continue;
      const z2Layer = z2.layer.toLowerCase().startsWith('bottom') ? 'Bottom' : 'Top';
      if (zLayer !== z2Layer) continue; // different copper layers can overlap
      const overlap = !(x2 < z2.bounding_box_mm.x1 || x1 > z2.bounding_box_mm.x2 ||
                        y2 < z2.bounding_box_mm.y1 || y1 > z2.bounding_box_mm.y2);
      if (overlap)
        issues.push({ severity: 'error', message: `Zone "${z.net}" overlaps zone "${z2.net}"` });
    }
  }

  issues.push(...traceIssues(pcb));

  // Via geometry: bounds, and clearance to different-net traces/pads.
  for (const v of pcb.pcb_vias ?? []) {
    const need = clearanceOf.get(v.net) ?? DEFAULT_CLEARANCE_MM;
    const vr = (v.pad_mm || 0.6) / 2;
    if (v.x < 0 || v.y < 0 || v.x > W || v.y > H)
      issues.push({ severity: 'error', message: `Via "${v.id}" (${v.net}) leaves board bounds (${v.x},${v.y})` });
    // Via vs different-net traces: trace must not pass within pad radius + clearance.
    for (const s of allTraceSegs) {
      if (s.net === v.net) continue;
      const sNeed = Math.max(need, clearanceOf.get(s.net) ?? DEFAULT_CLEARANCE_MM);
      for (const seg of s.segs) {
        if (ptSegDist({ x: v.x, y: v.y }, seg.a, seg.b) < vr + sNeed) {
          issues.push({ severity: 'error', message: `Via "${v.id}" (${v.net}) too close to trace "${s.net}" (< ${(vr + sNeed).toFixed(2)}mm)` });
          break;
        }
      }
    }
    // Via vs different-net pads: pad centers of foreign nets must clear the via pad.
    for (const c of pcb.components) {
      if (Object.values(c.pins).includes(v.net)) continue;
      const cx = c.pcb_placement_mm.x, cy = c.pcb_placement_mm.y;
      if (Math.hypot(cx - v.x, cy - v.y) < vr + (clearanceOf.get(v.net) ?? DEFAULT_CLEARANCE_MM)) {
        issues.push({ severity: 'error', message: `Via "${v.id}" (${v.net}) too close to ${c.designator} (< ${(vr + need).toFixed(2)}mm)` });
      }
    }
  }
  return issues;
}
