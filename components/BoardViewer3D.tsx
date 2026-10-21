'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useStore } from '../lib/store';
import { bodySizeForFootprint, colorForType } from '../lib/models-3d';
import { seg, muted } from '../lib/theme';

const Canvas: any = dynamic(() => import('@react-three/fiber').then((m) => m.Canvas), { ssr: false });
const Orbit: any = dynamic(() => import('@react-three/drei').then((m) => m.OrbitControls), { ssr: false });

// 3D viewer + editor: board extrusion + parametric parts. "Move parts" mode drags
// parts on the board plane (synced to 2D); "Orbit" mode inspects freely.
export default function BoardViewer3D() {
  const { pcb, setPcb } = useStore();
  const [moveMode, setMoveMode] = useState(false);
  if (!pcb) return <div style={{ padding: 12 }}>No board yet.</div>;
  const W = pcb.project_metadata.pcb_specifications.board_width_mm;
  const H = pcb.project_metadata.pcb_specifications.board_height_mm;

  const movePart = (des: string, x: number, y: number) => {
    const c = pcb.components.find((p) => p.designator === des);
    const [bw, bd] = bodySizeForFootprint(c?.footprint ?? '');
    const mx = Math.min(bw / 2, W / 2), my = Math.min(bd / 2, H / 2);
    setPcb({
      ...pcb,
      components: pcb.components.map((p) =>
        p.designator === des
          ? { ...p, pcb_placement_mm: { ...p.pcb_placement_mm, x: +Math.min(Math.max(x, mx), W - mx).toFixed(2), y: +Math.min(Math.max(y, my), H - my).toFixed(2) } }
          : p
      ),
    });
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button type="button" aria-pressed={moveMode} onClick={() => setMoveMode((m) => !m)} style={seg(moveMode)}>
          {moveMode ? 'Moving parts' : 'Move parts'}
        </button>
        <span style={{ fontSize: 12.5, color: 'var(--text-3)', alignSelf: 'center' }}>Drag to orbit when off. Moves sync to 2D.</span>
      </div>
      <div style={{ height: 380, background: '#05070a', borderRadius: 12, overflow: 'hidden' }}>
      <Canvas camera={{ position: [30, -40, 45], fov: 40 }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[20, 20, 30]} intensity={1.2} />
        {/* board: center at origin */}
        <mesh position={[0, 0, -0.8]}>
          <boxGeometry args={[W, H, 1.6]} />
          <meshStandardMaterial color="#0e5c26" />
        </mesh>
        {pcb.components.map((c) => {
          const [w, d, h] = bodySizeForFootprint(c.footprint);
          const x = c.pcb_placement_mm.x - W / 2;
          const y = c.pcb_placement_mm.y - H / 2;
          return (
            <mesh key={c.designator} position={[x, y, h / 2]}
              onPointerDown={(e: any) => { if (moveMode) (e.target as any).setPointerCapture?.(e.pointerId); }}
              onPointerMove={(e: any) => {
                if (moveMode && e.buttons === 1 && e.point) {
                  movePart(c.designator, e.point.x + W / 2, e.point.y + H / 2);
                }
              }}>
              <boxGeometry args={[w, d, h]} />
              <meshStandardMaterial color={colorForType(c.type)} />
            </mesh>
          );
        })}
        {(pcb.pcb_traces ?? []).map((t) =>
          t.pts_mm.slice(0, -1).flatMap(([x1, y1], i) => {
            const [x2, y2] = t.pts_mm[i + 1];
            const len = Math.hypot(x2 - x1, y2 - y1);
            if (len < 1e-6) return []; // skip degenerate segments
            const mx = (x1 + x2) / 2 - W / 2, my = (y1 + y2) / 2 - H / 2;
            const ang = Math.atan2(y2 - y1, x2 - x1);
            return [
              <mesh key={`${t.id}-${i}`} position={[mx, my, 0.15]} rotation={[0, 0, ang]}>
                <boxGeometry args={[len, Math.max(0.3, t.width_mm), 0.1]} />
                <meshStandardMaterial color={t.net === 'GND' ? '#999999' : '#ffcc00'} />
              </mesh>,
            ];
          })
        )}
        <Orbit enabled={!moveMode} />
      </Canvas>
      </div>
    </div>
  );
}
