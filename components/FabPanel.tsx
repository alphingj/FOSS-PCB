'use client';
import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { download } from '../lib/kicad-io';
import { fabFiles, fabZip } from '../lib/fab';
import { fossToSpiceNetlist } from '../lib/spice';
import { simulateBuckBoost, benchParams } from '../lib/sim/switching';
import { btnPrimary, muted } from '../lib/theme';

// Fabrication package: Gerbers + drill + JLC BOM/CPL + honesty README.
// Prototype-grade (see README in the zip); KiCad export stays the prod path.
export default function FabPanel() {
  const { pcb } = useStore();
  const [busy, setBusy] = useState(false);
  const files = useMemo(() => (pcb ? fabFiles(pcb) : []), [pcb]);
  if (!pcb) return null;

  const doZip = async () => {
    setBusy(true);
    try {
      const blob = await fabZip(pcb);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${pcb.project_metadata.design_name.replace(/[^\w.-]+/g, '_')}-fab.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } finally {
      setBusy(false);
    }
  };

  const doSpice = () => {
    // Duty comes from the same bisection the Lab bench runs, so the netlist
    // drives the converter at the operating point the app predicted. It used
    // to be hardcoded to 0.5 regardless of the design.
    const p = benchParams(pcb);
    const sim = simulateBuckBoost({
      vin: p.vin, voutTargetAbs: p.voutAbs, iout: p.iout, freqHz: p.freqHz,
      inductanceH: p.inductanceH, CoutF: p.coutF,
    });
    const duty = sim.valid ? sim.D : 0.5;
    download(
      `${pcb.project_metadata.design_name.replace(/[^\w.-]+/g, '_')}.cir`,
      fossToSpiceNetlist(pcb, {
        vin: p.vin,
        freqHz: p.freqHz,
        duty,
        tStop: 0.002,
      }),
      'text/plain'
    );
  };

  return (
    <div>
      <h3>Fabrication</h3>
      <div style={muted}>Gerbers + drill + JLC BOM/CPL. Prototype-grade â€” KiCad export stays the production path.</div>
      <ul style={{ fontSize: 12.5, paddingLeft: 18 }}>
        {files.map((f) => (
          <li key={f.name} style={{ marginBottom: 4 }}>
            {f.name} <span style={{ color: 'var(--text-3)' }}>({f.text.length} chars)</span>{' '}
            <button type="button" onClick={() => download(f.name, f.text, 'text/plain')} style={link}>Download</button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => void doZip()} disabled={busy} style={btnPrimary}>
        {busy ? 'Zippingâ€¦' : 'Download fab .zip'}
      </button>{' '}
      <button type="button" onClick={doSpice} style={btnPrimary}>
        SPICE netlist (.cir)
      </button>
    </div>
  );
}
const link: React.CSSProperties = { background: 'none', color: 'var(--accent)', border: 0, cursor: 'pointer', fontSize: 12.5, padding: 0 };
