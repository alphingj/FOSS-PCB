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
assert(pads.length === 16, '16 SOIC pads (2x8)', pads.length);
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
console.log('ALL PAD CHECKS PASSED');
