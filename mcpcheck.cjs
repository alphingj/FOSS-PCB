// MCP server checks: real stdio JSON-RPC handshake, tool discovery and every
// exposed tool, including failure paths. No network (live search is only
// checked for its missing-key message).
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const ROOT = __dirname;
const SERVER = path.join(ROOT, 'mcp', 'dist', 'mcp', 'server.js');

const assert = (c, m, v) => {
  if (!c) {
    console.error('FAIL: ' + m, v ?? '');
    process.exit(1);
  }
  console.log('ok: ' + m);
};

if (!fs.existsSync(SERVER)) {
  console.log('mcp/dist missing — building once…');
  const b = spawnSync('npm', ['run', 'mcp:build'], { cwd: ROOT, shell: true, encoding: 'utf8' });
  if (b.status !== 0) {
    console.error(b.stdout, b.stderr);
    process.exit(1);
  }
}

const cleanEnv = { ...process.env };
for (const k of ['MOUSER_API_KEY', 'DIGIKEY_CLIENT_ID', 'DIGIKEY_CLIENT_SECRET']) delete cleanEnv[k];

const child = spawn(process.execPath, [SERVER], { cwd: ROOT, env: cleanEnv, stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '';
child.stderr.on('data', (d) => { stderr += d.toString(); });

const pending = new Map();
let nextId = 1;
let badLine = null;
const idless = [];

const rl = readline.createInterface({ input: child.stdout });
rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    badLine = line;
    return;
  }
  if (!('id' in msg)) { idless.push(msg); return; }
  const p = pending.get(msg.id);
  if (!p) { idless.push(msg); return; }
  pending.delete(msg.id);
  clearTimeout(p.timer);
  p.resolve(msg);
});

function writeRaw(line) { child.stdin.write(line + '\n'); }

function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout waiting for ${method}`));
    }, 15000);
    pending.set(id, { resolve, reject, timer });
    writeRaw(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }));
  });
}

async function callTool(name, args) {
  return request('tools/call', { name, arguments: args });
}

const textOf = (res) => (res.result.content || []).map((c) => c.text).join('\n');
const isErr = (res) => res.result.isError === true;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // --- handshake -----------------------------------------------------------
  const init = await request('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'mcpcheck', version: '1.0.0' },
  });
  assert(init.result.protocolVersion === '2025-03-26', 'initialize echoes a supported protocol version', init.result.protocolVersion);
  assert(init.result.serverInfo.name === 'foss-pcb', 'server identifies as foss-pcb', JSON.stringify(init.result.serverInfo));
  assert(init.result.capabilities.tools, 'server advertises tool capability');
  assert((init.result.instructions || '').includes('verified'), 'server instructions carry the verified-parts rule');

  writeRaw(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  await sleep(120);
  assert(idless.length === 0, 'initialized notification produces no response', JSON.stringify(idless));

  const unsupported = await request('initialize', { protocolVersion: '1999-01-01', capabilities: {}, clientInfo: { name: 'x', version: '1' } });
  assert(unsupported.result.protocolVersion === '2025-06-18', 'unsupported protocol falls back to the latest', unsupported.result.protocolVersion);

  const ping = await request('ping');
  assert(ping.result && typeof ping.result === 'object', 'ping answers with an empty result');

  // --- discovery -----------------------------------------------------------
  const list = await request('tools/list');
  const names = list.result.tools.map((t) => t.name);
  for (const n of ['library_search', 'board_summary', 'board_drc', 'export_kicad', 'place_part', 'catalog_search'])
    assert(names.includes(n), `tools/list exposes ${n}`);
  assert(list.result.tools.every((t) => t.inputSchema && t.inputSchema.type === 'object' && Array.isArray(t.inputSchema.required)),
    'every tool has an object input schema with required fields');

  // --- library search ------------------------------------------------------
  const search = await callTool('library_search', { query: '10k' });
  const sj = JSON.parse(textOf(search));
  assert(sj.count === 1 && sj.parts[0].mpn === 'RC0805FR-0710KL', 'library_search finds the 10k resistor', textOf(search));
  assert(sj.parts[0].lcsc === 'C84376', 'library_search returns the verified LCSC code');
  assert(Array.isArray(sj.parts[0].pins) && sj.parts[0].pins.length > 0, 'library_search returns pin labels');

  const missingQuery = await callTool('library_search', {});
  assert(isErr(missingQuery) && /query/.test(textOf(missingQuery)), 'missing query is a tool error', textOf(missingQuery));

  const badLimit = await callTool('library_search', { query: '10k', limit: 'nope' });
  assert(isErr(badLimit), 'non-numeric limit is a tool error', textOf(badLimit));

  // --- board tools ---------------------------------------------------------
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'foss-mcp-'));
  const boardPath = path.join(tmp, 'board.foss.json');
  const board = {
    project_metadata: {
      design_name: 'MCP test',
      revision: '1.0.0',
      topology: '',
      assumed_parameters: {},
      pcb_specifications: {
        board_width_mm: 50,
        board_height_mm: 35,
        layers: 2,
        copper_weight_oz: 1,
        surface_finish: 'HASL_Lead_Free',
      },
    },
    components: [],
    nets: [{ net_name: 'GND', nodes: [], trace_width_mm: 2, clearance_mm: 0.3, routing_type: 'Solid_Bottom_Ground_Plane' }],
    schematic_wires: [],
    pcb_traces: [],
    pcb_layout_zones: [],
  };
  fs.writeFileSync(boardPath, JSON.stringify(board, null, 2));

  const summary = await callTool('board_summary', { board: boardPath });
  const sumj = JSON.parse(textOf(summary));
  assert(sumj.name === 'MCP test' && sumj.counts.components === 0 && sumj.counts.nets === 1, 'board_summary reads metadata/counts', textOf(summary));
  assert(sumj.board_mm.width === 50 && sumj.board_mm.height === 35, 'board_summary reports board size');

  const drc = await callTool('board_drc', { board: boardPath });
  const drcj = JSON.parse(textOf(drc));
  assert(drcj.ok === true && drcj.errors === 0, 'empty board passes DRC', textOf(drc));

  // Placement writes a new file and mirrors the app (pins on GND).
  const placed = path.join(tmp, 'placed.foss.json');
  const place = await callTool('place_part', { board: boardPath, mpn: 'RC0805FR-0710KL', x: 20, y: 15, out: placed });
  const pj = JSON.parse(textOf(place));
  assert(!isErr(place) && pj.designator === 'R1', 'place_part assigns R1', textOf(place));
  assert(fs.existsSync(placed), 'place_part writes the output file');
  const placedBoard = JSON.parse(fs.readFileSync(placed, 'utf8'));
  assert(placedBoard.components.length === 1 && placedBoard.components[0].mpn === 'RC0805FR-0710KL', 'placed part is in the output board');
  assert(placedBoard.components[0].pins['1'] === 'GND' && placedBoard.components[0].pins['2'] === 'GND', 'placed pins start on GND');
  assert(placedBoard.components[0].pcb_placement_mm.x === 20 && placedBoard.components[0].pcb_placement_mm.y === 15, 'placement coordinates are honoured');

  const placeDrc = await callTool('board_drc', { board: placed });
  const placeDrcj = JSON.parse(textOf(placeDrc));
  assert(placeDrcj.ok === true, 'placed board still passes DRC', textOf(placeDrc));

  const collide = await callTool('place_part', { board: placed, mpn: 'RC0805FR-0710KL', x: 30, y: 20, out: path.join(tmp, 'x.foss.json'), designator: 'R1' });
  assert(isErr(collide) && /already exists/.test(textOf(collide)), 'duplicate designator is refused', textOf(collide));

  const unknown = await callTool('place_part', { board: boardPath, mpn: 'NOT-A-PART', x: 10, y: 10, out: path.join(tmp, 'y.foss.json') });
  assert(isErr(unknown) && /Unknown MPN/.test(textOf(unknown)) && /library_search/.test(textOf(unknown)), 'unknown MPN points to library_search', textOf(unknown));

  const offBoard = await callTool('place_part', { board: boardPath, mpn: 'RC0805FR-0710KL', x: -1, y: 10, out: path.join(tmp, 'z.foss.json') });
  assert(isErr(offBoard) && /outside/.test(textOf(offBoard)), 'off-board placement is refused', textOf(offBoard));

  const overwrite = await callTool('place_part', { board: boardPath, mpn: 'RC0805FR-0710KL', x: 10, y: 10, out: boardPath });
  assert(isErr(overwrite) && /Refusing to overwrite/.test(textOf(overwrite)), 'place_part never overwrites its input', textOf(overwrite));

  // --- export --------------------------------------------------------------
  const kicadPath = path.join(tmp, 'mcp.kicad_pcb');
  const exp = await callTool('export_kicad', { board: placed, out: kicadPath });
  const ej = JSON.parse(textOf(exp));
  assert(!isErr(exp) && fs.existsSync(kicadPath) && ej.components === 1, 'export_kicad writes the board', textOf(exp));
  assert(fs.readFileSync(kicadPath, 'utf8').startsWith('(kicad_pcb'), 'export_kicad output is a .kicad_pcb s-expression');

  const badBoard = await callTool('board_summary', { board: path.join(tmp, 'missing.json') });
  assert(isErr(badBoard) && /File not found/.test(textOf(badBoard)), 'missing board is a readable tool error', textOf(badBoard));

  // --- catalog guard -------------------------------------------------------
  const cat = await callTool('catalog_search', { query: 'NE555', provider: 'mouser' });
  assert(isErr(cat) && /MOUSER_API_KEY/.test(textOf(cat)), 'catalog_search explains the missing key', textOf(cat));

  const catLcsc = await callTool('catalog_search', { query: 'NE555', provider: 'lcsc' });
  assert(isErr(catLcsc) && /mouser/.test(textOf(catLcsc)), 'catalog_search refuses an unsupported provider', textOf(catLcsc));

  // --- protocol errors -----------------------------------------------------
  const unknownTool = await callTool('nope', {});
  assert(unknownTool.error && unknownTool.error.code === -32602, 'unknown tool is a JSON-RPC -32602', JSON.stringify(unknownTool));

  const unknownMethod = await request('resources/list');
  assert(unknownMethod.error && unknownMethod.error.code === -32601, 'unknown method is a JSON-RPC -32601', JSON.stringify(unknownMethod));

  writeRaw('{not json');
  const parseErr = await new Promise((resolve) => {
    const check = setInterval(() => {
      const m = idless.find((x) => x.error && x.error.code === -32700);
      if (m) { clearInterval(check); resolve(m); }
    }, 50);
    setTimeout(() => { clearInterval(check); resolve(null); }, 2000);
  });
  assert(parseErr && parseErr.id === null, 'malformed JSON is a -32700 with a null id', JSON.stringify(parseErr));

  assert(badLine === null, 'server stdout contains only JSON-RPC messages', badLine);

  if (process.env.FOSS_MCP_KEEP === '1') console.log('kept temp dir: ' + tmp);
  else fs.rmSync(tmp, { recursive: true, force: true });

  // --- shutdown ------------------------------------------------------------
  child.stdin.end();
  const code = await new Promise((resolve) => {
    const t = setTimeout(() => resolve('timeout'), 5000);
    child.on('exit', (c) => { clearTimeout(t); resolve(c); });
  });
  assert(code === 0, 'server exits 0 when stdin closes', code);
  if (code !== 0) console.error(stderr);

  console.log('ALL MCP CHECKS PASSED');
}

main().catch((e) => {
  console.error('FAIL:', e && e.stack ? e.stack : e);
  console.error(stderr);
  try { child.kill(); } catch {}
  process.exit(1);
});
