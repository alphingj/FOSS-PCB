# FOSS-PCB — AI Text-to-PCB Desktop (Windows + Mac first)

## Status: green on all three sides (see CI badge runs)

- `npx tsc --noEmit` clean, `npm run build` green
- `cargo check` clean, `cargo test` 7/7 pass (router BFS, kicad parse, drc bounds)
- Python: `python python/verify_plugins.py` exercises KiCad export + plugins
- Executable suites: `simcheck` (values/MNA/switching), `routecheck` (A*/DRC,
  zones, vias, rip-up routing), `padcheck` (TS+Python KiCad pads), `spicecheck`
  (netlist), `fabcheck` (Gerber 4.6/Excellon), `repaircheck` (validator loop),
  `partgencheck` (symbol/footprint generator), `catalogcheck` (DigiKey/Mouser
  request shapes, normalisation and error surfacing), `backupcheck`
  (snapshot delete/clear + `.foss.json` round-trip) — run via
  `node scripts/prepare-checks.cjs`; `clicheck` covers the CLI and `mcpcheck`
  the MCP server (build both first)
- **Real KiCad**: `python python/kicad_verify.py` exports the demo board from
  both emitters (TypeScript and Python), runs `kicad-cli pcb drc` on each and
  asserts 0 errors plus emitter parity (warnings are reported). `python python/partgen_verify.py`
  loads generated symbols/footprints with KiCad's `pcbnew` API and re-saves
  them with `kicad-cli`. Both skip cleanly when KiCad is absent.

## Run

```
npm install
npm run dev          # web preview → http://localhost:3000 → "Load buck-boost demo"
cargo tauri dev      # desktop shell (needs Rust stable + Node)
cargo tauri build    # Windows .msi / macOS .dmg
```

Python is optional: it powers the plugin runner and `.kicad_pcb` export. Solid STEP
export uses KiCad's own OpenCASCADE exporter, so install KiCad 8+ (or point
`KICAD_CLI` at its `kicad-cli` binary) to enable it. `pip install -r python/requirements.txt`
is only needed for the optional plugin stack.

## CLI

```
npm run cli:build
npm link ./cli          # optional: gives a global `foss-pcb` command

foss-pcb search 10k [--json] [--limit 20]
foss-pcb search NE555DR --live --provider mouser     # MOUSER_API_KEY=…
foss-pcb search NE555DR --live --provider digikey    # DIGIKEY_CLIENT_ID / DIGIKEY_CLIENT_SECRET
foss-pcb drc board.foss.json [--json]                # exit 1 on DRC errors
foss-pcb export-kicad board.foss.json [--out board.kicad_pcb] [--stdout]
foss-pcb demo --out demo.foss.json
```

The CLI is built from the same TypeScript libraries as the app. It is not
published to npm yet, so `npx foss-pcb-cli` will not work until a release is
published; use `npm link ./cli`. `drc` reads `.foss.json` — for a `.kicad_pcb`
use KiCad's own `kicad-cli pcb drc`.

## MCP (assistants)

```
npm run mcp:build
node mcp/dist/mcp/server.js        # stdio JSON-RPC; point your MCP client here
```

Tools: `library_search`, `board_summary`, `board_drc`, `export_kicad`,
`place_part`, `catalog_search`. They use the same libraries as the app, so DRC
and export match the UI exactly. `place_part` only accepts verified library
MPNs, writes to a new file (never overwrites the input), rejects off-board
coordinates and duplicate designators, and leaves every new pin on GND.
Live catalog search reads keys from the environment, never from arguments.
The server is local stdio only — there is no HTTP transport and no auth.

## Projects and backups

Projects autosave to this browser. Each save keeps up to 20 snapshots; the
project bar can restore one, **delete a single backup**, or **clear all
backups** (both ask first, and neither touches the current board). Deleting a
project removes its backups too.

## Flow

Prompt → BOM + Netlist + strict JSON (zod-validated, last-block parse) → schematic
editor (ReactFlow, ERC live) → 2D layout (click-route, BFS autoroute, DRC live) →
3D viewer/editor (R3F, move-mode toggle, synced) → Lab (duty/ripple from real L1
values, fault matrix, scope) → export `.kicad_pcb`/STEP, import `.kicad_pcb`.

## AI providers (BYOK, keys in browser localStorage only)

Top bar: OpenRouter / Anthropic / Custom (baseUrl + key + model text or fetched
list). `/api/chat` proxies in dev (SSRF-guarded, 90s timeout); static/Tauri
builds fall back to direct browser→provider calls.

## Sourcing (BYOK distributor search)

The library panel's live search talks to **DigiKey** (Product Information v4,
OAuth2 client credentials) and **Mouser** (Search API v1) with keys you paste in
the panel — stored in this browser only, never sent anywhere but to the
distributor. In the desktop app requests go straight out through the Tauri HTTP
plugin (hosts allowlisted); in `npm run dev` they go through `/api/catalog`.
LCSC has no public product API, so it is offered as search/C-number links.
Results are ordering data: `Add` is enabled only for MPNs in the verified
library, and anything else is handed to the Part Generator with its datasheet.

## Layout

```
app/                    Next.js UI + /api/chat + /api/catalog proxies
components/             ProviderBar, PromptBox, OutputTabs, ExportBar,
                        SchematicEditor, BoardCanvas2D, BoardViewer3D,
                        ScopePanel, LabPanel, LibraryPanel, PartGenerator,
                        StackupEditor, DiagnosticsPanel
lib/                    foss-schema.ts (contract), drc.ts, erc.ts, routing.ts,
                        kicad-io.ts, kicad-pads.ts, fab.ts, partgen.ts,
                        partgen-prompt.ts, board-io.ts, tauri-bridge.ts,
                        chat-direct.ts, sim/
cli/                    search / drc / export-kicad / demo (compiled to cli/dist)
mcp/                    stdio MCP server (compiled to mcp/dist)
src-tauri/              Tauri 2 + Rust core (kicad parse, drc, router, commands)
python/foss_pcb/        kicad_compat, footprint, step_export, sim, runner
plugins/                bom_export, drc_report, step_export (run() entrypoint)
```

## Release (Windows .msi + macOS .dmg)

```
cargo tauri build
```

Unsigned builds work but trigger SmartScreen (Windows) / Gatekeeper (macOS)
warnings. To sign:

- Windows: buy an EV or OV code-signing certificate, install to the cert store,
  then set `bundle.windows.certificateThumbprint` to its SHA1 thumbprint and
  optionally `bundle.windows.wix.upgradeCode` (pin it after the first release).
- macOS: enroll in Apple Developer Program, then set
  `bundle.macOS.signingIdentity` (e.g. `Developer ID Application: Name (TEAMID)`)
  and notarize with `xcrun notarytool`.

No secrets live in this repo — thumbprints/identities go in local config only.

## Known limits (honest)

- Autorouter is rip-up-and-refit over a coarse BFS grid (45° simplification,
  rasterised trace segments and per-net pour keep-outs) — not true geometric
  push-and-shove; manual routing remains the precise path. DRC covers bounds,
  nets, same-layer trace/pad/via/zone clearances (measured copper edge to
  copper edge, with trace widths) and zone overlap, not every KiCad rule.
- Copper zones export as unfilled outlines; KiCad computes the pour on load.
  The in-app renderer shows zone bounds, not a simulated fill. The demo board
  ships two GND vias with no traces, so KiCad reports them as dangling until
  you route (a warning, not an error).
- The AI part generator models dual-row (SOIC/TSSOP), inline (SIP) and SOT-23
  packages only; quad/no-lead packages (QFP/QFN/BGA) are rejected rather than
  guessed. Pad geometry is IPC-7351B-inspired from the supplied lead dimensions
  and is shown as a pad table for review — not a verified land pattern. PDF
  input requires Anthropic; other providers accept a pinout image.
- Live distributor search covers DigiKey (Product Information v4) and Mouser
  (Search API v1) with your own API credentials, paged 25 at a time with a
  **Load more** button, and reuses a successful search for five minutes (per
  credential and page, in memory only — errors and your keys are never cached).
  It has been verified up to the distributors' own credential errors; a
  successful live search needs your key. LCSC publishes no
  public product API, so LCSC is offered as search/C-number links rather than
  invented results, and live rows can only be added to the board when their MPN
  matches the verified library — otherwise send them to the Part Generator with
  a datasheet. Prices/packages come from the distributor; footprint names never do.
  Catalog keys default to session storage ("Remember on this device" opt-in to
  localStorage) and go straight to the distributor in the desktop app.
- The CLI is not published yet, and its `drc` takes `.foss.json` (use
  `kicad-cli pcb drc` for a `.kicad_pcb`). Live CLI search reads keys from the
  environment and has the same verified-vs-unverified limits as the app panel.
- MCP is local stdio only (no HTTP/SSE, no auth) and works on board files, not
  the open GUI. `place_part` places library parts only — custom footprints
  still go through the Part Generator.
- Backups live in this browser's localStorage (20 per project); they are not
  synced or exported. Clearing them is permanent.
- STEP export is real AP214 geometry produced by KiCad's OpenCASCADE exporter
  from the generated `.kicad_pcb` (board outline and copper; component bodies
  appear only where KiCad has a 3D model for the footprint — the built-in
  library parts currently ship without models). It needs the desktop app and
  KiCad 8+ (`kicad-cli`); without KiCad it reports that clearly instead of
  writing a placeholder file. The web preview cannot export STEP.
- Scope/Lab run a local bench: value parsing (R/C/L strings → SI, incl. 4K7
  notation and case-sensitive M vs m), MNA DC divider check, and a CCM
  cycle-average switching model with Vf/Rds/DCR solved by bisection — no
  SPICE yet; ngspice linking is next. The SPICE export takes its duty cycle
  from that same solved operating point rather than a fixed 0.5.
