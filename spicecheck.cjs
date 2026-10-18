const { fossToSpiceNetlist } = require('SDIR/spice.js');
const { SAMPLE_BUCKBOOST } = require('SDIR/sample-buckboost.js');

const assert = (c, m, v) => { if (!c) { console.error('FAIL: ' + m, v ?? ''); process.exit(1); } else console.log('ok: ' + m); };

const nl = fossToSpiceNetlist(SAMPLE_BUCKBOOST, { vin: 12, freqHz: 100000, duty: 0.5, tStop: 0.002 });
console.log(nl.split('\n').slice(0, 14).join('\n'));
assert(nl.includes('VIN VIN 0 DC 12'), 'VIN source');
assert(/RR1\s+\S+\s+\S+\s+38300/.test(nl), 'R1 38.3k mapped');
assert(/LL1\s+\S+\s+\S+\s+4\.7e-5|0\.000047/.test(nl), 'L1 47uH mapped', nl.split('\n').find((l) => l.startsWith('LL1')));
assert(/DD1\s+\S+\s+\S+\s+DSCHOTTKY/.test(nl), 'D1 schottky model');
assert(/MQ1\s+\S+\s+\S+\s+\S+\s+\S+\s+MPOWER/.test(nl), 'Q1 power mosfet');
assert(nl.includes('IDEALIZED') && nl.includes('PULSE'), 'PWM controller idealized as pulse');
assert(nl.includes('.model DSCHOTTKY') && nl.includes('.model MPOWER'), 'default models present');

// Duty must track the solved operating point, not a hardcoded 0.5. The Lab
// bench and the fab export share benchParams()/simulateBuckBoost() so the
// netlist drives the converter where the app says it will run.
const { simulateBuckBoost, benchParams } = require('SDIR/sim/switching.js');
const p = benchParams(SAMPLE_BUCKBOOST);
const sim = simulateBuckBoost({
  vin: p.vin, voutTargetAbs: p.voutAbs, iout: p.iout, freqHz: p.freqHz,
  inductanceH: p.inductanceH, CoutF: p.coutF,
});
assert(sim.valid, 'demo bench solves', JSON.stringify(sim.warnings));
assert(sim.D > 0 && sim.D < 1, 'solved duty in range', sim.D);
const nl2 = fossToSpiceNetlist(SAMPLE_BUCKBOOST, { vin: p.vin, freqHz: p.freqHz, duty: sim.D, tStop: 0.002 });
const per = 1 / p.freqHz;
const pulse = nl2.match(/PULSE\([^)]*\)/);
assert(pulse, 'PULSE source present');
// PULSE(V1 V2 TD TR TF PW PER) — on-time and period are the last two numbers.
const nums = pulse[0].match(/[\d.]+e?-?\d*/gi).map(Number);
const onTime = nums[nums.length - 2], period = nums[nums.length - 1];
assert(Math.abs(onTime / period - sim.D) < 1e-3, 'netlist pulse duty matches solved D', `${onTime / period} vs ${sim.D}`);
assert(Math.abs(period - per) / per < 1e-6, 'netlist period matches switching frequency');
assert(Math.abs(onTime / period - 0.5) > 1e-6, 'netlist is not stuck at 50% duty', String(onTime / period));
assert(nl.includes('.tran') && nl.endsWith('.end'), 'tran + end');
assert(!nl.includes('NaN') && !nl.includes('undefined'), 'no NaN/undefined leak');
console.log('ALL SPICE CHECKS PASSED');
