"""Export the demo board from BOTH emitters (TypeScript and Python) and prove
each one loads in real KiCad with a clean DRC.

Skips (exit 0) when kicad-cli is not installed, so CI without KiCad stays green.

Usage:
    python python/kicad_verify.py            # verify if kicad-cli is on PATH
    python python/kicad_verify.py --require   # fail if kicad-cli is missing

The TS side is compiled to CommonJS first:
    npx tsc lib/kicad-io.ts lib/sample-buckboost.ts --outDir <dir> \
        --module commonjs --target es2020 --esModuleInterop --skipLibCheck
Set KICAD_TS_OUT to point at that directory.
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out" / "kicad-verify"
TS_OUT = Path(os.environ.get("KICAD_TS_OUT", Path(os.environ.get("TEMP", "/tmp")) / "kicadverify"))

REQUIRE = "--require" in sys.argv


def find_kicad_cli():
    exe = shutil.which("kicad-cli") or shutil.which("kicad-cli.exe")
    if exe:
        return exe
    # Common per-user install location on Windows.
    base = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "KiCad"
    if base.is_dir():
        for p in sorted(base.glob("*/bin/kicad-cli.exe"), reverse=True):
            return str(p)
    return None


NODE_CODE = (
    "const fs=require('fs');"
    "const {fossToKicadPcb}=require(process.argv[1]);"
    "const {SAMPLE_BUCKBOOST}=require(process.argv[2]);"
    "fs.writeFileSync(process.argv[3], fossToKicadPcb(SAMPLE_BUCKBOOST));"
)


def run_drc(kicad, board: Path):
    rpt = board.with_suffix(".rpt")
    r = subprocess.run([kicad, "pcb", "drc", "--output", str(rpt), str(board)],
                       capture_output=True, text=True)
    text = rpt.read_text(errors="replace") if rpt.exists() else ""
    # KiCad's "violations" count mixes errors and warnings. Only ERRORS block
    # the pass; warnings are reported but acceptable (e.g. via_dangling on a
    # board that has vias but no traces yet — the expected pre-routing state).
    viol = 0
    for line in text.splitlines():
        if line.startswith("** Found ") and "violation" in line:
            viol = int(line.split("** Found ")[1].split()[0])
    errors = 0
    in_viol = False
    for line in text.splitlines():
        if line.startswith("** Found ") and "violation" in line:
            in_viol = True
            continue
        if line.startswith("** Found "):
            in_viol = False
        if in_viol and "Local override; error" in line:
            errors += 1
    return viol, errors, text


def main():
    kicad = find_kicad_cli()
    if not kicad:
        msg = "kicad-cli not found - skipping real-KiCad verification"
        if REQUIRE:
            print("FAIL: " + msg)
            return 1
        print(msg)
        return 0

    OUT.mkdir(parents=True, exist_ok=True)

    # 1. TypeScript emitter
    ts_mod = TS_OUT / "kicad-io.js"
    sample_mod = TS_OUT / "sample-buckboost.js"
    if not ts_mod.exists():
        print(f"FAIL: {ts_mod} missing - compile the TS side first (see module docstring)")
        return 1
    ts_board = OUT / "demo-ts.kicad_pcb"
    subprocess.run(["node", "-e", NODE_CODE, str(ts_mod), str(sample_mod), str(ts_board)],
                   check=True)

    # 2. Python emitter, fed the same board JSON
    sample_ts = ROOT / "lib" / "sample-buckboost.ts"
    board_json = OUT / "demo.json"
    js = ("const {SAMPLE_BUCKBOOST}=require(process.argv[1]);"
          "require('fs').writeFileSync(process.argv[2],"
          "JSON.stringify(SAMPLE_BUCKBOOST,null,1));")
    subprocess.run(["node", "-e", js, str(sample_mod), str(board_json)], check=True)

    env = dict(os.environ)
    env["PYTHONPATH"] = str(ROOT / "python")
    py_board = OUT / "demo-py.kicad_pcb"
    r = subprocess.run([sys.executable, "-m", "foss_pcb.kicad_compat", "--to-kicad"],
                       input=board_json.read_text(), capture_output=True, text=True, env=env)
    if r.returncode != 0:
        print("FAIL: python emitter exit", r.returncode)
        print(r.stderr[:800])
        return 1
    py_board.write_text(r.stdout)

    ok = True
    for label, board in (("typescript", ts_board), ("python", py_board)):
        viol, errors, text = run_drc(kicad, board)
        fp_err = "** Found 0 Footprint errors **" in text
        unconn = 0
        for line in text.splitlines():
            if line.startswith("** Found ") and "unconnected" in line:
                unconn = int(line.split("** Found ")[1].split()[0])
        # Pass = no DRC errors and no footprint errors. Warnings are reported
        # but do not fail (unconnected pads/vias are the pre-routing state).
        status = "ok" if errors == 0 and fp_err else "FAIL"
        if status == "FAIL":
            ok = False
        print(f"{status}: {label} emitter -> KiCad DRC {viol} items "
              f"({errors} errors, {viol - errors} warnings), {unconn} unconnected (pre-routing)")
        if errors:
            print("\n".join(text.splitlines()[:20]))

    # 3. Parity: both emitters must produce the same pad/nets shape.
    ts_txt = ts_board.read_text()
    py_txt = py_board.read_text()
    def shape(t):
        return (t.count("(pad "), t.count("(net "), t.count("(footprint "))
    if shape(ts_txt) != shape(py_txt):
        ok = False
        print(f"FAIL: emitter parity TS{shape(ts_txt)} vs PY{shape(py_txt)}")
    else:
        print(f"ok: emitter parity (pads, nets, footprints) = {shape(ts_txt)}")

    print("ALL KICAD CHECKS PASSED" if ok else "KICAD CHECKS FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())