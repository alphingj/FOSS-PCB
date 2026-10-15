// footprint -> approximate 3D body size in mm [w, h, d]. Procedural MVP; STEP import later.
export function bodySizeForFootprint(fp: string): [number, number, number] {
  if (fp.includes('0805') || fp.includes('2012Metric')) return [2, 1.25, 0.9];
  if (fp.includes('SOIC-8')) return [5, 4, 1.75];
  if (fp.includes('SMA')) return [4.5, 2.5, 2.2];
  if (fp.includes('6.3x7.7')) return [6.6, 6.6, 7.7];
  if (fp.includes('SRR1280')) return [12.5, 12.5, 8];
  if (fp.includes('MKDS')) return [10, 9, 12];
  return [4, 4, 1.5];
}

export function colorForType(t: string): string {
  if (t.includes('Resistor')) return '#1a1a1a';
  if (t.includes('Capacitor')) return '#2b2f6b';
  if (t.includes('Inductor')) return '#3d3d3d';
  if (t.includes('MOSFET') || t.includes('IC_')) return '#111111';
  if (t.includes('Diode')) return '#7a2a00';
  if (t.includes('Connector')) return '#0a6c2f';
  return '#444444';
}
