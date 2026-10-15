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
