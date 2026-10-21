// Backup/snapshot management checks: single delete, clear-all and the
// .foss.json envelope round-trip. Uses an in-memory localStorage.
class MemStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
global.localStorage = new MemStorage();

const P = require('PROJDIR/projects.js');
const assert = (c, m, v) => { if (!c) { console.error('FAIL: ' + m, v ?? ''); process.exit(1); } else console.log('ok: ' + m); };

const board = P.blankBoard('Backup test');
assert(board.project_metadata.design_name === 'Backup test', 'blankBoard names the board');
assert(board.components.length === 0 && board.nets[0].net_name === 'GND', 'blankBoard has no parts and a GND net');

// --- snapshots are capped -------------------------------------------------
const p = { id: 'p1', name: 'Backup test', updatedAt: 1, pcb: board, snaps: [] };
P.putProject(p);
assert(P.getProject('p1')?.name === 'Backup test', 'putProject/getProject round-trip');
assert(P.listProjects().length === 1, 'listProjects returns the saved project');

const many = { ...p, snaps: Array.from({ length: 25 }, (_, i) => ({ t: i + 1, pcb: board })) };
const capped = P.snapshot(many);
assert(capped.snaps.length === 20, 'snapshot caps history at 20', capped.snaps.length);
assert(capped.snaps[0].t > 25, 'snapshot prepends a fresh entry', capped.snaps[0].t);

// --- delete one backup ----------------------------------------------------
P.putProject({ ...p, snaps: [{ t: 101, pcb: board }, { t: 102, pcb: board }, { t: 103, pcb: board }] });
assert(P.deleteSnapshot('p1', 102) === true, 'deleteSnapshot removes an existing backup');
const afterOne = P.getProject('p1').snaps.map((s) => s.t);
assert(JSON.stringify(afterOne) === '[101,103]', 'only the selected backup is deleted', JSON.stringify(afterOne));
assert(P.deleteSnapshot('p1', 999) === false, 'deleteSnapshot reports a missing snapshot');
assert(P.deleteSnapshot('nope', 101) === false, 'deleteSnapshot reports a missing project');
assert(P.getProject('p1').snaps.length === 2, 'failed deletes leave the history intact');

// The board itself is never touched by backup deletion.
assert(JSON.stringify(P.getProject('p1').pcb) === JSON.stringify(board), 'deleteSnapshot does not modify the board');

// --- clear all backups ----------------------------------------------------
assert(P.clearSnapshots('p1') === true, 'clearSnapshots succeeds');
assert(P.getProject('p1').snaps.length === 0, 'clearSnapshots empties the history');
assert(P.clearSnapshots('p1') === true, 'clearSnapshots is idempotent');
assert(P.clearSnapshots('nope') === false, 'clearSnapshots reports a missing project');
assert(JSON.stringify(P.getProject('p1').pcb) === JSON.stringify(board), 'clearSnapshots does not modify the board');

// --- .foss.json envelope ---------------------------------------------------
P.putProject({ ...p, snaps: [{ t: 200, pcb: board }] });
const text = P.toFileText(P.getProject('p1'));
const env = JSON.parse(text);
assert(env.app === 'foss-pcb' && env.version === 1 && env.pcb, 'toFileText writes the {app, version, pcb} envelope', Object.keys(env).join(','));
const round = P.parseProjectFile(text, 'fallback');
assert(round.name === 'Backup test' && round.pcb.nets[0].net_name === 'GND', 'parseProjectFile round-trips the envelope');
assert(round.snaps.length === 1, 'imports start a fresh single-snapshot history', round.snaps.length);
const bare = P.parseProjectFile(JSON.stringify(board), 'bare-name');
assert(bare.name === 'Backup test', 'parseProjectFile accepts a bare board');
assert(P.parseProjectFile(JSON.stringify(board), 'x').pcb.components.length === 0, 'bare board parses');

// --- project deletion also discards its backups ----------------------------
P.deleteProject('p1');
assert(P.getProject('p1') === null, 'deleteProject removes the project and its backups');
assert(P.listProjects().length === 0, 'listProjects is empty afterwards');

console.log('ALL BACKUP CHECKS PASSED');
