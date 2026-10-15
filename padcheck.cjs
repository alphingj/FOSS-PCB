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
  const fp = l.match(/\(property "Reference" "([^"]+)"\)/);
  if (fp) cur = fp[1];
  const pm = l.match(/\(pad "(\d)" .* \(net (\d+)\)/);
  if (pm && cur) (u1pads[cur] = u1pads[cur] || {})[pm[1]] = +pm[2];
}
assert(u1pads.U1['2'] === 7, 'U1 pad2 FB->7', JSON.stringify(u1pads.U1));
assert(u1pads.U1['5'] === 4, 'U1 pad5 GND->4');
assert(u1pads.U1['6'] === 5, 'U1 pad6 OUT->GATE_DRV=5');
assert(u1pads.U1['7'] === 1, 'U1 pad7 VCC->VIN=1');
assert(Object.values(u1pads.Q1).every((n) => n === 0), 'unverified Q1 pads all net 0');
assert(s.includes('PLACEHOLDER'), 'placeholder marker present for unverified pins');

// 2-pin passives: R(3x2) + D(1x2) = 8 pads; C (CP_Elec) and L (SRR1280) stay
// pad-less (land patterns not yet datasheet-sourced) — total 16 + 8 = 24.
assert(pads.length === 16 + 8, '24 pads (16 SOIC + 8 two-pin)', pads.length);
// R1 pad1 (left, label 1) -> VIN=1, pad2 -> GND=4
const r1pads = {};
let curDes = '';
for (const l of s.split('\n')) {
  const fp = l.match(/\(property "Reference" "([^"]+)"\)/);
  if (fp) curDes = fp[1];
  const pm = l.match(/\(pad "(\d)" .* \(net (\d+)\)/);
  if (pm && curDes) {
    const k = `${curDes}:${pm[1]}`;
    if (curDes === 'R1' || curDes === 'D1' || curDes === 'L1') r1pads[k] = +pm[2];
  }
}
assert(r1pads['R1:1'] === 3 && r1pads['R1:2'] === 7, 'R1 1->VOUT=3, 2->FB=7', JSON.stringify(r1pads));
assert(r1pads['D1:1'] === 3 && r1pads['D1:2'] === 2, 'D1 A->VOUT=3, K->SW=2');
console.log('ALL PAD CHECKS PASSED');
