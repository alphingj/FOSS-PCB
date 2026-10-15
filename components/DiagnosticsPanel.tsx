'use client';
import { useState } from 'react';
import { Desktop, isTauri } from '../lib/tauri-bridge';
import { btnGhost, mono, muted } from '../lib/theme';

interface Row {
  name: string;
  ok: boolean | null;
  ms: number;
  detail: string;
}

const SAMPLE_KICAD = '(kicad_pcb (version 20240101)\n  (title "Diag")\n  (net 1 "GND")\n  (footprint "R_0805" (at 5 5))\n)';

// One-click end-to-end check of the whole desktop bridge (Tauri + Rust +
// Python). In the browser it reports which paths need the shell.
export default function DiagnosticsPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    const out: Row[] = [];
    const timed = async (name: string, fn: () => Promise<string>) => {
      const t0 = performance.now();
      try {
        const detail = await fn();
        out.push({ name, ok: true, ms: Math.round(performance.now() - t0), detail: detail.slice(0, 160) });
      } catch (e: any) {
        out.push({ name, ok: false, ms: Math.round(performance.now() - t0), detail: String(e?.message ?? e).slice(0, 160) });
      }
      setRows([...out]);
    };
    if (!isTauri()) {
      setRows([{ name: 'shell', ok: false, ms: 0, detail: 'browser mode — run the desktop app (cargo tauri dev) for the full check' }]);
      setBusy(false);
      return;
    }
    await timed('check_python', async () => JSON.stringify(await Desktop.pythonStatus()));
    await timed('parse_kicad_pcb', async () => JSON.stringify(await Desktop.parseKicad(SAMPLE_KICAD)));
    await timed('run_drc', async () => JSON.stringify(await Desktop.drc(50, 35, [['R1', 5, 5]])));
    await timed('autoroute', async () => JSON.stringify(await Desktop.autoroute(['VIN', 'GND'])));
    await timed('run_python_plugin', async () => (await Desktop.plugin('bom_export', '{"components":[]}')) ?? '(null)');
    await timed('export_step', async () => (await Desktop.step('{"project_metadata":{"design_name":"diag"}}')) ?? '(null)');
    await timed('write_kicad_pcb', async () => ((await Desktop.writeKicad('{"project_metadata":{}}')) ?? '').slice(0, 160));
    setBusy(false);
  };

  return (
    <div>
      <h3>Diagnostics</h3>
      <div style={muted}>Exercises every desktop command with canned inputs.</div>
      <div style={{ margin: '10px 0' }}>
        <button type="button" onClick={() => void run()} disabled={busy} style={btnGhost}>
          {busy ? 'Running…' : 'Run all checks'}
        </button>
      </div>
      {rows.length > 0 && (
        <ul style={{ ...mono, listStyle: 'none', padding: 0, margin: 0 }}>
          {rows.map((r) => (
            <li key={r.name} style={{ padding: '4px 0', color: r.ok == null ? 'var(--text-2)' : r.ok ? 'var(--success)' : 'var(--danger)' }}>
              {r.ok == null ? '…' : r.ok ? '✓' : '✗'} {r.name} ({r.ms}ms) — {r.detail}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
