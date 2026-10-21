'use client';
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import * as THREE from 'three';
import { useStore } from '../lib/store';
import { bodySizeForFootprint, colorForType } from '../lib/models-3d';
import { loadStepMeshes, resolveModelForFootprint, type StepMesh } from '../lib/step-models';
import { seg, muted } from '../lib/theme';

const Canvas: any = dynamic(() => import('@react-three/fiber').then((m) => m.Canvas), { ssr: false });
const Orbit: any = dynamic(() => import('@react-three/drei').then((m) => m.OrbitControls), { ssr: false });

/** Merge OpenCASCADE meshes into one vertex-coloured BufferGeometry. */
function buildGeometry(meshes: StepMesh[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  let base = 0;
  for (const m of meshes) {
    for (let i = 0; i < m.positions.length; i++) positions.push(m.positions[i]);
    const c = m.color ?? [0.62, 0.62, 0.66];
    const verts = m.positions.length / 3;
    for (let i = 0; i < verts; i++) colors.push(c[0], c[1], c[2]);
    for (let i = 0; i < m.indices.length; i++) indices.push(m.indices[i] + base);
    base += verts;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

// 3D viewer + editor: board extrusion, parametric fallback bodies, and — on by
// default — the real official KiCad STEP bodies fetched from kicad-packages3d
// and tessellated locally with OpenCASCADE. Parts whose footprint has no
// official model stay as parametric boxes and are named in the status line.
export default function BoardViewer3D() {
  const { pcb, setPcb } = useStore();
  const [moveMode, setMoveMode] = useState(false);
  const [realBodies, setRealBodies] = useState(true);
  const [geoms, setGeoms] = useState<Record<string, THREE.BufferGeometry>>({});
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const alive = useRef(true);

  const components = pcb?.components ?? [];
  const modelSig = components.map((c) => `${c.designator}:${c.footprint}`).join('|');

  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    if (!realBodies) {
      setGeoms({});
      setNote('Parametric bodies only — turn on “Official 3D bodies” for the real KiCad models.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setNote('Fetching official KiCad 3D models…');
    (async () => {
      const next: Record<string, THREE.BufferGeometry> = {};
      const missing: string[] = [];
      let loaded = 0;
      for (const c of components) {
        if (cancelled) return;
        const ref = resolveModelForFootprint(c.footprint);
        if (!ref) {
          missing.push(`${c.designator} (no official model)`);
          continue;
        }
        try {
          const meshes = await loadStepMeshes(ref.url);
          if (cancelled) return;
          next[c.designator] = buildGeometry(meshes);
          loaded++;
          if (alive.current) setNote(`Loaded ${loaded} official bod${loaded === 1 ? 'y' : 'ies'}…`);
        } catch (e: any) {
          missing.push(`${c.designator} (${e?.message ?? e})`);
        }
      }
      if (cancelled || !alive.current) return;
      setGeoms(next);
      setLoading(false);
      const parts = [`${loaded}/${components.length} official KiCad 3D bodies`];
      if (missing.length) parts.push(`no body: ${missing.join(', ')}`);
      setNote(parts.join(' · '));
    })();
    return () => {
      cancelled = true;
    };
    // Components are identified by designator+footprint; moving a part must not
    // re-download or re-tessellate its body.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realBodies, modelSig]);

  // Dispose replaced geometries (GPU buffers are not garbage-collected).
  useEffect(() => () => {
    Object.values(geoms).forEach((g) => g.dispose());
  }, [geoms]);

  if (!pcb) return <div style={{ padding: 12 }}>No board yet.</div>;
  const W = pcb.project_metadata.pcb_specifications.board_width_mm;
  const H = pcb.project_metadata.pcb_specifications.board_height_mm;
  const THICKNESS = 1.6;

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
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" aria-pressed={moveMode} onClick={() => setMoveMode((m) => !m)} style={seg(moveMode)}>
          {moveMode ? 'Moving parts' : 'Move parts'}
        </button>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: 'var(--text-2)' }}>
          <input type="checkbox" checked={realBodies} onChange={(e) => setRealBodies(e.target.checked)} />
          Official 3D bodies
        </label>
        <span style={{ fontSize: 12.5, color: 'var(--text-3)', alignSelf: 'center' }}>
          {moveMode ? 'Drag a part across the board.' : 'Drag to orbit. Moves sync to 2D.'}
        </span>
      </div>
      {note && <div role="status" style={{ ...muted, marginBottom: 8 }}>{note}</div>}
      <div style={{ height: 380, background: '#05070a', borderRadius: 12, overflow: 'hidden' }}>
      <Canvas camera={{ position: [30, -40, 45], fov: 40 }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[20, 20, 30]} intensity={1.2} />
        {/* board: center at origin, top surface at z=0 */}
        <mesh position={[0, 0, -THICKNESS / 2]}>
          <boxGeometry args={[W, H, THICKNESS]} />
          <meshStandardMaterial color="#0e5c26" />
        </mesh>
        {pcb.components.map((c) => {
          const bottom = c.pcb_placement_mm.layer === 'Bottom';
          const x = c.pcb_placement_mm.x - W / 2;
          const y = c.pcb_placement_mm.y - H / 2;
          const rot = (c.pcb_placement_mm.rotation * Math.PI) / 180;
          const handlers = {
            onPointerDown: (e: any) => { if (moveMode) (e.target as any).setPointerCapture?.(e.pointerId); },
            onPointerMove: (e: any) => {
              if (moveMode && e.buttons === 1 && e.point) movePart(c.designator, e.point.x + W / 2, e.point.y + H / 2);
            },
          };
          const g = geoms[c.designator];
          if (g) {
            return (
              <mesh
                key={c.designator}
                geometry={g}
                position={[x, y, bottom ? -THICKNESS : 0]}
                rotation={[0, 0, rot]}
                scale={[1, 1, bottom ? -1 : 1]}
                {...handlers}
              >
                <meshStandardMaterial vertexColors metalness={0.18} roughness={0.55} side={THREE.DoubleSide} />
              </mesh>
            );
          }
          const [w, d, h] = bodySizeForFootprint(c.footprint);
          return (
            <mesh key={c.designator} position={[x, y, bottom ? -THICKNESS - h / 2 : h / 2]} rotation={[0, 0, rot]} {...handlers}>
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
              <mesh key={`${t.id}-${i}`} position={[mx, my, t.layer === 'Bottom' ? -THICKNESS - 0.05 : 0.05]} rotation={[0, 0, ang]}>
                <boxGeometry args={[len, Math.max(0.15, t.width_mm), 0.08]} />
                <meshStandardMaterial color={t.net === 'GND' ? '#c9a227' : '#e6a817'} metalness={0.6} roughness={0.35} />
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
