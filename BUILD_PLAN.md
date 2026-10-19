# FOSS-PCB Build Plan — Post-LCSC Milestone

**Status:** LCSC coverage complete — 35/36 library parts verified (`CL21A106KAFNNNE` stays blank; LCSC's C15850 is a different thickness variant). Phase 1 layout engine complete. Phase 2.1 AI part generator complete. Phase 2.2 live distributor catalog complete (DigiKey v4 + Mouser v1 search; LCSC via links, no public API).

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

### 3.1 CLI (`npx -y foss-pcb-cli`)
**Files:** New `cli/` directory, Tauri sidecar or standalone Node binary
**What:** `auth login/whoami/logout`, `search <query> [--json]`, `export-kicad <foss.json>`, `drc <kicad_pcb>`. Zero dependencies, Node 20+, JSON output.
**Verification:** CLI smoke test in CI (runs `drc` on a sample board).

### 3.2 MCP Interface
**Files:** New `mcp/` directory
**What:** Model Context Protocol server so external assistants (Claude, etc.) can drive FOSS-PCB: read netlist, run DRC, export KiCad, place parts.
**Verification:** MCP handshake test; `run_python_plugin` path already exists in `commands.rs`.

### 3.3 Git integration
**Files:** `lib/git.ts`, `components/ProjectBar.tsx` (branch/diff UI)
**What:** Branching, diff viewer, visual git diff overlays (like ProtoFlow). Store `.foss.json` in git.
**Verification:** `tsc --noEmit`, manual git round-trip test.

### 3.4 STEP export
**Files:** `python/foss_pcb/step_export.py` (CadQuery/OpenCascade via Python sidecar)
**What:** Replace the stub with real 3D STEP generation from footprints + placement.
**Verification:** `python/verify_plugins.py` — STEP parses (even if empty bodies initially).

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
node scripts/prepare-checks.cjs simcheck.cjs ./check-out simcheck-run.cjs   # (repeat for routecheck, padcheck, spicecheck, fabcheck, repaircheck, partgencheck, catalogcheck)
node simcheck-run.cjs     # (repeat for all 8)
python python/padcheck_py.py
python python/verify_plugins.py
python python/kicad_verify.py   # Real KiCad 10.0.6 DRC on both emitters
python python/partgen_verify.py # pcbnew load + kicad-cli re-save of generated parts
git commit && git push
```

---

## Definition of Done

- All 8 node check suites green
- All 4 Python check scripts green
- `kicad_verify.py` shows 0 DRC errors on both emitters (warnings reported)
- `tsc --noEmit` clean, `npm run build` green, `cargo test` 7/7
- Committed and pushed to `https://github.com/alphingj/FOSS-PCB`
