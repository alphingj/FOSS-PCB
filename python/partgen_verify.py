"""Validate FOSS-PCB's AI Part Generator output against real KiCad.

Generates a symbol + SOIC-8 and SOT-23 footprints with the TypeScript emitter,
loads them with KiCad's pcbnew API, and re-saves them with kicad-cli. Skips
cleanly when KiCad is not installed (CI without KiCad stays green).

Usage:
    npx tsc lib/partgen.ts --outDir <dir> --module commonjs --target es2020 \
        --esModuleInterop --skipLibCheck
    python python/partgen_verify.py            # verify if KiCad is present
    python python/partgen_verify.py --require  # fail if KiCad is missing
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out" / "partgen-verify"
TS_OUT = Path(os.environ.get("KICAD_TS_OUT", Path(os.environ.get("TEMP", "/tmp")) / "kicadverify"))

REQUIRE = "--require" in sys.argv

SOIC8 = {
    "mpn": "UC3843BD1",
    "description": "Current-mode PWM controller",
    "pins": [
        {"number": 1, "name": "COMP", "type": "output"},
        {"number": 2, "name": "FB", "type": "input"},
        {"number": 3, "name": "ISENSE", "type": "input"},
        {"number": 4, "name": "RT/CT", "type": "passive"},
        {"number": 5, "name": "GND", "type": "power_in"},
        {"number": 6, "name": "OUT", "type": "output"},
        {"number": 7, "name": "VCC", "type": "power_in"},
        {"number": 8, "name": "VREF", "type": "output"},
    ],
    "pkg": {"name": "SOIC-8", "layout": "dual", "rows": 2, "pinsPerRow": 4, "pitch": 1.27,
            "rowSpan": 5.4, "bodyWidth": 3.9, "bodyLength": 4.9,
            "leadWidth": 0.4, "leadLength": 0.6},
}

SOT23 = {
    "mpn": "AO3400A",
    "description": "N-MOSFET",
    "pins": [
        {"number": 1, "name": "G", "type": "input"},
        {"number": 2, "name": "S", "type": "power_out"},
        {"number": 3, "name": "D", "type": "power_in"},
    ],
    "pkg": {"name": "SOT-23", "layout": "sot23", "rows": 1, "pinsPerRow": 3,
            "pitch": 0.95, "rowSpan": 2.4, "bodyWidth": 1.3, "bodyLength": 2.9,
            "leadWidth": 0.4, "leadLength": 0.4},
}


def find_kicad_python():
    """Return a Python interpreter that can import pcbnew, or None.

    KiCad ships its own python.exe next to pcbnew; a system Python usually
    cannot import it. Each candidate is probed with a real import, so a
    missing/broken KiCad install skips cleanly instead of failing later.
    """
    base = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "KiCad"
    candidates = []
    if base.is_dir():
        for p in sorted(base.glob("*/bin/python.exe"), reverse=True):
            candidates.append(str(p))
    w = shutil.which("python")
    if w:
        candidates.append(w)
    for exe in candidates:
        try:
            r = subprocess.run([exe, "-c", "import pcbnew"], capture_output=True)
            if r.returncode == 0:
                return exe
        except Exception:
            continue
    return None


def kicad_bin_dir():
    base = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "KiCad"
    if base.is_dir():
        for p in sorted(base.glob("*/bin"), reverse=True):
            if (p / "kicad-cli.exe").exists():
                return p
    return None


def kicad_cli_parses(bin_dir, sym, mods):
    """Ask kicad-cli to re-save every file. `sym upgrade` parses the symbol
    library and `fp upgrade` parses a footprint library directory, so a
    syntax error in either file makes this fail. Inputs are copied first:
    `fp upgrade` consumes a file path passed directly as its input."""
    cli = bin_dir / "kicad-cli.exe"
    work = OUT / "upgrade-check"
    shutil.rmtree(work, ignore_errors=True)
    libdir = work / "gen.pretty"
    libdir.mkdir(parents=True)
    shutil.copy2(sym, work / "gen.kicad_sym")
    for i, m in enumerate(mods):
        shutil.copy2(m, libdir / f"gen{i}.kicad_mod")
    r1 = subprocess.run([str(cli), "sym", "upgrade", "--force", str(work / "gen.kicad_sym")],
                        capture_output=True, text=True)
    if r1.returncode != 0:
        return False, f"kicad-cli sym upgrade failed: {(r1.stdout + r1.stderr).strip()[:400]}"
    r2 = subprocess.run([str(cli), "fp", "upgrade", "--force", str(libdir)],
                        capture_output=True, text=True)
    if r2.returncode != 0:
        return False, f"kicad-cli fp upgrade failed: {(r2.stdout + r2.stderr).strip()[:400]}"
    return True, "kicad-cli parsed and re-saved both files"


def main():
    kicad_py = find_kicad_python()
    bin_dir = kicad_bin_dir()
    if not kicad_py or not bin_dir:
        msg = "KiCad python not found - skipping real-KiCad partgen verification"
        if REQUIRE:
            print("FAIL: " + msg)
            return 1
        print(msg)
        return 0

    OUT.mkdir(parents=True, exist_ok=True)
    sym = OUT / "gen.kicad_sym"
    mod = OUT / "gen.kicad_mod"
    mod_sot23 = OUT / "sot23.kicad_mod"

    # Generate with the TS emitter.
    ts_mod = TS_OUT / "partgen.js"
    if not ts_mod.exists():
        print(f"FAIL: {ts_mod} missing - compile lib/partgen.ts first")
        return 1
    js = (
        "const fs=require('fs');"
        "const {generateKicadSymbol,generateKicadFootprint}=require(process.argv[1]);"
        "const spec=JSON.parse(fs.readFileSync(process.argv[4],'utf8'));"
        "fs.writeFileSync(process.argv[2], generateKicadSymbol(spec));"
        "fs.writeFileSync(process.argv[3], generateKicadFootprint(spec));"
        "const spec2=JSON.parse(fs.readFileSync(process.argv[5],'utf8'));"
        "fs.writeFileSync(process.argv[6], generateKicadFootprint(spec2));"
    )
    spec_json = OUT / "spec.json"
    spec2_json = OUT / "spec-sot23.json"
    spec_json.write_text(json.dumps(SOIC8))
    spec2_json.write_text(json.dumps(SOT23))
    subprocess.run(
        ["node", "-e", js, str(ts_mod), str(sym), str(mod), str(spec_json), str(spec2_json), str(mod_sot23)],
        check=True,
    )

    # Validate with KiCad's own APIs.
    script = r"""
import sys, json
sys.path.insert(0, r"KICAD_BIN")
import pcbnew

def pads_of(name):
    fp = pcbnew.FootprintLoad(r"LIBDIR", name)
    return {p.GetPadName(): {
        "pos": [round(pcbnew.ToMM(p.GetPosition().x), 3), round(pcbnew.ToMM(p.GetPosition().y), 3)],
        "size": [round(pcbnew.ToMM(p.GetSize().x), 3), round(pcbnew.ToMM(p.GetSize().y), 3)],
    } for p in fp.Pads()}

print(json.dumps({"soic8": pads_of("gen"), "sot23": pads_of("sot23")}))
""".replace("KICAD_BIN", str(bin_dir)).replace("LIBDIR", str(OUT))
    r = subprocess.run([kicad_py, "-c", script], capture_output=True, text=True)
    if r.returncode != 0:
        print("FAIL: KiCad could not load the generated footprints")
        print(r.stderr[:800])
        return 1
    got = json.loads(r.stdout)
    ok = True
    soic = got["soic8"]
    sot = got["sot23"]

    if sorted(soic) != [str(i) for i in range(1, 9)]:
        ok = False
        print(f"FAIL: SOIC-8 pad numbers {sorted(soic)}")
    # Pad 1: left row, top. SOIC-8 (pitch 1.27, bodyWidth 3.9, leadLength 0.6)
    # → x = -(3.9/2 + 0.6/2) = -2.25, y = -(4-1)/2*1.27 = -1.905. Size:
    # leadWidth + 0.2 = 0.6 tall, pitch*1.5 = 1.905 long.
    px, py = soic["1"]["pos"]
    if abs(px + 2.25) > 0.01 or abs(py + 1.905) > 0.01:
        ok = False
        print(f"FAIL: SOIC-8 pad 1 at ({px}, {py}) mm, expected (-2.25, -1.905)")
    sw, sh = soic["1"]["size"]
    if abs(sw - 1.905) > 0.01 or abs(sh - 0.6) > 0.01:
        ok = False
        print(f"FAIL: SOIC-8 pad 1 size ({sw}, {sh}) mm, expected (1.905, 0.6)")
    # Counter-clockwise numbering: pin 5 bottom-right, pin 8 top-right.
    if not (soic["5"]["pos"][0] > 0 and soic["5"]["pos"][1] > 0):
        ok = False
        print(f"FAIL: SOIC-8 pin 5 should be bottom-right, got {soic['5']['pos']}")
    if not (soic["8"]["pos"][0] > 0 and soic["8"]["pos"][1] < 0):
        ok = False
        print(f"FAIL: SOIC-8 pin 8 should be top-right, got {soic['8']['pos']}")

    # SOT-23: 2 pins on one side (x<0, y=±0.475), 1 opposite (x>0, y=0).
    if sorted(sot) != ["1", "2", "3"]:
        ok = False
        print(f"FAIL: SOT-23 pad numbers {sorted(sot)}")
    else:
        s1, s2, s3 = sot["1"]["pos"], sot["2"]["pos"], sot["3"]["pos"]
        if not (s1[0] < 0 and abs(s1[1] + 0.475) < 0.01):
            ok = False
            print(f"FAIL: SOT-23 pin 1 at {s1}, expected (x<0, -0.475)")
        if not (s2[0] < 0 and abs(s2[1] - 0.475) < 0.01):
            ok = False
            print(f"FAIL: SOT-23 pin 2 at {s2}, expected (x<0, +0.475)")
        if not (s3[0] > 0 and abs(s3[1]) < 0.01):
            ok = False
            print(f"FAIL: SOT-23 pin 3 at {s3}, expected (x>0, 0)")
    print(f"{'ok' if ok else 'FAIL'}: KiCad loaded generated footprints — "
          f"SOIC-8 {len(soic)} pads, SOT-23 {len(sot)} pads")

    # kicad-cli parses both files (symbol lib syntax is not covered by pcbnew).
    cli_ok, cli_msg = kicad_cli_parses(bin_dir, sym, [mod, mod_sot23])
    if not cli_ok:
        ok = False
        print(f"FAIL: {cli_msg}")
    else:
        print(f"ok: {cli_msg}")

    print("ALL PARTGEN KICAD CHECKS PASSED" if ok else "PARTGEN KICAD CHECKS FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())