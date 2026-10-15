// KiCad s-expr interop (TS side). Python (kicad_compat.py) mirrors the export shape.
import type { FossPcb } from './foss-schema';

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `foss-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/** FOSS JSON -> loadable .kicad_pcb: numeric net ids (0 reserved), segments as
 *  start/end pairs, footprints with layer/tstamp/properties. Pads are intentionally
 *  absent (unknown pin geometry) — KiCad loads pad-less footprints fine. */
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
  designator: string; value: string; footprint: string; x: number; y: number; rot: number;
}[] {
  const comps: { designator: string; value: string; footprint: string; x: number; y: number; rot: number }[] = [];
  const fpRe = /\(footprint\s+"([^"]+)"([^]*?)(?=\(footprint\s+"|$)/g;
  let m: RegExpExecArray | null;
  while ((m = fpRe.exec(text))) {
    const footprint = m[1];
    const body = m[2];
    const at = body.match(/\(at\s+(-?[\d.]+)\s+(-?[\d.]+)(?:\s+(-?[\d.]+))?/);
    const ref = body.match(/\(property\s+"Reference"\s+"([^"]*)"/);
    const val = body.match(/\(property\s+"Value"\s+"([^"]*)"/);
    comps.push({
      designator: ref?.[1] ?? `U${comps.length + 1}`,
      value: val?.[1] ?? '',
      footprint,
      x: at ? parseFloat(at[1]) : 0,
      y: at ? parseFloat(at[2]) : 0,
      rot: at?.[3] ? parseFloat(at[3]) : 0,
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
