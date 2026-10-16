export type ProviderKind = 'openrouter' | 'anthropic' | 'custom';

export interface ProviderConfig {
  kind: ProviderKind;
  apiKey: string;
  baseUrl: string;
  model: string;
  extraHeaders: Record<string, string>;
}

export const PRESETS: Record<ProviderKind, { baseUrl: string; model: string }> = {
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4.5' },
  anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-5-20250929' },
  custom: { baseUrl: 'http://localhost:11434/v1', model: '' },
};

export const SYSTEM_PROMPT = `You are FOSS-PCB, a text-to-PCB designer. Always return three sections in order:
## Components List (BOM) — markdown table: Designator | Type | Value/Rating | Package/Footprint | MPN | Role
## Connection List (Netlist & Trace Rules) — per net: pins, trace width, layout constraint
## Full JSON Format — one fenced \`\`\`json block matching this exact schema (no comments, strictly valid JSON):
{"project_metadata":{"design_name":string,"revision":string,"topology":string,"assumed_parameters":object,"pcb_specifications":{"board_width_mm":number,"board_height_mm":number,"layers":number,"copper_weight_oz":number,"surface_finish":string}},"components":[{"designator":string,"type":string,"value":string,"mpn":string,"footprint":string,"pins":{label:net},"schematic_pos":{"x":number,"y":number,"rotation":number},"pcb_placement_mm":{"x":number,"y":number,"rotation":number,"layer":"Top"}}],"nets":[{"net_name":string,"nodes":[string],"trace_width_mm":number,"clearance_mm":number,"routing_type":string}],"schematic_wires":[{"net":string,"from":string,"to":string,"waypoints":[[x,y]]}],"pcb_traces":[],"pcb_layout_zones":[{"zone_name":string,"net":string,"layer":string,"bounding_box_mm":{"x1":number,"y1":number,"x2":number,"y2":number},"rule":string}]}
Rules: use only real footprints (R_0805_2012Metric, SOIC-8_3.9x4.9mm_P1.27mm, D_SMA, CP_Elec_6.3x7.7, Inductor_Bourns_SRR1280_12.5x12.5mm, TerminalBlock_Phoenix_MKDS-1,5-2_5.08mm). Keep pcb_placement_mm inside board bounds. Keep SW polygons small. Never omit the JSON block.
Prefer these stocked MPNs (mpn | value | footprint); other values for the same footprint are allowed but flagged:
RC0805FR-0710RL | 10R | R_0805_2012Metric
RC0805FR-07100RL | 100R | R_0805_2012Metric
RC0805FR-071KL | 1k | R_0805_2012Metric
RC0805FR-074K7L | 4.7k | R_0805_2012Metric
RC0805FR-0710KL | 10k | R_0805_2012Metric
RC0805FR-0738K3L | 38.3k | R_0805_2012Metric
CL21B104KBCNNNC | 100nF | C_0805_2012Metric
CL21B105KAFNNNE | 1uF | C_0805_2012Metric
CL21A106KAFNNNE | 10uF | C_0805_2012Metric
EEE-FK1V470P | 47uF_35V | CP_Elec_6.3x7.7
UUD1E101MCL1GS | 100uF_25V | CP_Elec_6.3x7.7
SRR1280-100M | 10uH_6A | Inductor_Bourns_SRR1280_12.5x12.5mm
SRR1280-220M | 22uH_4.1A | Inductor_Bourns_SRR1280_12.5x12.5mm
SRR1280-470M | 47uH_3.5A | Inductor_Bourns_SRR1280_12.5x12.5mm
MBRA340T3G | 40V_3A | D_SMA
SSA34-E3/5AT | 40V_3A_SMA | D_SMA
1N4148W-7-F | 100V_150mA | D_SOD-123
IRF7416TRPBF | IRF7416 | SOIC-8_3.9x4.9mm_P1.27mm
IRLZ44NPBF | IRLZ44N | TO-220-3_Vertical
AO3400A | AO3400 | SOT-23
UC3843BD1 | UC3843B | SOIC-8_3.9x4.9mm_P1.27mm
NE555DR | NE555 | SOIC-8_3.9x4.9mm_P1.27mm
LM7805CT | 5V_1A | TO-220-3_Vertical
AMS1117-3.3 | 3.3V_1A | SOT-223-3_TabPin2
LM358DR | LM358 | SOIC-8_3.9x4.9mm_P1.27mm
TL431ACDBZR | 2.5V | SOT-23
ATMEGA328P-PU | ATmega328P | DIP-28_W7.62mm
ESP32-WROOM-32-N4 | ESP32-WROOM-32-N4 | Module_ESP32-WROOM-32
MKDS_1_5_2 | TERM_2P | TerminalBlock_Phoenix_MKDS-1,5-2_5.08mm
A2541WV-2x4P | 2x04_P2.54 | PinHeader_2x04_P2.54mm_Vertical
PJ-102A | DC_2.1mm | BarrelJack_PJ-102A_Horizontal
B3F-1000 | 6x6mm_THT | SW_Tactile_SPST_6x6mm_THT
045101.5MRL | 1.5A_125V | Fuse_2410_6125Metric`;

export async function fetchOpenRouterModels(apiKey: string, baseUrl: string): Promise<string[]> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`models fetch failed: ${res.status}`);
    const j = await res.json();
    const arr = Array.isArray(j?.data) ? j.data : [];
    return arr.map((m: any) => m.id ?? m.name).filter(Boolean).slice(0, 200);
  } finally {
    clearTimeout(t);
  }
}
