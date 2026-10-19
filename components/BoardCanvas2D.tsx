'use client';
import { useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { runDrc } from '../lib/drc';
import { ripupAutoroute, type Pt } from '../lib/routing';
import { bodySizeForFootprint } from '../lib/models-3d';
import { seg, btnPlain, muted } from '../lib/theme';

// Full 2D editor: select/move parts (pointer-capture drag), click-to-route traces
// (click adds waypoint, double-click finishes), right-click a trace to ripup,
// Autoroute button (BFS per net between real pin owners).
export default function BoardCanvas2D() {
  const { pcb, setPcb } = useStore();
  const [mode, setMode] = useState<'select' | 'route'>('select');
  const [netSel, setNetSel] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [pending, setPending] = useState<[number, number][]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragLast = useRef<{ x: number; y: number } | null>(null);
  const idSeq = useRef(0);

  if (!pcb) return <div style={{ padding: 12 }}>Build or load demo to edit traces.</div>;
  const W = pcb.project_metadata.pcb_specifications.board_width_mm;
  const H = pcb.project_metadata.pcb_specifications.board_height_mm;
  const issues = runDrc(pcb);
  const S = 10; // px per mm at 1:1
  const net = netSel ?? pcb.nets[0]?.net_name ?? '';

  /** Client px -> board mm, corrected for CSS scaling of the SVG. */
  const scale = () => {
    const el = svgRef.current;
    if (!el) return 1;
    const r = el.getBoundingClientRect();
    return r.width / (W * S + 40);
  };
  const toMm = (clientX: number, clientY: number): [number, number] => {
    const el = svgRef.current!;
    const r = el.getBoundingClientRect();
    const k = scale();
    const px = (clientX - r.left) / k - 20;
    const py = (clientY - r.top) / k - 20;
    return [+Math.min(Math.max(px / S, 0), W).toFixed(1), +Math.min(Math.max(H - py / S, 0), H).toFixed(1)];
  };

  const clampPart = (des: string, x: number, y: number): [number, number] => {
    const c = pcb.components.find((p) => p.designator === des);
    const [bw, bd] = c ? bodySizeForFootprint(c.footprint) : [4, 4];
    const mx = Math.min(bw / 2, W / 2), my = Math.min(bd / 2, H / 2);
    return [
      +Math.min(Math.max(x, mx), W - mx).toFixed(2),
      +Math.min(Math.max(y, my), H - my).toFixed(2),
    ];
  };

  const move = (des: string, x: number, y: number) => {
    const [cx, cy] = clampPart(des, x, y);
    setPcb({
      ...pcb,
      components: pcb.components.map((c) =>
        c.designator === des ? { ...c, pcb_placement_mm: { ...c.pcb_placement_mm, x: cx, y: cy } } : c
      ),
    });
  };

  const onPartPointerDown = (des: string) => (e: React.PointerEvent<SVGGElement>) => {
    if (mode !== 'select') return;
    (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
    dragLast.current = { x: e.clientX, y: e.clientY };
    setDrag(des);
  };
  const onPartPointerMove = (des: string) => (e: React.PointerEvent<SVGGElement>) => {
    if (drag !== des || !dragLast.current || !pcb) return;
    const k = scale() * S; // screen px per board mm
    const dxMm = (e.clientX - dragLast.current.x) / k;
    const dyMm = -(e.clientY - dragLast.current.y) / k;
    dragLast.current = { x: e.clientX, y: e.clientY };
    const c = pcb.components.find((p) => p.designator === des)!;
    move(des, c.pcb_placement_mm.x + dxMm, c.pcb_placement_mm.y + dyMm);
  };
  const endDrag = () => {
    dragLast.current = null;
    setDrag(null);
  };

  /** Drop consecutive points closer than 0.3mm (absorbs double-click duplicates). */
  const dedupe = (pts: [number, number][]): [number, number][] => {
    const out: [number, number][] = [];
    for (const p of pts) {
      const l = out[out.length - 1];
      if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.3) out.push(p);
    }
    return out;
  };

  const commitTrace = (pts: [number, number][]) => {
    const clean = dedupe(pts);
    if (clean.length < 2 || !net) return;
    const netObj = pcb.nets.find((n) => n.net_name === net);
    idSeq.current += 1;
    setPcb({
      ...pcb,
      pcb_traces: [...(pcb.pcb_traces ?? []), { id: `t${Date.now()}-${idSeq.current}`, net, layer: 'Top' as const, pts_mm: clean, width_mm: netObj?.trace_width_mm ?? 0.25 }],
    });
  };

  /** Route every signal net with rip-up-and-refit: each net routes around the
   *  traces already placed; if blocked, the blocking traces are ripped up and
   *  re-routed in a second pass. Later nets can displace earlier ones. */
  const autoroute = () => {
    const byDes = new Map(pcb.components.map((c) => [c.designator, c]));
    const staticBlocked = pcb.components.map((c) => ({ x: c.pcb_placement_mm.x, y: c.pcb_placement_mm.y }));
    const owners = new Map<string, [Pt, Pt]>();
    for (const n of pcb.nets.filter((x) => x.net_name !== 'GND')) {
      const own = Array.from(new Set(n.nodes.map((nd) => nd.split('.')[0]).filter((d) => byDes.has(d))));
      if (own.length < 2) continue;
      const a = byDes.get(own[0])!.pcb_placement_mm;
      const b = byDes.get(own[1])!.pcb_placement_mm;
      owners.set(n.net_name, [
        { x: Math.min(a.x + 2, W), y: a.y },
        { x: Math.max(b.x - 2, 0), y: b.y },
      ]);
    }
    const r = ripupAutoroute(W, H, pcb.nets, owners, staticBlocked);
    setPcb({
      ...pcb,
      pcb_traces: r.traces.map((t) => ({ ...t, layer: 'Top' as const })),
    });
  };

  const traces = pcb.pcb_traces ?? [];
  const svgPt = ([x, y]: [number, number]) => `${x * S},${(H - y) * S}`;

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center', background: 'var(--bg-soft)', padding: 6, borderRadius: 980, width: 'fit-content', maxWidth: '100%' }}>
        <button type="button" onClick={() => { setMode('select'); setPending([]); }} style={seg(mode === 'select')}>Select</button>
        <button type="button" onClick={() => setMode('route')} style={seg(mode === 'route')}>Route</button>
        <select aria-label="Net" value={net} onChange={(e) => setNetSel(e.target.value)} style={{ background: 'transparent', color: 'var(--text)', border: 0, fontSize: 13, fontWeight: 600, outline: 'none' }}>
          {pcb.nets.map((n) => <option key={n.net_name} value={n.net_name}>{n.net_name}</option>)}
        </select>
        <button type="button" onClick={autoroute} style={seg(false)}>Autoroute</button>
        <button type="button" onClick={() => setPcb({ ...pcb, pcb_traces: [] })} style={seg(false)}>Ripup</button>
      </div>
      <div style={{ ...muted, marginBottom: 8 }}>
        {issues.length === 0 ? 'DRC clean' : issues.map((i) => i.message).join(' · ')} · {traces.length} traces
      </div>
      <svg
        ref={svgRef}
        width={W * S + 40} height={H * S + 40}
        style={{ background: '#0d4d1f', borderRadius: 8, cursor: mode === 'route' ? 'crosshair' : 'default', maxWidth: '100%', height: 'auto' }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={(e) => {
          if (mode !== 'route') return;
          setPending((p) => [...p, toMm(e.clientX, e.clientY)]);
        }}
        onDoubleClick={() => { commitTrace(pending); setPending([]); }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <g transform="translate(20,20)">
          <rect width={W * S} height={H * S} fill="#0e5c26" stroke="#000" />
          {pcb.pcb_layout_zones.map((z) => (
            <rect key={z.zone_name} x={z.bounding_box_mm.x1 * S} y={(H - z.bounding_box_mm.y2) * S}
              width={(z.bounding_box_mm.x2 - z.bounding_box_mm.x1) * S}
              height={(z.bounding_box_mm.y2 - z.bounding_box_mm.y1) * S}
              fill={z.net === 'GND' ? '#0d4d1f' : z.net === 'SW' ? '#b8860b' : '#1a3a5c'}
              fillOpacity={0.25}
              stroke={z.net === 'GND' ? '#2ecc71' : z.net === 'SW' ? '#f1c40f' : '#3498db'}
              strokeWidth={1}
              strokeDasharray="4 2" />
          ))}
          {traces.map((t) => (
            <polyline key={t.id} points={t.pts_mm.map(svgPt).join(' ')} fill="none"
              stroke={t.net === 'GND' ? '#888' : '#ffcc00'} strokeWidth={Math.max(2, t.width_mm * 4)}
              strokeLinejoin="round" onContextMenu={(e) => { e.preventDefault(); setPcb({ ...pcb, pcb_traces: traces.filter((x) => x.id !== t.id) }); }}>
              <title>{`${t.net} (right-click ripup)`}</title>
            </polyline>
          ))}
          {pending.length > 0 && (
            <polyline points={pending.map(svgPt).join(' ')} fill="none" stroke="#00d4ff" strokeWidth={2} strokeDasharray="5 3" />
          )}
          {(pcb.pcb_vias ?? []).map((v) => (
            <circle key={v.id} cx={v.x * S} cy={(H - v.y) * S} r={Math.max(2, v.pad_mm * S / 2)}
              fill="#c9a227" stroke="#fff" strokeWidth={1}>
              <title>{`via ${v.net} (${v.drill_mm}mm drill)`}</title>
            </circle>
          ))}
          {pcb.components.map((c) => (
            <g key={c.designator}
              transform={`translate(${c.pcb_placement_mm.x * S},${(H - c.pcb_placement_mm.y) * S})`}
              onPointerDown={onPartPointerDown(c.designator)}
              onPointerMove={onPartPointerMove(c.designator)}
              onPointerUp={endDrag}
            >
              <rect x={-14} y={-8} width={28} height={16} fill="#111" stroke="#fff" strokeWidth={1} />
              <text y={3} textAnchor="middle" fontSize={9} fill="#fff">{c.designator}</text>
            </g>
          ))}
        </g>
      </svg>
      <div style={{ ...muted, marginTop: 8 }}>
        Route: click to add points, double-click to finish. Right-click a trace to remove it.
      </div>
    </div>
  );
}
