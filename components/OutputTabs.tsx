'use client';
import { useStore } from '../lib/store';
import { findByMpn } from '../lib/library';
import { card, table, muted, mono, sectionLabel } from '../lib/theme';

export default function OutputTabs() {
  const { rawText, pcb, error } = useStore();
  return (
    <div style={card}>
      <h3>Results</h3>
      {error && <div style={{ background: 'var(--danger-soft)', color: 'var(--danger)', padding: '10px 14px', borderRadius: 10, marginBottom: 12, fontSize: 13 }}>{error}</div>}
      <div className="foss-grid-2">
        <div>
          <div style={sectionLabel}>AI response</div>
          <pre style={{ ...mono, whiteSpace: 'pre-wrap', background: 'var(--bg-soft)', padding: 14, borderRadius: 10, maxHeight: 420, overflow: 'auto', margin: 0 }}>{rawText || 'No output yet.'}</pre>
        </div>
        <div>
          <div style={sectionLabel}>Bill of materials ({pcb?.components.length ?? 0})</div>
          <div style={{ maxHeight: 200, overflow: 'auto', marginBottom: 12 }}>
            <table style={table}>
              <thead><tr>{['Ref', 'Type', 'Value', 'Footprint', 'MPN', 'LCSC'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{pcb?.components.map((c) => <tr key={c.designator}>{[c.designator, c.type, c.value, c.footprint, c.mpn, findByMpn(c.mpn)?.lcsc ?? '—'].map((v, i) => <td key={i} style={td}>{v}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <div style={sectionLabel}>Nets ({pcb?.nets.length ?? 0})</div>
          <div style={{ maxHeight: 200, overflow: 'auto' }}>
            <table style={table}>
              <thead><tr>{['Net', 'Pins', 'Width', 'Rule'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{pcb?.nets.map((n) => <tr key={n.net_name}><td style={td}>{n.net_name}</td><td style={td}>{n.nodes.join(', ')}</td><td style={td}>{n.trace_width_mm}</td><td style={td}>{n.routing_type}</td></tr>)}</tbody>
            </table>
          </div>
          {!pcb && <div style={muted}>Generate or load a board to see the breakdown.</div>}
        </div>
      </div>
    </div>
  );
}
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-3)', background: 'var(--table-head)', position: 'sticky', top: 0 };
const td: React.CSSProperties = { padding: '7px 10px', borderTop: '1px solid var(--card-border)' };
