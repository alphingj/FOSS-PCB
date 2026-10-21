import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = {"PYTHONPATH": os.path.join(ROOT, "python") + os.pathsep + ROOT, "FOSS_3D": "0"}
sys.path.insert(0, os.path.join(ROOT, "python"))

# --- official KiCad 3D-model resolution (offline: mapping only) ---
from foss_pcb.models3d import ensure_models, resolve_model  # noqa: E402

ref = resolve_model("R_0805_2012Metric")
assert ref and ref["library"] == "Resistor_SMD" and ref["url"].endswith("R_0805_2012Metric.step"), ref
ref = resolve_model("Package_SO:SOIC-8_3.9x4.9mm_P1.27mm")
assert ref and ref["library"] == "Package_SO" and ref["name"] == "SOIC-8_3.9x4.9mm_P1.27mm", ref
ref = resolve_model("TerminalBlock_Phoenix_MKDS-1,5-2_5.08mm")
assert ref and "MKDS-1,5-2-5.08_1x02" in ref["name"], ref
assert resolve_model("Inductor_Bourns_SRR1280_12.5x12.5mm") is None, "never substitute a lookalike model"
assert resolve_model("") is None and resolve_model("Mystery_Part") is None
print("models3d: resolver maps exact official footprints only")

if os.environ.get("FOSS_3D_NET") == "1":
    import tempfile
    from foss_pcb.kicad_compat import foss_to_kicad_pcb
    with tempfile.TemporaryDirectory() as cache:
        info = ensure_models({"components": [{"designator": "R1", "footprint": "R_0805_2012Metric"}]}, cache=cache)
        assert list(info["paths"]) == ["R1"] and not info["missing"], info
        model_path = info["paths"]["R1"]
        assert os.path.getsize(model_path) > 1000
        with open(model_path, encoding="utf-8", errors="replace") as fh:
            assert fh.read(32).lstrip().startswith("ISO-10303-21")
        board_text = foss_to_kicad_pcb({"components": [{"designator": "R1", "footprint": "R_0805_2012Metric",
                                                       "pcb_placement_mm": {"x": 5, "y": 5}}]}, info["paths"])
        assert '(model "' in board_text and "R_0805_2012Metric.step" in board_text, board_text[-400:]
        print(f"models3d: downloaded a real official STEP ({os.path.getsize(model_path)} bytes) and referenced it")

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
    model_info = data.get("models") or {}
    assert isinstance(model_info, dict) and "used" in model_info, "STEP envelope must report 3D-model usage"
    print(f"step: real AP214 via {data['backend']}, {len(step)} bytes, {model_info.get('used', 0)} official bodies, file {data.get('file')}")

