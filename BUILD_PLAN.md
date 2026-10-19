# FOSS-PCB Build Plan — Post-LCSC Milestone

**Status:** LCSC coverage complete — 35/36 library parts verified (the one exception, `CL21A106KAFNNNE`, isn't listed on LCSC; its closest variant C15850 is a different thickness and stays blank per the standing rule).

**Goal:** Build every ProtoFlow-class capability that's realistically achievable for a desktop-first, BYOK, open-source EDA. Explicitly out of scope: live collaboration, ngspice live linking, MCU co-simulation, Linux/Android targets, signed installers, auto-updater.

---

## Phase 1 — Layout Engine (make the board editor feel "real")

### 1.1 Copper pours / zones
**Files:** `lib/drc.ts`, `lib/routing.ts`, `components/BoardCanvas2D.tsx`, `lib/kicad-io.ts`, `python/foss_pcb/kicad_compat.py`
**What:** Solid ground/power pours on copper layers with clearance from other nets. KiCad emits zones as `zone` s-expr with `net`, `layer`, `bounding_box`, `pad_connections`.
**DRC:** Pour-to-trace clearance, pour-to-pad clearance (same-net = connected, different-net = clearance), thermal reliefs on through-hole pins.
**Verification:** `routecheck.cjs` + real KiCad DRC via `python/kicad_verify.py`.

### 1.2 Vias
**Files:** `lib/kicad-pads.ts`, `lib/kicad-io.ts`, `python/foss_pcb/kicad_compat.ts`, `components/BoardCanvas2D.tsx`
**What:** Via stack definitions (drill size, pad sizes per layer, antipads). Through-hole vias first; blind/buried documented as future.
**KiCad:** `via` s-expr in `.kicad_pcb`. TS and Python emitters must stay pad-for-pad identical.
**Verification:** `padcheck.cjs` + `python/padcheck_py.py` + `kicad_verify.py`.

### 1.3 Push-and-shove routing
**Files:** `lib/routing.ts`, `components/BoardCanvas2D.tsx`
**What:** Replace/augment A* point-to-point with rip-up-and-refit or true push-and-shove. Obstacle awareness (component bodies, other traces, pours).
**Verification:** `routecheck.cjs` — A* still works, new router doesn't break existing traces.

### 1.4 Stackup editor
**Files:** `lib/foss-schema.ts` (pcb_specifications), `components/ExportBar.tsx` or new `StackupEditor.tsx`
**What:** Layer count, copper weight, dielectric thickness, impedance hints. Stored in `project_metadata.pcb_specifications`.
**Verification:** `tsc --noEmit`, schema round-trip.

---

## Phase 2 — Part Generation & Sourcing (ProtoFlow's biggest differentiator)

### 2.1 AI Part Generator (datasheet → symbol + footprint)
**Files:** New `lib/partgen.ts`, new `components/PartGenerator.tsx`, Python sidecar `python/foss_pcb/partgen.py`
**What:** 
- Input: part number, datasheet URL, uploaded PDF, or pinout image
- BYOK vision model reads datasheet, extracts pinout + package + land pattern
- Output: linked `.kicad_sym` + `.kicad_mod` (IPC-7351B), refinement loop ("tell the AI what's wrong")
- Export to KiCad (primary), EAGLE/Altium/Allegro documented as future
**Verification:** No automated check possible (LLM output); unit tests for the IPC-7351B geometry math. Manual verification against datasheets.

### 2.2 Live distributor catalog
**Files:** `lib/catalog.ts`, `components/LibraryPanel.tsx`, CLI `@protoflow/cli`-style
**What:** Search LCSC/DigiKey/Mouser by keyword/part number. Return MPN + price + stock + LCSC code. Rate-limit aware; auth via user API keys.
**Verification:** `fetchOpenRouterModels`-style timeout pattern. Offline fallback to static `library.ts` (35/36 with LCSC codes).

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
node scripts/prepare-checks.cjs simcheck.cjs ./check-out simcheck-run.cjs   # (repeat for routecheck, padcheck, spicecheck, fabcheck, repaircheck)
node simcheck-run.cjs     # (repeat for all 6)
python python/padcheck_py.py
python python/verify_plugins.py
python python/kicad_verify.py   # Real KiCad 10.0.6 DRC on both emitters
git commit && git push
```

---

## Definition of Done

- All 6 node check suites green
- Both Python check scripts green
- `kicad_verify.py` shows 0 DRC violations on both emitters
- `tsc --noEmit` clean, `npm run build` green, `cargo test` 7/7
- Committed and pushed to `https://github.com/alphingj/FOSS-PCB`
