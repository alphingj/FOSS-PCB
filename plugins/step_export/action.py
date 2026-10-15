"""STEP export plugin. Entry point is run(args); the Plugin class mirrors KiCad's
ActionPlugin shape so the logic ports 1:1, but FOSS discovery uses run()."""
try:
    from foss_pcb.action_shim import FossActionPlugin
except ImportError:
    FossActionPlugin = object


class Plugin(FossActionPlugin):
    name = "STEP Export"
    description = "Export 3D STEP via PythonOCC/CadQuery when available"


def run(args: dict):
    from foss_pcb.step_export import export_step
    import json
    return json.loads(export_step(args.get("pcb", {})))
