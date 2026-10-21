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

export const PARTGEN_REFINE_SYSTEM = `You are correcting a component-library extraction for FOSS-PCB.
You receive the previous extraction (strict JSON) and reviewer feedback, plus the original datasheet (PDF or image).

Return the COMPLETE corrected JSON in exactly the same shape as the previous extraction — no prose, no markdown fences.

Rules:
- Apply ONLY corrections supported by the attached datasheet and the reviewer feedback.
- Keep every value that is not being corrected exactly as it was.
- Never invent a pin, a dimension or an electrical type. If the datasheet does not support a requested change, keep the previous value (or omit the field) rather than guessing.
- Keep pin numbers and names from the datasheet pin table; do not reorder pins.
- If the feedback asks for a quad-row or no-lead package (QFP/QFN/BGA/LGA/DFN/WLCSP), return {"error": "unsupported package: quad/no-lead"}.
- If the feedback conflicts with the datasheet, the datasheet wins; keep the documented value.

Output ONLY the corrected JSON object.`;

/** Build the refinement request. `previous` is included verbatim so the model
 *  edits rather than re-extracts, and `feedback` states what was wrong. */
export function partgenRefineRequest(
  partNumber: string,
  source: string,
  previous: PartSpec,
  feedback: string,
): { system: string; user: string } {
  return {
    system: PARTGEN_REFINE_SYSTEM,
    user: [
      `Part number: ${partNumber}`,
      `Datasheet source: ${source} (reference only — you cannot fetch URLs)`,
      'Previous extraction:',
      JSON.stringify(previous, null, 2),
      'Reviewer feedback (correct these points):',
      feedback.trim(),
      'Return the complete corrected JSON, re-checking the attached datasheet.',
    ].join('\n'),
  };
}

const PKG_FIELDS = [
  'name', 'layout', 'rows', 'pinsPerRow', 'pitch', 'rowSpan',
  'bodyWidth', 'bodyLength', 'leadWidth', 'leadLength',
] as const;

/** Field-level summary of a refinement, for review before/after applying it.
 *  Pure and deterministic so the UI and checks agree. */
export function diffPartSpecs(before: PartSpec, after: PartSpec): string[] {
  const out: string[] = [];
  const show = (v: unknown) => (v === '' || v === undefined || v === null ? '—' : String(v));
  if (before.mpn !== after.mpn) out.push(`MPN: ${show(before.mpn)} → ${show(after.mpn)}`);
  if ((before.description ?? '') !== (after.description ?? ''))
    out.push(`Description: ${show(before.description)} → ${show(after.description)}`);

  const oldPins = new Map(before.pins.map((p) => [p.number, p]));
  const newPins = new Map(after.pins.map((p) => [p.number, p]));
  for (const [n, p] of oldPins) if (!newPins.has(n)) out.push(`Removed pin ${n} (${p.name})`);
  for (const [n, p] of newPins) {
    const prev = oldPins.get(n);
    if (!prev) {
      out.push(`Added pin ${n} (${p.name})`);
      continue;
    }
    if (prev.name !== p.name) out.push(`Pin ${n} name: ${prev.name} → ${p.name}`);
    if (prev.type !== p.type) out.push(`Pin ${n} type: ${prev.type} → ${p.type}`);
  }

  for (const k of PKG_FIELDS) {
    const a = (before.pkg as unknown as Record<string, unknown>)[k];
    const b = (after.pkg as unknown as Record<string, unknown>)[k];
    if (a !== b) out.push(`Package ${k}: ${show(a)} → ${show(b)}`);
  }
  return out;
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