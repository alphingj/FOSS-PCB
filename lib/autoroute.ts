// Board-level autoroute: connects each non-GND net between its first two
// components on the top layer, keeping other nets out of top-layer pours.
// Extracted so the canvas and the checks exercise exactly the same code.
import type { FossPcb } from './foss-schema';
import { ripupAutoroute, type Pt, type ZoneRect } from './routing';

export function autorouteBoard(pcb: FossPcb): FossPcb {
  const { board_width_mm: W, board_height_mm: H } = pcb.project_metadata.pcb_specifications;
  const byDes = new Map(pcb.components.map((c) => [c.designator, c]));
  const clearanceOf = new Map(pcb.nets.map((n) => [n.net_name ?? '', n.clearance_mm ?? 0.2]));

  // Coarse part centres plus vias are hard obstacles for every net.
  const staticBlocked: Pt[] = [
    ...pcb.components.map((c) => ({ x: c.pcb_placement_mm.x, y: c.pcb_placement_mm.y })),
    ...(pcb.pcb_vias ?? []).map((v) => ({ x: v.x ?? 0, y: v.y ?? 0 })),
  ];

  // Owners: the first two components on each net, landed 2mm inside the part.
  const owners = new Map<string, [Pt, Pt]>();
  for (const n of pcb.nets) {
    const name = n.net_name ?? '';
    if (!name || name === 'GND') continue;
    const own = Array.from(new Set((n.nodes ?? []).map((nd) => nd.split('.')[0]).filter((d) => byDes.has(d))));
    if (own.length < 2) continue;
    const a = byDes.get(own[0])!.pcb_placement_mm;
    const b = byDes.get(own[1])!.pcb_placement_mm;
    owners.set(name, [
      { x: Math.min(a.x + 2, W), y: a.y },
      { x: Math.max(b.x - 2, 0), y: b.y },
    ]);
  }

  // Only top-layer pours constrain top-layer routing; pours of the same net
  // are its own copper and are never obstacles.
  const zones: ZoneRect[] = (pcb.pcb_layout_zones ?? [])
    .filter((z) => !(z.layer ?? 'Top').toLowerCase().startsWith('bottom'))
    .map((z) => {
      const b = z.bounding_box_mm ?? {};
      return {
        net: z.net ?? '',
        x1: b.x1 ?? 0,
        y1: b.y1 ?? 0,
        x2: b.x2 ?? 0,
        y2: b.y2 ?? 0,
        clearance_mm: clearanceOf.get(z.net ?? '') ?? 0.2,
      };
    });

  const routerNets = pcb.nets.map((n) => ({
    net_name: n.net_name ?? '',
    trace_width_mm: n.trace_width_mm ?? 0.25,
  }));
  const r = ripupAutoroute(W, H, routerNets, owners, staticBlocked, zones);
  return {
    ...pcb,
    pcb_traces: r.traces.map((t) => ({ ...t, layer: 'Top' as const })),
  };
}
