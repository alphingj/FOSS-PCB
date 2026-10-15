// Parse engineering value strings ("10R", "4.7k", "100nF", "47uH_3.5A") into SI units.
// Returns NaN when unparseable — callers decide fallbacks and must surface them.

/** Coerce AI/UX values that may arrive as strings ("12V", "100kHz") or garbage. */
export function toNum(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const m = v.replace(/,/g, '').match(/-?\d+(\.\d+)?([kKmMuU]?)/);
    if (!m) return fallback;
    let n = parseFloat(m[0]);
    const suf = (m[2] || '').toLowerCase();
    if (suf === 'k') n *= 1e3;
    else if (suf === 'm' && /hz|ohm|ω/i.test(v)) n *= 1e6;
    else if (suf === 'm' && /a/i.test(v)) n *= 1e-3;
    else if (suf === 'u') n *= 1e-6;
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}
export function parseResistance(s: string): number {
  const m = s.replace(/,/g, '').match(/(\d+(\.\d+)?)\s*([kKmM]?)(?:ohm|Ω|R\b|R(?=_|$))/i)
    ?? s.replace(/,/g, '').match(/(\d+(\.\d+)?)\s*([kKmM]?)\s*$/);
  if (!m) return NaN;
  let n = parseFloat(m[1]);
  const suf = (m[3] || '').toLowerCase();
  if (suf === 'k') n *= 1e3;
  else if (suf === 'm') n *= 1e6;
  return n;
}

export function parseCapacitance(s: string): number {
  const m = s.replace(/,/g, '').match(/(\d+(\.\d+)?)\s*([pPnNuU])?F/i);
  if (!m) return NaN;
  let n = parseFloat(m[1]);
  const suf = (m[3] || '').toLowerCase();
  if (suf === 'p') n *= 1e-12;
  else if (suf === 'n') n *= 1e-9;
  else if (suf === 'u') n *= 1e-6;
  return n; // bare "F" stays in farads
}

export function parseInductance(s: string): number {
  const m = s.replace(/,/g, '').match(/(\d+(\.\d+)?)\s*([mMuU])?H/i);
  if (!m) return NaN;
  let n = parseFloat(m[1]);
  const suf = (m[3] || '').toLowerCase();
  if (suf === 'm') n *= 1e-3;
  else if (suf === 'u') n *= 1e-6;
  return n;
}

export function parseCurrent(s: string): number {
  const m = s.replace(/,/g, '').match(/(\d+(\.\d+)?)\s*A/i);
  return m ? parseFloat(m[1]) : NaN;
}
