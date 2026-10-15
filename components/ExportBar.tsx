'use client';
import { useState } from 'react';
import { useStore } from '../lib/store';
import { fossToKicadPcb, kicadPcbToFoss, kicadNetNames, download } from '../lib/kicad-io';
import { Desktop, isTauri } from '../lib/tauri-bridge';
import { btnGhost, btnPrimary, muted } from '../lib/theme';

/** Marker emitted ONLY by the Rust fallback stub — never by a real exporter. */
const STUB_MARKER = 'foss-json follows';

export default function ExportBar() {
  const { pcb, setPcb, setError } = useStore();
  const [busy, setBusy] = useState(false);
  if (!pcb) return null;
  const name = pcb.project_metadata.design_name.replace(/[^\w.-]+/g, '_');

  const doJson = () => download(`${name}.foss.json`, JSON.stringify(pcb, null, 2));

  const doKicad = async () => {
    setBusy(true);
    try {
      let s = fossToKicadPcb(pcb);
      if (isTauri()) {
        try {
          const viaRust = await Desktop.writeKicad(JSON.stringify(pcb));
          if (typeof viaRust === 'string' && viaRust.startsWith('(kicad_pcb') && !viaRust.includes(STUB_MARKER)) {
            s = viaRust;
          }
        } catch (e: any) {
          setError(`Desktop exporter failed, used built-in writer: ${e.message}`);
        }
      }
      download(`${name}.kicad_pcb`, s, 'text/plain');
    } finally {
      setBusy(false);
    }
  };

  const doStep = async () => {
    const r = isTauri() ? await Desktop.step(JSON.stringify(pcb)).catch((e: any) => `{"error":"${String(e.message).slice(0, 200)}"}`) : null;
    download(`${name}.step.json`, typeof r === 'string' && r ? r : JSON.stringify({ note: 'Solid STEP needs desktop shell + CadQuery; this is a placeholder manifest.', components: pcb.components.length }));
  };

  const doImport = async (f: File) => {
    setBusy(true);
    try {
      const text = await f.text();
      const comps = kicadPcbToFoss(text);
      const nets = kicadNetNames(text);
      if (!comps.length) {
        setError('Import found no footprints in that file.');
        return;
      }
      const W = 100, perRow = 8;
      setPcb({
        project_metadata: {
          design_name: f.name.replace(/\.kicad_pcb$/i, ''),
          revision: '1.0.0',
          topology: 'imported',
          assumed_parameters: {},
          pcb_specifications: { board_width_mm: W, board_height_mm: 80, layers: 2, copper_weight_oz: 1, surface_finish: 'HASL_Lead_Free' },
        },
        components: comps.map((c, i) => ({
          designator: c.designator,
          type: 'Imported',
          value: c.value,
          mpn: '',
          footprint: c.footprint,
          pins: {},
          schematic_pos: { x: 100 + (i % perRow) * 80, y: 150 + Math.floor(i / perRow) * 90, rotation: 0 },
          pcb_placement_mm: {
            x: c.x || 10 + (i % perRow) * 10,
            y: c.y || 10 + Math.floor(i / perRow) * 10,
            rotation: c.rot,
            layer: 'Top' as const,
          },
        })),
        nets: nets.filter((n) => n).map((n) => ({ net_name: n, nodes: [], trace_width_mm: 0.25, clearance_mm: 0.2, routing_type: 'Imported' })),
        schematic_wires: [],
        pcb_traces: [],
        pcb_layout_zones: [],
      });
      setError('');
    } catch (e: any) {
      setError(`Import failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={muted}>KiCad interchange</span>
      <button type="button" onClick={doJson} style={btnGhost}>FOSS JSON</button>
      <button type="button" onClick={doKicad} disabled={busy} style={btnPrimary}>Export .kicad_pcb</button>
      <button type="button" onClick={doStep} disabled={busy} style={btnGhost}>STEP</button>
      <label style={{ ...btnGhost, cursor: 'pointer' }}>
        Import .kicad_pcb
        <input type="file" accept=".kicad_pcb" hidden onChange={(e) => { if (e.target.files?.[0]) void doImport(e.target.files[0]); e.target.value = ''; }} />
      </label>
    </div>
  );
}
