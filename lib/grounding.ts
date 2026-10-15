// Grounding: constrain AI-generated boards to real library parts.
// Reports issues and produces a fixed board for SAFE cases only:
// MPN rebrand (same footprint+value+compatible pins). Anything that would
// rewire nets is reported, never auto-applied.
import type { FossPcb } from './foss-schema';
import { findByFootprintValue, suggestSameType, KNOWN_FOOTPRINTS, type LibraryPart } from './library';

export interface GroundIssue {
  designator: string;
  kind: 'mpn-rebrand' | 'unknown-footprint' | 'unknown-value' | 'pin-mismatch';
  message: string;
  suggestion?: LibraryPart;
  /** true when applyFixes() may safely rewrite this component */
  autoFixable: boolean;
}

export function groundBoard(pcb: FossPcb): GroundIssue[] {
  const issues: GroundIssue[] = [];
  for (const c of pcb.components) {
    if (c.type === 'Imported') continue; // file imports are user-verified
    const exact = findByFootprintValue(c.footprint, c.value);
    if (exact) {
      if (exact.mpn.toLowerCase() !== (c.mpn || '').toLowerCase()) {
        const pinOk = exact.pins.every((p) => p in c.pins) && Object.keys(c.pins).every((p) => exact.pins.includes(p));
        issues.push({
          designator: c.designator,
          kind: 'mpn-rebrand',
          message: `${c.designator}: MPN "${c.mpn || '(blank)'}" not stocked — library stocks ${exact.mpn}`,
          suggestion: exact,
          autoFixable: pinOk,
        });
        if (!pinOk) {
          issues[issues.length - 1].kind = 'pin-mismatch';
          issues[issues.length - 1].message += ` (pin labels differ: board [${Object.keys(c.pins)}] vs library [${exact.pins}] — rewire manually)`;
          issues[issues.length - 1].autoFixable = false;
        }
      }
      continue;
    }
    if (!KNOWN_FOOTPRINTS.has(c.footprint)) {
      const s = suggestSameType(c.type, c.value);
      issues.push({
        designator: c.designator,
        kind: 'unknown-footprint',
        message: `${c.designator}: footprint "${c.footprint}" not in library${s ? ` — closest: ${s.mpn} (${s.footprint})` : ''}`,
        suggestion: s,
        autoFixable: false,
      });
      continue;
    }
    const s = suggestSameType(c.type, c.value);
    issues.push({
      designator: c.designator,
      kind: 'unknown-value',
      message: `${c.designator}: value "${c.value}" not stocked for ${c.footprint}${s ? ` — closest: ${s.value} (${s.mpn})` : ''}`,
      suggestion: s,
      autoFixable: false,
    });
  }
  return issues;
}

/** Apply only autoFixable rebrands; returns the fixed board + applied count. */
export function applyGroundFixes(pcb: FossPcb, issues: GroundIssue[]): { pcb: FossPcb; applied: number } {
  const fixable = new Map(issues.filter((i) => i.autoFixable && i.suggestion).map((i) => [i.designator, i.suggestion!]));
  if (!fixable.size) return { pcb, applied: 0 };
  return {
    pcb: {
      ...pcb,
      components: pcb.components.map((c) => {
        const s = fixable.get(c.designator);
        return s ? { ...c, mpn: s.mpn } : c;
      }),
    },
    applied: fixable.size,
  };
}
