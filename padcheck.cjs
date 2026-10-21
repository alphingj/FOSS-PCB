const { fossToKicadPcb } = require('PDIR/kicad-io.js');
const { SAMPLE_BUCKBOOST } = require('PDIR/sample-buckboost.js');

const assert = (c, m, v) => { if (!c) { console.error('FAIL: ' + m, v ?? ''); process.exit(1); } else console.log('ok: ' + m); };

const s = fossToKicadPcb(SAMPLE_BUCKBOOST);
// paren balance (strings contain no parens by construction — quotes stripped)
let depth = 0, min = 0;
for (const ch of s) {
  if (ch === '(') depth++;
  if (ch === ')') depth--;
  if (depth < min) min = depth;
}
assert(depth === 0 && min >= 0, 'balanced parens');

const pads = s.split('\n').filter((l) => l.includes('(pad '));
// demo SOIC-8 parts: Q1 (IRF7416, no verified pinout) + U1 (UC3843BD1, verified)
// 2-pin passives: R(3x2) + D(1x2) = 8 pads; C (CP_Elec) and L (SRR1280) stay
// pad-less (land patterns not yet datasheet-sourced) — total 16 + 8 = 24.
assert(pads.length === 16 + 8, '24 pads (16 SOIC + 8 two-pin)', pads.length);
// U1 pad 2 (FB) -> FB net; pad 5 (GND) -> GND net; pad 6 (OUT) -> GATE_DRV; pad 7 (VCC) -> VIN
// net ids: VIN=1 SW=2 VOUT=3 GND=4 GATE_DRV=5 GATE=6 FB=7
const u1pads = {};
const lines = s.split('\n');
let cur = '';
for (const l of lines) {
  const fp = l.match(/\(property "Reference" "([^"]+)"/);
  if (fp) cur = fp[1];
  const pm = l.match(/\(pad "(\d)" .* \(net (\d+) "([^"]*)"\)/);
  if (pm && cur) (u1pads[cur] = u1pads[cur] || {})[pm[1]] = +pm[2];
}
assert(u1pads.U1['2'] === 7, 'U1 pad2 FB->7', JSON.stringify(u1pads.U1));
assert(u1pads.U1['5'] === 4, 'U1 pad5 GND->4');
assert(u1pads.U1['6'] === 5, 'U1 pad6 OUT->GATE_DRV=5');
assert(u1pads.U1['7'] === 1, 'U1 pad7 VCC->VIN=1');
assert(Object.values(u1pads.Q1).every((n) => n === 0), 'unverified Q1 pads all net 0');
assert(s.includes('FOSS_NOTE'), 'unverified-pin note present for Q1');
// KiCad's (net ...) grammar differs by object: pads and segments carry a
// quoted name `(net N "name")`; vias and zones carry `(net N)` with the name
// derived from the net id. Verified with kicad-cli 10.0.6 against a real
// .kicad_pcb from the KiCad 10 demos.
const netLines = s.split('\n').filter((l) => /\(net \d+\)/.test(l));
const badNet = netLines.some((l) => {
  if (/\)\s*"/.test(l)) return false;   // quoted name present
  if (/\(zone /.test(l)) return false;  // zone: (net N) only, name by id
  if (/\(via /.test(l)) return false;   // via: (net N) only, name by id
  return true;
});
assert(!badNet, 'every net field carries a name (pads/segments) or uses a via/zone form');
// Pads must be local offsets (KiCad applies the footprint rotation itself),
// and geometry must match the official KiCad footprint library.
assert(!/^\s+\(pad "\d+" .*\(at -?4\.9\d\d/.test(s), 'pads use local offsets, not absolute');
assert(s.includes('(size 1.95 0.6)'), 'SOIC-8 pads 1.95x0.6 (KiCad library)');
assert(s.includes('(size 2.5 1.8)'), 'D_SMA pads 2.5x1.8 (KiCad library)');
assert(s.includes('(size 1.025 1.4)'), '0805 pads 1.025x1.4 (KiCad library)');
assert(s.includes('(layer "Edge.Cuts")'), 'board outline present on Edge.Cuts');
// Zones: demo board has SW (Top) and GND (Bottom) pours — KiCad 10 uses the
// `polygon`/`connect_pads`/`min_thickness`/`fill`/`hatch` zone grammar.
assert((s.match(/\(zone /g) ?? []).length === 2, '2 copper pour zones exported', (s.match(/\(zone /g) ?? []).length);
assert(s.includes('(zone (net 2) (layer "F.Cu")') && s.includes('(zone (net 4) (layer "B.Cu")'), 'zone net+layer fields present');
assert(s.includes('(polygon (pts (xy 21 14)') && s.includes('(polygon (pts (xy 1 1)'), 'zone polygon outlines present');
assert(s.includes('(connect_pads (clearance 0.2))'), 'zone thermal relief rules present');
assert(s.includes('(fill yes (thermal_gap 0.508)'), 'zone fill rules present');
// Vias: demo board has 2 through vias.
assert((s.match(/\(via /g) ?? []).length === 2, '2 vias exported', (s.match(/\(via /g) ?? []).length);
assert(s.includes('(via (at 22 8) (size 0.6) (drill 0.3)'), 'via V1 geometry', s.match(/\(via [^\n]*/)?.[0]);

// 2-pin passives: R(3x2) + D(1x2) = 8 pads; C (CP_Elec) and L (SRR1280) stay
// pad-less (land patterns not yet datasheet-sourced) — total 16 + 8 = 24.
assert(pads.length === 16 + 8, '24 pads (16 SOIC + 8 two-pin)', pads.length);
// R1 pad1 (left, label 1) -> VIN=1, pad2 -> GND=4
const r1pads = {};
let curDes = '';
for (const l of s.split('\n')) {
  const fp = l.match(/\(property "Reference" "([^"]+)"/);
  if (fp) curDes = fp[1];
  const pm = l.match(/\(pad "(\d)" .* \(net (\d+) "([^"]*)"\)/);
  if (pm && curDes) {
    const k = `${curDes}:${pm[1]}`;
    if (curDes === 'R1' || curDes === 'D1' || curDes === 'L1') r1pads[k] = +pm[2];
  }
}
assert(r1pads['R1:1'] === 3 && r1pads['R1:2'] === 7, 'R1 1->VOUT=3, 2->FB=7', JSON.stringify(r1pads));
assert(r1pads['D1:1'] === 3 && r1pads['D1:2'] === 2, 'D1 A->VOUT=3, K->SW=2');

// synthetic SOT-23 board: AO3400A (G:1 S:2 D:3) + TL431ACDBZR (K:1 R:2 A:3)
const sot = {
  project_metadata: SAMPLE_BUCKBOOST.project_metadata,
  components: [
    { designator: 'Q9', type: 'MOSFET_N_Channel', value: 'AO3400', mpn: 'AO3400A', footprint: 'SOT-23', pins: { G: 'G9', D: 'D9', S: 'GND' }, schematic_pos: { x: 0, y: 0, rotation: 0 }, pcb_placement_mm: { x: 10, y: 10, rotation: 0, layer: 'Top' } },
    { designator: 'U9', type: 'IC_Shunt_Regulator', value: '2.5V', mpn: 'TL431ACDBZR', footprint: 'SOT-23', pins: { R: 'FB9', A: 'GND', K: 'K9' }, schematic_pos: { x: 0, y: 0, rotation: 0 }, pcb_placement_mm: { x: 20, y: 10, rotation: 0, layer: 'Top' } },
    { designator: 'U8', type: 'IC_OpAmp_Dual', value: 'LM358', mpn: 'LM358DR', footprint: 'SOIC-8_3.9x4.9mm_P1.27mm', pins: { OUT1: 'O1', 'IN1-': 'N1', 'IN1+': 'P1', 'V-': 'GND', 'IN2+': 'P2', 'IN2-': 'N2', OUT2: 'O2', 'V+': 'VCC8' }, schematic_pos: { x: 0, y: 0, rotation: 0 }, pcb_placement_mm: { x: 30, y: 10, rotation: 0, layer: 'Top' } },
  ],
  nets: [
    { net_name: 'GND', nodes: ['Q9.S', 'U9.A', 'U8.V-'], trace_width_mm: 2, clearance_mm: 0.3, routing_type: '' },
    { net_name: 'G9', nodes: ['Q9.G'], trace_width_mm: 0.25, clearance_mm: 0.2, routing_type: '' },
    { net_name: 'D9', nodes: ['Q9.D'], trace_width_mm: 0.25, clearance_mm: 0.2, routing_type: '' },
    { net_name: 'FB9', nodes: ['U9.R'], trace_width_mm: 0.25, clearance_mm: 0.2, routing_type: '' },
    { net_name: 'K9', nodes: ['U9.K'], trace_width_mm: 0.25, clearance_mm: 0.2, routing_type: '' },
    { net_name: 'O1', nodes: ['U8.OUT1'], trace_width_mm: 0.25, clearance_mm: 0.2, routing_type: '' },
    { net_name: 'O2', nodes: ['U8.OUT2'], trace_width_mm: 0.25, clearance_mm: 0.2, routing_type: '' },
    { net_name: 'VCC8', nodes: ['U8.V+'], trace_width_mm: 0.25, clearance_mm: 0.2, routing_type: '' },
  ],
  schematic_wires: [],
  pcb_traces: [],
  pcb_layout_zones: [],
};
const ss = fossToKicadPcb(sot);
assert(ss.includes('(size 1.475 0.6)'), 'SOT-23 pads 1.475x0.6 (KiCad library)');
const sotPads = {};
let curS = '';
for (const l of ss.split('\n')) {
  const fp = l.match(/\(property "Reference" "([^"]+)"/);
  if (fp) curS = fp[1];
  const pm = l.match(/\(pad "(\d)" .* \(net (\d+) "([^"]*)"\)/);
  if (pm && curS) (sotPads[curS] = sotPads[curS] || {})[pm[1]] = +pm[2];
}
// net ids: GND=1 G9=2 D9=3 FB9=4 K9=5 O1=6 O2=7 VCC8=8
assert(sotPads.Q9['1'] === 2 && sotPads.Q9['2'] === 1 && sotPads.Q9['3'] === 3, 'AO3400 nets', JSON.stringify(sotPads.Q9));
assert(sotPads.U9['1'] === 5 && sotPads.U9['2'] === 4 && sotPads.U9['3'] === 1, 'TL431 nets', JSON.stringify(sotPads.U9));
assert(sotPads.U8['1'] === 6 && sotPads.U8['4'] === 1 && sotPads.U8['7'] === 7 && sotPads.U8['8'] === 8, 'LM358 nets', JSON.stringify(sotPads.U8));
assert(sotPads.U8['2'] === 0 && sotPads.U8['3'] === 0, 'LM358 unconnected inputs stay net 0');
console.log('ALL PAD CHECKS PASSED');
