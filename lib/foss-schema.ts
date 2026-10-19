import { z } from 'zod';

export const Vec2 = z.object({ x: z.number(), y: z.number() });
export const PlacementMm = z.object({
  x: z.number(), y: z.number(),
  rotation: z.number().default(0),
  layer: z.enum(['Top', 'Bottom']).default('Top'),
});

export const FossComponent = z.object({
  designator: z.string(),
  type: z.string(),
  value: z.string(),
  mpn: z.string().default(''),
  footprint: z.string(),
  pins: z.record(z.string(), z.string()),
  schematic_pos: z.object({ x: z.number(), y: z.number(), rotation: z.number().default(0) }),
  pcb_placement_mm: PlacementMm,
});

export const FossNet = z.object({
  net_name: z.string(),
  nodes: z.array(z.string()),
  trace_width_mm: z.number().default(0.25),
  clearance_mm: z.number().default(0.2),
  routing_type: z.string().default('Signal'),
});

export const FossWire = z.object({
  net: z.string(),
  from: z.string(),
  to: z.string(),
  waypoints: z.array(z.tuple([z.number(), z.number()])).default([]),
});

export const FossZone = z.object({
  zone_name: z.string(),
  net: z.string(),
  layer: z.string(),
  bounding_box_mm: z.object({ x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() }),
  rule: z.string().default(''),
});

export const FossTrace = z.object({
  id: z.string(),
  net: z.string(),
  layer: z.enum(['Top', 'Bottom']).default('Top'),
  pts_mm: z.array(z.tuple([z.number(), z.number()])),
  width_mm: z.number().default(0.25),
});

/** A plated through-hole via: drill hole + pad on outer layers.
 *  layers names the span ("F.Cu-B.Cu" is a through via; a blind/buried via
 *  would name an inner span, but inner layers are not modelled yet). */
export const FossVia = z.object({
  id: z.string(),
  net: z.string(),
  x: z.number(),
  y: z.number(),
  drill_mm: z.number().default(0.3),
  pad_mm: z.number().default(0.6),
  layers: z.string().default('F.Cu-B.Cu'),
});

export const FossPcbJson = z.object({
  project_metadata: z.object({
    design_name: z.string(),
    revision: z.string().default('1.0.0'),
    topology: z.string().default(''),
    assumed_parameters: z.record(z.string(), z.any()).default({}),
    pcb_specifications: z.object({
      board_width_mm: z.number(),
      board_height_mm: z.number(),
      layers: z.number().default(2),
      copper_weight_oz: z.number().default(1),
      surface_finish: z.string().default('HASL_Lead_Free'),
    }),
  }),
  components: z.array(FossComponent),
  nets: z.array(FossNet),
  schematic_wires: z.array(FossWire).default([]),
  pcb_traces: z.array(FossTrace).default([]),
  pcb_layout_zones: z.array(FossZone).default([]),
  pcb_vias: z.array(FossVia).default([]),
});

export type FossPcb = z.infer<typeof FossPcbJson>;

/** Extract the LAST fenced ```json block from LLM markdown (models often show an
 *  example before the final design), else try raw JSON. */
export function extractJsonBlock(text: string): string {
  const re = /```json\s*([\s\S]*?)```/gi;
  let last = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) last = m[1].trim();
  if (last) return last;
  const m2 = text.match(/```\s*([\s\S]*?)```/);
  if (m2 && m2[1].trim().startsWith('{')) return m2[1].trim();
  return text.trim();
}

export function parseFossPcb(text: string) {
  const raw = extractJsonBlock(text);
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch (e: any) {
    throw new Error(`${e.message} (extracted ${raw.length} chars — is the full JSON block present?)`);
  }
  return FossPcbJson.parse(obj);
}
