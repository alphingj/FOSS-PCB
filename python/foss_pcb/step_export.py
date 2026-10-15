"""STEP/GLB export stub. Full impl uses CadQuery/PythonOCC when installed."""
import json
import sys


def export_step(foss: dict) -> str:
    comps = len(foss.get("components", []))
    name = foss.get("project_metadata", {}).get("design_name", "board")
    return json.dumps({"file": f"{name}.step", "components": comps, "note": "stub — install CadQuery for solid STEP"})


if __name__ == "__main__":
    foss = json.load(sys.stdin) if not sys.stdin.isatty() else {"project_metadata": {"design_name": "board"}}
    print(export_step(foss))
