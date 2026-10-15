'use client';
import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { LIBRARY } from '../lib/library';
import { input, btnPrimary, table, muted, sectionLabel } from '../lib/theme';

// Browse/search the curated part library; Add drops the part onto the board
// (center placement, auto designator) for manual wiring.
export default function LibraryPanel() {
  const { pcb, setPcb } = useStore();
  const [q, setQ] = useState('');
  const [typeF, setTypeF] = useState('all');

  const types = useMemo(() => ['all', ...Array.from(new Set(LIBRARY.map((p) => p.type)))], []);
  const results = useMemo(() => {
    const nq = q.trim().toLowerCase();
    return LIBRARY.filter(
      (p) =>
        (typeF === 'all' || p.type === typeF) &&
        (!nq || [p.mpn, p.value, p.footprint, p.role].some((f) => f.toLowerCase().includes(nq)))
    ).slice(0, 60);
  }, [q, typeF]);

  const add = (mpn: string) => {
    if (!pcb) return;
    const part = LIBRARY.find((p) => p.mpn === mpn)!;
    const nums = pcb.components
      .filter((c) => c.designator.startsWith(part.prefix))
      .map((c) => parseInt(c.designator.slice(part.prefix.length), 10))
      .filter((n) => Number.isFinite(n));
    const des = `${part.prefix}${(nums.length ? Math.max(...nums) : 0) + 1}`;
    const spec = pcb.project_metadata.pcb_specifications;
    const i = pcb.components.length;
    const pins: Record<string, string> = {};
    part.pins.forEach((p) => { pins[p] = 'GND'; });
    setPcb({
      ...pcb,
      components: [
        ...pcb.components,
        {
          designator: des,
          type: part.type,
          value: part.value,
          mpn: part.mpn,
          footprint: part.footprint,
          pins,
          schematic_pos: { x: 100 + (i % 8) * 80, y: 150 + Math.floor(i / 8) * 90, rotation: 0 },
          pcb_placement_mm: {
            x: Math.min(spec.board_width_mm / 2 + (i % 5) * 4, spec.board_width_mm - 2),
            y: Math.min(spec.board_height_mm / 2 + Math.floor(i / 5) * 4, spec.board_height_mm - 2),
            rotation: 0,
            layer: 'Top' as const,
          },
        },
      ],
    });
  };

  return (
    <div>
      <h3>Part library</h3>
      <div style={muted}>{LIBRARY.length} stocked parts</div>
      <div style={{ display: 'flex', gap: 8, margin: '10px 0' }}>
        <input aria-label="Search parts" placeholder="Search MPN / value / role…" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...input, flex: 1 }} />
        <select aria-label="Type filter" value={typeF} onChange={(e) => setTypeF(e.target.value)} style={input}>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div style={{ maxHeight: 260, overflow: 'auto' }}>
        <table style={table}>
          <thead><tr>{['MPN', 'Value', 'Footprint', 'LCSC', ''].map((h) => <th key={h} style={lth}>{h}</th>)}</tr></thead>
          <tbody>
            {results.map((p) => (
              <tr key={p.mpn} title={p.role}>
                <td style={ltd}>{p.mpn}</td><td style={ltd}>{p.value}</td><td style={ltd}>{p.footprint}</td><td style={ltd}>{p.lcsc ?? '—'}</td>
                <td style={ltd}><button type="button" disabled={!pcb} onClick={() => add(p.mpn)} style={btnPrimary}>Add</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!pcb && <div style={{ ...muted, marginTop: 8 }}>Load or generate a board first — new pins land on GND for you to rewire.</div>}
    </div>
  );
}
const lth: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-3)', background: 'var(--table-head)', position: 'sticky', top: 0 };
const ltd: React.CSSProperties = { padding: '7px 10px', borderTop: '1px solid var(--card-border)' };
