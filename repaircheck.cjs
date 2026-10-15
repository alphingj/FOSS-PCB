const { validationErrors, repairPrompt } = require('RDIR/repair.js');
const { SAMPLE_BUCKBOOST } = require('RDIR/sample-buckboost.js');

const assert = (c, m, v) => { if (!c) { console.error('FAIL: ' + m, v ?? ''); process.exit(1); } else console.log('ok: ' + m); };

assert(validationErrors(SAMPLE_BUCKBOOST).length === 0, 'demo board validates clean');

const broken = JSON.parse(JSON.stringify(SAMPLE_BUCKBOOST));
broken.nets = broken.nets.filter((n) => n.net_name !== 'GND');
const errs = validationErrors(broken);
assert(errs.some((e) => e.includes('Missing GND')), 'missing GND reported', JSON.stringify(errs));

const rp = repairPrompt('build a buck', errs.slice(0, 8));
assert(rp.includes('build a buck') && rp.includes('Missing GND') && rp.includes('FULL three sections'), 'repair prompt shape');
console.log('ALL REPAIR CHECKS PASSED');
