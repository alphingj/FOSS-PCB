"""DRC report plugin. Entry point is run(args); the Plugin class mirrors KiCad's
ActionPlugin shape so the logic ports 1:1, but FOSS discovery uses run()."""
try:
    from foss_pcb.action_shim import FossActionPlugin
except ImportError:
    FossActionPlugin = object


class Plugin(FossActionPlugin):
    name = "DRC Report"
    description = "Markdown DRC report"


def run(args: dict):
    issues = args.get("issues", [])
    if not issues:
        return {"markdown": "DRC clean."}
    return {"markdown": "\n".join(f'- [{i.get("severity")}] {i.get("message")}' for i in issues)}
