'use client';
import { useMemo } from 'react';
import { useStore } from '../lib/store';
import { toNum, parseInductance, parseCurrent, parseCapacitance } from '../lib/sim/values';
import { simulateBuckBoost } from '../lib/sim/switching';
import { checkFeedback } from '../lib/sim/mna';
import { FAULT_MATRIX } from '../lib/sim/faults';
import { table, muted } from '../lib/theme';

export default function LabPanel() {
  const { pcb } = useStore();
  const bench = useMemo(() => {
    if (!pcb) return null;
    const assumed = (pcb.project_metadata.assumed_parameters ?? {}) as Record<string, unknown>;
    const l1 = pcb.components.find((c) => c.designator === 'L1');
    const c2 = pcb.components.find((c) => c.designator === 'C2');
    const Lh = l1 ? parseInductance(l1.value) : NaN;
    const isat = l1 ? parseCurrent(l1.value) : NaN;
    const Cout = c2 ? parseCapacitance(c2.value) : NaN;
    const vin = toNum(assumed.vin_min_v ?? assumed.vin_v ?? 12, 12);
    const vout = Math.abs(toNum(assumed.vout_nominal_v ?? assumed.vout_v ?? 12, 12));
    const iout = toNum(assumed.iout_max_a ?? assumed.iout_a ?? 1, 1);
    const freq = toNum(assumed.switching_frequency_hz ?? assumed.freq_hz ?? 100000, 100000);
    const sim = simulateBuckBoost({
      vin, voutTargetAbs: vout, iout, freqHz: freq,
      inductanceH: Number.isFinite(Lh) ? Lh : 47e-6,
      CoutF: Number.isFinite(Cout) ? Cout : 100e-6,
    });
    const fb = checkFeedback(pcb, -Math.abs(toNum(assumed.vout_nominal_v ?? -12, -12)));
    return { sim, fb, isat: Number.isFinite(isat) ? isat : 3.5, l1src: l1 ? 'L1' : 'default 47µH', coutSrc: c2 ? 'C2' : 'default 100µF' };
  }, [pcb]);

  if (!pcb || !bench) return <div style={muted}>Lab appears after build.</div>;
  const { sim, fb, isat, l1src, coutSrc } = bench;

  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 700 }}>{pcb.project_metadata.design_name}</div>
      <div style={muted}>Cycle-by-cycle CCM sim (Vf/Rds/DCR modeled) + MNA divider check. L from {l1src}, Cout from {coutSrc}.</div>
      {!sim.valid ? (
        <div style={{ color: 'var(--danger)', fontSize: 13 }}>Cannot simulate: {sim.warnings.join('; ')}</div>
      ) : (
        <div style={{ fontSize: 13 }}>
          D = {sim.D.toFixed(3)} ({(sim.D * 100).toFixed(1)}%) · Ipk {sim.iPeak.toFixed(2)}A vs Isat {isat}A ·
          Vout {sim.vAvgAbs.toFixed(2)}V ± {(sim.vRipple * 1000).toFixed(0)}mV{!sim.settled && ' (unsettled)'}
          {sim.warnings.map((w) => <div key={w} style={{ color: 'var(--warning)' }}>{w}</div>)}
        </div>
      )}
      <div style={{ fontSize: 13, color: fb.ok ? 'var(--success)' : 'var(--warning)' }}>FB divider: {fb.detail}</div>
      <div style={{ ...muted, marginTop: 8 }}>Green fault = simulator reproduced the predicted behavior (board broken as predicted).</div>
      {sim.valid && (
        <table style={{ ...table, marginTop: 8 }}>
          <thead><tr>{['Fault', 'Predicted', 'Result'].map((h) => <th key={h} style={lth}>{h}</th>)}</tr></thead>
          <tbody>
            {FAULT_MATRIX.map((f) => {
              const r = f.run({ peakA: sim.iPeak, isatA: isat });
              return <tr key={f.id}><td style={ltd}>{f.label}</td><td style={ltd}>{f.expect}</td><td style={{ ...ltd, color: r.pass ? 'var(--success)' : 'var(--danger)' }}>{r.detail}</td></tr>;
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
const lth: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-3)', background: 'var(--table-head)' };
const ltd: React.CSSProperties = { padding: '7px 10px', borderTop: '1px solid var(--card-border)' };
