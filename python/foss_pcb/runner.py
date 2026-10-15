"""Plugin runner. Primary input is JSON on stdin (immune to shell quoting issues):
    echo '<args_json>' | python -m foss_pcb.runner <plugin_name>
argv JSON is accepted as a fallback: python -m foss_pcb.runner <name> '<args_json>'."""
import importlib
import json
import sys


def read_args() -> dict:
    # 1) piped stdin (Tauri commands.rs uses this — immune to shell quote-mangling)
    if not sys.stdin.isatty():
        raw = sys.stdin.read().strip()
        if raw:
            return json.loads(raw)
    # 2) argv fallback
    if len(sys.argv) > 2:
        return json.loads(sys.argv[2])
    return {}


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "bom_export"
    args = read_args()
    try:
        mod = importlib.import_module(f"plugins.{name}.action")
    except ImportError:
        # dev-layout fallback: plugins/<name>/action.py on sys.path
        sys.path.insert(0, "plugins")
        mod = importlib.import_module(f"{name}.action")
    print(json.dumps(mod.run(args)))


if __name__ == "__main__":
    main()
