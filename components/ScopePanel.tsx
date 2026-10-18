'use client';
import { useEffect, useRef } from 'react';
import { useStore } from '../lib/store';
import { toNum } from '../lib/sim/values';
import { simulateBuckBoost, benchParams } from '../lib/sim/switching';

// Switching-cycle waveforms from the sim bench (placeholder until ngspice).
// Yellow: inductor current. Blue: output voltage (AC-exaggerated around average).
export default function ScopePanel() {
  const { pcb } = useStore();
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !pcb) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    // Same solved operating point as LabPanel — single source of truth via
    // benchParams, so Scope can never drift from the Lab's prediction.
    const p = benchParams(pcb);
    const sim = simulateBuckBoost({
      vin: p.vin, voutTargetAbs: p.voutAbs, iout: p.iout, freqHz: p.freqHz,
      inductanceH: p.inductanceH, CoutF: p.coutF,
    });
    if (!sim.valid || !sim.iWave.length) {
      ctx.fillStyle = '#05070a';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = '#ff7b72';
      ctx.font = '12px sans-serif';
      ctx.fillText('No waveform: ' + sim.warnings.join('; ').slice(0, 80), 10, 20);
      return;
    }
    let raf = 0;
    let last = performance.now();
    let scroll = 0;
    const draw = (t: number) => {
      const dt = Math.min(t - last, 100);
      last = t;
      scroll += dt / 1000;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = cv.clientWidth || 520;
      const cssH = 180;
      cv.width = Math.round(cssW * dpr);
      cv.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const W = cssW, H = cssH;
      ctx.fillStyle = '#05070a';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1;
      for (let y = 20; y < H; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      const N = sim.iWave.length;
      const iMax = Math.max(...sim.iWave, 0.01);
      const vAbs = sim.vWave.map((v) => Math.abs(v));
      const vAvg = vAbs.reduce((a, b) => a + b, 0) / N;
      const vDev = Math.max(...vAbs.map((v) => Math.abs(v - vAvg)), 1e-6);
      const off = Math.floor(scroll * 60) % N;
      const at = (arr: number[], x: number) => arr[(Math.floor((x / W) * N) + off) % N];
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x < W; x++) {
        const y = 120 - (at(sim.iWave, x) / iMax) * 90;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.strokeStyle = '#00d4ff';
      ctx.beginPath();
      for (let x = 0; x < W; x++) {
        const y = 150 - ((at(vAbs, x) - vAvg) / vDev) * 12;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.fillStyle = '#888';
      ctx.font = '11px sans-serif';
      ctx.fillText(`iL pk=${sim.iPeak.toFixed(2)}A D=${(sim.D * 100).toFixed(1)}%`, 8, 14);
      ctx.fillText(`Vout ${sim.vAvgAbs.toFixed(2)}V ±${(sim.vRipple * 1000).toFixed(0)}mV`, 8, 168);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [pcb]);

  if (!pcb) return null;
  return (
    <div>
      <canvas ref={ref} style={{ width: '100%', height: 180, borderRadius: 12, border: '1px solid var(--card-border)' }} />
    </div>
  );
}
