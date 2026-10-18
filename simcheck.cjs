const { parseResistance, parseCapacitance, parseInductance, parseCurrent } = require('SIMDIR/sim/values.js');
const { solveDC, checkFeedback } = require('SIMDIR/sim/mna.js');
const { simulateBuckBoost } = require('SIMDIR/sim/switching.js');
const { SAMPLE_BUCKBOOST } = require('SIMDIR/sample-buckboost.js');

const assert = (c, m, v) => { if (!c) { console.error('FAIL: ' + m, v ?? ''); process.exit(1); } else console.log('ok: ' + m); };
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// value parsing
assert(parseResistance('38.3k') === 38300, 'R 38.3k');
assert(parseResistance('10R') === 10, 'R 10R');
assert(close(parseCapacitance('100uF_25V'), 100e-6), 'C 100uF');
assert(close(parseCapacitance('100nF'), 100e-9), 'C 100nF');
assert(close(parseInductance('47uH_3.5A'), 47e-6), 'L 47uH');
assert(parseCurrent('47uH_3.5A') === 3.5, 'Isat 3.5A');
assert(Number.isNaN(parseResistance('blah')), 'R garbage -> NaN');
assert(parseResistance('4K7') === 4700, 'R 4K7 european');
assert(parseResistance('4R7') === 4.7, 'R 4R7 european');
// Case-sensitive: 'M' = mega, 'm' = milli. Current-sense shunts are 10m.
assert(parseResistance('10m') === 0.01, 'R 10m milliohm', parseResistance('10m'));
assert(parseResistance('10mΩ') === 0.01, 'R 10mΩ milliohm');
assert(parseResistance('10mR') === 0.01, 'R 10mR milliohm');
assert(parseResistance('10M') === 1e7, 'R 10M megaohm');
assert(parseResistance('1M5') === 1.5e6, 'R 1M5 european mega');

// The value must lead the string. An unanchored search returned 603 ohm for
// "100nF 0603", 2.54 ohm for the footprint "2x04_P2.54", and 3400 ohm for
// the part number "AO3400" — all silently wrong.
assert(parseResistance('100nF 0603') !== 603, 'R does not read a trailing package code');
assert(Number.isNaN(parseResistance('2x04_P2.54')), 'R footprint string -> NaN');
assert(Number.isNaN(parseResistance('AO3400')), 'R part number -> NaN');
assert(Number.isNaN(parseResistance('ESP32-WROOM-32-N4')), 'R part number with dashes -> NaN');
assert(parseResistance('10k_0805') === 10000, 'R value then underscore suffix still parses');

// Frequency must not read as farads/henries: 16MHz is a crystal.
assert(Number.isNaN(parseCapacitance('16MHz')), 'C crystal freq -> NaN');
assert(Number.isNaN(parseInductance('16MHz')), 'L crystal freq -> NaN', parseInductance('16MHz'));
assert(Number.isNaN(parseInductance('100V_150mA')), 'L voltage string -> NaN');
// Trailing ratings must not be mistaken for the component value.
assert(close(parseCapacitance('100nF 0603'), 100e-9), 'C value leads, package code ignored');
// Current ratings carry their own multiplier: 150mA is 0.15 A.
assert(close(parseCurrent('100V_150mA'), 0.15), 'I 150mA -> 0.15A', parseCurrent('100V_150mA'));
assert(close(parseCurrent('3.3V_1A'), 1), 'I 1A trailing');
assert(close(parseCapacitance('4n7'), 4.7e-9), 'C 4n7 european nano');

// MNA on demo board: FB divider 38.3k/10k at VOUT=-12 -> |FB| ~ 2.484V
const fb = checkFeedback(SAMPLE_BUCKBOOST, -12);
console.log('fb:', fb.detail);
assert(Math.abs(fb.vfb - 2.484) < 0.01, 'FB divider ~2.484V', fb.vfb);
assert(fb.ok, 'divider regulates (within 5%)');
assert(Math.abs(fb.regulatesAt + 12.08) < 0.15, 'regulates near -12V', fb.regulatesAt);

// switching sim on demo operating point
const sim = simulateBuckBoost({ vin: 12, voutTargetAbs: 12, iout: 1, freqHz: 100000, inductanceH: 47e-6, CoutF: 100e-6 });console.log(`sim: D=${sim.D.toFixed(3)} Ipk=${sim.iPeak.toFixed(2)} Vavg=${sim.vAvgAbs.toFixed(2)} ripple=${(sim.vRipple * 1000).toFixed(0)}mV settled=${sim.settled}`);
assert(sim.valid, 'sim valid');
assert(sim.D > 0.5 && sim.D < 0.56, 'D just above ideal 0.5 (losses)', sim.D);
assert(sim.vAvgAbs === 12, 'Vavg hits target by construction', sim.vAvgAbs);
assert(Math.abs(sim.vRipple - 0.051) < 0.012, 'ripple ~51mV (I·D·T/C)', sim.vRipple);
assert(Math.abs(sim.iPeak - 2.69) < 0.25, 'Ipk ~2.7A', sim.iPeak);
assert(sim.settled, 'settled flag');
assert(sim.iWave.length === 200 && sim.vWave.length === 200, 'waveform length');
const div0 = simulateBuckBoost({ vin: 12, voutTargetAbs: 12, iout: 1, freqHz: 0, inductanceH: 47e-6, CoutF: 100e-6 });
assert(!div0.valid, 'zero freq invalid');
console.log('ALL SIM CHECKS PASSED');
