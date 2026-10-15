import type { FossPcb } from './foss-schema';
import { segSegDist, type Pt } from './routing';

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
  return issues;
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

  issues.push(...traceIssues(pcb));
  return issues;
}
