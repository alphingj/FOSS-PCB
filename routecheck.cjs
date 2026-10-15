const { bfsRoute, simplify, segSegDist } = require('ROUTEDIR/routing.js');
const { runDrc } = require('ROUTEDIR/drc.js');

const assert = (c, m, v) => { if (!c) { console.error('FAIL: ' + m, v ?? ''); process.exit(1); } else console.log('ok: ' + m); };

// 45° native: diagonal across empty board simplifies to a single segment
const diag = simplify(bfsRoute(50, 35, { x: 5, y: 5 }, { x: 9, y: 9 }));
assert(diag.length === 2, 'diagonal simplifies to 2 pts', JSON.stringify(diag));
assert(diag[0].x === 5 && diag[1].x === 9, 'diagonal endpoints kept');

// blocked column forces a detour around it
const blocked = [];
for (let y = 4; y <= 6; y++) blocked.push({ x: 7, y });
const detour = bfsRoute(50, 35, { x: 5, y: 5 }, { x: 9, y: 5 }, blocked);
assert(detour.some((p) => Math.abs(p.y - 5) > 0.5), 'detour leaves the blocked row');
assert(detour.every((p) => !(Math.abs(p.x - 7) < 0.5 && p.y >= 4 && p.y <= 6)), 'detour avoids blocked cells');

// L-shape is preserved by simplify
const ell = simplify([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }]);
assert(ell.length === 3, 'L-shape kept');

// geometry primitives
assert(segSegDist({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 1 }, { x: 4, y: 1 }) === 1, 'parallel = 1mm');
assert(segSegDist({ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 }) === 0, 'crossing = 0');

// DRC: overlapping different-net traces violate clearance
const board = {
  project_metadata: { design_name: 't', revision: '1', topology: '', assumed_parameters: {}, pcb_specifications: { board_width_mm: 50, board_height_mm: 35, layers: 2, copper_weight_oz: 1, surface_finish: 'x' } },
  components: [],
  nets: [
    { net_name: 'GND', nodes: [], trace_width_mm: 2, clearance_mm: 0.3, routing_type: '' },
    { net_name: 'A', nodes: [], trace_width_mm: 0.25, clearance_mm: 0.2, routing_type: '' },
    { net_name: 'B', nodes: [], trace_width_mm: 0.25, clearance_mm: 0.2, routing_type: '' },
  ],
  schematic_wires: [],
  pcb_traces: [
    { id: 't1', net: 'A', layer: 'Top', pts_mm: [[10, 10], [20, 10]], width_mm: 0.25 },
    { id: 't2', net: 'B', layer: 'Top', pts_mm: [[10, 10.1], [20, 10.1]], width_mm: 0.25 },
  ],
  pcb_layout_zones: [],
};
const iss = runDrc(board);
assert(iss.some((i) => i.severity === 'error' && i.message.includes('clearance')), 'overlap flagged', JSON.stringify(iss));

// DRC: same geometry on one net is fine (minus the pre-existing net errors)
const board2 = { ...board, pcb_traces: board.pcb_traces.map((t) => ({ ...t, net: 'A' })) };
const iss2 = runDrc(board2);
assert(!iss2.some((i) => i.message.includes('clearance')), 'same-net overlap not flagged');

// DRC: off-board trace point flagged
const board3 = { ...board, pcb_traces: [{ id: 't9', net: 'A', layer: 'Top', pts_mm: [[10, 10], [60, 10]], width_mm: 0.25 }] };
assert(runDrc(board3).some((i) => i.message.includes('leaves the board')), 'off-board flagged');
console.log('ALL ROUTE/DRC CHECKS PASSED');
