"""KiCad s-expr interop. Reads/writes .kicad_pcb so KiCad plugins work unmodified."""
import json
import re
import sys


def kicad_pcb_to_foss(text: str) -> dict:
    footprints = re.findall(r'\(footprint\s+"?([^"\s\)]+)', text)
    nets = re.findall(r'\(net\s+(\d+)\s+"?([^"\)]*)', text)
    return {"footprints": footprints, "nets": [{"id": n[0], "name": n[1]} for n in nets]}


def _q(v) -> str:
    return str(v if v is not None else "").replace('"', "")


def foss_to_kicad_pcb(foss: dict) -> str:
    lines = ["(kicad_pcb (version 20240101) (generator foss-pcb)"]
    nets = foss.get("nets", [])
    net_ids = {}
    for i, n in enumerate(nets, start=1):
        name = _q(n.get("net_name", ""))
        net_ids[n.get("net_name")] = i
        lines.append(f'  (net {i} "{name}")')
    for c in foss.get("components", []):
        p = c.get("pcb_placement_mm", {}) or {}
        fp = _q(c.get("footprint", ""))
        lines.append(
            f'  (footprint "{fp}" (layer "F.Cu")'
            f' (at {p.get("x", 0)} {p.get("y", 0)} {p.get("rotation", 0)})'
            f' (property "Reference" "{_q(c.get("designator", ""))}")'
            f' (property "Value" "{_q(c.get("value", ""))}")'
            + (f' (property "MPN" "{_q(c.get("mpn", ""))}")' if c.get("mpn") else "")
            + ")"
        )
    for t in foss.get("pcb_traces", []):
        nid = net_ids.get(t.get("net"), 0)
        layer = "F.Cu" if t.get("layer", "Top") == "Top" else "B.Cu"
        pts = t.get("pts_mm", []) or []
        for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
            if abs(x2 - x1) < 1e-9 and abs(y2 - y1) < 1e-9:
                continue
            lines.append(
                f'  (segment (start {x1} {y1}) (end {x2} {y2})'
                f' (width {t.get("width_mm", 0.25)}) (layer "{layer}") (net {nid}))'
            )
    lines.append(")")
    return "\n".join(lines)


def read_stdin_json() -> dict:
    if sys.stdin.isatty():
        return {}
    try:
        raw = sys.stdin.read().strip()
        return json.loads(raw) if raw else {}
    except (json.JSONDecodeError, OSError):
        return {}


if __name__ == "__main__":
    if "--to-kicad" in sys.argv:
        print(foss_to_kicad_pcb(read_stdin_json()))
