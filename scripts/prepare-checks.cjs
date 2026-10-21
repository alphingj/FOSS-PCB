// Rewrite a *check.cjs placeholder dir (SIMDIR/ROUTEDIR/PDIR/SDIR/RDIR)
// to a real compiled-output dir. Usage:
//   node scripts/prepare-checks.cjs <src.cjs> <outDir> <outFile>
const fs = require('fs');

const [src, outDir, outFile] = process.argv.slice(2);
if (!src || !outDir || !outFile) {
  console.error('usage: prepare-checks.cjs <src.cjs> <outDir> <outFile>');
  process.exit(2);
}
let c = fs.readFileSync(src, 'utf8');
for (const ph of ['SIMDIR', 'ROUTEDIR', 'PDIR', 'SDIR', 'RDIR', 'FDIR', 'LDIR', 'VDIR', 'PGDIR', 'CATDIR', 'PROJDIR']) {
  c = c.split(ph).join(outDir);
}
fs.writeFileSync(outFile, c);
console.log(`wrote ${outFile}`);
