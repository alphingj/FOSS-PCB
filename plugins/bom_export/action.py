"""BOM export plugin. Entry point is run(args); the Plugin class mirrors KiCad's
ActionPlugin shape so the logic ports 1:1, but FOSS discovery uses run()."""
try:
    from foss_pcb.action_shim import FossActionPlugin
except ImportError:
    FossActionPlugin = object


class Plugin(FossActionPlugin):
    name = "BOM Export"
    description = "Export CSV BOM from FOSS JSON"


def _cell(v) -> str:
    s = "" if v is None else str(v)
    return f'"{s.replace(chr(34), chr(34) + chr(34))}"' if any(ch in s for ch in [",", '"', "\n"]) else s


def run(args: dict):
    comps = args.get("components", [])
    lines = ["Designator,Value,Footprint,MPN"]
    for c in comps:
        lines.append(",".join(_cell(c.get(k, "")) for k in ("designator", "value", "footprint", "mpn")))
    return {"csv": "\n".join(lines)}
