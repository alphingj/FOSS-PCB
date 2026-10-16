# FOSS-PCB — AI Text-to-PCB Desktop (Windows + Mac first)

## Status: green on all three sides (see CI badge runs)

- `npx tsc --noEmit` clean, `npm run build` green
- `cargo check` clean, `cargo test` 7/7 pass (router BFS, kicad parse, drc bounds)
- Python: `python python/verify_plugins.py` exercises KiCad export + plugins
- Executable suites: `simcheck` (16 asserts: values/MNA/switching), `routecheck`
  (14: A*/DRC), `padcheck` (TS+Python KiCad pads), `spicecheck` (9: netlist),
  `repaircheck` (validator loop) — run via `node scripts/prepare-checks.cjs`

## Run

```
npm install
npm run dev          # web preview → http://localhost:3000 → "Load buck-boost demo"
cargo tauri dev      # desktop shell (needs Rust stable + Node)
cargo tauri build    # installers (msi/dmg/appimage)
```

Python extras (optional, for solid STEP later): `pip install -r python/requirements.txt`

## Flow

Prompt → BOM + Netlist + strict JSON (zod-validated, last-block parse) → schematic
editor (ReactFlow, ERC live) → 2D layout (click-route, BFS autoroute, DRC live) →
3D viewer/editor (R3F, move-mode toggle, synced) → Lab (duty/ripple from real L1
values, fault matrix, scope) → export `.kicad_pcb`/STEP, import `.kicad_pcb`.

## AI providers (BYOK, keys in browser localStorage only)

Top bar: OpenRouter / Anthropic / Custom (baseUrl + key + model text or fetched
list). `/api/chat` proxies in dev (SSRF-guarded, 90s timeout); static/Tauri
builds fall back to direct browser→provider calls.

## Layout

```
app/                    Next.js UI + /api/chat proxy
components/             ProviderBar, PromptBox, OutputTabs, ExportBar,
                        SchematicEditor, BoardCanvas2D, BoardViewer3D,
                        ScopePanel, LabPanel, PluginPanel
lib/                    foss-schema.ts (contract), drc.ts, erc.ts, routing.ts,
                        kicad-io.ts, tauri-bridge.ts, chat-direct.ts, sim/
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

- Autorouter is coarse BFS (Manhattan, point obstacles) — manual routing is the
  real path; DRC covers bounds/nets/heuristic zones, not full clearance.
- STEP export is a manifest stub until CadQuery/PythonOCC is wired.
- Scope/Lab run a local bench: value parsing (R/C/L strings → SI, incl. 4K7
  notation), MNA DC divider check, and a CCM cycle-average switching model
  with Vf/Rds/DCR solved by bisection — no SPICE yet; ngspice linking is next.
- Android later: viewer/lab only, not the full editor.
