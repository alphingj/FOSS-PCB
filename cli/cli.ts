#!/usr/bin/env node
// FOSS-PCB command line: search parts, validate a board (DRC) and export KiCad.
// It uses the same TypeScript libraries as the app, so results cannot drift.
//
// Exit codes: 0 success / no DRC errors, 1 DRC errors or a failed operation,
// 2 usage or invalid-input errors.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { LIBRARY } from '../lib/library';
import { type FossPcb } from '../lib/foss-schema';
import { readBoardFile } from '../lib/board-io';
import { runDrc } from '../lib/drc';
import { fossToKicadPcb } from '../lib/kicad-io';
import { SAMPLE_BUCKBOOST } from '../lib/sample-buckboost';
import { runCatalogSearch, lcscSearchUrl, type CatalogProvider, type CatalogCredentials } from '../lib/catalog';

const VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../../package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.1.0';
  } catch {
    return '0.1.0'; // compiled away from the repo — still a usable version string
  }
})();

class CliError extends Error {
  code: number;
  constructor(message: string, code = 2) {
    super(message);
    this.code = code;
  }
}

interface Args {
  positional: string[];
  flags: Map<string, string | boolean>;
}

const VALUE_FLAGS = new Set(['provider', 'limit', 'out', 'o']);

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('-') || a === '-') {
      positional.push(a);
      continue;
    }
    const name = a.replace(/^--?/, '');
    if (name.includes('=')) {
      const [k, ...v] = name.split('=');
      flags.set(k, v.join('='));
      continue;
    }
    if (VALUE_FLAGS.has(name)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('-')) throw new CliError(`--${name} needs a value.`);
      flags.set(name, v);
      i++;
      continue;
    }
    flags.set(name, true);
  }
  return { positional, flags };
}

function flagStr(args: Args, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = args.flags.get(n);
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function flagNum(args: Args, name: string, fallback: number): number {
  const raw = flagStr(args, name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) throw new CliError(`--${name} must be a positive number.`);
  return Math.floor(n);
}

// ------------------------------------------------------------------- output

function pad(s: string, n: number): string {
  const t = s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s;
  return t.padEnd(n);
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

interface CliPart {
  mpn: string;
  manufacturer?: string;
  description?: string;
  package?: string;
  stock?: number;
  unitPrice?: number;
  currency?: string;
  lcsc?: string;
  footprint?: string;
  value?: string;
  role?: string;
  distributorPart?: string;
  datasheetUrl?: string;
  productUrl?: string;
}

function printParts(provider: string, query: string, parts: CliPart[], total?: number): void {
  if (!parts.length) {
    process.stdout.write(`No matches for "${query}" (${provider}).\n`);
    return;
  }
  const widths = [26, 18, 16, 10, 12, 8];
  const rows = parts.map((p) =>
    [
      pad(p.mpn, widths[0]),
      pad(p.manufacturer ?? '—', widths[1]),
      pad(p.package ?? p.footprint ?? '—', widths[2]),
      pad(typeof p.stock === 'number' ? p.stock.toLocaleString('en-US') : '—', widths[3]),
      pad(
        typeof p.unitPrice === 'number'
          ? `${p.currency ?? ''}${p.unitPrice < 1 ? p.unitPrice.toFixed(4) : p.unitPrice.toFixed(2)}`
          : '—',
        widths[4],
      ),
      p.lcsc ?? '',
    ].join(' ').trimEnd(),
  );
  const header = ['MPN', 'MANUFACTURER', 'PACKAGE', 'STOCK', 'PRICE', 'LCSC']
    .map((h, i) => pad(h, widths[i]))
    .join(' ')
    .trimEnd();
  process.stdout.write(`${header}\n${'-'.repeat(Math.max(header.length, 40))}\n${rows.join('\n')}\n`);
  if (typeof total === 'number' && total > parts.length)
    process.stdout.write(`\nShowing ${parts.length} of ${total} matches.\n`);
}

// -------------------------------------------------------------------- board

function readBoard(file: string): FossPcb {
  try {
    return readBoardFile(file).pcb;
  } catch (e: any) {
    throw new CliError(e?.message ?? String(e));
  }
}

// ------------------------------------------------------------------ commands

function help(): void {
  process.stdout.write(
    `FOSS-PCB CLI ${VERSION} — search parts, check DRC, export KiCad (Node 20+)

Usage:
  foss-pcb search <query> [--json] [--limit N] [--live --provider mouser|digikey]
  foss-pcb drc <board.foss.json> [--json]
  foss-pcb export-kicad <board.foss.json> [--out file.kicad_pcb] [--stdout]
  foss-pcb demo [--out foss-demo.foss.json]
  foss-pcb --version | --help

Search:
  Default search is the offline curated library (verified MPNs, LCSC codes and
  footprints). --live queries a distributor with keys from the environment:
    Mouser:  MOUSER_API_KEY
    DigiKey: DIGIKEY_CLIENT_ID and DIGIKEY_CLIENT_SECRET
  LCSC has no public API — use the printed LCSC links instead.

DRC / export:
  Input is a .foss.json project (envelope {app, pcb} or a bare board object).
  DRC exits 1 when it finds errors, 0 when clean or warnings-only.
  export-kicad writes a loadable .kicad_pcb next to the input by default.

Exit codes: 0 ok · 1 DRC errors / failed operation · 2 usage or invalid input
`,
  );
}

function cmdSearch(args: Args): void {
  const query = args.positional.slice(1).join(' ').trim();
  if (!query) throw new CliError('Usage: foss-pcb search <query> [--json] [--limit N]');
  const limit = flagNum(args, 'limit', 20);
  const provider = flagStr(args, 'provider');
  const nq = query.toLowerCase();
  const hits = LIBRARY.filter((p) =>
    [p.mpn, p.value, p.footprint, p.role, p.type, p.lcsc ?? ''].some((f) => f.toLowerCase().includes(nq)),
  ).slice(0, limit);
  const parts: CliPart[] = hits.map((p) => ({
    mpn: p.mpn,
    value: p.value,
    footprint: p.footprint,
    role: p.role,
    lcsc: p.lcsc,
    description: p.role,
  }));
  if (args.flags.has('json')) {
    printJson({ provider: 'library', query, count: parts.length, parts });
    return;
  }
  printParts('library', query, parts);
  if (provider === 'lcsc') process.stdout.write(`\nLCSC search: ${lcscSearchUrl(query)}\n`);
  if (hits.some((p) => p.lcsc))
    process.stdout.write('\nLCSC product pages: https://www.lcsc.com/product-detail/<C-number>.html\n');
}

async function runSearchLive(args: Args): Promise<void> {
  const query = args.positional.slice(1).join(' ').trim();
  if (!query) throw new CliError('Usage: foss-pcb search <query> --live --provider mouser|digikey');
  const provider = flagStr(args, 'provider');
  if (provider !== 'mouser' && provider !== 'digikey')
    throw new CliError('--live needs --provider mouser or --provider digikey (LCSC has no public API).');

  const mouserKey = process.env.MOUSER_API_KEY ?? '';
  const dkId = process.env.DIGIKEY_CLIENT_ID ?? '';
  const dkSecret = process.env.DIGIKEY_CLIENT_SECRET ?? '';
  if (provider === 'mouser' && !mouserKey)
    throw new CliError('Set MOUSER_API_KEY in the environment (never pass keys as arguments).');
  if (provider === 'digikey' && (!dkId || !dkSecret))
    throw new CliError('Set DIGIKEY_CLIENT_ID and DIGIKEY_CLIENT_SECRET in the environment.');

  const creds: CatalogCredentials =
    provider === 'mouser'
      ? { mouser: { apiKey: mouserKey } }
      : { digikey: { clientId: dkId, clientSecret: dkSecret } };

  const result = await runCatalogSearch(
    { provider: provider as CatalogProvider, query, limit: flagNum(args, 'limit', 20) },
    creds,
  );
  const parts: CliPart[] = result.parts.map((p) => ({
    mpn: p.mpn,
    manufacturer: p.manufacturer,
    description: p.description,
    package: p.package,
    stock: p.stock,
    unitPrice: p.unitPrice,
    currency: p.currency,
    distributorPart: p.distributorPart,
    datasheetUrl: p.datasheetUrl,
    productUrl: p.productUrl,
  }));
  if (args.flags.has('json')) {
    printJson({ ...result, parts });
    return;
  }
  printParts(provider, query, parts, result.total);
  if (result.note) process.stdout.write(`\n${result.note}\n`);
}

function cmdDrc(args: Args): void {
  const file = args.positional[1];
  if (!file) throw new CliError('Usage: foss-pcb drc <board.foss.json> [--json]');
  const pcb = readBoard(file);
  const issues = runDrc(pcb);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  if (args.flags.has('json')) {
    printJson({ file, errors: errors.length, warnings: warnings.length, issues });
  } else {
    for (const i of issues) process.stdout.write(`${i.severity === 'error' ? 'ERROR' : 'WARN '} ${i.message}\n`);
    process.stdout.write(
      `\n${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'} (${pcb.components.length} components, ${pcb.pcb_traces.length} traces)\n`,
    );
  }
  if (errors.length) process.exitCode = 1;
}

function cmdExportKicad(args: Args): void {
  const file = args.positional[1];
  if (!file) throw new CliError('Usage: foss-pcb export-kicad <board.foss.json> [--out file.kicad_pcb] [--stdout]');
  const pcb = readBoard(file);
  const text = fossToKicadPcb(pcb);
  if (args.flags.has('stdout')) {
    process.stdout.write(text);
    return;
  }
  const out =
    flagStr(args, 'out', 'o') ?? file.replace(/\.foss\.json$/i, '').replace(/\.json$/i, '') + '.kicad_pcb';
  writeFileSync(out, text, 'utf8');
  process.stdout.write(
    `Wrote ${out} — ${pcb.components.length} components, ${pcb.pcb_traces.length} traces, ${pcb.nets.length} nets.\n`,
  );
}

function cmdDemo(args: Args): void {
  const out = flagStr(args, 'out', 'o') ?? 'foss-demo.foss.json';
  const envelope = {
    app: 'foss-pcb',
    version: 1,
    name: 'FOSS-PCB demo buck-boost',
    updatedAt: Date.now(),
    pcb: SAMPLE_BUCKBOOST,
  };
  writeFileSync(out, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
  process.stdout.write(`Wrote ${out} (${SAMPLE_BUCKBOOST.components.length} components). Try: foss-pcb drc ${out}\n`);
}

// ---------------------------------------------------------------------- main

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args.flags.has('version') || args.flags.has('v')) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (args.flags.has('help') || args.flags.has('h') || !args.positional.length) {
    help();
    return;
  }
  switch (args.positional[0]) {
    case 'search':
      return args.flags.has('live') ? runSearchLive(args) : cmdSearch(args);
    case 'drc':
      return cmdDrc(args);
    case 'export-kicad':
      return cmdExportKicad(args);
    case 'demo':
      return cmdDemo(args);
    case 'help':
      return help();
    default:
      throw new CliError(`Unknown command "${args.positional[0]}". Run "foss-pcb --help".`);
  }
}

main(process.argv.slice(2)).catch((e: any) => {
  const code = e instanceof CliError ? e.code : 1;
  process.stderr.write(`${e?.message ?? e}\n`);
  process.exitCode = code;
});
