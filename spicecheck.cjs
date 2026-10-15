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
assert(nl.includes('.tran') && nl.endsWith('.end'), 'tran + end');
assert(!nl.includes('NaN') && !nl.includes('undefined'), 'no NaN/undefined leak');
console.log('ALL SPICE CHECKS PASSED');
