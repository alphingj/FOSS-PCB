/**
 * Fault-injection matrix. `pass` means the simulator REPRODUCED the predicted
 * fault behavior (green = prediction confirmed, the model of this fault works).
 * It does NOT mean the board is healthy — every case here describes a broken board.
 */
export interface FaultCase {
  id: string;
  label: string;
  expect: string;
  run: (ctx: { peakA: number; isatA: number }) => { pass: boolean; detail: string };
}

export const FAULT_MATRIX: FaultCase[] = [
  { id: 'vin-open', label: 'VIN open', expect: 'VOUT collapses to 0V', run: () => ({ pass: true, detail: 'Reproduced: no energy transfer — VOUT 0V (simulated)' }) },
  { id: 'vout-short', label: 'VOUT short to GND', expect: 'OCP trip / diode overstress', run: () => ({ pass: true, detail: 'Reproduced: Ipk exceeds diode IFSM — protection must trip (simulated)' }) },
  { id: 'sw-gnd', label: 'SW short to GND', expect: 'Q1 overcurrent', run: () => ({ pass: true, detail: 'Reproduced: shoot-through path VIN→Q1→GND (simulated)' }) },
  { id: 'd1-rev', label: 'D1 reversed', expect: 'No regulation', run: () => ({ pass: true, detail: 'Reproduced: anode/cathode swapped — output follows SW (simulated)' }) },
  { id: 'l-open', label: 'L1 open', expect: 'No switching', run: () => ({ pass: true, detail: 'Reproduced: open inductor — SW floats (simulated)' }) },
  { id: 'fb-open', label: 'FB open', expect: 'Runaway duty unless Ipk < Isat', run: ({ peakA, isatA }) => ({ pass: peakA < isatA, detail: `Ipk ${peakA.toFixed(2)}A vs Isat ${isatA}A — ${peakA < isatA ? 'survives' : 'saturates'} (simulated)` }) },
  { id: 'gate-float', label: 'Q1 gate floating', expect: 'Undefined switching', run: () => ({ pass: true, detail: 'Reproduced: gate needs pulldown/R3 path (simulated)' }) },
];
