import type { FossPcb } from './foss-schema';

// Trimmed demo of the user's buck-boost example so the app works with no API key.
export const SAMPLE_BUCKBOOST: FossPcb = {
  project_metadata: {
    design_name: 'Simple_Discrete_Buck_Boost_Converter',
    revision: '1.0.0',
    topology: 'Inverting_Single_Switch_Buck_Boost',
    assumed_parameters: { vin_min_v: 5, vin_max_v: 15, vout_nominal_v: -12, iout_max_a: 1, switching_frequency_hz: 100000 },
    pcb_specifications: { board_width_mm: 50, board_height_mm: 35, layers: 2, copper_weight_oz: 2, surface_finish: 'HASL_Lead_Free' },
  },
  components: [
    { designator: 'J1', type: 'Connector_Terminal_2Pin', value: 'TERM_2P', mpn: 'MKDS_1_5_2', footprint: 'TerminalBlock_Phoenix_MKDS-1,5-2_5.08mm', pins: { '1': 'VIN', '2': 'GND' }, schematic_pos: { x: 100, y: 200, rotation: 0 }, pcb_placement_mm: { x: 5, y: 17.5, rotation: 90, layer: 'Top' } },
    { designator: 'C1', type: 'Capacitor_Polarized', value: '47uF_35V', mpn: 'EEE-FK1V470P', footprint: 'CP_Elec_6.3x7.7', pins: { '1': 'VIN', '2': 'GND' }, schematic_pos: { x: 180, y: 250, rotation: 90 }, pcb_placement_mm: { x: 13, y: 22, rotation: 0, layer: 'Top' } },
    { designator: 'Q1', type: 'MOSFET_P_Channel', value: 'IRF7416', mpn: 'IRF7416TRPBF', footprint: 'SOIC-8_3.9x4.9mm_P1.27mm', pins: { S: 'VIN', G: 'GATE', D: 'SW' }, schematic_pos: { x: 260, y: 180, rotation: 0 }, pcb_placement_mm: { x: 20, y: 24, rotation: 0, layer: 'Top' } },
    { designator: 'L1', type: 'Inductor_Shielded', value: '47uH_3.5A', mpn: 'SRR1280-470M', footprint: 'Inductor_Bourns_SRR1280_12.5x12.5mm', pins: { '1': 'SW', '2': 'GND' }, schematic_pos: { x: 340, y: 250, rotation: 90 }, pcb_placement_mm: { x: 27.5, y: 15, rotation: 0, layer: 'Top' } },
    { designator: 'D1', type: 'Diode_Schottky', value: '40V_3A', mpn: 'MBRA340T3G', footprint: 'D_SMA', pins: { K: 'SW', A: 'VOUT' }, schematic_pos: { x: 420, y: 180, rotation: 180 }, pcb_placement_mm: { x: 35, y: 24, rotation: 180, layer: 'Top' } },
    { designator: 'C2', type: 'Capacitor_Polarized', value: '100uF_25V', mpn: 'UUD1E101MCL1GS', footprint: 'CP_Elec_6.3x7.7', pins: { '1': 'VOUT', '2': 'GND' }, schematic_pos: { x: 500, y: 250, rotation: 90 }, pcb_placement_mm: { x: 40, y: 22, rotation: 180, layer: 'Top' } },
    { designator: 'U1', type: 'IC_PWM_Controller', value: 'UC3843B', mpn: 'UC3843BD1', footprint: 'SOIC-8_3.9x4.9mm_P1.27mm', pins: { VCC: 'VIN', OUT: 'GATE_DRV', FB: 'FB', GND: 'GND' }, schematic_pos: { x: 260, y: 360, rotation: 0 }, pcb_placement_mm: { x: 16, y: 8, rotation: 0, layer: 'Top' } },
    { designator: 'R3', type: 'Resistor', value: '10R', mpn: 'RC0805FR-0710RL', footprint: 'R_0805_2012Metric', pins: { '1': 'GATE_DRV', '2': 'GATE' }, schematic_pos: { x: 260, y: 290, rotation: 90 }, pcb_placement_mm: { x: 18, y: 16, rotation: 90, layer: 'Top' } },
    { designator: 'R1', type: 'Resistor', value: '38.3k', mpn: 'RC0805FR-0738K3L', footprint: 'R_0805_2012Metric', pins: { '1': 'VOUT', '2': 'FB' }, schematic_pos: { x: 560, y: 230, rotation: 90 }, pcb_placement_mm: { x: 36, y: 8, rotation: 0, layer: 'Top' } },
    { designator: 'R2', type: 'Resistor', value: '10k', mpn: 'RC0805FR-0710KL', footprint: 'R_0805_2012Metric', pins: { '1': 'FB', '2': 'GND' }, schematic_pos: { x: 560, y: 310, rotation: 90 }, pcb_placement_mm: { x: 36, y: 5, rotation: 0, layer: 'Top' } },
    { designator: 'J2', type: 'Connector_Terminal_2Pin', value: 'TERM_2P', mpn: 'MKDS_1_5_2', footprint: 'TerminalBlock_Phoenix_MKDS-1,5-2_5.08mm', pins: { '1': 'VOUT', '2': 'GND' }, schematic_pos: { x: 640, y: 200, rotation: 0 }, pcb_placement_mm: { x: 45, y: 17.5, rotation: 270, layer: 'Top' } },
  ],
  nets: [
    { net_name: 'VIN', nodes: ['J1.1', 'C1.1', 'Q1.S', 'U1.VCC'], trace_width_mm: 1.5, clearance_mm: 0.3, routing_type: 'Power_Rail' },
    { net_name: 'SW', nodes: ['Q1.D', 'L1.1', 'D1.K'], trace_width_mm: 2, clearance_mm: 0.4, routing_type: 'High_dV_dt_Copper_Polygon' },
    { net_name: 'VOUT', nodes: ['D1.A', 'C2.1', 'R1.1', 'J2.1'], trace_width_mm: 1.5, clearance_mm: 0.3, routing_type: 'Power_Rail' },
    { net_name: 'GND', nodes: ['J1.2', 'C1.2', 'L1.2', 'C2.2', 'U1.GND', 'R2.2', 'J2.2'], trace_width_mm: 2, clearance_mm: 0.3, routing_type: 'Solid_Bottom_Ground_Plane' },
    { net_name: 'GATE_DRV', nodes: ['U1.OUT', 'R3.1'], trace_width_mm: 0.5, clearance_mm: 0.2, routing_type: 'Gate_Drive_Signal' },
    { net_name: 'GATE', nodes: ['R3.2', 'Q1.G'], trace_width_mm: 0.5, clearance_mm: 0.2, routing_type: 'Gate_Drive_Signal' },
    { net_name: 'FB', nodes: ['R1.2', 'R2.1', 'U1.FB'], trace_width_mm: 0.25, clearance_mm: 0.3, routing_type: 'Sensitive_Analog_Feedback' },
  ],
  schematic_wires: [],
  pcb_traces: [],
  pcb_layout_zones: [
    { zone_name: 'SW_Copper_Polygon', net: 'SW', layer: 'Top', bounding_box_mm: { x1: 19, y1: 14, x2: 36, y2: 26 }, rule: 'Keep small and wide.' },
    { zone_name: 'Bottom_Ground_Plane', net: 'GND', layer: 'Bottom', bounding_box_mm: { x1: 1, y1: 1, x2: 49, y2: 34 }, rule: 'Continuous pour.' },
  ],
};

export const SAMPLE_MARKDOWN = `## Components List (BOM)\nDemo buck-boost loaded. See BOM tab.\n## Connection List\nSee Netlist tab.\n## Full JSON Format\nDemo JSON loaded into builder.`;
