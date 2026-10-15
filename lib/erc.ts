import type { FossPcb } from './foss-schema';

export interface ErcIssue { severity: 'error' | 'warning'; message: string }

/** Electrical Rule Check: floating pins, missing power flags, single-pin nets. */
export function runErc(pcb: FossPcb): ErcIssue[] {
  const issues: ErcIssue[] = [];
  const pinNets = new Map<string, string>();
  for (const n of pcb.nets) for (const node of n.nodes) pinNets.set(node, n.net_name);

  for (const c of pcb.components) {
    for (const [pin, net] of Object.entries(c.pins)) {
      const node = `${c.designator}.${pin}`;
      if (node.includes('.') && !pinNets.has(node))
        issues.push({ severity: 'warning', message: `${node} (${net}) not in any net` });
    }
  }
  for (const n of pcb.nets) {
    if (n.nodes.length < 2)
      issues.push({ severity: 'error', message: `Net ${n.net_name} has <2 pins` });
  }
  const hasVcc = pcb.nets.some((n) => /VIN|VCC|VOUT|5V|3V3/i.test(n.net_name));
  if (!hasVcc) issues.push({ severity: 'warning', message: 'No power net detected (VIN/VCC/VOUT)' });
  return issues;
}
