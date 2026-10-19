// KiCad s-expr interop (TS side). Python (kicad_compat.py) mirrors the export shape.
import type { FossPcb } from './foss-schema';
import { soic8Pads, pinoutFor, twoPinGeom, SOT23_PADS } from './kicad-pads';

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `foss-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/** Net id for a component pin label, or 0 when unconnected. */
function pinNetId(pcb: FossPcb, netId: Map<string, number>, des: string, label: string): number {
  const key = `${des}.${label}`;
  for (const n of pcb.nets) {
    if (n.nodes.includes(key)) return netId.get(n.net_name) ?? 0;
  }
  return 0;
}

/** KiCad requires a quoted name in every `(net ...)` field, including the
 *  reserved unconnected net 0 (written as an empty string by KiCad itself).
 *  Verified: `(net 0)` alone makes kicad-cli refuse to load the board. */
function netField(nid: number, netName: (id: number) => string): string {
  return `(net ${nid} "${String(netName(nid)).replace(/"/g, '')}")`;
}

/** FOSS JSON -> loadable .kicad_pcb: numeric net ids (0 reserved), segments as
 *  start/end pairs, footprints with layer/tstamp/properties. SOIC-8 footprints
 *  get real pads with verified pinouts; every other footprint is pad-less
 *  (never guessed) — KiCad loads those fine for placement, add pads there. */
export function fossToKicadPcb(pcb: FossPcb): string {
  const L: string[] = ['(kicad_pcb (version 20240101) (generator foss-pcb) (general) (paper "A4")'];
  pcb.nets.forEach((n, i) => L.push(`  (net ${i + 1} "${n.net_name.replace(/"/g, '')}")`));
  const netId = new Map(pcb.nets.map((n, i) => [n.net_name, i + 1]));
  const netNameOf = (id: number) => (id === 0 ? '' : pcb.nets[id - 1]?.net_name ?? '');
  // Pads and fields are emitted as LOCAL offsets from the footprint origin and
  // KiCad applies the footprint `(at x y rot)` itself — the same convention as
  // a real .kicad_mod. Pre-rotating offsets here (as an earlier version did)
  // double-rotated every part; caught by kicad-cli DRC on the 90-degree R3.
  const at = (dx: number, dy: number, rot: number) => ` (at ${dx.toFixed(3)} ${dy.toFixed(3)} ${rot})`;
  for (const c of pcb.components) {
    const p = c.pcb_placement_mm;
    L.push(`  (footprint "${c.footprint}" (layer "F.Cu") (tstamp ${uuid()}) (at ${p.x} ${p.y} ${p.rotation})`);
    // Reference sits above the part on F.SilkS; Value is hidden. Without
    // (at)/(layer) KiCad places fields over the pads and DRC flags
    // silk_over_copper (verified with kicad-cli 10.0.6).
    L.push(`    (property "Reference" "${c.designator}" (at 0 -2 0) (layer "F.SilkS") (uuid ${uuid()}) (effects (font (size 1 1) (thickness 0.15))))`);
    L.push(`    (property "Value" "${c.value.replace(/"/g, '')}" (at 0 2 0) (layer "F.Fab") (hide yes) (uuid ${uuid()}) (effects (font (size 1 1) (thickness 0.15))))`);
    L.push(`    (attr smd)`);
    if (c.mpn) L.push(`    (property "MPN" "${c.mpn.replace(/"/g, '')}")`);
    if (c.footprint.includes('SOIC-8')) {
      // Real pads. Nets resolve through the verified pinout table; pads whose
      // label has no verified number stay on net 0 (never guessed).
      const pinout = pinoutFor(c.mpn);
      const numOf = new Map<string, number>();
      if (pinout) for (const [label, num] of Object.entries(pinout)) numOf.set(label, num);
      let unverified = 0;
      for (const pad of soic8Pads()) {
        const label = Array.from(numOf.entries()).find(([, n]) => n === pad.n)?.[0];
        if (!label) unverified++;
        const nid = label ? pinNetId(pcb, netId, c.designator, label) : 0;
        L.push(
          `    (pad "${pad.n}" smd roundrect${at(pad.dx, pad.dy, p.rotation)}` +
          ` (size ${pad.w} ${pad.h}) (layers "F.Cu" "F.Paste" "F.Mask") ${netField(nid, netNameOf)} (roundrect_rratio 0.25) (tstamp ${uuid()}))`
        );
      }
      if (unverified)
        L.push(`    (property "FOSS_NOTE" "Pinout not verified for ${c.mpn.replace(/"/g, '') || c.designator} — ${unverified} pad(s) left on net 0")`);
    } else {
      const g2 = twoPinGeom(c.footprint);
      if (g2) {
        // Symmetric 2-pin: nets attach per pin label, exact by construction.
        // Pad "1" prefers label '1', then anode 'A' (diode convention), else first.
        const labels = Object.keys(c.pins);
        const l1 = labels.includes('1') ? '1' : labels.includes('A') ? 'A' : labels[0];
        const l2 = labels.find((l) => l !== l1);
        const ends: [string, number][] = [[l1, -g2.dx], ...(l2 ? [[l2, g2.dx] as [string, number]] : [])];
        ends.forEach(([lname, ox], i) => {
          const nid = pinNetId(pcb, netId, c.designator, lname);
          L.push(
            `    (pad "${i + 1}" smd roundrect${at(ox, 0, p.rotation)}` +
            ` (size ${g2.w} ${g2.h}) (layers "F.Cu" "F.Paste" "F.Mask") ${netField(nid, netNameOf)} (roundrect_rratio 0.25) (tstamp ${uuid()}))`
          );
        });
      } else if (c.footprint.includes('SOT-23')) {
        // Nets resolve through verified pinouts (AO3400, TL431/DBZ); unknown
        // MPNs stay net-0 and the footprint carries a visible note property.
        const pinout = pinoutFor(c.mpn);
        let unverified = 0;
        for (const pad of SOT23_PADS) {
          const label = pinout ? Object.keys(pinout).find((l) => pinout[l] === pad.n && l in c.pins) : undefined;
          if (!label) unverified++;
          const nid = label ? pinNetId(pcb, netId, c.designator, label) : 0;
          L.push(
            `    (pad "${pad.n}" smd rect${at(pad.dx, pad.dy, p.rotation)}` +
            ` (size ${pad.w} ${pad.h}) (layers "F.Cu" "F.Paste" "F.Mask") ${netField(nid, netNameOf)} (tstamp ${uuid()}))`
          );
        }
        if (unverified)
          L.push(`    (property "FOSS_NOTE" "SOT-23 pinout not verified for ${c.mpn.replace(/"/g, '')} — ${unverified} pad(s) left on net 0")`);
      }
    }
    L.push(`  )`);
  }
  // Board outline on Edge.Cuts. Without it KiCad DRC reports
  // "invalid_outline: Board has malformed outline (no edges found on
  // Edge.Cuts layer)" — verified with kicad-cli 10.0.6.
  const { board_width_mm: W, board_height_mm: H } = pcb.project_metadata.pcb_specifications;
  const edge = (x1: number, y1: number, x2: number, y2: number) =>
    `  (gr_line (start ${x1} ${y1}) (end ${x2} ${y2}) (layer "Edge.Cuts") (width 0.05) (tstamp ${uuid()}))`;
  L.push(edge(0, 0, W, 0), edge(W, 0, W, H), edge(W, H, 0, H), edge(0, H, 0, 0));
  for (const t of pcb.pcb_traces ?? []) {
    const id = netId.get(t.net) ?? 0;
    const layer = t.layer === 'Top' ? 'F.Cu' : 'B.Cu';
    for (let i = 0; i + 1 < t.pts_mm.length; i++) {
      const [x1, y1] = t.pts_mm[i];
      const [x2, y2] = t.pts_mm[i + 1];
      if (Math.hypot(x2 - x1, y2 - y1) < 1e-9) continue;
      L.push(`  (segment (start ${x1} ${y1}) (end ${x2} ${y2}) (width ${t.width_mm}) (layer "${layer}") ${netField(id, netNameOf)} (tstamp ${uuid()}))`);
    }
  }
  // Copper pour zones. KiCad computes the filled polygon on load; we emit the
  // zone boundary + pad connection rules. Verified: kicad-cli 10.0.6 accepts
  // zones with a chain and pad_connections block, then refills on open.
  for (const z of pcb.pcb_layout_zones ?? []) {
    const id = netId.get(z.net) ?? 0;
    const layer = z.layer.toLowerCase().startsWith('bottom') ? 'B.Cu' : 'F.Cu';
    const { x1, y1, x2, y2 } = z.bounding_box_mm;
    L.push(`  (zone (net ${id}) (layer "${layer}") (net_name "${z.net.replace(/"/g, '')}")`);
    L.push(`    (chain (start ${x1} ${y1}) (xy ${x2} ${y1}) (xy ${x2} ${y2}) (xy ${x1} ${y2}))`);
    L.push(`    (pad_connections (pad_via_shape thermal_relief) (clearance 0.2) (width_scale 0.6))`);
    L.push(`    (island_remove_mode corner_threshold_area)`);
    L.push(`  )`);
  }
  L.push(')');
  return L.join('\n');
}

/** Best-effort .kicad_pcb -> FOSS JSON: footprint references/values/positions,
 *  net ids/names. Pins/zones/traces are NOT recoverable from this direction —
 *  nets come back with empty node lists for the user/AI to re-attach. */
export function kicadPcbToFoss(text: string): {
  designator: string; value: string; footprint: string; x: number; y: number; rot: number; layer: 'Top' | 'Bottom';
}[] {
  const comps: { designator: string; value: string; footprint: string; x: number; y: number; rot: number; layer: 'Top' | 'Bottom' }[] = [];
  const fpRe = /\(footprint\s+"([^"]+)"([^]*?)(?=\(footprint\s+"|$)/g;
  let m: RegExpExecArray | null;
  while ((m = fpRe.exec(text))) {
    const footprint = m[1];
    const body = m[2];
    const at = body.match(/\(at\s+(-?[\d.]+)\s+(-?[\d.]+)(?:\s+(-?[\d.]+))?/);
    const ref = body.match(/\(property\s+"Reference"\s+"([^"]*)"/);
    const val = body.match(/\(property\s+"Value"\s+"([^"]*)"/);
    const layer = body.match(/\(layer\s+"([^"]+)"/);
    comps.push({
      designator: ref?.[1] ?? `U${comps.length + 1}`,
      value: val?.[1] ?? '',
      footprint,
      x: at ? parseFloat(at[1]) : 0,
      y: at ? parseFloat(at[2]) : 0,
      rot: at?.[3] ? parseFloat(at[3]) : 0,
      layer: layer && /B\.Cu|Bottom/i.test(layer[1]) ? 'Bottom' : 'Top',
    });
  }
  return comps;
}

export function kicadNetNames(text: string): string[] {
  const names: string[] = [];
  const re = /\(net\s+\d+\s+"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) names.push(m[1]);
  return names;
}

export function countFootprints(sexpr: string): number {
  return (sexpr.match(/\(footprint/g) ?? []).length;
}

export function download(name: string, text: string, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
