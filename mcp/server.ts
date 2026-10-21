#!/usr/bin/env node
// FOSS-PCB MCP server (stdio, JSON-RPC 2.0, one message per line).
// Exposes the app's own libraries so assistants read/check/export the same
// boards the GUI does. No accounts: distributor keys come from the env.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as readline from 'node:readline';

import { LIBRARY } from '../lib/library';
import { FossPcbJson, type FossPcb } from '../lib/foss-schema';
import { readBoardFile, serializeBoard } from '../lib/board-io';
import { runDrc } from '../lib/drc';
import { fossToKicadPcb } from '../lib/kicad-io';
import {
  runCatalogSearch,
  lcscSearchUrl,
  type CatalogCredentials,
  type CatalogProvider,
} from '../lib/catalog';

const VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../../package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.1.0';
  } catch {
    return '0.1.0';
  }
})();

const SERVER_NAME = 'foss-pcb';
const SUPPORTED_PROTOCOLS = ['2024-11-05', '2025-03-26', '2025-06-18'];
const LATEST_PROTOCOL = '2025-06-18';

// ------------------------------------------------------------------- schema

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const obj = (properties: Record<string, unknown>, required: string[]): Record<string, unknown> => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

const TOOLS: ToolDef[] = [
  {
    name: 'library_search',
    description:
      'Search the curated part library by MPN, value, footprint, role or verified LCSC code. ' +
      'Only parts returned here have a verified footprint and LCSC code; never invent parts.',
    inputSchema: obj(
      {
        query: { type: 'string', description: 'MPN, value (e.g. "10k"), footprint, role or LCSC code' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max results (default 20)' },
      },
      ['query'],
    ),
  },
  {
    name: 'board_summary',
    description: 'Read a .foss.json board: size, layer count, components with placements, and nets.',
    inputSchema: obj({ board: { type: 'string', description: 'Path to a .foss.json board or project envelope' } }, ['board']),
  },
  {
    name: 'board_drc',
    description:
      'Run the app DRC (bounds, clearance, pads, zone rules) on a .foss.json board. ' +
      'Returns errors and warnings without modifying the file.',
    inputSchema: obj({ board: { type: 'string', description: 'Path to a .foss.json board' } }, ['board']),
  },
  {
    name: 'export_kicad',
    description:
      'Export a .foss.json board to a loadable .kicad_pcb (same emitter as the app). ' +
      'Defaults to a sibling file with the .kicad_pcb extension.',
    inputSchema: obj(
      {
        board: { type: 'string', description: 'Path to a .foss.json board' },
        out: { type: 'string', description: 'Output .kicad_pcb path' },
      },
      ['board'],
    ),
  },
  {
    name: 'place_part',
    description:
      'Add one verified library part to a board and write the result to a NEW file. ' +
      'Every pin is initially on GND (same as the app); rewire nets afterwards.',
    inputSchema: obj(
      {
        board: { type: 'string', description: 'Input .foss.json board (never overwritten)' },
        mpn: { type: 'string', description: 'Exact MPN from library_search' },
        x: { type: 'number', description: 'Placement X in mm (inside the board)' },
        y: { type: 'number', description: 'Placement Y in mm (inside the board)' },
        out: { type: 'string', description: 'Output path, different from the input' },
        designator: { type: 'string', description: 'Optional designator; defaults to the next prefix (R1, C2…)' },
        rotation: { type: 'number', description: 'Rotation in degrees (default 0)' },
        layer: { type: 'string', enum: ['Top', 'Bottom'], description: 'Placement layer (default Top)' },
      },
      ['board', 'mpn', 'x', 'y', 'out'],
    ),
  },
  {
    name: 'catalog_search',
    description:
      'Live distributor search (Mouser or DigiKey) using keys from the environment ' +
      '(MOUSER_API_KEY, or DIGIKEY_CLIENT_ID + DIGIKEY_CLIENT_SECRET). ' +
      'LCSC has no public API — use LCSC links instead. Results are ordering data only.',
    inputSchema: obj(
      {
        query: { type: 'string', description: 'Keyword or MPN' },
        provider: { type: 'string', enum: ['mouser', 'digikey'] },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max results (default 10)' },
      },
      ['query', 'provider'],
    ),
  },
];

// -------------------------------------------------------------- tool helpers

type Args = Record<string, unknown>;

function strArg(args: Args, key: string, required = true): string {
  const v = args[key];
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (required) throw new Error(`Missing required string argument "${key}".`);
  return '';
}

function numArg(args: Args, key: string, required = true): number {
  const v = args[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  if (required) throw new Error(`Missing required number argument "${key}".`);
  return 0;
}

function optNumArg(args: Args, key: string): number | undefined {
  if (args[key] === undefined || args[key] === null || args[key] === '') return undefined;
  return numArg(args, key);
}

function optStrArg(args: Args, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function text(value: unknown): { content: { type: 'text'; text: string }[]; isError?: boolean } {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

function toolError(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

function nextDesignator(pcb: FossPcb, prefix: string): string {
  const nums = pcb.components
    .filter((c) => c.designator.startsWith(prefix))
    .map((c) => parseInt(c.designator.slice(prefix.length), 10))
    .filter((n) => Number.isFinite(n));
  return `${prefix}${(nums.length ? Math.max(...nums) : 0) + 1}`;
}

// -------------------------------------------------------------- tool handlers

async function callTool(name: string, raw: Args): Promise<ReturnType<typeof text> | ReturnType<typeof toolError>> {
  switch (name) {
    case 'library_search': {
      const query = strArg(raw, 'query');
      const limitRaw = optNumArg(raw, 'limit');
      const limit = Math.min(Math.max(1, Math.floor(limitRaw ?? 20)), 100);
      const q = query.toLowerCase();
      const hits = LIBRARY.filter((p) =>
        [p.mpn, p.value, p.footprint, p.role, p.type, p.lcsc ?? ''].some((f) => f.toLowerCase().includes(q)),
      ).slice(0, limit);
      return text({
        provider: 'library',
        query,
        count: hits.length,
        parts: hits.map((p) => ({
          mpn: p.mpn,
          type: p.type,
          value: p.value,
          footprint: p.footprint,
          pins: p.pins,
          role: p.role,
          lcsc: p.lcsc ?? null,
        })),
      });
    }

    case 'board_summary': {
      const file = readBoardFile(strArg(raw, 'board'));
      const pcb = file.pcb;
      const spec = pcb.project_metadata.pcb_specifications;
      return text({
        file: file.path,
        name: pcb.project_metadata.design_name,
        revision: pcb.project_metadata.revision,
        board_mm: { width: spec.board_width_mm, height: spec.board_height_mm, layers: spec.layers },
        counts: {
          components: pcb.components.length,
          nets: pcb.nets.length,
          traces: pcb.pcb_traces.length,
          zones: pcb.pcb_layout_zones.length,
          wires: pcb.schematic_wires.length,
        },
        components: pcb.components.map((c) => ({
          designator: c.designator,
          mpn: c.mpn,
          value: c.value,
          footprint: c.footprint,
          placement: c.pcb_placement_mm,
          pins: c.pins,
        })),
        nets: pcb.nets.map((n) => ({
          net: n.net_name,
          nodes: n.nodes,
          trace_width_mm: n.trace_width_mm,
          clearance_mm: n.clearance_mm,
        })),
      });
    }

    case 'board_drc': {
      const file = readBoardFile(strArg(raw, 'board'));
      const issues = runDrc(file.pcb);
      const errors = issues.filter((i) => i.severity === 'error');
      const warnings = issues.filter((i) => i.severity === 'warning');
      return text({
        file: file.path,
        ok: errors.length === 0,
        errors: errors.length,
        warnings: warnings.length,
        issues,
      });
    }

    case 'export_kicad': {
      const boardPath = strArg(raw, 'board');
      const file = readBoardFile(boardPath);
      const pcb = file.pcb;
      const out =
        optStrArg(raw, 'out') ??
        boardPath.replace(/\.foss\.json$/i, '').replace(/\.json$/i, '') + '.kicad_pcb';
      const body = fossToKicadPcb(pcb);
      writeFileSync(out, body, 'utf8');
      return text({
        out,
        bytes: Buffer.byteLength(body, 'utf8'),
        components: pcb.components.length,
        traces: pcb.pcb_traces.length,
        nets: pcb.nets.length,
        note: 'Load in KiCad, or verify with: kicad-cli pcb drc <file>',
      });
    }

    case 'place_part': {
      const boardPath = strArg(raw, 'board');
      const mpn = strArg(raw, 'mpn');
      const x = numArg(raw, 'x');
      const y = numArg(raw, 'y');
      const out = strArg(raw, 'out');
      if (resolve(out) === resolve(boardPath))
        throw new Error('Refusing to overwrite the input board — choose a different "out" path.');

      const part = LIBRARY.find((p) => p.mpn.toLowerCase() === mpn.toLowerCase());
      if (!part) {
        const q = mpn.toLowerCase();
        const close = LIBRARY.filter((p) => p.mpn.toLowerCase().includes(q) || p.value.toLowerCase() === q)
          .slice(0, 3)
          .map((p) => p.mpn);
        throw new Error(
          `Unknown MPN "${mpn}". Only verified library parts can be placed; run library_search first.` +
            (close.length ? ` Close matches: ${close.join(', ')}.` : ''),
        );
      }

      const file = readBoardFile(boardPath);
      const pcb = file.pcb;
      const spec = pcb.project_metadata.pcb_specifications;
      if (x < 0 || x > spec.board_width_mm || y < 0 || y > spec.board_height_mm)
        throw new Error(
          `(${x}, ${y}) is outside the ${spec.board_width_mm}×${spec.board_height_mm} mm board.`,
        );

      const layer = (optStrArg(raw, 'layer') ?? 'Top') as 'Top' | 'Bottom';
      if (layer !== 'Top' && layer !== 'Bottom') throw new Error('"layer" must be "Top" or "Bottom".');

      const designator = optStrArg(raw, 'designator') ?? nextDesignator(pcb, part.prefix);
      if (pcb.components.some((c) => c.designator === designator))
        throw new Error(`Designator "${designator}" already exists on this board.`);

      const pins: Record<string, string> = {};
      part.pins.forEach((p) => {
        pins[p] = 'GND';
      });

      const i = pcb.components.length;
      const next: FossPcb = {
        ...pcb,
        components: [
          ...pcb.components,
          {
            designator,
            type: part.type,
            value: part.value,
            mpn: part.mpn,
            footprint: part.footprint,
            pins,
            schematic_pos: { x: 100 + (i % 8) * 80, y: 150 + Math.floor(i / 8) * 90, rotation: 0 },
            pcb_placement_mm: { x, y, rotation: numArg(raw, 'rotation', false), layer },
          },
        ],
      };
      const check = FossPcbJson.safeParse(next);
      if (!check.success)
        throw new Error(`Placement produced an invalid board: ${check.error.issues[0]?.message ?? 'schema error'}`);

      writeFileSync(out, serializeBoard(file, check.data), 'utf8');
      return text({
        out,
        designator,
        mpn: part.mpn,
        footprint: part.footprint,
        pins,
        components: check.data.components.length,
        note: 'Every pin is on GND — rewire nets before routing or export.',
      });
    }

    case 'catalog_search': {
      const query = strArg(raw, 'query');
      const provider = strArg(raw, 'provider');
      if (provider !== 'mouser' && provider !== 'digikey')
        throw new Error('"provider" must be "mouser" or "digikey". LCSC has no public API.');

      const mouserKey = process.env.MOUSER_API_KEY ?? '';
      const dkId = process.env.DIGIKEY_CLIENT_ID ?? '';
      const dkSecret = process.env.DIGIKEY_CLIENT_SECRET ?? '';
      if (provider === 'mouser' && !mouserKey)
        throw new Error('Set MOUSER_API_KEY in the environment for Mouser search.');
      if (provider === 'digikey' && (!dkId || !dkSecret))
        throw new Error('Set DIGIKEY_CLIENT_ID and DIGIKEY_CLIENT_SECRET for DigiKey search.');

      const creds: CatalogCredentials =
        provider === 'mouser'
          ? { mouser: { apiKey: mouserKey } }
          : { digikey: { clientId: dkId, clientSecret: dkSecret } };
      const limit = Math.min(Math.max(1, Math.floor(optNumArg(raw, 'limit') ?? 10)), 50);
      const result = await runCatalogSearch({ provider: provider as CatalogProvider, query, limit }, creds);
      return text({
        ...result,
        lcsc_search_url: lcscSearchUrl(query),
        note:
          result.note ??
          'Ordering data only — a catalog row is not a verified footprint. Use place_part only for library matches.',
      });
    }

    default:
      throw new Error(`Unknown tool "${name}".`);
  }
}

// --------------------------------------------------------------- JSON-RPC

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id: string | number | null, result: unknown): void {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id: string | number | null, code: number, message: string): void {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

interface RpcMessage {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: { protocolVersion?: unknown; name?: unknown; arguments?: unknown };
}

async function handle(msg: RpcMessage): Promise<void> {
  const id = msg.id === undefined ? null : msg.id;
  const isNotification = msg.id === undefined || msg.id === null;

  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    replyError(id, -32600, 'Invalid Request');
    return;
  }

  switch (msg.method) {
    case 'initialize': {
      const requested = msg.params?.protocolVersion;
      const version =
        typeof requested === 'string' && SUPPORTED_PROTOCOLS.includes(requested) ? requested : LATEST_PROTOCOL;
      reply(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: VERSION },
        instructions:
          'FOSS-PCB board tools. Search the verified library, then read/DRC/export boards. ' +
          'Catalog rows are ordering data only — never treat them as verified footprints.',
      });
      return;
    }
    case 'notifications/initialized':
      return;
    case 'ping':
      if (!isNotification) reply(id, {});
      return;
    case 'tools/list':
      if (!isNotification) reply(id, { tools: TOOLS });
      return;
    case 'tools/call': {
      if (isNotification) return;
      const name = typeof msg.params?.name === 'string' ? msg.params.name : '';
      if (!TOOLS.some((t) => t.name === name)) {
        replyError(id, -32602, `Unknown tool: ${name}`);
        return;
      }
      const args = (msg.params?.arguments ?? {}) as Args;
      try {
        reply(id, await callTool(name, args));
      } catch (e: any) {
        reply(id, toolError(`Error: ${e?.message ?? e}`));
      }
      return;
    }
    default:
      if (!isNotification) replyError(id, -32601, `Method not found: ${msg.method}`);
  }
}

function main(): void {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let queue: Promise<void> = Promise.resolve();

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: RpcMessage;
    try {
      msg = JSON.parse(trimmed) as RpcMessage;
    } catch {
      replyError(null, -32700, 'Parse error');
      return;
    }
    queue = queue.then(() => handle(msg)).catch((e: any) => {
      process.stderr.write(`foss-pcb-mcp: ${e?.message ?? e}\n`);
    });
  });

  rl.on('close', () => {
    queue.finally(() => {
      process.exitCode = 0;
    });
  });

  process.stderr.write(`foss-pcb-mcp ${VERSION} ready (stdio)\n`);
}

main();
