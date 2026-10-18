// Inverting buck-boost operating point (CCM cycle-average model) with losses.
// Instead of integrating stiff switching transients (fragile), this solves the
// steady state directly: bisection on D is monotonic hence unconditionally
// stable. Idealizations: CCM only, constant Vf/Rds/DCR, no ESR/switching loss.
// Interface is unchanged so Lab/Scope panels need no edits.
import type { FossPcb } from '../foss-schema';
import { toNum, parseInductance, parseCurrent, parseCapacitance } from './values';
export interface SwitchingParams {
  vin: number; voutTargetAbs: number; iout: number;
  freqHz: number; inductanceH: number; CoutF: number;
  vf?: number; rds?: number; dcr?: number;
}

/** Bench inputs for a board, with every default recorded so the UI can say
 *  which values came from the design and which were assumed. Lab and the
 *  SPICE export both call this so the two can never drift apart. */
export interface BenchParams {
  vin: number; voutAbs: number; iout: number; freqHz: number;
  inductanceH: number; coutF: number; isat: number;
  l1src: string; coutSrc: string;
}

export function benchParams(pcb: FossPcb): BenchParams {
  const assumed = (pcb.project_metadata.assumed_parameters ?? {}) as Record<string, unknown>;
  const l1 = pcb.components.find((c) => c.designator === 'L1');
  const c2 = pcb.components.find((c) => c.designator === 'C2');
  const Lh = l1 ? parseInductance(l1.value) : NaN;
  const isat = l1 ? parseCurrent(l1.value) : NaN;
  const Cout = c2 ? parseCapacitance(c2.value) : NaN;
  return {
    vin: toNum(assumed.vin_min_v ?? assumed.vin_v ?? 12, 12),
    voutAbs: Math.abs(toNum(assumed.vout_nominal_v ?? assumed.vout_v ?? 12, 12)),
    iout: toNum(assumed.iout_max_a ?? assumed.iout_a ?? 1, 1),
    freqHz: toNum(assumed.switching_frequency_hz ?? assumed.freq_hz ?? 100000, 100000),
    inductanceH: Number.isFinite(Lh) ? Lh : 47e-6,
    coutF: Number.isFinite(Cout) ? Cout : 100e-6,
    isat: Number.isFinite(isat) ? isat : 3.5,
    l1src: l1 ? 'L1' : 'default 47uH',
    coutSrc: c2 ? 'C2' : 'default 100uF',
  };
}

export interface SwitchingResult {
  valid: boolean; warnings: string[];
  D: number; iPeak: number; iAvg: number;
  vAvgAbs: number; vRipple: number;
  /** one idealized settled cycle (triangle iL, sawtooth vout) */
  iWave: number[]; vWave: number[]; settled: boolean;
}

/** |Vout| predicted at duty D including conduction losses. */
function voutAt(D: number, vin: number, iout: number, vf: number, rds: number, dcr: number): number {
  const il = iout / (1 - D);
  return (D * (vin - il * rds)) / (1 - D) - vf - il * dcr;
}

export function simulateBuckBoost(p: SwitchingParams): SwitchingResult {
  const warnings: string[] = [];
  const { vin, voutTargetAbs, iout, freqHz, inductanceH, CoutF } = p;
  const vf = p.vf ?? 0.5, rds = p.rds ?? 0.035, dcr = p.dcr ?? 0.05;
  const bad = (w: string): SwitchingResult => ({
    valid: false, warnings: [w], D: NaN, iPeak: NaN, iAvg: NaN,
    vAvgAbs: NaN, vRipple: NaN, iWave: [], vWave: [], settled: false,
  });
  if (!(vin > 0) || !(voutTargetAbs > 0) || !(iout > 0) || !(freqHz > 0) || !(inductanceH > 0) || !(CoutF > 0)) {
    return bad('positive vin/vout/iout/freq/L/C required');
  }
  if (voutAt(0.9, vin, iout, vf, rds, dcr) < voutTargetAbs) {
    return bad('target unreachable even at 90% duty — check Vin/load/Losses');
  }
  // bisection: Vout(D) monotonic increasing on (0, 0.9)
  let lo = 0.05, hi = 0.9;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (voutAt(mid, vin, iout, vf, rds, dcr) < voutTargetAbs) lo = mid;
    else hi = mid;
  }
  const D = (lo + hi) / 2;
  const T = 1 / freqHz;
  const il = iout / (1 - D);
  const dI = ((vin - il * rds) * D * T) / inductanceH; // on-slope ripple
  const iPeak = il + dI / 2;
  const vAvgAbs = voutTargetAbs;
  const vRipple = (iout * D * T) / CoutF; // charge deficit during on-time
  if (dI / 2 >= il) warnings.push('inductor current touches zero — borderline DCM, CCM assumed');
  if (D >= 0.85) warnings.push('Duty > 85% — outside efficient buck-boost range');

  // idealized last-cycle waveforms for the scope
  const N = 200;
  const iWave: number[] = [];
  const vWave: number[] = [];
  for (let s = 0; s < N; s++) {
    const t = s / N;
    if (t < D) {
      iWave.push(il - dI / 2 + dI * (t / D));
      vWave.push(-(vAvgAbs + vRipple / 2 - vRipple * (t / D)));
    } else {
      const u = (t - D) / (1 - D);
      iWave.push(il + dI / 2 - dI * u);
      vWave.push(-(vAvgAbs - vRipple / 2 + vRipple * u));
    }
  }
  return { valid: true, warnings, D, iPeak, iAvg: il, vAvgAbs, vRipple, iWave, vWave, settled: true };
}
