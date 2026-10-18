'use client';
import { useMemo } from 'react';
import { useStore } from '../lib/store';
import { toNum } from '../lib/sim/values';
import { simulateBuckBoost, benchParams } from '../lib/sim/switching';
import { checkFeedback } from '../lib/sim/mna';
import { FAULT_MATRIX } from '../lib/sim/faults';
import { table, muted } from '../lib/theme';

export default function LabPanel() {
  const { pcb } = useStore();
  const bench = useMemo(() => {
    if (!pcb) return null;
    const assumed = (pcb.project_metadata.assumed_parameters ?? {}) as Record<string, unknown>;
    const p = benchParams(pcb);
    const sim = simulateBuckBoost({
      vin: p.vin, voutTargetAbs: p.voutAbs, iout: p.iout, freqHz: p.freqHz,
      inductanceH: p.inductanceH, CoutF: p.coutF,
    });
    const fb = checkFeedback(pcb, toNum(assumed.vout_nominal_v ?? -12, -12));
    return { sim, fb, isat: p.isat, l1src: p.l1src, coutSrc: p.coutSrc };
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
          D = {sim.D.toFixed(3)} ({(sim.D * 100).toFixed(1)}%) Â· Ipk {sim.iPeak.toFixed(2)}A vs Isat {isat}A Â·
          Vout {sim.vAvgAbs.toFixed(2)}V Â± {(sim.vRipple * 1000).toFixed(0)}mV{!sim.settled && ' (unsettled)'}
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
