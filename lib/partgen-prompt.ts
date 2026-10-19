// Prompt for the BYOK vision LLM that reads a datasheet and returns a PartSpec.
// The model must return strict JSON matching lib/partgen.ts's PartSpec — no
// prose, no guessing. Missing facts stay empty/null; the generator never
// invents a pin or a dimension.
import type { PartSpec } from './partgen';

export const PARTGEN_SYSTEM = `You are a component-library extraction engine for FOSS-PCB.
Given a manufacturer datasheet (text, PDF, or pinout image), extract ONLY facts that are stated in the document.

Return STRICT JSON with this exact shape (no markdown fences, no explanation):
{
  "mpn": "manufacturer part number",
  "description": "one-line description",
  "pins": [
    {"number": "1", "name": "VCC", "type": "power_in"}
  ],
  "pkg": {
    "name": "SOIC-8",
    "layout": "dual",
    "rows": 2,
    "pinsPerRow": 4,
    "pitch": 1.27,
    "rowSpan": 5.4,
    "bodyWidth": 3.9,
    "bodyLength": 4.9,
    "leadWidth": 0.4,
    "leadLength": 0.6
  }
}

Pin electrical types (use exactly one): input, output, bidirectional, tri_state, passive, unspecified, power_in, power_out, open_collector, open_emitter, no_connect.

Rules:
- Pin numbers and names MUST come from the datasheet pin table. Never guess or reorder.
- Package dimensions MUST come from the mechanical drawing. If a value is missing, omit it — do not estimate.
- layout is one of: "dual" (two opposite rows: SOIC, TSSOP, SSOP, SOJ), "inline" (one straight row: SIP header), "sot23" (3 pins: two on one side, one opposite).
- Quad-row and no-lead packages (QFP, QFN, BGA, LGA, DFN, WLCSP) are NOT supported. Return {"error": "unsupported package: quad/no-lead"} for them.
- rows: 2 for "dual", 1 otherwise.
- bodyWidth is the package dimension ACROSS the pin rows (lead-to-lead direction); bodyLength is the dimension ALONG the rows.
- pitch, rowSpan, bodyWidth, bodyLength, leadWidth, leadLength are all in MILLIMETERS.
- If the document has no pin table, return {"error": "not a datasheet"}.
- You cannot browse the web. Use only document content supplied in this conversation; if none is supplied, return {"error": "no datasheet content"}.

Output ONLY the JSON object.`;

/** Build the extraction request. The caller appends the datasheet text or image
 *  reference as the user message. */
export function partgenRequest(partNumber: string, source: string): { system: string; user: string } {
  return {
    system: PARTGEN_SYSTEM,
    user: [
      `Part number: ${partNumber}`,
      `Datasheet source: ${source} (reference only — you cannot fetch URLs)`,
      'Extract the pin table and package dimensions from the attached document.',
    ].join('\n'),
  };
}

/** Parse the LLM's JSON reply into a PartSpec, tolerating fenced blocks and
 *  minor shape issues. Returns null when the reply is unusable. */
export function parsePartSpec(raw: string): PartSpec | null {
  const txt = raw.replace(/```json\s*/i, '').replace(/```\s*/g, '').trim();
  let obj: any;
  try {
    obj = JSON.parse(txt);
  } catch {
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { obj = JSON.parse(m[0]); } catch { return null; }
  }
  if (!obj || typeof obj !== 'object') return null;
  if (obj.error) return null;
  if (!Array.isArray(obj.pins) || !obj.pins.length) return null;
  if (!obj.pkg || typeof obj.pkg !== 'object') return null;
  const p = obj.pkg;
  const num = (v: any, fb = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
  const pkgName = String(p.name ?? 'CUSTOM');
  const layout: 'dual' | 'inline' | 'sot23' =
    p.layout === 'dual' || p.layout === 'inline' || p.layout === 'sot23'
      ? p.layout
      : /SOT-?23/i.test(pkgName) && obj.pins.length === 3
        ? 'sot23'
        : p.rows === 2
          ? 'dual'
          : 'inline';
  return {
    mpn: String(obj.mpn ?? ''),
    description: obj.description ? String(obj.description) : undefined,
    pins: obj.pins.map((x: any) => ({
      number: String(x.number ?? ''),
      name: String(x.name ?? ''),
      type: (x.type ?? 'unspecified') as PartSpec['pins'][number]['type'],
    })),
    pkg: {
      name: pkgName,
      layout,
      rows: layout === 'dual' ? 2 : 1,
      pinsPerRow: num(p.pinsPerRow, Math.ceil(obj.pins.length / 2)),
      pitch: num(p.pitch, 1.27),
      rowSpan: num(p.rowSpan, 0),
      bodyWidth: num(p.bodyWidth, 0),
      bodyLength: num(p.bodyLength, 0),
      leadWidth: num(p.leadWidth, 0.4),
      leadLength: num(p.leadLength, 0.6),
    },
  };
}