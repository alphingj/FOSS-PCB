// CLI checks: runs the compiled command as a user would and asserts exit codes,
// JSON/human output, DRC failure signalling and KiCad export. No network.
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = __dirname;
const CLI = path.join(ROOT, 'cli', 'dist', 'cli', 'cli.js');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const assert = (c, m, v) => { if (!c) { console.error('FAIL: ' + m, v ?? ''); process.exit(1); } else console.log('ok: ' + m); };

if (!fs.existsSync(CLI)) {
  console.log('cli/dist missing — building once…');
  const b = spawnSync('npm', ['run', 'cli:build'], { cwd: ROOT, shell: true, encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stdout, b.stderr); process.exit(1); }
}

// Run with a sanitised environment so a developer's keys can't make tests pass.
const cleanEnv = { ...process.env };
for (const k of ['MOUSER_API_KEY', 'DIGIKEY_CLIENT_ID', 'DIGIKEY_CLIENT_SECRET']) delete cleanEnv[k];

function run(args, opts = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8', env: cleanEnv, ...opts });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'foss-cli-'));
const demo = path.join(tmp, 'demo.foss.json');

try {
  // --- basics ---
  const ver = run(['--version']);
  assert(ver.code === 0 && ver.out.trim() === PKG.version, '--version matches package.json', JSON.stringify(ver));
  const help = run(['--help']);
  assert(help.code === 0 && help.out.includes('export-kicad') && help.out.includes('MOUSER_API_KEY'), '--help documents commands and key env vars');

  // --- offline library search ---
  const search = run(['search', '10k', '--json']);
  const sj = JSON.parse(search.out);
  assert(search.code === 0 && sj.provider === 'library' && sj.count === 1, 'library search returns one JSON match', search.out);
  assert(sj.parts[0].mpn === 'RC0805FR-0710KL' && sj.parts[0].lcsc === 'C84376', 'library search maps MPN + verified LCSC', JSON.stringify(sj.parts[0]));

  const byCode = JSON.parse(run(['search', 'C7593', '--json']).out);
  assert(byCode.parts.some((p) => p.mpn === 'NE555DR'), 'library search matches an LCSC code');

  const human = run(['search', '10k']);
  assert(human.code === 0 && human.out.includes('MPN') && human.out.includes('RC0805FR-0710KL'), 'human search table renders');

  const none = JSON.parse(run(['search', 'zzz-not-a-part', '--json']).out);
  assert(none.count === 0, 'no-match search is not an error', JSON.stringify(none));

  const noQuery = run(['search']);
  assert(noQuery.code === 2 && /Usage: foss-pcb search/.test(noQuery.err), 'search without a query exits 2', JSON.stringify(noQuery));

  // --- live search guards (no keys configured) ---
  const lcscLive = run(['search', 'NE555', '--live', '--provider', 'lcsc']);
  assert(lcscLive.code === 2 && /LCSC has no public API/.test(lcscLive.err), 'LCSC live search refuses honestly', lcscLive.err);

  const noKey = run(['search', 'NE555', '--live', '--provider', 'mouser']);
  assert(noKey.code === 2 && /MOUSER_API_KEY/.test(noKey.err), 'missing Mouser key is explained', noKey.err);

  const dkNoKey = run(['search', 'NE555', '--live', '--provider', 'digikey']);
  assert(dkNoKey.code === 2 && /DIGIKEY_CLIENT_ID/.test(dkNoKey.err), 'missing DigiKey credentials are explained', dkNoKey.err);

  const badLive = run(['search', 'NE555', '--live']);
  assert(badLive.code === 2 && /--provider/.test(badLive.err), '--live without a provider exits 2', badLive.err);

  // --- demo + DRC ---
  const demoRun = run(['demo', '--out', demo]);
  assert(demoRun.code === 0 && fs.existsSync(demo), 'demo writes a project file', demoRun);

  const envelope = JSON.parse(fs.readFileSync(demo, 'utf8'));
  assert(envelope.app === 'foss-pcb' && envelope.pcb && envelope.pcb.components.length === 11, 'demo file is a .foss.json envelope', JSON.stringify(Object.keys(envelope)));

  const drc = run(['drc', demo]);
  assert(drc.code === 0 && /0 errors/.test(drc.out), 'clean demo passes DRC', drc.out);

  const drcJson = JSON.parse(run(['drc', demo, '--json']).out);
  assert(drcJson.errors === 0 && Array.isArray(drcJson.issues), 'DRC --json reports counts + issues', JSON.stringify(drcJson).slice(0, 120));

  // Move a component off the board: DRC must fail with exit 1 and name the error.
  const brokenPath = path.join(tmp, 'broken.foss.json');
  const broken = JSON.parse(JSON.stringify(envelope));
  broken.pcb.components[0].pcb_placement_mm.x = -10;
  fs.writeFileSync(brokenPath, JSON.stringify(broken));
  const brokenRun = run(['drc', brokenPath, '--json']);
  const brokenJson = JSON.parse(brokenRun.out);
  assert(brokenRun.code === 1 && brokenJson.errors >= 1, 'off-board component makes DRC exit 1', JSON.stringify({ code: brokenRun.code, errors: brokenJson.errors }));
  assert(brokenJson.issues.some((i) => i.severity === 'error' && /bounds/i.test(i.message)), 'DRC error names the bounds violation', JSON.stringify(brokenJson.issues));

  // --- KiCad export ---
  const kicad = path.join(tmp, 'out.kicad_pcb');
  const ex = run(['export-kicad', demo, '--out', kicad]);
  assert(ex.code === 0 && fs.existsSync(kicad), 'export-kicad writes a file', ex.out);
  const kicadText = fs.readFileSync(kicad, 'utf8');
  assert(kicadText.startsWith('(kicad_pcb'), 'exported file is a .kicad_pcb s-expression');
  assert((kicadText.match(/\(footprint "/g) || []).length === 11, 'exported file contains every component', (kicadText.match(/\(footprint "/g) || []).length);

  const stdoutRun = run(['export-kicad', demo, '--stdout']);
  assert(stdoutRun.code === 0 && stdoutRun.out.startsWith('(kicad_pcb'), '--stdout streams the board', stdoutRun.out.slice(0, 20));

  // --- input errors ---
  const missing = run(['drc', path.join(tmp, 'nope.json')]);
  assert(missing.code === 2 && /File not found/.test(missing.err), 'missing file exits 2', missing.err);

  const notJson = path.join(tmp, 'bad.json');
  fs.writeFileSync(notJson, '{not json');
  const bad = run(['drc', notJson]);
  assert(bad.code === 2 && /is not JSON/.test(bad.err), 'invalid JSON exits 2', bad.err);

  const notBoard = path.join(tmp, 'not-board.json');
  fs.writeFileSync(notBoard, JSON.stringify({ hello: 'world' }));
  const nb = run(['drc', notBoard]);
  assert(nb.code === 2 && /not a valid FOSS board/.test(nb.err), 'wrong schema exits 2 with field details', nb.err);

  const drcUsage = run(['drc']);
  assert(drcUsage.code === 2 && /Usage: foss-pcb drc/.test(drcUsage.err), 'drc without a file exits 2', drcUsage.err);

  const unknown = run(['frobnicate']);
  assert(unknown.code === 2 && /Unknown command/.test(unknown.err), 'unknown command exits 2', unknown.err);

  console.log('ALL CLI CHECKS PASSED');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
