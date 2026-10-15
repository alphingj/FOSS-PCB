'use client';
import { useMemo } from 'react';
import { useStore } from '../lib/store';
import { applyGroundFixes, groundBoard } from '../lib/grounding';
import { btnPrimary, muted } from '../lib/theme';

// Grounding report: every AI-chosen part checked against the stocked library.
// Only safe MPN rebrands are auto-applied; rewires stay manual.
export default function GroundingPanel() {
  const { pcb, setPcb } = useStore();
  const issues = useMemo(() => (pcb ? groundBoard(pcb) : []), [pcb]);
  if (!pcb) return null;
  const fixable = issues.filter((i) => i.autoFixable).length;

  return (
    <div>
      <h3>Grounding</h3>
      <div style={muted}>{issues.length === 0 ? 'Every part is stocked — orderable as listed.' : `${issues.length} issue${issues.length === 1 ? '' : 's'} vs the stocked library`}</div>
      {issues.length > 0 && (
        <>
          <ul style={{ fontSize: 12.5, maxHeight: 160, overflow: 'auto', paddingLeft: 18 }}>
            {issues.map((i) => (
              <li key={i.designator + i.kind} style={{ color: i.autoFixable ? 'var(--warning)' : 'var(--danger)', marginBottom: 4 }}>
                {i.message}{i.autoFixable ? ' · auto-fixable' : ''}
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={!fixable}
            onClick={() => {
              const { pcb: fixed, applied } = applyGroundFixes(pcb, issues);
              if (applied) setPcb(fixed);
            }}
            style={btnPrimary}
          >
            Apply {fixable} safe MPN fix{fixable === 1 ? '' : 'es'}
          </button>
        </>
      )}
    </div>
  );
}
