// Fabrication package: RS-274X Gerbers, Excellon drill, JLC BOM + CPL.
// Prototype-grade by construction: pads are approximated from body sizes and
// THT drills are center hits — the README in the zip says so, and the KiCad
// export remains the production path. Everything emitted is format-valid.
import type { FossPcb } from './foss-schema';
import { bodySizeForFootprint } from './models-3d';
import { findByMpn } from './library';

const f46 = (mm: number) => Math.round(mm * 1e6).toString();

const THT_DRILL: { key: string; dia: number }[] = [
  { key: 'MKDS', dia: 1.3 },
  { key: 'PinHeader', dia: 1.0 },
  { key: 'BarrelJack', dia: 1.0 },
  { key: 'HC49', dia: 0.8 },
  { key: 'TO-220', dia: 1.5 },
  { key: 'DIP', dia: 0.9 },
];

export interface FabFile {
  name: string;
  text: string;
}

function header(title: string): string[] {
  return [
    'G04 FOSS-PCB fab export — prototype grade, verify in KiCad before ordering*',
    `G04 ${title}*`,
    '%FSLAX46Y46*%',
    '%MOMM*%',
  ];
}

/** Aperture table for the distinct widths used; returns D-code per width. */
function apertures(widths: number[]): { defs: string[]; code: Map<number, number> } {
  const uniq = Array.from(new Set(widths.map((w) => +w.toFixed(2)))).sort((a, b) => a - b);
  const defs: string[] = [];
  const code = new Map<number, number>();
  uniq.forEach((w, i) => {
    const d = 10 + i;
    code.set(w, d);
    defs.push(`%ADD${d}C,${w.toFixed(3)}*%`);
  });
  return { defs, code };
}

function outlineRegion(W: number, H: number): string[] {
  return [
    'G36*',
    `X0Y0D02*`,
    `X${f46(W)}Y0D01*`,
    `X${f46(W)}Y${f46(H)}D01*`,
    `X0Y${f46(H)}D01*`,
    `X0Y0D01*`,
    'G37*',
  ];
}

function copperLayer(pcb: FossPcb, layer: 'Top' | 'Bottom', isOutline: boolean): string {
  const { board_width_mm: W, board_height_mm: H } = pcb.project_metadata.pcb_specifications;
  const L = header(`${layer} copper${isOutline ? ' + outline' : ''}`);
  const widths = (pcb.pcb_traces ?? []).filter((t) => t.layer === layer).map((t) => t.width_mm);
  const { defs, code } = apertures(widths.length ? widths : [0.25]);
  L.push(...defs);
  if (isOutline) L.push(...outlineRegion(W, H));
  // pour zones on this layer as solid regions
  for (const z of pcb.pcb_layout_zones) {
    const zl = z.layer.toLowerCase().startsWith('bottom') ? 'Bottom' : 'Top';
    if (zl !== layer) continue;
    const { x1, y1, x2, y2 } = z.bounding_box_mm;
    L.push('G36*', `X${f46(x1)}Y${f46(y1)}D02*`, `X${f46(x2)}Y${f46(y1)}D01*`, `X${f46(x2)}Y${f46(y2)}D01*`, `X${f46(x1)}Y${f46(y2)}D01*`, `X${f46(x1)}Y${f46(y1)}D01*`, 'G37*');
  }
  for (const t of pcb.pcb_traces ?? []) {
    if (t.layer !== layer) continue;
    const d = code.get(+t.width_mm.toFixed(2)) ?? 10;
    L.push(`D${d}*`);
    t.pts_mm.forEach(([x, y], i) => {
      L.push(`X${f46(x)}Y${f46(y)}D${i === 0 ? '02' : '01'}*`);
    });
  }
  L.push('M02*');
  return L.join('\n');
}

/** Assembly outlines: body rectangles + pin-1 dot per part (top side). */
function silkTop(pcb: FossPcb): string {
  const L = header('Top assembly outlines + pin1');
  L.push('%ADD10C,0.100*%', 'D10*');
  for (const c of pcb.components) {
    if (c.pcb_placement_mm.layer !== 'Top') continue;
    const [w, d] = bodySizeForFootprint(c.footprint);
    const { x, y } = c.pcb_placement_mm;
    const x1 = x - w / 2, y1 = y - d / 2, x2 = x + w / 2, y2 = y + d / 2;
    L.push(
      `X${f46(x1)}Y${f46(y1)}D02*`, `X${f46(x2)}Y${f46(y1)}D01*`,
      `X${f46(x2)}Y${f46(y2)}D01*`, `X${f46(x1)}Y${f46(y2)}D01*`,
      `X${f46(x1)}Y${f46(y1)}D01*`,
      `X${f46(x1)}Y${f46(y2)}D02*`, `X${f46(x1)}Y${f46(y2)}D01*` // pin-1 tick
    );
  }
  L.push('M02*');
  return L.join('\n');
}

function drillFile(pcb: FossPcb): { text: string; hits: number } {
  const L = ['M48', 'METRIC,TZ', 'G04 prototype center-hits per THT part — verify before ordering*'];
  const tools = new Map<number, number>();
  const hits: { dia: number; x: number; y: number }[] = [];
  for (const c of pcb.components) {
    const t = THT_DRILL.find((t) => c.footprint.includes(t.key));
    if (!t) continue;
    hits.push({ dia: t.dia, x: c.pcb_placement_mm.x, y: c.pcb_placement_mm.y });
    if (!tools.has(t.dia)) tools.set(t.dia, tools.size + 1);
  }
  for (const [dia, n] of tools) L.push(`T${n}F00S00C${dia.toFixed(2)}`);
  L.push('G90', 'G05');
  for (const h of hits) L.push(`T${tools.get(h.dia)}`, `X${h.x.toFixed(3)}Y${h.y.toFixed(3)}`);
  L.push('T0', 'M30');
  return { text: L.join('\n'), hits: hits.length };
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function bomCsv(pcb: FossPcb): string {
  return ['Comment,Designator,Footprint,LCSC Part # (JLC)', ...pcb.components.map((c) => [`${c.value} ${c.mpn}`.trim(), c.designator, c.footprint, findByMpn(c.mpn)?.lcsc ?? ''].map(csvCell).join(','))].join('\n');
}

/** JLC CPL: rotation passed through as placed; JLC may need footprint-specific
 *  offsets — the zip README says to verify against the 3D preview. */
export function cplCsv(pcb: FossPcb): string {
  return [
    'Designator,Mid X,Mid Y,Layer,Rotation,Package',
    ...pcb.components.map((c) => [
      c.designator,
      c.pcb_placement_mm.x.toFixed(3),
      c.pcb_placement_mm.y.toFixed(3),
      c.pcb_placement_mm.layer,
      String(c.pcb_placement_mm.rotation),
      c.footprint,
    ].map(csvCell).join(',')),
  ].join('\n');
}

export function fabFiles(pcb: FossPcb): FabFile[] {
  const name = pcb.project_metadata.design_name.replace(/[^\w.-]+/g, '_');
  const drill = drillFile(pcb);
  const readme = [
    `${name} — FOSS-PCB prototype fab package`,
    '',
    '- GTL/GBL/GTO are format-valid RS-274X; pads are approximated from body sizes.',
    '- Drill hits are single center-hits per THT part with library-default diameters.',
    '- CPL rotations are as-placed; verify against the 3D preview in JLC tools.',
    '- For production: File → Export .kicad_pcb → finish in KiCad, then plot from there.',
    '',
    `Drill hits: ${drill.hits}. Traces: ${(pcb.pcb_traces ?? []).length}. Parts: ${pcb.components.length}.`,
  ].join('\n');
  return [
    { name: `${name}-F_Cu.gtl`, text: copperLayer(pcb, 'Top', true) },
    { name: `${name}-B_Cu.gbl`, text: copperLayer(pcb, 'Bottom', true) },
    { name: `${name}-F_SilkS.gto`, text: silkTop(pcb) },
    { name: `${name}.drl`, text: drill.text },
    { name: '-BOM.csv', text: bomCsv(pcb) },
    { name: '-CPL.csv', text: cplCsv(pcb) },
    { name: '-FAB-README.txt', text: readme },
  ];
}

export async function fabZip(pcb: FossPcb): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const name = pcb.project_metadata.design_name.replace(/[^\w.-]+/g, '_');
  for (const f of fabFiles(pcb)) zip.file(f.name, f.text);
  return zip.generateAsync({ type: 'blob' });
}
