// Reading and writing .foss.json boards outside the browser (CLI and MCP).
// Accepts both the project envelope {app, version, name, pcb, ...} and a bare
// board object, and preserves envelope metadata when rewriting.
import { existsSync, readFileSync } from 'node:fs';

import { FossPcbJson, type FossPcb } from './foss-schema';

export interface BoardFile {
  path: string;
  /** The board, whether it came from an envelope or was the root object. */
  pcb: FossPcb;
  /** True when the file was a {app, version, name, pcb} project envelope. */
  envelope: boolean;
  /** Original parsed document, so rewrite keeps id/name/version fields. */
  raw: Record<string, unknown>;
}

export function readBoardFile(file: string): BoardFile {
  if (!existsSync(file)) throw new Error(`File not found: ${file}`);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e: any) {
    throw new Error(`Cannot read ${file}: ${e?.message ?? e}`);
  }
  let obj: any;
  try {
    obj = JSON.parse(text);
  } catch (e: any) {
    throw new Error(`${file} is not JSON: ${e?.message ?? e}`);
  }
  const envelope = !!obj && typeof obj === 'object' && 'pcb' in obj;
  const parsed = FossPcbJson.safeParse(envelope ? obj.pcb : obj);
  if (!parsed.success) {
    const details = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`${file} is not a valid FOSS board — ${details}`);
  }
  return { path: file, pcb: parsed.data, envelope, raw: envelope ? obj : {} };
}

/** Serialize a board back to disk, refreshing `updatedAt` for envelopes. */
export function serializeBoard(file: BoardFile, pcb: FossPcb): string {
  const out = file.envelope ? { ...file.raw, pcb, updatedAt: Date.now() } : pcb;
  return `${JSON.stringify(out, null, 2)}\n`;
}
