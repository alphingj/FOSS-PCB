'use client';
import { useMemo } from 'react';
import ReactFlow, { Background, Controls, MiniMap } from 'reactflow';
import 'reactflow/dist/style.css';
import { useStore } from '../lib/store';
import { runErc } from '../lib/erc';

// Schematic canvas: nodes from schematic_pos, edges from schematic_wires.
// Drag a symbol to move it (committed on drag-stop). ERC shown above.
export default function SchematicEditor() {
  const { pcb, setPcb } = useStore();
  const erc = useMemo(() => (pcb ? runErc(pcb) : []), [pcb]);
  const { nodes, edges, dropped } = useMemo(() => {
    if (!pcb) return { nodes: [], edges: [], dropped: 0 };
    const ids = new Set(pcb.components.map((c) => c.designator));
    const nodes = pcb.components.map((c) => ({
      id: c.designator,
      position: { x: c.schematic_pos.x, y: c.schematic_pos.y },
      data: { label: `${c.designator} ${c.value}` },
      style: { background: '#161b22', color: '#fff', border: '1px solid #555', borderRadius: 6, fontSize: 11, padding: 6 },
    }));
    let dropped = 0;
    const edges = pcb.schematic_wires.flatMap((w, i) => {
      const s = w.from.split('.')[0];
      const t = w.to.split('.')[0];
      if (!ids.has(s) || !ids.has(t)) {
        dropped += 1;
        return [];
      }
      return [{
        id: `e${i}`,
        source: s,
        target: t,
        label: w.net,
        style: { stroke: w.net === 'GND' ? '#888' : '#1f6feb' },
      }];
    });
    return { nodes, edges, dropped };
  }, [pcb]);

  if (!pcb) return <div style={{ padding: 12 }}>Schematic appears after build.</div>;

  return (
    <div>
      <div style={{ fontSize: 12.5, marginBottom: 8, color: erc.some((e) => e.severity === 'error') ? 'var(--danger)' : 'var(--text-2)' }}>
        {erc.length === 0 ? 'ERC clean' : erc.map((e) => e.message).join(' · ')}
        {dropped > 0 && <span> · {dropped} wire{dropped === 1 ? '' : 's'} reference unknown parts (hidden)</span>}
      </div>
      <div style={{ height: 380, background: 'var(--bg-soft)', borderRadius: 12, overflow: 'hidden' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          onNodeDragStop={(_e, node) => {
            setPcb({
              ...pcb,
              components: pcb.components.map((comp) =>
                comp.designator === node.id
                  ? { ...comp, schematic_pos: { ...comp.schematic_pos, x: Math.round(node.position.x), y: Math.round(node.position.y) } }
                  : comp
              ),
            });
          }}
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
    </div>
  );
}
