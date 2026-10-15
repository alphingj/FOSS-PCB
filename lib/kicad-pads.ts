// SOIC-8 pad geometry + verified pinouts.
// SOURCES: TI UCx84x datasheet (COMP=1, VFB=2, ISENSE=3, RT/CT=4, GND=5,
// OUTPUT=6, VCC=7, VREF=8); TI NE555 datasheet (GND=1, TRIG=2, OUT=3,
// RESET=4, CONT=5, THRES=6, DISCH=7, VCC=8).
// Any footprint/MPN NOT listed here gets NO pads (never guessed geometry).

export interface PadGeom {
  n: number;
  dx: number; // mm from footprint origin, y-up like KiCad s-expr
  dy: number;
}

const SOIC8_PADS: PadGeom[] = [
  { n: 1, dx: -2.7, dy: 1.905 },
  { n: 2, dx: -2.7, dy: 0.635 },
  { n: 3, dx: -2.7, dy: -0.635 },
  { n: 4, dx: -2.7, dy: -1.905 },
  { n: 5, dx: 2.7, dy: -1.905 },
  { n: 6, dx: 2.7, dy: -0.635 },
  { n: 7, dx: 2.7, dy: 0.635 },
  { n: 8, dx: 2.7, dy: 1.905 },
];

/** MPN prefix -> pin label -> physical pad number. */
export const PINOUTS: Record<string, Record<string, number>> = {
  UC3843: { VCC: 7, OUT: 6, FB: 2, GND: 5 },
  NE555: { GND: 1, TRIG: 2, OUT: 3, RESET: 4, CTRL: 5, CONT: 5, THR: 6, THRES: 6, DISCH: 7, VCC: 8 },
  AO3400: { G: 1, S: 2, D: 3 },
  TL431: { R: 2, REF: 2, A: 3, K: 1 },
};

export function pinoutFor(mpn: string): Record<string, number> | null {
  const up = mpn.toUpperCase();
  for (const [prefix, map] of Object.entries(PINOUTS)) {
    if (up.startsWith(prefix)) return map;
  }
  return null;
}

export function soic8Pads(): PadGeom[] {
  return SOIC8_PADS;
}

/** Rotate a local offset by placement rotation (degrees, CCW, y-up). */
export function rot2(dx: number, dy: number, rotDeg: number): [number, number] {
  const r = (rotDeg * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return [+(dx * c - dy * s).toFixed(3), +(dx * s + dy * c).toFixed(3)];
}

export interface TwoPinGeom {
  dx: number; // pad centers at ±dx
  w: number;
  h: number;
}

/** Symmetric 2-pin footprints: pad "1" left, pad "2" right. Nets attach per pin
 *  label ('1'->pad1, '2'->pad2, else first/second label e.g. A/K), so net
 *  connectivity is exact regardless of left/right convention. */
export function twoPinGeom(fp: string): TwoPinGeom | null {
  if (fp.includes('R_0805') || fp.includes('C_0805') || fp.includes('LED_0805')) return { dx: 1.05, w: 1.0, h: 1.2 };
  if (fp.includes('SOD-123')) return { dx: 1.6, w: 1.0, h: 1.1 };
  if (fp.includes('D_SMA')) return { dx: 2.1, w: 2.0, h: 2.0 };
  // NOTE: CP_Elec and SRR1280 deliberately absent — their land patterns vary
  // by manufacturer and are not yet sourced from a datasheet.
  return null;
}

/** SOT-23 land pattern (pads numbered positionally). Net assignment needs a
 *  verified pinout (not yet encoded) → emitted net-0 with PLACEHOLDER. */
export const SOT23_PADS = [
  { n: 1, dx: -0.9, dy: 0.95 },
  { n: 2, dx: -0.9, dy: -0.95 },
  { n: 3, dx: 0.9, dy: 0 },
];
