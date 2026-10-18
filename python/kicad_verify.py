"""KiCad round-trip gate: export the demo board through BOTH emitters (TS + Python),
load each with real kicad-cli, and run DRC. Fails loudly if either won't parse.

Skipped (exit 0, message) when kicad-cli isn't installed.
"""
import json
import os
import re
import subprocess as sp
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KICAD = os.path.join(
    os.environ.get("LOCALAPPDATA", ""), "Programs", "KiCad", "10.0", "bin", "kicad-cli.exe"
)
COMPILED = os.path.join(os.environ.get("TEMP", "."), "kicadverify")
WORK = os.path.join(ROOT, "out", "kicad-verify")


def ts_board() -> str:
    code = (
        "const fs=require('fs');"
        "const {fossToKicadPcb}=require(process.argv[1]);"
        "const {SAMPLE_BUCKBOOST}=require(process.argv[2]);"
        "process.stdout.write(fossToKicadPcb(SAMPLE_BUCKBOOST));"
    )
    r = sp.run(
        ["node", "-e", code,
         os.path.join(COMPILED, "kicad-io.js"),
         os.path.join(COMPILED, "sample-buckboost.js")],
        capture_output=True, text=True, check=True,
    )
    return r.stdout


def py_board() -> str:
    sys.path.insert(0, os.path.join(ROOT, "python"))
    from foss_pcb.kicad_compat import foss_to_kicad_pcb
    node = (
        "const fs=require('fs');"
        "const {SAMPLE_BUCKBOOST}=require(process.argv[1]);"
        "process.stdout.write(JSON.stringify(SAMPLE_BUCKBOOST));"
    )
    r = sp.run(["node", "-e", node, os.path.join(COMPILED, "sample-buckboost.js")],
               capture_output=True, text=True, check=True)
    return foss_to_kicad_pcb(json.loads(r.stdout))


def check(label: str, text: str) -> bool:
    """Load + DRC in real KiCad. Errors are failures; silk warnings are not."""
    os.makedirs(WORK, exist_ok=True)
    pcb = os.path.join(WORK, f"{label}.kicad_pcb")
    rpt = os.path.join(WORK, f"{label}-drc.rpt")
    with open(pcb, "w", encoding="utf-8") as fh:
        fh.write(text)
    if os.path.exists(rpt):
        os.remove(rpt)
    r = sp.run([KICAD, "pcb", "drc", "--output", rpt, pcb], capture_output=True, text=True)
    out = r.stdout + r.stderr
    if r.returncode != 0 or "Failed to load" in out:
        print(f"FAIL {label}: kicad-cli could not load the board\n{out.strip()}")
        return False
    report = open(rpt, encoding="utf-8").read() if os.path.exists(rpt) else ""
    errors = [b for b in report.split("[") if b.startswith("clearance")
              or b.startswith("invalid_outline") or b.startswith("malformed")
              or b.startswith("copper_edge_clearance")]
    unconn = len(re.findall(r"^\[unconnected_items\]", report, re.M))
    silk = len(re.findall(r"^\[silk_over_copper\]", report, re.M))
    print(f"ok   {label}: loads; {len(errors)} geometry errors, "
          f"{unconn} unconnected (autoroute not run), {silk} silk warnings")
    return not errors


def main() -> int:
    if not os.path.exists(KICAD):
        print(f"skip: kicad-cli not found at {KICAD}")
        return 0
    ok = check("ts-demo", ts_board())
    ok = check("py-demo", py_board()) and ok
    print("ALL KICAD ROUND-TRIP CHECKS PASSED" if ok else "KICAD ROUND-TRIP FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())