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
