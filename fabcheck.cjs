const { fabFiles } = require('FDIR/fab.js');
const { SAMPLE_BUCKBOOST } = require('FDIR/sample-buckboost.js');

const assert = (c, m, v) => { if (!c) { console.error('FAIL: ' + m, v ?? ''); process.exit(1); } else console.log('ok: ' + m); };

const files = fabFiles(SAMPLE_BUCKBOOST);
const gtl = files.find((f) => f.name.endsWith('.gtl')).text;
// RS-274X 4.6: every X/Y coordinate is exactly 4+6 = 10 digits
const coords = [...gtl.matchAll(/X(\d+)Y(\d+)D0[12]/g)];
assert(coords.length > 0, 'coords present');
const bad = coords.filter((m) => m[1].length !== 10 || m[2].length !== 10);
assert(bad.length === 0, 'all coords 10 digits', JSON.stringify(bad.slice(0, 2)));
const drl = files.find((f) => f.name.endsWith('.drl')).text;
assert(drl.includes('METRIC,TZ,000.000'), 'excellon format header');
assert(files.find((f) => f.name.endsWith('-CPL.csv')).text.split('\n').length === SAMPLE_BUCKBOOST.components.length + 1, 'cpl rows');
console.log('ALL FAB CHECKS PASSED');
