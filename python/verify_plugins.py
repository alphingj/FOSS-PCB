import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = {"PYTHONPATH": os.path.join(ROOT, "python") + os.pathsep + ROOT}

foss = {
    "project_metadata": {},
    "components": [
        {"designator": "R1", "value": "10k, 1%", "mpn": 'a"b',
         "footprint": "R_0805_2012Metric",
         "pcb_placement_mm": {"x": 5, "y": 5, "rotation": 90}},
    ],
    "nets": [{"net_name": "GND"}],
    "pcb_traces": [{"net": "GND", "layer": "Top", "width_mm": 0.5,
                    "pts_mm": [[1, 1], [2, 2], [2, 2], [5, 5]]}],
}
payload = json.dumps(foss)

r = subprocess.run([sys.executable, os.path.join(ROOT, "python", "foss_pcb", "kicad_compat.py"), "--to-kicad"],
                   input=payload, capture_output=True, text=True, env={**dict(__import__("os").environ), **ENV})
print("=== kicad_compat ===")
print(r.stdout)
print("stderr:", r.stderr[-300:] if r.stderr else "")

r = subprocess.run([sys.executable, "-m", "foss_pcb.runner", "bom_export"],
                   input=json.dumps({"components": foss["components"]}),
                   capture_output=True, text=True, env={**dict(__import__("os").environ), **ENV})
print("=== bom_export ===")
print(r.stdout)
print("stderr:", r.stderr[-300:] if r.stderr else "")

r = subprocess.run([sys.executable, "-m", "foss_pcb.runner", "drc_report"],
                   input=json.dumps({"issues": []}),
                   capture_output=True, text=True, env={**dict(__import__("os").environ), **ENV})
print("=== drc_report ===")
print(r.stdout)

# STEP export must be real geometry or an actionable error — never a manifest.
r = subprocess.run([sys.executable, "-m", "foss_pcb.step_export"],
                   input=payload, capture_output=True, text=True,
                   env={**dict(__import__("os").environ), **ENV})
print("=== step_export ===")
assert r.returncode == 0, f"step_export exited {r.returncode}: {r.stderr[-400:]}"
data = json.loads(r.stdout)
assert "step-stub" not in r.stdout.lower(), "STEP exporter must not emit a stub"
if "error" in data:
    # Machines without KiCad must say so plainly and name the fix.
    assert "KiCad" in data["error"], f"unhelpful STEP error: {data['error']}"
    print("step: unavailable —", data["error"])
else:
    step = data.get("step", "")
    assert step.startswith("ISO-10303-21;"), "STEP header missing"
    assert "AUTOMOTIVE_DESIGN" in step[:800], "STEP schema is not AP214"
    assert len(step) > 1000, "STEP payload is implausibly small"
    assert data.get("backend") == "kicad-cli"
    print(f"step: real AP214 via {data['backend']}, {len(step)} bytes, file {data.get('file')}")

