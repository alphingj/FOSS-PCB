// Curated part library: real orderable MPNs + footprints + pin labels.
// The AI validator (grounding.ts) constrains generated boards to THESE parts
// so MPNs are orderable, not hallucinated. Add parts here, not in prompts.
export interface LibraryPart {
  mpn: string;
  type: string;
  value: string;
  footprint: string;
  prefix: string; // designator prefix (R, C, L, D, Q, U, J, Y, F, LED)
  pins: string[]; // pin labels, matching net-node conventions
  params: Record<string, string>; // key specs for matching (ohms, V, A, ...)
  role: string;
  /** Verified LCSC stock code (C-number). Absent = not verified, never guessed. */
  lcsc?: string;
}

const R = (value: string, mpn: string, lcsc?: string): LibraryPart => ({
  mpn, type: 'Resistor', value, footprint: 'R_0805_2012Metric', prefix: 'R',
  pins: ['1', '2'], params: { power: '0.125W', tol: '1%' }, role: 'General resistor', lcsc,
});

const C0805 = (value: string, mpn: string, volts: string, lcsc?: string): LibraryPart => ({
  mpn, type: 'Capacitor_Ceramic', value, footprint: 'C_0805_2012Metric', prefix: 'C',
  pins: ['1', '2'], params: { volts, diel: 'X7R' }, role: 'Decoupling/filter ceramic', lcsc,
});

export const LIBRARY: LibraryPart[] = [
  R('10R', 'RC0805FR-0710RL', 'C96347'),
  R('100R', 'RC0805FR-07100RL', 'C105577'),
  R('1k', 'RC0805FR-071KL', 'C95781'),
  R('4.7k', 'RC0805FR-074K7L', 'C60816'),
  R('10k', 'RC0805FR-0710KL', 'C84376'),
  R('38.3k', 'RC0805FR-0738K3L', 'C273970'),
  C0805('100nF', 'CL21B104KBCNNNC', '50V', 'C1711'),
  C0805('1uF', 'CL21B105KAFNNNE', '25V', 'C116352'),
  C0805('10uF', 'CL21A106KAFNNNE', '25V'),
  { mpn: 'EEE-FK1V470P', type: 'Capacitor_Polarized', value: '47uF_35V', footprint: 'CP_Elec_6.3x7.7', prefix: 'C', pins: ['1', '2'], params: { volts: '35V' }, role: 'Input bulk electrolytic', lcsc: 'C178565' },
  { mpn: 'UUD1E101MCL1GS', type: 'Capacitor_Polarized', value: '100uF_25V', footprint: 'CP_Elec_6.3x7.7', prefix: 'C', pins: ['1', '2'], params: { volts: '25V' }, role: 'Output bulk electrolytic', lcsc: 'C445264' },
  { mpn: 'SRR1280-100M', type: 'Inductor_Shielded', value: '10uH_6A', footprint: 'Inductor_Bourns_SRR1280_12.5x12.5mm', prefix: 'L', pins: ['1', '2'], params: { isat: '6.3A' }, role: 'Power inductor 10uH', lcsc: 'C2041557' },
  { mpn: 'SRR1280-220M', type: 'Inductor_Shielded', value: '22uH_4.1A', footprint: 'Inductor_Bourns_SRR1280_12.5x12.5mm', prefix: 'L', pins: ['1', '2'], params: { isat: '4.1A' }, role: 'Power inductor 22uH', lcsc: 'C2041379' },
  { mpn: 'SRR1280-470M', type: 'Inductor_Shielded', value: '47uH_3.5A', footprint: 'Inductor_Bourns_SRR1280_12.5x12.5mm', prefix: 'L', pins: ['1', '2'], params: { isat: '3.5A' }, role: 'Power inductor 47uH' },
  { mpn: 'MBRA340T3G', type: 'Diode_Schottky', value: '40V_3A', footprint: 'D_SMA', prefix: 'D', pins: ['A', 'K'], params: { vr: '40V', io: '3A' }, role: 'Freewheeling Schottky', lcsc: 'C26178' },
  { mpn: 'SSA34-E3/5AT', type: 'Diode_Schottky', value: '40V_3A_SMA', footprint: 'D_SMA', prefix: 'D', pins: ['A', 'K'], params: { vr: '40V', io: '3A' }, role: 'Schottky SMA (SS34 is SMC — use this for SMA)', lcsc: 'C6302059' },
  { mpn: '1N4148W-7-F', type: 'Diode_Signal', value: '100V_150mA', footprint: 'D_SOD-123', prefix: 'D', pins: ['A', 'K'], params: { vr: '100V' }, role: 'Signal diode', lcsc: 'C83528' },
  { mpn: 'IRF7416TRPBF', type: 'MOSFET_P_Channel', value: 'IRF7416', footprint: 'SOIC-8_3.9x4.9mm_P1.27mm', prefix: 'Q', pins: ['S', 'G', 'D'], params: { vdss: '-30V', id: '-9A' }, role: 'High-side P-MOS switch', lcsc: 'C3000' },
  { mpn: 'IRLZ44NPBF', type: 'MOSFET_N_Channel', value: 'IRLZ44N', footprint: 'TO-220-3_Vertical', prefix: 'Q', pins: ['G', 'D', 'S'], params: { vdss: '55V', id: '47A' }, role: 'Low-side N-MOS switch', lcsc: 'C38774' },
  { mpn: 'AO3400A', type: 'MOSFET_N_Channel', value: 'AO3400', footprint: 'SOT-23', prefix: 'Q', pins: ['G', 'D', 'S'], params: { vdss: '30V', id: '5.8A' }, role: 'Small-signal N-MOS', lcsc: 'C20917' },
  { mpn: 'UC3843BD1', type: 'IC_PWM_Controller', value: 'UC3843B', footprint: 'SOIC-8_3.9x4.9mm_P1.27mm', prefix: 'U', pins: ['VCC', 'OUT', 'FB', 'GND'], params: { freq: '500kHz max' }, role: 'Current-mode PWM controller', lcsc: 'C1529973' },
  { mpn: 'NE555DR', type: 'IC_Timer', value: 'NE555', footprint: 'SOIC-8_3.9x4.9mm_P1.27mm', prefix: 'U', pins: ['GND', 'TRIG', 'OUT', 'RESET', 'CTRL', 'THR', 'DISCH', 'VCC'], params: {}, role: '555 timer', lcsc: 'C7593' },
  { mpn: 'LM7805CT', type: 'IC_Regulator_Linear', value: '5V_1A', footprint: 'TO-220-3_Vertical', prefix: 'U', pins: ['IN', 'GND', 'OUT'], params: { vout: '5V', io: '1A' }, role: '5V linear regulator', lcsc: 'C22146' },
  { mpn: 'AMS1117-3.3', type: 'IC_Regulator_LDO', value: '3.3V_1A', footprint: 'SOT-223-3_TabPin2', prefix: 'U', pins: ['GND', 'OUT', 'IN'], params: { vout: '3.3V', io: '1A' }, role: '3.3V LDO', lcsc: 'C6186' },
  { mpn: 'LM358DR', type: 'IC_OpAmp_Dual', value: 'LM358', footprint: 'SOIC-8_3.9x4.9mm_P1.27mm', prefix: 'U', pins: ['OUT1', 'IN1-', 'IN1+', 'V-', 'IN2+', 'IN2-', 'OUT2', 'V+'], params: {}, role: 'Dual op-amp', lcsc: 'C5423' },
  { mpn: 'TL431ACDBZR', type: 'IC_Shunt_Regulator', value: '2.5V', footprint: 'SOT-23', prefix: 'U', pins: ['R', 'A', 'K'], params: { vref: '2.5V' }, role: 'Shunt reference SOT-23 (TL431ACLPR is TO-92 — use that only with a TO-92 footprint)', lcsc: 'C350683' },
  { mpn: 'ATMEGA328P-PU', type: 'IC_MCU', value: 'ATmega328P', footprint: 'DIP-28_W7.62mm', prefix: 'U', pins: ['PD0', 'PD1', 'VCC', 'GND', 'RST', 'SDA', 'SCL', 'MOSI', 'MISO', 'SCK'], params: { flash: '32KB' }, role: '8-bit MCU', lcsc: 'C33901' },
  { mpn: 'ESP32-WROOM-32-N4', type: 'Module_WiFi_BT', value: 'ESP32-WROOM-32-N4', footprint: 'Module_ESP32-WROOM-32', prefix: 'U', pins: ['3V3', 'GND', 'TX', 'RX', 'EN'], params: { flash: '4MB' }, role: 'WiFi/BT module (bare -32 number is ambiguous across 4/8/16MB variants — N4 pinned)', lcsc: 'C82899' },
  { mpn: 'LTST-C170KRKT', type: 'LED', value: 'RED_0805', footprint: 'LED_0805_2012Metric', prefix: 'LED', pins: ['A', 'K'], params: { vf: '2V' }, role: 'Indicator red', lcsc: 'C94868' },
  { mpn: 'LTST-C170KGKT', type: 'LED', value: 'GREEN_0805', footprint: 'LED_0805_2012Metric', prefix: 'LED', pins: ['A', 'K'], params: { vf: '2.1V' }, role: 'Indicator green-yellow', lcsc: 'C98221' },
  { mpn: 'MKDS_1_5_2', type: 'Connector_Terminal_2Pin', value: 'TERM_2P', footprint: 'TerminalBlock_Phoenix_MKDS-1,5-2_5.08mm', prefix: 'J', pins: ['1', '2'], params: { pitch: '5.08mm', current: '10A' }, role: 'Screw terminal in/out (Phoenix MKDS 1,5/2-5,08)', lcsc: 'C5183929' },
  { mpn: 'A2541WV-2x4P', type: 'Connector_PinHeader', value: '2x04_P2.54', footprint: 'PinHeader_2x04_P2.54mm_Vertical', prefix: 'J', pins: ['1', '2', '3', '4', '5', '6', '7', '8'], params: { pitch: '2.54mm' }, role: 'Programming/debug header (CJT, gold, TH)', lcsc: 'C225519' },
  { mpn: 'PJ-102A', type: 'Connector_BarrelJack', value: 'DC_2.1mm', footprint: 'BarrelJack_PJ-102A_Horizontal', prefix: 'J', pins: ['TIP', 'SLEEVE'], params: {}, role: 'DC barrel input', lcsc: 'C20518877' },
  { mpn: 'ABM3-16.000MHZ-D2Y-T', type: 'Crystal', value: '16MHz', footprint: 'Crystal_HC49-SD', prefix: 'Y', pins: ['1', '2'], params: { freq: '16MHz' }, role: 'MCU crystal' },
  { mpn: 'B3F-1000', type: 'Switch_Tactile', value: '6x6mm_THT', footprint: 'SW_Tactile_SPST_6x6mm_THT', prefix: 'SW', pins: ['1', '2'], params: {}, role: 'Reset/user button (through-hole)', lcsc: 'C93157' },
  { mpn: '045101.5MRL', type: 'Fuse', value: '1.5A_125V', footprint: 'Fuse_2410_6125Metric', prefix: 'F', pins: ['1', '2'], params: { current: '1.5A' }, role: 'Input fuse (Nano2 2410 — not 1206)', lcsc: 'C185113' },
];

export const KNOWN_FOOTPRINTS = new Set(LIBRARY.map((p) => p.footprint));

export function findByMpn(mpn: string): LibraryPart | undefined {
  return LIBRARY.find((p) => p.mpn.toLowerCase() === mpn.toLowerCase());
}

/** Exact library hit for footprint+value (MPN may still differ → rebrand fix). */
export function findByFootprintValue(footprint: string, value: string): LibraryPart | undefined {
  return LIBRARY.find((p) => p.footprint === footprint && p.value.toLowerCase() === value.toLowerCase());
}

/** Closest part of the same type by value string similarity (for suggestions). */
export function suggestSameType(type: string, value: string): LibraryPart | undefined {
  const cands = LIBRARY.filter((p) => p.type === type);
  if (!cands.length) return undefined;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]/g, '');
  const nv = norm(value);
  return cands.find((p) => norm(p.value) === nv)
    ?? cands.find((p) => norm(p.value).includes(nv) || nv.includes(norm(p.value)));
}
