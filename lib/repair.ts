// Validator-repair: collect machine-checkable problems (parse, DRC errors,
// ERC errors, unfixable grounding issues) as LLM-readable lines for the
// repair loop. Warnings are reported, never repair triggers.
import type { FossPcb } from './foss-schema';
import { runDrc } from './drc';
import { runErc } from './erc';
import { groundBoard } from './grounding';

export function validationErrors(pcb: FossPcb): string[] {
  const out: string[] = [];
  for (const i of runDrc(pcb)) if (i.severity === 'error') out.push(`DRC: ${i.message}`);
  for (const i of runErc(pcb)) if (i.severity === 'error') out.push(`ERC: ${i.message}`);
  for (const i of groundBoard(pcb)) {
    if (i.kind === 'unknown-footprint' || i.kind === 'pin-mismatch') out.push(`LIB: ${i.message}`);
  }
  return out;
}

export function repairPrompt(original: string, problems: string[]): string {
  return [
    `The previous board for "${original}" has these machine-checked problems:`,
    ...problems.map((p) => `- ${p}`),
    'Return the FULL three sections again (BOM, netlist, JSON) with every problem fixed. Do not explain, just output the corrected design.',
  ].join('\n');
}
