const { generateKicadSymbol, generateKicadFootprint, landPads, padTable } = require('PGDIR/partgen.js');
const { parsePartSpec, diffPartSpecs, partgenRefineRequest } = require('PGDIR/partgen-prompt.js');

const assert = (c, m, v) => { if (!c) { console.error('FAIL: ' + m, v ?? ''); process.exit(1); } else console.log('ok: ' + m); };
const balanced = (s, label) => {
  let d = 0, min = 0;
  for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (d < min) min = d; }
  assert(d === 0 && min >= 0, `${label} balanced parens`, `depth=${d} min=${min}`);
};

// --- SOIC-8 with a verified pinout (TI UC3843: VCC=7 OUT=6 FB=2 GND=5) ---
const soic8 = {
  mpn: 'UC3843BD1',
  description: 'Current-mode PWM controller',
  pins: [
    { number: 1, name: 'COMP', type: 'output' },
    { number: 2, name: 'FB', type: 'input' },
    { number: 3, name: 'ISENSE', type: 'input' },
    { number: 4, name: 'RT/CT', type: 'passive' },
    { number: 5, name: 'GND', type: 'power_in' },
    { number: 6, name: 'OUT', type: 'output' },
    { number: 7, name: 'VCC', type: 'power_in' },
    { number: 8, name: 'VREF', type: 'output' },
  ],
  pkg: { name: 'SOIC-8', rows: 2, pinsPerRow: 4, pitch: 1.27, rowSpan: 5.4, bodyWidth: 3.9, bodyLength: 4.9, leadWidth: 0.4, leadLength: 0.6 },
};

const sym = generateKicadSymbol(soic8);
const mod = generateKicadFootprint(soic8);
balanced(sym, 'symbol');
balanced(mod, 'footprint');
assert(sym.includes('(kicad_symbol_lib'), 'symbol header');
assert(mod.includes('(footprint "SOIC-8"'), 'footprint header');
assert(sym.includes('(pin input line'), 'symbol has input pins');
assert(sym.includes('(pin power_in line'), 'symbol has power pins');
assert(sym.includes('(name "VCC"'), 'symbol pin name VCC');
assert(sym.includes('(number "7"'), 'symbol pin number 7');
assert(mod.includes('(pad "1" smd rect'), 'footprint pad 1');
assert(mod.includes('(pad "8" smd rect'), 'footprint pad 8');
assert(mod.includes('(attr smd)'), 'footprint smd attr');
assert(mod.includes('(layer "F.CrtYd")'), 'footprint courtyard');

// Pad geometry: 8 pads, symmetric about origin, pitch 1.27.
const pads = landPads(soic8.pkg, soic8.pins);
assert(pads.length === 8, '8 pads', pads.length);
const xs = new Set(pads.map((p) => Math.abs(p.dx).toFixed(3)));
assert(xs.size === 1 && [...xs][0] !== '0.000', 'dual-row pads share one row offset', JSON.stringify([...xs]));
const ys = [...new Set(pads.map((p) => +p.dy.toFixed(3)))].sort((a, b) => a - b);
assert(Math.abs(ys[0] + ys[ys.length - 1]) < 1e-6, 'pad ys symmetric about 0', JSON.stringify(ys));
const pitch = Math.abs(ys[1] - ys[0]);
assert(Math.abs(pitch - 1.27) < 1e-6, 'pad pitch matches pkg', pitch);
// Pin numbering must run counter-clockwise: 1 top-left, 5 bottom-right, 8 top-right.
const byNum = new Map(pads.map((p) => [p.number, p]));
assert(+byNum.get('1').dy.toFixed(3) === -1.905 && byNum.get('1').dx < 0, 'pin 1 at top-left');
assert(+byNum.get('5').dy.toFixed(3) === 1.905 && byNum.get('5').dx > 0, 'pin 5 at bottom-right');
assert(+byNum.get('8').dy.toFixed(3) === -1.905 && byNum.get('8').dx > 0, 'pin 8 at top-right');
// Courtyard must enclose every pad plus clearance.
const rect = mod.match(/\(fp_rect \(start (-?[\d.]+) (-?[\d.]+)\) \(end (-?[\d.]+) (-?[\d.]+)\)/);
assert(rect, 'footprint has a courtyard rect');
const hw = Math.max(Math.abs(+rect[1]), Math.abs(+rect[3]));
const hl = Math.max(Math.abs(+rect[2]), Math.abs(+rect[4]));
assert(
  pads.every((p) => Math.abs(p.dx) + p.w / 2 <= hw + 1e-6 && Math.abs(p.dy) + p.h / 2 <= hl + 1e-6),
  'courtyard encloses all pads',
  JSON.stringify({ hw, hl }),
);
const table = padTable(soic8);
assert(table.includes('Pad') && table.includes('Size'), 'pad table has header');

// --- SOT-23: two pins on one side, one opposite (not an inline row) ---
const sot = {
  mpn: 'AO3400A',
  description: 'N-MOSFET',
  pins: [
    { number: 1, name: 'G', type: 'input' },
    { number: 2, name: 'S', type: 'power_out' },
    { number: 3, name: 'D', type: 'power_in' },
  ],
  pkg: { name: 'SOT-23', layout: 'sot23', rows: 1, pinsPerRow: 3, pitch: 0.95, rowSpan: 2.4, bodyWidth: 1.3, bodyLength: 2.9, leadWidth: 0.4, leadLength: 0.4 },
};
const sotMod = generateKicadFootprint(sot);
balanced(sotMod, 'SOT-23 footprint');
assert(sotMod.includes('(pad "3" smd rect'), 'SOT-23 pad 3');
const sotPads = landPads(sot.pkg, sot.pins);
assert(sotPads.length === 3, 'SOT-23 has 3 pads');
const sp1 = sotPads.find((p) => p.number === '1');
const sp2 = sotPads.find((p) => p.number === '2');
const sp3 = sotPads.find((p) => p.number === '3');
assert(sp1.dx < 0 && sp2.dx < 0 && sp3.dx > 0, 'SOT-23 two pins on one side, one opposite', JSON.stringify(sotPads));
assert(Math.abs(sp1.dy + 0.475) < 1e-6 && Math.abs(sp2.dy - 0.475) < 1e-6, 'SOT-23 pin pitch 0.95');
assert(Math.abs(sp3.dy) < 1e-6, 'SOT-23 single pin centred');

// --- Unsupported quad package is rejected, never silently mis-generated ---
const quad = {
  mpn: 'STM32F103C8T6',
  pins: [
    { number: 1, name: 'A', type: 'passive' },
    { number: 2, name: 'B', type: 'passive' },
    { number: 3, name: 'C', type: 'passive' },
    { number: 4, name: 'D', type: 'passive' },
  ],
  pkg: { name: 'LQFP-48', layout: 'dual', rows: 2, pinsPerRow: 24, pitch: 0.5, rowSpan: 9, bodyWidth: 7, bodyLength: 7, leadWidth: 0.3, leadLength: 1 },
};
let quadErr = '';
try { generateKicadFootprint(quad); } catch (e) { quadErr = e.message; }
assert(/Unsupported package/.test(quadErr), 'quad package rejected', quadErr);

// --- parsePartSpec: tolerates fenced JSON and rejects garbage ---
const good = parsePartSpec('```json\n' + JSON.stringify(soic8) + '\n```');
assert(good && good.mpn === 'UC3843BD1' && good.pins.length === 8, 'parse fenced JSON');
assert(good && good.pkg.rows === 2 && good.pkg.pitch === 1.27, 'parse package');
assert(good && good.pkg.layout === 'dual', 'parse dual layout');
const sotParsed = parsePartSpec(JSON.stringify(sot));
assert(sotParsed && sotParsed.pkg.layout === 'sot23', 'parse SOT-23 layout');
const legacySot = parsePartSpec(JSON.stringify({ ...sot, pkg: { ...sot.pkg, layout: undefined } }));
assert(legacySot && legacySot.pkg.layout === 'sot23', 'infer SOT-23 layout from package name');
const bad = parsePartSpec('this is not json');
assert(bad === null, 'reject garbage');
const errSpec = parsePartSpec('{"error": "not a datasheet"}');
assert(errSpec === null, 'reject error reply');
const noPins = parsePartSpec('{"mpn": "X", "pkg": {}}');
assert(noPins === null, 'reject missing pins');

// --- Refinement loop: field-level diff + grounded prompt shape ---
const before = JSON.parse(JSON.stringify(soic8));
const after = JSON.parse(JSON.stringify(soic8));
after.pins[3].name = 'GND';
after.pins[3].type = 'power_in';
after.pins.push({ number: 9, name: 'EP', type: 'passive' });
after.pkg.pitch = 1.27; // unchanged
after.pkg.bodyWidth = 3.9; // unchanged
const delta = diffPartSpecs(before, after);
assert(delta.some((d) => d.includes('Pin 4 name')), 'diff reports a renamed pin', delta);
assert(delta.some((d) => d.includes('Pin 4 type')), 'diff reports a changed pin type');
assert(delta.some((d) => d.includes('Added pin 9')), 'diff reports an added pin');
assert(!delta.some((d) => d.includes('pitch')), 'diff ignores unchanged fields');
assert(diffPartSpecs(before, JSON.parse(JSON.stringify(before))).length === 0, 'identical specs produce no diff');

const removed = JSON.parse(JSON.stringify(before));
removed.pins.pop();
assert(diffPartSpecs(before, removed).some((d) => d.includes('Removed pin')), 'diff reports a removed pin');

const refine = partgenRefineRequest('UC3843BD1', 'datasheet.pdf', before, ' pin 4 is GND ');
assert(refine.user.includes(JSON.stringify(before, null, 2)), 'refine request embeds the previous spec');
assert(refine.user.includes('pin 4 is GND'), 'refine request embeds trimmed feedback');
assert(refine.system.includes('COMPLETE corrected JSON'), 'refine system asks for a complete spec');
assert(refine.system.includes('Never invent'), 'refine system keeps the no-guessing rule');
assert(refine.system.includes('datasheet wins'), 'refine system resolves feedback/datasheet conflicts');

console.log('ALL PARTGEN CHECKS PASSED');