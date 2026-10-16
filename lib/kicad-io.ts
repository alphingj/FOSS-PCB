// KiCad s-expr interop (TS side). Python (kicad_compat.py) mirrors the export shape.
import type { FossPcb } from './foss-schema';
import { soic8Pads, pinoutFor, rot2, twoPinGeom, SOT23_PADS } from './kicad-pads';

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

/** FOSS JSON -> loadable .kicad_pcb: numeric net ids (0 reserved), segments as
 *  start/end pairs, footprints with layer/tstamp/properties. SOIC-8 footprints
 *  get real pads with verified pinouts; every other footprint is pad-less
 *  (never guessed) — KiCad loads those fine for placement, add pads there. */
export function fossToKicadPcb(pcb: FossPcb): string {
  const L: string[] = ['(kicad_pcb (version 20240101) (generator foss-pcb) (general) (paper "A4")'];
  pcb.nets.forEach((n, i) => L.push(`  (net ${i + 1} "${n.net_name.replace(/"/g, '')}")`));
  const netId = new Map(pcb.nets.map((n, i) => [n.net_name, i + 1]));
  for (const c of pcb.components) {
    const p = c.pcb_placement_mm;
    L.push(`  (footprint "${c.footprint}" (layer "F.Cu") (tstamp ${uuid()}) (at ${p.x} ${p.y} ${p.rotation})`);
    L.push(`    (property "Reference" "${c.designator}")`);
    L.push(`    (property "Value" "${c.value.replace(/"/g, '')}")`);
    if (c.mpn) L.push(`    (property "MPN" "${c.mpn.replace(/"/g, '')}")`);
    if (c.footprint.includes('SOIC-8')) {
      // Real pads. Nets resolve through the verified pinout table; pads whose
      // label has no verified number stay on net 0 (never guessed).
      const pinout = pinoutFor(c.mpn);
      const numOf = new Map<string, number>();
      if (pinout) for (const [label, num] of Object.entries(pinout)) numOf.set(label, num);
      for (const pad of soic8Pads()) {
        const label = Array.from(numOf.entries()).find(([, n]) => n === pad.n)?.[0];
        const nid = label ? pinNetId(pcb, netId, c.designator, label) : 0;
        const [ax, ay] = rot2(pad.dx, pad.dy, p.rotation);
        L.push(
          `    (pad "${pad.n}" smd roundrect (at ${(p.x + ax).toFixed(3)} ${(p.y + ay).toFixed(3)} ${p.rotation})` +
          ` (size 0.6 1.6) (layers "F.Cu" "F.Paste" "F.Mask") (net ${nid}) (roundrect_rratio 0.25) (tstamp ${uuid()}))` +
          (label ? '' : ' ; PLACEHOLDER: unverified pin — net assigned in KiCad')
        );
      }
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
          const [ax, ay] = rot2(ox, 0, p.rotation);
          L.push(
            `    (pad "${i + 1}" smd roundrect (at ${(p.x + ax).toFixed(3)} ${(p.y + ay).toFixed(3)} ${p.rotation})` +
            ` (size ${g2.w} ${g2.h}) (layers "F.Cu" "F.Paste" "F.Mask") (net ${nid}) (roundrect_rratio 0.25) (tstamp ${uuid()}))`
          );
        });
      } else if (c.footprint.includes('SOT-23')) {
        // Nets resolve through verified pinouts (AO3400, TL431/DBZ); unknown
        // MPNs stay net-0 with a marker.
        const pinout = pinoutFor(c.mpn);
        for (const pad of SOT23_PADS) {
          const label = pinout ? Object.keys(pinout).find((l) => pinout[l] === pad.n && l in c.pins) : undefined;
          const nid = label ? pinNetId(pcb, netId, c.designator, label) : 0;
          const [ax, ay] = rot2(pad.dx, pad.dy, p.rotation);
          L.push(
            `    (pad "${pad.n}" smd rect (at ${(p.x + ax).toFixed(3)} ${(p.y + ay).toFixed(3)} ${p.rotation})` +
            ` (size 0.8 1.0) (layers "F.Cu" "F.Paste" "F.Mask") (net ${nid}) (tstamp ${uuid()}))` +
            (label ? '' : ' ; PLACEHOLDER: SOT-23 pinout not yet verified — nets assigned in KiCad')
          );
        }
      }
    }
    L.push(`  )`);
  }
  for (const t of pcb.pcb_traces ?? []) {
    const id = netId.get(t.net) ?? 0;
    const layer = t.layer === 'Top' ? 'F.Cu' : 'B.Cu';
    for (let i = 0; i + 1 < t.pts_mm.length; i++) {
      const [x1, y1] = t.pts_mm[i];
      const [x2, y2] = t.pts_mm[i + 1];
      if (Math.hypot(x2 - x1, y2 - y1) < 1e-9) continue;
      L.push(`  (segment (start ${x1} ${y1}) (end ${x2} ${y2}) (width ${t.width_mm}) (layer "${layer}") (net ${id}) (tstamp ${uuid()}))`);
    }
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
