// Parse engineering value strings ("10R", "4.7k", "100nF", "47uH_3.5A") into SI units.
// Returns NaN when unparseable — callers decide fallbacks and must surface them.

/** Coerce AI/UX values that may arrive as strings ("12V", "100kHz") or garbage. */
export function toNum(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const m = v.replace(/,/g, '').match(/-?\d+(\.\d+)?([kKmMuU]?)/);
    if (!m) return fallback;
    let n = parseFloat(m[0]);
    // Same case rule as parseResistance: uppercase 'M' is mega, lowercase 'm'
    // is milli (10mΩ = 0.01Ω, 5mA = 0.005A). Megahertz is always written
    // uppercase 'M', so there is no real ambiguity left to guess at.
    const suf = m[2] || '';
    if (suf === 'k' || suf === 'K') n *= 1e3;
    else if (suf === 'M') n *= 1e6;
    else if (suf === 'm') n *= 1e-3;
    else if (suf === 'u' || suf === 'U') n *= 1e-6;
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}
export function parseResistance(s: string): number {
  const clean = s.replace(/,/g, '');
  // European notation is written solid: 4K7 -> 4700, 4M7 -> 4.7M, 4R7 -> 4.7
  // No whitespace allowed inside: real notation is written solid ("4K7").
  // Allowing spaces made "10k 0603" parse as 10.0603k = 10060 ohm.
  const eurK = clean.match(/^(\d+)[kK](\d+)$/);
  if (eurK) return parseFloat(`${eurK[1]}.${eurK[2]}`) * 1e3;
  const eurM = clean.match(/^(\d+)[mM](\d+)$/);
  if (eurM) return parseFloat(`${eurM[1]}.${eurM[2]}`) * 1e6;
  const eurR = clean.match(/^(\d+)[Rr](\d+)$/);
  if (eurR) return parseFloat(`${eurR[1]}.${eurR[2]}`);
  const eurU = clean.match(/^(\d+)[uµμ](\d+)$/);
  if (eurU) return parseFloat(`${eurU[1]}.${eurU[2]}`);
  // The value must be the FIRST thing in the string. An unanchored search
  // happily returned 603 for "100nF 0603" and 2.54 for the footprint
  // "2x04_P2.54", and part numbers like "AO3400" parsed as 3400 ohm.
  // Trailing package/rating text after a valid value is still allowed.
  const m = clean.match(/^(\d+(?:\.\d+)?)\s*([kKmM]?)(?=ohm|Ω|R\b|R(?=_|$)|\s|_|$)/i);
  if (!m) return NaN;
  let n = parseFloat(m[1]);
  // Case is meaningful: 'M' = mega, 'm' = milli (10mΩ = 0.01Ω, a real
  // current-sense value). Reading lowercase m as mega produced 10 MΩ.
  const suf = m[2] || '';
  if (suf === 'k' || suf === 'K') n *= 1e3;
  else if (suf === 'M') n *= 1e6;
  else if (suf === 'm') n *= 1e-3;
  return n;
}

/** European solid-notation prefix: "4n7" -> 4.7, "1R2" -> 1.2. Returns the
 *  multiplier for the digit that follows the letter, or null if not that form. */
function european(s: string, unit: RegExp): { n: number; mult: number } | null {
  const m = s.replace(/,/g, '').match(/^(\d+)([pPnNuUmMkKMgGµμRr])(\d{1,2})$/);
  if (!m) return null;
  const suffix = m[2];
  const mult =
    suffix === 'p' || suffix === 'P' ? 1e-12
    : suffix === 'n' || suffix === 'N' ? 1e-9
    : suffix === 'u' || suffix === 'U' || suffix === 'µ' || suffix === 'μ' ? 1e-6
    : suffix === 'm' ? 1e-3
    : suffix === 'k' || suffix === 'K' ? 1e3
    : suffix === 'M' ? 1e6
    : suffix === 'G' || suffix === 'g' ? 1e9
    : 1; // R
  // The letter must be the one this parser owns, otherwise "4k7" would be
  // read as 4.7 farads.
  const owns = unit.test(suffix);
  if (!owns) return null;
  return { n: parseFloat(`${m[1]}.${m[3]}`) * mult, mult };
}

export function parseCapacitance(s: string): number {
  const eur = european(s, /^[pPnNuUmMµμ]$/);
  if (eur) return eur.n;
  // Value must lead the string — see parseResistance for why. "16MHz"
  // (a crystal) must not parse as 16 farads.
  const m = s.replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*([pPnNmMuUµμ]?)\s*F/i);
  if (!m) return NaN;
  let n = parseFloat(m[1]);
  // 'mF' = millifarad (a real 400mH-ish bulk cap size); 'M' before F would
  // be megafarad, which does not exist, so lowercase m is unambiguous here.
  const suf = m[2] || '';
  if (suf === 'p' || suf === 'P') n *= 1e-12;
  else if (suf === 'n' || suf === 'N') n *= 1e-9;
  else if (suf === 'u' || suf === 'U' || suf === 'µ' || suf === 'μ') n *= 1e-6;
  else if (suf === 'm') n *= 1e-3;
  return n; // bare "F" stays in farads
}

export function parseInductance(s: string): number {
  // Anchored, and (?!z) so "16MHz" (a crystal) is not read as 16 H.
  const eur = european(s, /^[nNuUmMµμ]$/);
  if (eur) return eur.n;
  // Anchored, and (?!z) so "16MHz" is not read as 16 H.
  const m = s.replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*([nNuUmµμ]?)\s*H(?!z)/i);
  if (!m) return NaN;
  let n = parseFloat(m[1]);
  const suf = m[2] || '';
  if (suf === 'p' || suf === 'P') n *= 1e-12;
  else if (suf === 'n' || suf === 'N') n *= 1e-9;
  else if (suf === 'm') n *= 1e-3;          // 10mH = 10 millihenry
  else if (suf === 'u' || suf === 'U' || suf === 'µ' || suf === 'μ') n *= 1e-6;
  return n;
}

export function parseCurrent(s: string): number {
  // Rating may trail a value ("47uH_3.5A") or lead one ("3.3V_1A"), so this
  // one stays unanchored — but the multiplier must be handled, since
  // "150mA" is 0.15 A, not 150.
  const m = s.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([mMkKMuUµμ]?)\s*A(?![a-z])/i);
  if (!m) return NaN;
  let n = parseFloat(m[1]);
  const suf = m[2] || '';
  if (suf === 'm') n *= 1e-3;
  else if (suf === 'u' || suf === 'U' || suf === 'µ' || suf === 'μ') n *= 1e-6;
  else if (suf === 'k' || suf === 'K') n *= 1e3;
  return n;
}
