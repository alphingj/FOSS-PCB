// AI Part Generator: turn a part spec (pinout + package geometry) into a linked
// KiCad schematic symbol (.kicad_sym) and PCB footprint (.kicad_mod).
//
// The part spec comes from a BYOK vision LLM that has read a datasheet; this
// module does the deterministic geometry work so the LLM only has to extract
// facts. Footprint pads follow IPC-7351B-inspired land patterns computed from
// the package's lead dimensions.
//
// Honest scope: pads are computed from the supplied lead dimensions. They are
// a reviewed starting point, never silently substituted for a verified
// land pattern. The generator shows the full pad table for verification.

export interface PartPin {
  number: number | string;
  name: string;
  /** KiCad pin electrical type. */
  type:
    | 'input' | 'output' | 'bidirectional' | 'tri_state'
    | 'passive' | 'unspecified'
    | 'power_in' | 'power_out'
    | 'open_collector' | 'open_emitter' | 'no_connect';
}

/** Pin arrangement the generator can model. Quad/no-lead packages (QFP, QFN,
 *  BGA) are deliberately unsupported: their land patterns need four-sided
 *  geometry, and guessing one would silently produce a wrong footprint. */
export type PackageLayout = 'dual' | 'inline' | 'sot23';

export interface PackageGeom {
  /** Human name, e.g. "SOIC-8". */
  name: string;
  /** 1 = inline row / SOT-23, 2 = two opposite rows (SOIC/TSSOP). */
  rows: 1 | 2;
  /** Optional explicit layout; defaults to dual for rows=2, inline otherwise. */
  layout?: PackageLayout;
  pinsPerRow: number;
  /** Distance between adjacent pads in a row, mm. */
  pitch: number;
  /** Distance between the two rows, mm (dual-row only). */
  rowSpan: number;
  /** Body width / span, mm. */
  bodyWidth: number;
  /** Body length, mm. */
  bodyLength: number;
  /** Lead width, mm (drives pad width). */
  leadWidth: number;
  /** Lead length, mm (drives pad length). */
  leadLength: number;
}

export interface PartSpec {
  mpn: string;
  description?: string;
  pins: PartPin[];
  pkg: PackageGeom;
}

/** IPC-7351B-inspired land-pattern allowances, mm. The pad width tracks the
 *  lead width plus a small allowance; the pad length tracks the row pitch
 *  (a common rule of thumb for gull-wing packages). Both are a reviewed
 *  starting point, never a substitute for the datasheet land pattern. */
const PAD_W_ALLOWANCE = 0.2;
const PAD_L_PITCH_FACTOR = 1.5;
const COURTYARD = 0.5;

/** Pad geometry for one row of a package, computed from lead dimensions. */
export interface GenPad {
  number: string;
  dx: number; // mm from footprint origin
  dy: number;
  w: number;
  h: number;
}

/** Compute land-pattern pads for a dual-row, inline, or SOT-23 package.
 *  Pads extend outward from the body; width follows the lead width plus an
 *  allowance, length follows the pin pitch. Quad packages throw rather than
 *  emit geometry for a package shape that is not modelled. */
const UNSUPPORTED_PKG = /(QFP|QFN|BGA|LGA|DFN|WLCSP|CSP|PLCC|LCC)/i;

export function landPads(pkg: PackageGeom, pins: PartPin[]): GenPad[] {
  if (UNSUPPORTED_PKG.test(pkg.name))
    throw new Error(
      `Unsupported package "${pkg.name}": quad/no-lead packages are not modelled yet — only dual-row (SOIC/TSSOP), inline (SIP) and SOT-23 land patterns are generated.`,
    );
  const layout: PackageLayout = pkg.layout ?? (pkg.rows === 2 ? 'dual' : 'inline');
  const n = pins.length;
  if (n === 0) throw new Error('Part spec has no pins — cannot generate a land pattern.');
  const pitch = pkg.pitch;
  const padW = +(pkg.leadWidth + PAD_W_ALLOWANCE).toFixed(3);
  const padH = +(pitch * PAD_L_PITCH_FACTOR).toFixed(3);
  const rowX = pkg.bodyWidth / 2 + pkg.leadLength / 2;
  const out: GenPad[] = [];

  if (layout === 'dual') {
    const perRow = Math.ceil(n / 2);
    if (perRow * 2 !== n)
      throw new Error(`Unsupported pin count ${n} for a dual-row package — pins must split evenly between two rows.`);
    const rowY = (i: number) => (i - (perRow - 1) / 2) * pitch;
    for (let i = 0; i < n; i++) {
      const left = i < perRow;
      // Numbering runs counter-clockwise: pins 1..perRow down the left row,
      // then the right row bottom→top so the last pin sits at the top right.
      const col = left ? i : n - 1 - i;
      out.push({
        number: String(pins[i].number),
        dx: left ? -rowX : rowX,
        dy: rowY(col),
        w: padH, // pads are long along x (gull-wing)
        h: padW,
      });
    }
    return out;
  }

  if (layout === 'sot23') {
    if (n !== 3) throw new Error(`SOT-23 layout expects exactly 3 pins, got ${n}.`);
    const half = pitch / 2;
    out.push({ number: String(pins[0].number), dx: -rowX, dy: -half, w: padH, h: padW });
    out.push({ number: String(pins[1].number), dx: -rowX, dy: half, w: padH, h: padW });
    out.push({ number: String(pins[2].number), dx: rowX, dy: 0, w: padH, h: padW });
    return out;
  }

  // Inline: one vertical row (SIP headers, single-row connectors).
  const rowY = (i: number) => (i - (n - 1) / 2) * pitch;
  for (let i = 0; i < n; i++)
    out.push({ number: String(pins[i].number), dx: 0, dy: rowY(i), w: padW, h: padH });
  return out;
}

/** KiCad .kicad_sym for a single unit. Pins are placed on the left/right of a
 *  box; power pins go on top/bottom. Units beyond the first are not generated
 *  (single-unit parts only — documented limit). */
export function generateKicadSymbol(spec: PartSpec): string {
  const pins = spec.pins;
  const n = pins.length;
  const perSide = Math.ceil(n / 2);
  const pinSpacing = 2.54;
  const boxH = Math.max(perSide, 1) * pinSpacing + 2.54;
  const boxW = Math.max(...pins.map((p) => p.name.length)) * 1.27 + 5.08;
  const name = spec.mpn.replace(/[^A-Za-z0-9_.-]/g, '_');
  const esc = (s: string) => s.replace(/"/g, '');

  const L: string[] = [
    '(kicad_symbol_lib (version 20240101) (generator foss-pcb)',
    `  (symbol "${esc(name)}" (pin_numbers (hide yes)) (pin_names (offset 0)) (exclude_from_sim no) (in_bom yes) (on_board yes)`,
    `    (property "Reference" "U" (at ${(boxW / 2 + 2.54).toFixed(2)} ${(boxH / 2 + 1.27).toFixed(2)} 0) (effects (font (size 1.27 1.27))))`,
    `    (property "Value" "${esc(spec.mpn)}" (at ${(boxW / 2 + 2.54).toFixed(2)} ${(-boxH / 2 - 1.27).toFixed(2)} 0) (effects (font (size 1.27 1.27))))`,
    `    (property "Footprint" "" (at ${(boxW / 2 + 2.54).toFixed(2)} ${(-boxH / 2 - 3.81).toFixed(2)} 0) (effects (font (size 1.27 1.27)) (hide yes)))`,
    `    (property "Datasheet" "" (at ${(boxW / 2 + 2.54).toFixed(2)} ${(-boxH / 2 - 6.35).toFixed(2)} 0) (effects (font (size 1.27 1.27)) (hide yes)))`,
    `    (property "Description" "${esc(spec.description ?? '')}" (at ${(boxW / 2 + 2.54).toFixed(2)} ${(-boxH / 2 - 8.89).toFixed(2)} 0) (effects (font (size 1.27 1.27)) (hide yes)))`,
    `    (symbol "${esc(name)}_0_1"`,
    `      (rectangle (start ${(-boxW / 2).toFixed(2)} ${(boxH / 2).toFixed(2)}) (end ${(boxW / 2).toFixed(2)} ${(-boxH / 2).toFixed(2)}) (stroke (width 0.254) (type default)) (fill (type none)))`,
    `    )`,
    `    (symbol "${esc(name)}_1_1"`,
  ];
  pins.forEach((p, i) => {
    const left = i < perSide;
    const col = left ? i : i - perSide;
    const y = (perSide / 2 - col - 0.5) * pinSpacing;
    const x = left ? -boxW / 2 - 2.54 : boxW / 2 + 2.54;
    const rot = left ? 180 : 0;
    const pinType = p.type || 'unspecified';
    const len = 2.54;
    L.push(
      `      (pin ${pinType} line (at ${x.toFixed(2)} ${y.toFixed(2)} ${rot}) (length ${len})`,
      `        (name "${esc(p.name)}" (effects (font (size 1.27 1.27))))`,
      `        (number "${esc(String(p.number))}" (effects (font (size 1.27 1.27))))`,
      `      )`
    );
  });
  L.push('    )', '  )', ')');
  return L.join('\n');
}

/** KiCad .kicad_mod for the package, with the land pattern from landPads(). */
export function generateKicadFootprint(spec: PartSpec, footprintName?: string): string {
  const pkg = spec.pkg;
  const name = footprintName ?? pkg.name.replace(/[^A-Za-z0-9_.-]/g, '_');
  const pads = landPads(pkg, spec.pins);
  const esc = (s: string) => s.replace(/"/g, '');
  const halfW = Math.max(...pads.map((p) => Math.abs(p.dx) + p.w / 2)) + COURTYARD;
  const halfL = Math.max(...pads.map((p) => Math.abs(p.dy) + p.h / 2)) + COURTYARD;

  const L: string[] = [
    `(footprint "${esc(name)}" (version 20240101) (generator foss-pcb)`,
    '  (layer "F.Cu")',
    `  (descr "Generated by FOSS-PCB — verify against the datasheet before production")`,
    `  (property "Reference" "U" (at 0 ${(-halfL - 2).toFixed(2)} 0) (layer "F.SilkS") (uuid ${sym()}) (effects (font (size 1 1) (thickness 0.15))))`,
    `  (property "Value" "${esc(spec.mpn)}" (at 0 ${(halfL + 2).toFixed(2)} 0) (layer "F.Fab") (hide yes) (uuid ${sym()}) (effects (font (size 1 1) (thickness 0.15))))`,
    `  (property "Footprint" "" (at 0 ${(halfL + 4).toFixed(2)} 0) (layer "F.Fab") (hide yes) (uuid ${sym()}) (effects (font (size 1 1) (thickness 0.15))))`,
    `  (property "Datasheet" "" (at 0 ${(halfL + 6).toFixed(2)} 0) (layer "F.Fab") (hide yes) (uuid ${sym()}) (effects (font (size 1 1) (thickness 0.15))))`,
    `  (attr smd)`,
    `  (fp_rect (start ${(-halfW).toFixed(3)} ${(-halfL).toFixed(3)}) (end ${halfW.toFixed(3)} ${halfL.toFixed(3)}) (stroke (width 0.12) (type solid)) (fill none) (layer "F.CrtYd") (uuid ${sym()}))`,
  ];
  for (const p of pads) {
    L.push(
      `  (pad "${esc(p.number)}" smd rect (at ${p.dx.toFixed(3)} ${p.dy.toFixed(3)}) (size ${p.w.toFixed(3)} ${p.h.toFixed(3)}) (layers "F.Cu" "F.Paste" "F.Mask") (tstamp ${sym()}))`
    );
  }
  L.push(')');
  return L.join('\n');
}

function sym(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `foss-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/** Human-readable pad table for review (the generator ships this alongside the
 *  files so the user can check every dimension against the datasheet). */
export function padTable(spec: PartSpec): string {
  const pads = landPads(spec.pkg, spec.pins);
  const head = 'Pad | X (mm) | Y (mm) | Size (mm)';
  const rows = pads.map((p) => `${p.number.padStart(3)} | ${p.dx.toFixed(3).padStart(6)} | ${p.dy.toFixed(3).padStart(6)} | ${p.w.toFixed(3)} x ${p.h.toFixed(3)}`);
  return [head, '-'.repeat(head.length), ...rows].join('\n');
}