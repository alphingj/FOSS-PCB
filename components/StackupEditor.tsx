'use client';
import { useMemo } from 'react';
import { useStore } from '../lib/store';
import { btnGhost, btnPlain, card, input, muted, sectionLabel, table } from '../lib/theme';

// Stackup editor: layer count, copper weight, dielectric thickness per layer.
// Stored in project_metadata.pcb_specifications.stackup. The `layers` count on
// pcb_specifications stays the authoritative routing layer count; the stackup
// array describes each copper layer (signal/ground/power/mixed).
const LAYER_TYPES = ['signal', 'ground', 'power', 'mixed'] as const;
const DEFAULT_THICKNESS = 1.6;

export default function StackupEditor() {
  const { pcb, setPcb } = useStore();
  const stackup = useMemo(
    () => pcb?.project_metadata.pcb_specifications.stackup,
    [pcb]
  );
  if (!pcb) return <div style={muted}>Build or load a board to edit the stackup.</div>;

  const layers = stackup?.layers ?? [];
  const spec = pcb.project_metadata.pcb_specifications;
  const copperTotal = layers.reduce((s, l) => s + l.copper_weight_oz, 0);
  const dielectricTotal = layers.reduce((s, l) => s + (l.dielectric_thickness_mm ?? 0), 0);

  const update = (next: typeof stackup) =>
    setPcb({
      ...pcb,
      project_metadata: {
        ...pcb.project_metadata,
        pcb_specifications: { ...spec, stackup: next! },
      },
    });

  const addLayer = () => {
    const next = [...layers, { name: `L${layers.length + 1}`, type: 'signal' as const, copper_weight_oz: 1, dielectric_thickness_mm: 1.5 }];
    update({ layers: next, total_thickness_mm: (stackup?.total_thickness_mm ?? DEFAULT_THICKNESS) });
  };
  const removeLayer = (i: number) => {
    update({ layers: layers.filter((_, k) => k !== i), total_thickness_mm: stackup?.total_thickness_mm ?? DEFAULT_THICKNESS });
  };
  const edit = (i: number, patch: Partial<(typeof layers)[number]>) => {
    update({ layers: layers.map((l, k) => (k === i ? { ...l, ...patch } : l)), total_thickness_mm: stackup?.total_thickness_mm ?? DEFAULT_THICKNESS });
  };

  const th: React.CSSProperties = { textAlign: 'left', padding: '7px 10px', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-3)' };
  const td: React.CSSProperties = { padding: '6px 8px', borderTop: '1px solid var(--card-border)', fontSize: 12.5 };

  return (
    <div style={card}>
      <h3>Stackup</h3>
      <div style={{ ...muted, marginBottom: 12 }}>
        Configure the board layer stack. The routing layer count ({spec.layers}) and total thickness ({stackup?.total_thickness_mm ?? DEFAULT_THICKNESS} mm) come from the board spec; per-layer copper and dielectric go here.
      </div>

      <table style={table}>
        <thead>
          <tr>{['#', 'Name', 'Type', 'Cu (oz)', 'Dielectric (mm)', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {layers.map((l, i) => (
            <tr key={i}>
              <td style={td}>{i + 1}</td>
              <td style={td}><input aria-label={`Layer ${i + 1} name`} value={l.name} onChange={(e) => edit(i, { name: e.target.value })} style={{ ...input, width: 70 }} /></td>
              <td style={td}>
                <select aria-label={`Layer ${i + 1} type`} value={l.type} onChange={(e) => edit(i, { type: e.target.value as (typeof layers)[number]['type'] })} style={{ ...input, width: 90 }}>
                  {LAYER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </td>
              <td style={td}><input aria-label={`Layer ${i + 1} copper`} type="number" step="0.5" min="0.5" value={l.copper_weight_oz} onChange={(e) => edit(i, { copper_weight_oz: Math.max(0.5, Number(e.target.value)) })} style={{ ...input, width: 60 }} /></td>
              <td style={td}><input aria-label={`Layer ${i + 1} dielectric`} type="number" step="0.1" min="0" value={l.dielectric_thickness_mm ?? 1.5} onChange={(e) => edit(i, { dielectric_thickness_mm: Math.max(0, Number(e.target.value)) })} style={{ ...input, width: 80 }} /></td>
              <td style={td}><button type="button" onClick={() => removeLayer(i)} style={btnPlain}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
        <button type="button" onClick={addLayer} style={btnGhost}>Add layer</button>
        <span style={muted}>Total copper {copperTotal.toFixed(1)} oz · dielectric {dielectricTotal.toFixed(1)} mm</span>
      </div>

      <div style={{ ...muted, marginTop: 12 }}>
        Common presets: 2-layer (1.6mm FR4, 1oz), 4-layer (1.6mm, signal/GND/PWR/signal). Ground and power layers are usually poured as zones.
      </div>
    </div>
  );
}