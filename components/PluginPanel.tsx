'use client';
import { useState } from 'react';
import { useStore } from '../lib/store';
import { runDrc } from '../lib/drc';
import { Desktop, isTauri } from '../lib/tauri-bridge';
import { btnGhost, mono, muted } from '../lib/theme';

// Runs bundled Python plugins via Tauri (desktop) with browser fallback (TS mirror).
export default function PluginPanel() {
  const { pcb } = useStore();
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  if (!pcb) return null;

  const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

  const run = async (plugin: string) => {
    setBusy(true);
    setOut(`running ${plugin}…`);
    try {
      const argsJson = JSON.stringify({ pcb, components: pcb.components, issues: runDrc(pcb) });
      if (isTauri()) {
        const r = await Desktop.plugin(plugin, argsJson);
        if (typeof r === 'string' && r) {
          try {
            const parsed = JSON.parse(r);
            if (parsed && typeof parsed === 'object' && 'error' in parsed) throw new Error(String(parsed.error));
          } catch (e: any) {
            if (e.message && !e.message.startsWith('Unexpected token')) throw e;
          }
          setOut(r.slice(0, 2000));
          return;
        }
        throw new Error('desktop plugin returned empty output');
      }
      // browser fallback mirrors
      if (plugin === 'bom_export') {
        setOut(['Designator,Value,Footprint,MPN', ...pcb.components.map((c) => [c.designator, c.value, c.footprint, c.mpn].map(csvCell).join(','))].join('\n'));
      } else if (plugin === 'drc_report') {
        const issues = runDrc(pcb);
        setOut(issues.length ? issues.map((i) => `- [${i.severity}] ${i.message}`).join('\n') : 'DRC clean.');
      } else if (plugin === 'step_export') {
        setOut(JSON.stringify({ file: `${pcb.project_metadata.design_name}.step`, components: pcb.components.length, note: 'placeholder — solid STEP needs desktop shell + CadQuery' }));
      } else {
        setOut(`unknown plugin: ${plugin}`);
      }
    } catch (e: any) {
      setOut(`plugin failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h3>Plugins</h3>
      <div style={muted}>FOSS runner; KiCad ActionPlugin shape accepted for porting.</div>
      <div style={{ display: 'flex', gap: 8, margin: '10px 0' }}>
        {['bom_export', 'drc_report', 'step_export'].map((p) => (
          <button type="button" key={p} onClick={() => void run(p)} disabled={busy} style={btnGhost}>{p}</button>
        ))}
      </div>
      <pre style={{ ...mono, background: 'var(--bg-soft)', padding: 12, borderRadius: 10, maxHeight: 160, overflow: 'auto', margin: 0 }}>{out || 'no output'}</pre>
    </div>
  );
}
