import type { FossPcb } from './foss-schema';
import { segSegDist, ptSegDist, type Pt } from './routing';
import { bodySizeForFootprint } from './models-3d';
import { pinoutFor, rot2, soic8Pads, SOT23_PADS, twoPinGeom } from './kicad-pads';

export interface DrcIssue {
  severity: 'error' | 'warning';
  message: string;
}

const DEFAULT_CLEARANCE_MM = 0.2;
const MAX_TRACE_VIOLATIONS = 10;

type Seg = { a: Pt; b: Pt };

type PadAt = { n: number; x: number; y: number; net: string; w: number; h: number };

/** Pad centres in board coordinates for footprints whose land pattern is
 *  sourced (SOIC-8, SOT-23, symmetric 2-pin). Returns null when the footprint
 *  has no modelled geometry, so callers fall back to a body-centre check. */
function padCentres(c: FossPcb['components'][number]): PadAt[] | null {
  const local: { n: number; dx: number; dy: number; w: number; h: number }[] = [];
  if (c.footprint.includes('SOIC-8')) {
    for (const pad of soic8Pads()) local.push({ ...pad });
  } else if (c.footprint.includes('SOT-23')) {
    for (const pad of SOT23_PADS) local.push({ ...pad });
  } else {
    const g2 = twoPinGeom(c.footprint);
    if (!g2) return null;
    local.push({ n: 1, dx: -g2.dx, dy: 0, w: g2.w, h: g2.h }, { n: 2, dx: g2.dx, dy: 0, w: g2.w, h: g2.h });
  }

  const labels = Object.keys(c.pins);
  const pinout = pinoutFor(c.mpn);
  // Symmetric 2-pin: pad 1 ← '1' (or 'A'), pad 2 ← the other label.
  let twoPinNet: ((n: number) => string) | null = null;
  if (!pinout && local.length === 2) {
    const l1 = labels.includes('1') ? '1' : labels.includes('A') ? 'A' : labels[0];
    const l2 = labels.find((l) => l !== l1);
    twoPinNet = (n) => {
      const label = n === 1 ? l1 : l2;
      return label && c.pins[label] ? c.pins[label] : '';
    };
  }
  const netOf = (n: number): string => {
    if (pinout) {
      const label = Object.keys(pinout).find((l) => pinout[l] === n && l in c.pins);
      return label ? c.pins[label] : '';
    }
    return twoPinNet ? twoPinNet(n) : '';
  };

  const { x, y, rotation } = c.pcb_placement_mm;
  return local.map((l) => {
    const [rx, ry] = rot2(l.dx, l.dy, rotation);
    return { n: l.n, x: x + rx, y: y + ry, net: netOf(l.n), w: l.w, h: l.h };
  });
}

function traceSegs(pcb: FossPcb): { net: string; id: string; layer: 'Top' | 'Bottom'; width: number; segs: Seg[] }[] {
  const isBottom = (l: string | undefined) => (l ?? 'Top').toLowerCase().startsWith('bottom');
  return (pcb.pcb_traces ?? []).map((t) => ({
    net: t.net,
    id: t.pts_mm.length ? t.pts_mm[0].join(',') : t.id,
    layer: isBottom(t.layer) ? 'Bottom' : 'Top',
    width: t.width_mm ?? 0.25,
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
      // Copper on opposite sides cannot short; vias/pads are checked separately.
      if (segs[i].layer !== segs[j].layer) continue;
      const need = Math.max(clearanceOf.get(segs[i].net) ?? DEFAULT_CLEARANCE_MM, clearanceOf.get(segs[j].net) ?? DEFAULT_CLEARANCE_MM);
      const halfWidths = (segs[i].width + segs[j].width) / 2;
      let best = Infinity;
      for (const s1 of segs[i].segs) {
        for (const s2 of segs[j].segs) {
          const d = segSegDist(s1.a, s1.b, s2.a, s2.b);
          if (d < best) best = d;
          if (best - halfWidths < need) break;
        }
        if (best - halfWidths < need) break;
      }
      // Distances are centreline-to-centreline; report the copper gap.
      if (best - halfWidths < need) {
        violations += 1;
        const gap = Math.max(0, best - halfWidths);
        issues.push({ severity: 'error', message: `${segs[i].net} ↔ ${segs[j].net} clearance ${gap.toFixed(2)}mm < ${need.toFixed(2)}mm` });
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
        if (segRectDist(a, b, rect) - (t.width_mm ?? 0.25) / 2 < need) {
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

/** Distance point → axis-aligned rect (0 when inside). */
export function ptRectDist(p: Pt, r: { x1: number; y1: number; x2: number; y2: number }): number {
  const dx = Math.max(r.x1 - p.x, 0, p.x - r.x2);
  const dy = Math.max(r.y1 - p.y, 0, p.y - r.y2);
  return Math.hypot(dx, dy);
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
  const isBottomLayer = (l: string | undefined) => (l ?? 'Top').toLowerCase().startsWith('bottom');
  for (const z of zones) {
    const { x1, y1, x2, y2 } = z.bounding_box_mm;
    const need = clearanceOf.get(z.net) ?? DEFAULT_CLEARANCE_MM;
    const zBottom = isBottomLayer(z.layer);
    // Zone must be within board bounds.
    if (x1 < 0 || y1 < 0 || x2 > W || y2 > H)
      issues.push({ severity: 'error', message: `Zone "${z.net}" leaves board bounds (${x1},${y1})-(${x2},${y2})` });
    // Zone clearance vs different-net traces ON THE SAME COPPER LAYER.
    // Compare edge-to-edge: trace centreline distance minus half its width
    // must still be at least the pour clearance.
    for (const s of allTraceSegs) {
      if (s.net === z.net) continue; // same-net copper connects freely
      if ((s.layer === 'Bottom') !== zBottom) continue; // other side cannot short
      const sNeed = Math.max(need, clearanceOf.get(s.net) ?? DEFAULT_CLEARANCE_MM);
      for (const seg of s.segs) {
        if (segRectDist(seg.a, seg.b, { x1, y1, x2, y2 }) - s.width / 2 < sNeed) {
          issues.push({ severity: 'error', message: `Zone "${z.net}" too close to trace "${s.net}" (< ${sNeed.toFixed(2)}mm)` });
          break;
        }
      }
    }
    // Foreign pads under the pour rectangle: a real fill would short them.
    // Pads are treated as their circumscribed circle (conservative at corners).
    for (const c of pcb.components) {
      const cBottom = isBottomLayer(c.pcb_placement_mm.layer);
      if (cBottom !== zBottom) continue;
      const pads = padCentres(c);
      if (!pads) continue;
      for (const p of pads) {
        if (!p.net || p.net === z.net) continue;
        const pNeed = Math.max(need, clearanceOf.get(p.net) ?? DEFAULT_CLEARANCE_MM);
        if (ptRectDist({ x: p.x, y: p.y }, { x1, y1, x2, y2 }) - Math.hypot(p.w, p.h) / 2 < pNeed)
          issues.push({ severity: 'error', message: `Zone "${z.net}" too close to pad ${c.designator}.${p.n} (${p.net})` });
      }
    }
    // Vias span every copper layer, so a foreign pour must clear them.
    for (const v of pcb.pcb_vias ?? []) {
      if (v.net === z.net) continue;
      const vNeed = Math.max(need, clearanceOf.get(v.net) ?? DEFAULT_CLEARANCE_MM);
      if (ptRectDist({ x: v.x, y: v.y }, { x1, y1, x2, y2 }) - (v.pad_mm ?? 0.6) / 2 < vNeed)
        issues.push({ severity: 'error', message: `Zone "${z.net}" too close to via "${v.id}" (${v.net})` });
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
        if (ptSegDist({ x: v.x, y: v.y }, seg.a, seg.b) - s.width / 2 < vr + sNeed) {
          issues.push({ severity: 'error', message: `Via "${v.id}" (${v.net}) too close to trace "${s.net}" (< ${(vr + sNeed).toFixed(2)}mm)` });
          break;
        }
      }
    }
    // Via vs different-net pads. Sourced footprints use real pad centres;
    // others fall back to a conservative component-body centre check.
    for (const c of pcb.components) {
      const pads = padCentres(c);
      if (pads) {
        for (const pad of pads) {
          if (!pad.net || pad.net === v.net) continue;
          const padNeed = Math.max(need, clearanceOf.get(pad.net) ?? DEFAULT_CLEARANCE_MM);
          if (Math.hypot(pad.x - v.x, pad.y - v.y) < vr + padNeed)
            issues.push({ severity: 'error', message: `Via "${v.id}" (${v.net}) too close to ${c.designator} pad ${pad.n} (${pad.net}) (< ${(vr + padNeed).toFixed(2)}mm)` });
        }
      } else if (!Object.values(c.pins).includes(v.net)) {
        const cx = c.pcb_placement_mm.x, cy = c.pcb_placement_mm.y;
        if (Math.hypot(cx - v.x, cy - v.y) < vr + need)
          issues.push({ severity: 'error', message: `Via "${v.id}" (${v.net}) too close to ${c.designator} (< ${(vr + need).toFixed(2)}mm)` });
      }
    }
  }

  // Stackup consistency: the layer stack should describe the routing layer count.
  const spec = pcb.project_metadata.pcb_specifications;
  const stackLayers = spec.stackup?.layers ?? [];
  if (stackLayers.length && stackLayers.length !== spec.layers)
    issues.push({
      severity: 'warning',
      message: `Stackup has ${stackLayers.length} layers but board spec says ${spec.layers} — keep them consistent`,
    });
  if (spec.stackup && spec.stackup.total_thickness_mm <= 0)
    issues.push({ severity: 'error', message: 'Stackup total thickness must be positive' });

  return issues;
}
