# FOSS-PCB Build Plan — Post-LCSC Milestone

**Status:** LCSC coverage complete - 35/36 library parts verified (`CL21A106KAFNNNE` stays blank; LCSC's C15850 is a different thickness variant). Phase 1 layout engine complete. Phase 2.1 AI part generator complete. Phase 2.2 live distributor catalog complete (DigiKey v4 + Mouser v1 search; LCSC via links, no public API). Phase 3.1 CLI complete (build from source; npm publish still pending). Phase 3.2 MCP server complete. Phase 3.4 STEP export complete (KiCad OpenCASCADE backend). Project backups can now be deleted individually or cleared.

**Goal:** Build every ProtoFlow-class capability that's realistically achievable for a desktop-first, BYOK, open-source EDA. Explicitly out of scope: live collaboration, ngspice live linking, MCU co-simulation, Linux/Android targets, signed installers, auto-updater.

---

## Phase 1 — Layout Engine (make the board editor feel "real") — ✅ COMPLETE

### 1.1 Copper pours / zones ✅
KiCad 10 zone grammar: `polygon`/`connect_pads`/`min_thickness`/`fill`/`hatch`, `(net N)` no name. DRC: bounds, trace clearance, layer-aware zone overlap.

### 1.2 Vias ✅
`FossVia` schema; KiCad 10 via grammar `(net N)` no name (verified vs real demo). DRC: bounds, trace clearance, pad clearance. Rendering + 2 demo vias.

### 1.3 Push-and-shove routing ✅
`tryRoute` + `ripupAutoroute` (rip-up-and-refit). Wired into BoardCanvas2D autoroute. Later nets displace earlier ones; ripped traces re-routed in a second pass.

### 1.4 Stackup editor ✅
`FossLayer`/`FossStackup` schema + `StackupEditor.tsx` UI (add/edit/remove layers) + stackup DRC. Wired into nav.

**Key lesson:** KiCad 10's zone/via grammar differs from older versions. The `kicad_verify.py` harness (built earlier) caught the invalid `chain`/`pad_connections`/`net_name` tokens. Always validate emitters against a real KiCad, never assume the format.

---

## Phase 2 — Part Generation & Sourcing (ProtoFlow's biggest differentiator)

### 2.1 AI Part Generator (datasheet → symbol + footprint) ✅
**Files:** `lib/partgen.ts`, `lib/partgen-prompt.ts`, `components/PartGenerator.tsx`, `partgencheck.cjs`, `python/partgen_verify.py`
**What:**
- Input: uploaded datasheet PDF or pinout image (a URL is recorded as provenance only — the model cannot browse)
- BYOK model extracts the pin table + package dimensions as strict JSON; missing facts are rejected rather than guessed
- Output: linked `.kicad_sym` + `.kicad_mod`; the pad table is shown for review
- Supported layouts: dual-row (SOIC/TSSOP), inline (SIP), SOT-23. Quad/no-lead (QFP/QFN/BGA) are rejected.
- Pad geometry is IPC-7351B-inspired from the supplied lead dimensions — a reviewed starting point, not a verified land pattern
- No refinement loop yet; re-run with a clearer document instead
**Verification:** `partgencheck.cjs` (geometry, counter-clockwise numbering, courtyard, parser, quad rejection) + `python/partgen_verify.py` (pcbnew load + kicad-cli re-save for SOIC-8 and SOT-23). Real parts still need manual datasheet review.

### 2.2 Live distributor catalog ✅
**Files:** `lib/catalog.ts`, `app/api/catalog/route.ts`, `components/LibraryPanel.tsx`, `catalogcheck.cjs`
**What:**
- DigiKey **Product Information v4** (`POST /products/v4/search/keyword`, OAuth2 client-credentials token from `/v1/oauth2/token`, `X-DIGIKEY-Client-Id` + locale headers) — request/response fields per DigiKey's own endpoint docs
- Mouser **Search API v1** (`POST /api/v1/search/keyword?apiKey=…` with the `SearchByKeywordRequest` wrapper) — shape taken from the live `api.mouser.com/api/docs/V1` swagger
- Normalised rows: MPN, manufacturer, description, distributor part number, package text, stock, unit price + price breaks, currency, datasheet/product links
- **LCSC has no public product API** — FOSS-PCB refuses to fabricate results and instead offers LCSC search and C-number product links (used for the library's verified codes)
- Honesty guards: ambiguous money ("0,42 €") and free-text availability are left blank rather than guessed; distributor errors surface verbatim; DigiKey OAuth tokens are cached in memory (refreshed once on 401) and the client secret never enters a search body
- Desktop transport is the Tauri HTTP plugin (no CORS, keys never leave the machine, hosts allowlisted in `capabilities/default.json`); web/dev goes through `/api/catalog`, which validates provider/body size and persists nothing
- Live rows carry ordering data only, so **Add** is offered just for MPNs already in the verified `library.ts` (real land patterns); everything else hands the MPN to the AI Part Generator for a datasheet-driven footprint
**Verification:** `catalogcheck.cjs` drives the HTTP layer with an injected mock (request shapes, DigiKey token + 401 retry + cache, Mouser error surfacing, price/stock parsing, LCSC refusal, missing-credential messages, timeouts, 429). A live smoke run of `/api/catalog` confirmed the routing, the LCSC refusal and two real distributor round-trips (DigiKey and Mouser both returned their own invalid-credential errors — no valid keys were available to test a successful live search).

---

## Phase 3 — Extensibility & Integration

### 3.1 CLI ✅
**Files:** `cli/cli.ts`, `cli/tsconfig.json`, `cli/package.json`, `clicheck.cjs`
**What:**
- `npm run cli:build` compiles the CLI against the app's own libraries (schema validation, DRC, KiCad export, catalog, library) so behaviour cannot drift; `npm link ./cli` gives a local `foss-pcb` binary
- `search <query> [--json] [--limit N]` — offline curated library, matching MPN / value / footprint / role / LCSC code
- `search <query> --live --provider mouser|digikey` — live distributor search using `MOUSER_API_KEY` or `DIGIKEY_CLIENT_ID`/`DIGIKEY_CLIENT_SECRET` from the environment (keys never go through argv)
- `drc <board.foss.json> [--json]` — full app DRC; exit 1 on errors, 0 when clean/warnings-only, 2 on usage/invalid input
- `export-kicad <board.foss.json> [--out file] [--stdout]` — same emitter as the app; output loads in KiCad 10
- `demo [--out file]` — writes the demo buck-boost as a `.foss.json` project (also the CI fixture)
- No CLI-only dependencies (Node 20+; `zod` comes from the app); JSON output on every query command
**Deviations (honest):**
- No `auth login/whoami/logout`: FOSS-PCB has no accounts. Distributor credentials are read from the environment instead.
- `drc` reads `.foss.json`; a `.kicad_pcb` needs KiCad's own `kicad-cli pcb drc` (the Rust parser is not exposed as a binary).
- The package is **not published** — `npx -y foss-pcb-cli` requires an npm publish/token (release task). Until then: `npm run cli:build && npm link ./cli`.
**Verification:** `clicheck.cjs` (26 assertions: exit codes, JSON/human output, LCSC honesty, missing-key messages, off-board DRC failure, KiCad export, invalid input). The exported demo was loaded by real `kicad-cli pcb drc`: 0 errors, the 2 known demo-via warnings, 7 unconnected (unrouted).

### 3.2 MCP Interface ✅
**Files:** `mcp/server.ts`, `mcp/tsconfig.json`, `mcp/package.json`, `mcpcheck.cjs`, `lib/board-io.ts`
**What:**
- Stdio MCP server (JSON-RPC 2.0, one message per line) with no SDK dependency; negotiates 2024-11-05 / 2025-03-26 / 2025-06-18 and falls back to the latest for unknown versions
- Tools: `library_search` (verified MPNs, pin labels, LCSC codes), `board_summary` (size, layers, placements, nets), `board_drc` (the app's own rules), `export_kicad` (same emitter as the app), `place_part` (verified library parts only), `catalog_search` (Mouser/DigiKey with keys from the environment)
- Safety rails: `place_part` writes a **new** file (refuses to overwrite the input), rejects off-board coordinates, duplicate designators and unknown MPNs (suggesting `library_search`); placed pins start on GND exactly like the app
- LCSC is refused with an explanation (no public API); catalog rows are labelled ordering data, not verified footprints
- Nothing is hidden: tool failures come back as `isError` text with the real reason; unknown tools/methods are proper JSON-RPC errors
**Limitations (honest):** local stdio only — no HTTP/SSE transport, no auth (any local process that can spawn it can call it), and it operates on board files rather than driving the open GUI.
**Verification:** `mcpcheck.cjs` (42 assertions: handshake + version fallback, notifications stay silent, tool schemas, every tool's success and failure paths, protocol errors, stdout purity, clean shutdown). A board exported by `export_kicad` was loaded by real KiCad 10.0.6: **0 violations, 0 unconnected**. The CLI and MCP now share `lib/board-io.ts`, so file parsing/rewriting cannot drift.

### 3.3 Git integration
**Files:** `lib/git.ts`, `components/ProjectBar.tsx` (branch/diff UI)
**What:** Branching, diff viewer, visual git diff overlays (like ProtoFlow). Store `.foss.json` in git.
**Verification:** `tsc --noEmit`, manual git round-trip test.

### 3.4 STEP export - ? COMPLETE
**Files:** `python/foss_pcb/step_export.py`, `src-tauri/src/commands.rs`, `components/ExportBar.tsx`
**What:**
- The stub is gone. The sidecar serialises the board to `.kicad_pcb` and runs KiCad's own OpenCASCADE exporter (`kicad-cli pcb export step`), returning real AP214 text plus a file name; the desktop command returns a JSON envelope and the UI downloads `<design>.step`
- KiCad is auto-detected on Windows/macOS (or set `KICAD_CLI`); no ~500 MB CadQuery install and no CAD kernel of our own to maintain
- Without KiCad the exporter returns an actionable error and the UI shows it — it never fabricates a placeholder file. The web preview explains that STEP needs the desktop app
**Verification:** `python/verify_plugins.py` asserts the result is AP214 (`ISO-10303-21` + `AUTOMOTIVE_DESIGN`, >1 KB) and contains no stub marker; on machines without KiCad the error must name KiCad. Locally the demo board emits a 9 KB STEP file. Honest limit: component bodies appear only where KiCad has 3D models for the footprints; the built-in library parts currently have none, so the STEP contains the board and pads.

---

## Phase 4 — Polish (roadmap, not blockers)

- Signed installers / auto-updater (Tauri updater)
- Accessibility (ARIA, keyboard nav)
- Full documentation (README already has status section; expand)
- Performance: large board rendering (WebGL vs SVG canvas)

---

## Verification Recipe (every step)

```
npx tsc --noEmit          # TypeScript clean
npm run build             # Next build green
cargo check               # Rust clean
cargo test                # 7/7 Rust tests
node scripts/prepare-checks.cjs simcheck.cjs ./check-out simcheck-run.cjs   # (repeat for routecheck, padcheck, spicecheck, fabcheck, repaircheck, partgencheck, catalogcheck, backupcheck)
node simcheck-run.cjs     # (repeat for all 9)
node clicheck.cjs         # after: npm run cli:build
node mcpcheck.cjs         # after: npm run mcp:build
python python/padcheck_py.py
python python/verify_plugins.py
python python/kicad_verify.py   # Real KiCad 10.0.6 DRC on both emitters
python python/partgen_verify.py # pcbnew load + kicad-cli re-save of generated parts
git commit && git push
```

---

## Definition of Done

- All 9 mocked check suites + the CLI (`clicheck.cjs`) and MCP (`mcpcheck.cjs`) suites green
- All 4 Python check scripts green
- `kicad_verify.py` shows 0 DRC errors on both emitters (warnings reported)
- `tsc --noEmit` clean, `npm run build` green, `cargo test` 7/7
- Committed and pushed to `https://github.com/alphingj/FOSS-PCB`
