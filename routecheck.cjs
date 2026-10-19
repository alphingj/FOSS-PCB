const { bfsRoute, simplify, segSegDist, tryRoute, ripupAutoroute } = require('ROUTEDIR/routing.js');
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

// DRC: trace through a foreign body flagged; same-net body exempt
const part = (pins) => ({ designator: 'R99', type: 'Resistor', value: '10k', mpn: '', footprint: 'R_0805_2012Metric', pins, schematic_pos: { x: 0, y: 0, rotation: 0 }, pcb_placement_mm: { x: 10, y: 10, rotation: 0, layer: 'Top' } });
const thru = [{ id: 'tb', net: 'B', layer: 'Top', pts_mm: [[5, 10], [15, 10]], width_mm: 0.25 }];
const board4 = { ...board, components: [part({ 1: 'X', 2: 'Y' })], pcb_traces: thru };
assert(runDrc(board4).some((i) => i.message.includes('R99')), 'foreign body proximity flagged');
const board5 = { ...board, components: [part({ 1: 'B', 2: 'B' })], pcb_traces: thru };
assert(!runDrc(board5).some((i) => i.message.includes('R99')), 'same-net body exempt');
// DRC: duplicate designators flagged
const dup = { ...board, components: [
  { designator: 'R1', type: 'Resistor', value: '10k', mpn: '', footprint: 'R_0805_2012Metric', pins: {}, schematic_pos: { x: 0, y: 0, rotation: 0 }, pcb_placement_mm: { x: 5, y: 5, rotation: 0, layer: 'Top' } },
  { designator: 'R1', type: 'Resistor', value: '10k', mpn: '', footprint: 'R_0805_2012Metric', pins: {}, schematic_pos: { x: 0, y: 0, rotation: 0 }, pcb_placement_mm: { x: 8, y: 5, rotation: 0, layer: 'Top' } },
] };
assert(runDrc(dup).some((i) => i.message.includes('Duplicate designator R1')), 'duplicate designator flagged');

// DRC: zone out of board bounds flagged
const zOOB = { ...board, pcb_layout_zones: [
  { zone_name: 'Z1', net: 'GND', layer: 'Top', bounding_box_mm: { x1: -5, y1: 0, x2: 55, y2: 10 }, rule: 'x' },
] };
assert(runDrc(zOOB).some((i) => i.message.includes('leaves board bounds')), 'zone out of bounds flagged');

// DRC: different-net trace through zone flagged
const zTrace = { ...board, pcb_layout_zones: [
  { zone_name: 'Z1', net: 'GND', layer: 'Top', bounding_box_mm: { x1: 10, y1: 10, x2: 20, y2: 20 }, rule: 'x' },
], pcb_traces: [
  { id: 'zt', net: 'A', layer: 'Top', pts_mm: [[12, 12], [18, 18]], width_mm: 0.25 },
] };
assert(runDrc(zTrace).some((i) => i.message.includes('too close to trace')), 'zone vs trace clearance flagged');

// DRC: same-net trace through zone is fine
const zTraceSame = { ...board, pcb_layout_zones: [
  { zone_name: 'Z1', net: 'GND', layer: 'Top', bounding_box_mm: { x1: 10, y1: 10, x2: 20, y2: 20 }, rule: 'x' },
], pcb_traces: [
  { id: 'zts', net: 'GND', layer: 'Top', pts_mm: [[12, 12], [18, 18]], width_mm: 0.25 },
] };
assert(!runDrc(zTraceSame).some((i) => i.message.includes('too close to trace')), 'same-net trace in zone OK');

// DRC: overlapping different-net zones flagged
const zOverlap = { ...board, pcb_layout_zones: [
  { zone_name: 'Z1', net: 'GND', layer: 'Top', bounding_box_mm: { x1: 0, y1: 0, x2: 10, y2: 10 }, rule: 'x' },
  { zone_name: 'Z2', net: 'A', layer: 'Top', bounding_box_mm: { x1: 5, y1: 5, x2: 15, y2: 15 }, rule: 'x' },
] };
assert(runDrc(zOverlap).some((i) => i.message.includes('overlaps zone')), 'zone overlap flagged');

// DRC: via out of board bounds flagged
const vOOB = { ...board, pcb_vias: [
  { id: 'V9', net: 'GND', x: 60, y: 5, drill_mm: 0.3, pad_mm: 0.6 },
] };
assert(runDrc(vOOB).some((i) => i.message.includes('leaves board bounds')), 'via out of bounds flagged');

// DRC: via too close to a different-net trace flagged
const vTrace = { ...board, pcb_vias: [
  { id: 'V1', net: 'GND', x: 15, y: 10, drill_mm: 0.3, pad_mm: 0.6 },
], pcb_traces: [
  { id: 'vt', net: 'A', layer: 'Top', pts_mm: [[14, 10], [16, 10]], width_mm: 0.25 },
] };
assert(runDrc(vTrace).some((i) => i.message.includes('too close to trace')), 'via vs trace clearance flagged');

// DRC: same-net trace passing through via is fine
const vTraceSame = { ...board, pcb_vias: [
  { id: 'V1', net: 'GND', x: 15, y: 10, drill_mm: 0.3, pad_mm: 0.6 },
], pcb_traces: [
  { id: 'vts', net: 'GND', layer: 'Top', pts_mm: [[14, 10], [16, 10]], width_mm: 0.25 },
] };
assert(!runDrc(vTraceSame).some((i) => i.message.includes('too close to trace')), 'same-net trace at via OK');

// DRC: via too close to a different-net pad flagged (R_0805 pad 2 at x+0.9125)
const vPad = { ...board, pcb_vias: [
  { id: 'V1', net: 'GND', x: 10.9125, y: 10, drill_mm: 0.3, pad_mm: 0.6 },
], components: [part({ 1: 'A', 2: 'B' })], pcb_traces: [] };
assert(runDrc(vPad).some((i) => i.message.includes('too close to R99')), 'via vs pad clearance flagged');

// Real pad geometry, not the component centre: a via between the pads is clear.
const vBetween = { ...board, pcb_vias: [
  { id: 'V1', net: 'GND', x: 10, y: 10, drill_mm: 0.3, pad_mm: 0.6 },
], components: [part({ 1: 'A', 2: 'B' })], pcb_traces: [] };
assert(!runDrc(vBetween).some((i) => i.message.includes('too close to R99')), 'via between pads is clear');

// DRC: stackup layer count mismatch flagged
const sMismatch = { ...board, project_metadata: { ...board.project_metadata, pcb_specifications: { ...board.project_metadata.pcb_specifications, layers: 2, stackup: { layers: [{ name: 'F', type: 'signal', copper_weight_oz: 1, dielectric_thickness_mm: 1.5 }, { name: 'B', type: 'signal', copper_weight_oz: 1, dielectric_thickness_mm: 1.5 }, { name: 'G', type: 'ground', copper_weight_oz: 1, dielectric_thickness_mm: 1.5 }], total_thickness_mm: 1.6 } } } };
assert(runDrc(sMismatch).some((i) => i.message.includes('Stackup has 3 layers')), 'stackup layer count mismatch flagged');

// DRC: zero/negative stackup thickness flagged
const sZero = { ...board, project_metadata: { ...board.project_metadata, pcb_specifications: { ...board.project_metadata.pcb_specifications, stackup: { layers: [], total_thickness_mm: 0 } } } };
assert(runDrc(sZero).some((i) => i.message.includes('total thickness')), 'stackup zero thickness flagged');

// DRC: consistent stackup is clean
const sOk = { ...board, project_metadata: { ...board.project_metadata, pcb_specifications: { ...board.project_metadata.pcb_specifications, layers: 2, stackup: { layers: [{ name: 'F', type: 'signal', copper_weight_oz: 1, dielectric_thickness_mm: 1.5 }, { name: 'B', type: 'signal', copper_weight_oz: 1, dielectric_thickness_mm: 1.5 }], total_thickness_mm: 1.6 } } } };
assert(!runDrc(sOk).some((i) => i.message.includes('Stackup') || i.message.includes('thickness')), 'consistent stackup clean');

// Push-and-shove: tryRoute returns null when a wall blocks every path.
const wall = [];
for (let y = 0; y <= 35; y++) wall.push({ x: 25, y });
assert(tryRoute(50, 35, { x: 5, y: 10 }, { x: 45, y: 10 }, wall) === null, 'tryRoute null on fully blocked path');
assert(tryRoute(50, 35, { x: 5, y: 10 }, { x: 10, y: 10 }, []) !== null, 'tryRoute finds open path');

// Push-and-shove: ripupAutoroute connects every net, even when the first net
// blocks the second's straight line. The second net rips it up and re-routes.
const owners = new Map([
  ['A', [{ x: 5, y: 10 }, { x: 45, y: 10 }]],
  ['B', [{ x: 10, y: 20 }, { x: 40, y: 20 }]],
]);
const rr = ripupAutoroute(50, 35, [{ net_name: 'A', trace_width_mm: 0.25 }, { net_name: 'B', trace_width_mm: 0.25 }], owners, []);
assert(rr.routed === 2, 'ripupAutoroute connects both nets', JSON.stringify(rr));
assert(rr.traces.some((t) => t.net === 'A') && rr.traces.some((t) => t.net === 'B'), 'both nets present after ripup');

// Push-and-shove: two nets whose straight lines cross force a rip-up.
const owners2 = new Map([
  ['A', [{ x: 5, y: 10 }, { x: 45, y: 10 }]],
  ['B', [{ x: 25, y: 5 }, { x: 25, y: 30 }]],
]);
const rr2 = ripupAutoroute(50, 35, [{ net_name: 'A', trace_width_mm: 0.25 }, { net_name: 'B', trace_width_mm: 0.25 }], owners2, []);
assert(rr2.routed === 2, 'crossing nets both routed', JSON.stringify(rr2));
assert(rr2.traces.every((t) => t.pts_mm.length >= 2), 'all routed traces have geometry');

console.log('ALL ROUTE/DRC CHECKS PASSED');
