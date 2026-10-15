"""KiCad s-expr interop. Reads/writes .kicad_pcb so KiCad plugins work unmodified."""
import json
import math
import re
import sys
from uuid import uuid4


def kicad_pcb_to_foss(text: str) -> dict:
    footprints = re.findall(r'\(footprint\s+"?([^"\s\)]+)', text)
    nets = re.findall(r'\(net\s+(\d+)\s+"?([^"\)]*)', text)
    return {"footprints": footprints, "nets": [{"id": n[0], "name": n[1]} for n in nets]}


# SOIC-8 pad geometry + verified pinouts. Source of truth is
# lib/kicad-pads.ts — keep the numbers identical when editing either side.
# SOURCES: TI UCx84x datasheet (COMP=1 VFB=2 ISENSE=3 RTCT=4 GND=5 OUT=6
# VCC=7 VREF=8); TI NE555 datasheet (GND=1 TRIG=2 OUT=3 RESET=4 CONT=5
# THRES=6 DISCH=7 VCC=8).
SOIC8_DX = 2.7
SOIC8_DY = [1.905, 0.635, -0.635, -1.905]
PINOUTS = {
    "UC3843": {"VCC": 7, "OUT": 6, "FB": 2, "GND": 5},
    "NE555": {"GND": 1, "TRIG": 2, "OUT": 3, "RESET": 4, "CTRL": 5, "CONT": 5,
              "THR": 6, "THRES": 6, "DISCH": 7, "VCC": 8},
}


def _pinout_for(mpn: str):
    up = (mpn or "").upper()
    for prefix, table in PINOUTS.items():
        if up.startswith(prefix):
            return table
    return None


def _pad_lines(fp, mpn, des, net_nodes, net_ids, x, y, rot):
    """Real SOIC-8 pads with verified nets; anything else gets no pads (never guessed)."""
    if "SOIC-8" not in fp:
        return []
    table = _pinout_for(mpn) or {}
    label_of = {num: label for label, num in table.items()}
    r = math.radians(rot or 0)
    cos_r, sin_r = math.cos(r), math.sin(r)
    out = []
    for i in range(8):
        n = i + 1
        dx = -SOIC8_DX if n <= 4 else SOIC8_DX
        dy = SOIC8_DY[(n - 1) % 4]
        ax = x + dx * cos_r - dy * sin_r
        ay = y + dx * sin_r + dy * cos_r
        label = label_of.get(n)
        nid = 0
        if label:
            for net_name in net_nodes:
                if f"{des}.{label}" in net_nodes[net_name]:
                    nid = net_ids.get(net_name, 0)
                    break
        out.append(
            f'    (pad "{n}" smd roundrect (at {ax:.3f} {ay:.3f} {rot})'
            f' (size 0.6 1.6) (layers "F.Cu" "F.Paste" "F.Mask") (net {nid})'
            f' (roundrect_rratio 0.25) (tstamp {uuid4()}))'
            + ("" if label else " ; PLACEHOLDER: unverified pin — net assigned in KiCad")
        )
    return out


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
        )
        net_nodes = {n.get("net_name"): (n.get("nodes", []) or []) for n in nets}
        lines.extend(_pad_lines(
            fp, c.get("mpn", ""), c.get("designator", ""), net_nodes, net_ids,
            float(p.get("x", 0)), float(p.get("y", 0)), float(p.get("rotation", 0)),
        ))
        lines.append("  )")
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
