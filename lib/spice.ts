// FOSS JSON -> SPICE netlist (ngspice/LTspice compatible).
// Honest scope: passives map 1:1 with parsed values; semiconductors get
// default models; control ICs (PWM controllers, MCUs) are replaced by an
// equivalent PULSE stimulus clearly marked IDEALIZED so the loop can be
// simulated today and refined part-by-part later.
import type { FossPcb } from './foss-schema';
import { parseResistance, parseCapacitance, parseInductance } from './sim/values';

export interface SpiceOptions {
  vin: number;
  freqHz: number;
  duty: number;
  tStop: number;
}

function esc(s: string): string {
  return s.replace(/[^A-Za-z0-9_.\-+]/g, '_');
}

/** Net names to SPICE node names (GND -> 0). */
function node(net: string): string {
  return net === 'GND' ? '0' : esc(net);
}

/** Which net a component pin attaches to, via the nets table. */
function pinNet(pcb: FossPcb, des: string, pin: string): string | null {
  const key = `${des}.${pin}`;
  for (const n of pcb.nets) {
    if (n.nodes.includes(key)) return n.net_name;
  }
  return null;
}

export function fossToSpiceNetlist(pcb: FossPcb, opt: SpiceOptions): string {
  const L: string[] = [];
  L.push(`* ${pcb.project_metadata.design_name} — exported by FOSS-PCB (prototype-grade, verify before tapeout)`);
  L.push(`VIN VIN 0 DC ${opt.vin}`);

  for (const c of pcb.components) {
    const t = c.type;
    if (t === 'Resistor') {
      const pins = Object.keys(c.pins);
      if (pins.length < 2) continue;
      const r = parseResistance(c.value);
      if (!Number.isFinite(r) || r <= 0) {
        L.push(`* SKIP ${c.designator}: unparseable "${c.value}"`);
        continue;
      }
      const n1 = pinNet(pcb, c.designator, pins[0]);
      const n2 = pinNet(pcb, c.designator, pins[1]);
      if (!n1 || !n2) { L.push(`* SKIP ${c.designator}: pins not in netlist`); continue; }
      L.push(`R${esc(c.designator)} ${node(n1)} ${node(n2)} ${r}`);
    } else if (t === 'Capacitor_Ceramic' || t === 'Capacitor_Polarized') {
      const pins = Object.keys(c.pins);
      if (pins.length < 2) continue;
      const cap = parseCapacitance(c.value);
      if (!Number.isFinite(cap) || cap <= 0) {
        L.push(`* SKIP ${c.designator}: unparseable "${c.value}"`);
        continue;
      }
      const n1 = pinNet(pcb, c.designator, pins[0]);
      const n2 = pinNet(pcb, c.designator, pins[1]);
      if (!n1 || !n2) { L.push(`* SKIP ${c.designator}: pins not in netlist`); continue; }
      L.push(`C${esc(c.designator)} ${node(n1)} ${node(n2)} ${cap} IC=0`);
    } else if (t === 'Inductor_Shielded') {
      const pins = Object.keys(c.pins);
      if (pins.length < 2) continue;
      const lh = parseInductance(c.value);
      if (!Number.isFinite(lh) || lh <= 0) {
        L.push(`* SKIP ${c.designator}: unparseable "${c.value}"`);
        continue;
      }
      const n1 = pinNet(pcb, c.designator, pins[0]);
      const n2 = pinNet(pcb, c.designator, pins[1]);
      if (!n1 || !n2) { L.push(`* SKIP ${c.designator}: pins not in netlist`); continue; }
      L.push(`L${esc(c.designator)} ${node(n1)} ${node(n2)} ${lh} IC=0`);
    } else if (t === 'Diode_Schottky' || t === 'Diode_Signal' || t === 'LED') {
      const a = pinNet(pcb, c.designator, 'A');
      const k = pinNet(pcb, c.designator, 'K');
      if (!a || !k) { L.push(`* SKIP ${c.designator}: A/K not in netlist`); continue; }
      L.push(`D${esc(c.designator)} ${node(a)} ${node(k)} DSCHOTTKY`);
    } else if (t === 'MOSFET_P_Channel' || t === 'MOSFET_N_Channel') {
      const g = pinNet(pcb, c.designator, 'G');
      const s = pinNet(pcb, c.designator, 'S');
      const d = pinNet(pcb, c.designator, 'D');
      if (!g || !s || !d) { L.push(`* SKIP ${c.designator}: G/S/D not in netlist`); continue; }
      // ngspice MOSFET order: drain gate source
      L.push(`M${esc(c.designator)} ${node(d)} ${node(g)} ${node(s)} ${node(s)} MPOWER`);
    } else if (t === 'IC_PWM_Controller') {
      // Idealized gate drive: the controller's regulation loop is NOT modeled.
      const out = pinNet(pcb, c.designator, 'OUT') ?? pinNet(pcb, c.designator, 'GATE_DRV');
      if (!out) { L.push(`* SKIP ${c.designator}: no drive output in netlist`); continue; }
      const per = 1 / opt.freqHz;
      L.push(`* IDEALIZED: ${c.designator} (${c.value}) replaced by fixed-duty pulse source`);
      L.push(`VGATE_${esc(c.designator)} ${node(out)} 0 PULSE(0 ${opt.vin} 0 10n 10n ${opt.duty * per} ${per})`);
    } else if (t.startsWith('Connector') || t === 'Fuse' || t === 'Switch_Tactile' || t === 'Crystal') {
      L.push(`* PASSIVE-STRUCTURAL ${c.designator} (${c.type}): not modeled`);
    } else {
      L.push(`* UNMODELED ${c.designator} (${c.type} ${c.value}): no SPICE mapping yet`);
    }
  }

  L.push('.model DSCHOTTKY D(Vfwd=0.5 Ron=0.02)');
  L.push('.model MPOWER VDMOS(Vto=2.0 Rdson=0.035)');
  L.push(`.tran ${(1 / opt.freqHz / 200).toExponential(2)} ${opt.tStop.toExponential(3)} uic`);
  L.push('.end');
  return L.join('\n');
}
