// Minimal Modified Nodal Analysis DC solver: resistors + independent voltage
// sources (VIN vs GND). Used for honest divider/level checks (e.g. FB network),
// not for switching stages. Returns node voltages keyed by net name.
import type { FossPcb } from '../foss-schema';
import { parseResistance } from './values';

export interface DcResult {
  voltages: Map<string, number>;
  warnings: string[];
}

/** Gaussian elimination with partial pivoting. Mutates copies. */
function solve(A: number[][], z: number[]): number[] | null {
  const n = z.length;
  const M = A.map((r, i) => [...r, z[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null; // singular
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / M[i][i]);
}

/**
 * Solve DC operating point. `sources` maps net name -> forced voltage
 * (e.g. { VIN: 12, GND: 0 }). Resistor components bridge their two nets.
 */
export function solveDC(pcb: FossPcb, sources: Record<string, number>): DcResult {
  const warnings: string[] = [];
  const nets = pcb.nets.map((n) => n.net_name);
  const forced = new Map<string, number>();
  for (const [k, v] of Object.entries(sources)) {
    if (nets.includes(k)) forced.set(k, v);
    else warnings.push(`source net "${k}" not in netlist — ignored`);
  }
  forced.set('GND', sources['GND'] ?? 0);
  const free = nets.filter((n) => !forced.has(n));
  const idx = new Map(free.map((n, i) => [n, i]));
  const m = free.length;
  const G: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
  const I: number[] = new Array(m).fill(0);

  for (const c of pcb.components) {
    if (c.type !== 'Resistor') continue;
    const r = parseResistance(c.value);
    if (!Number.isFinite(r) || r <= 0) {
      warnings.push(`${c.designator}: unparseable "${c.value}" — excluded`);
      continue;
    }
    // find the two nets this resistor connects (first two distinct pin nets)
    const pinNets: string[] = [];
    for (const n of pcb.nets) {
      if (n.nodes.some((nd) => nd.split('.')[0] === c.designator) && !pinNets.includes(n.net_name)) {
        pinNets.push(n.net_name);
      }
    }
    if (pinNets.length < 2) {
      warnings.push(`${c.designator}: fewer than 2 nets — excluded`);
      continue;
    }
    const [a, b] = pinNets;
    const g = 1 / r;
    const ia = idx.get(a), ib = idx.get(b);
    if (ia !== undefined && ib !== undefined) {
      G[ia][ia] += g; G[ib][ib] += g; G[ia][ib] -= g; G[ib][ia] -= g;
    } else if (ia !== undefined) {
      G[ia][ia] += g; I[ia] += g * forced.get(b)!;
    } else if (ib !== undefined) {
      G[ib][ib] += g; I[ib] += g * forced.get(a)!;
    }
  }

  const voltages = new Map<string, number>(forced);
  if (m > 0) {
    // gmin to ground (à la SPICE): floating nets read ~0V instead of
    // singularizing the matrix.
    for (let i = 0; i < m; i++) G[i][i] += 1e-9;
    const x = solve(G, I);
    if (!x) {
      warnings.push('singular matrix (floating network?) — unsolved nodes at 0V');
      free.forEach((n) => voltages.set(n, 0));
    } else {
      free.forEach((n, i) => voltages.set(n, x[i]));
    }
  }
  return { voltages, warnings };
}

/** Feedback check: divider output magnitude at nominal Vout vs controller Vref.
 *  Uses magnitudes because inverting stages regulate a negative rail. */
export function checkFeedback(
  pcb: FossPcb, voutNominal: number, vref = 2.5
): { vfb: number; regulatesAt: number; ok: boolean; detail: string } {
  const { voltages, warnings } = solveDC(pcb, { VOUT: voutNominal, VIN: 0 });
  const raw = voltages.get('FB');
  if (raw === undefined) {
    return { vfb: NaN, regulatesAt: NaN, ok: false, detail: 'FB network unsolvable — check divider wiring' };
  }
  const vfb = Math.abs(raw);
  const vnom = Math.abs(voutNominal);
  // regulates where divider gives Vref: Vreg = Vref * Vnom / Vfb (linear scale)
  const regAbs = vfb > 1e-9 ? (vref * vnom) / vfb : NaN;
  const regulatesAt = (voutNominal < 0 ? -1 : 1) * regAbs;
  const err = Math.abs(vfb - vref) / vref;
  return {
    vfb, regulatesAt,
    ok: err < 0.05,
    detail: `|FB|=${vfb.toFixed(3)}V vs Vref=${vref}V → regulates at ${Number.isFinite(regulatesAt) ? regulatesAt.toFixed(2) + 'V' : '—'}`,
  };
}
