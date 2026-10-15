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
# Symmetric 2-pin footprints: pad centers at ±dx (pad "1" left, "2" right).
# Nets attach per pin label so connectivity is exact regardless of convention.
TWO_PIN = [
    ("R_0805", 1.05, 1.0, 1.2),
    ("C_0805", 1.05, 1.0, 1.2),
    ("LED_0805", 1.05, 1.0, 1.2),
    ("SOD-123", 1.6, 1.0, 1.1),
    ("D_SMA", 2.1, 2.0, 2.0),
]
SOT23_PADS = [(1, -0.9, 0.95), (2, -0.9, -0.95), (3, 0.9, 0.0)]
PINOUTS = {
    "UC3843": {"VCC": 7, "OUT": 6, "FB": 2, "GND": 5},
    "NE555": {"GND": 1, "TRIG": 2, "OUT": 3, "RESET": 4, "CTRL": 5, "CONT": 5,
              "THR": 6, "THRES": 6, "DISCH": 7, "VCC": 8},
    "AO3400": {"G": 1, "S": 2, "D": 3},
    "TL431": {"R": 2, "REF": 2, "A": 3, "K": 1},
    "LM358": {"OUT1": 1, "IN1-": 2, "IN1+": 3, "V-": 4, "IN2+": 5, "IN2-": 6, "OUT2": 7, "V+": 8},
}


def _pinout_for(mpn: str):
    up = (mpn or "").upper()
    for prefix, table in PINOUTS.items():
        if up.startswith(prefix):
            return table
    return None


def _two_pin_geom(fp):
    for key, dx, w, h in TWO_PIN:
        if key in fp:
            return dx, w, h
    return None


def _rot(dx, dy, rot):
    import math as _m
    r = _m.radians(rot or 0)
    return dx * _m.cos(r) - dy * _m.sin(r), dx * _m.sin(r) + dy * _m.cos(r)


def _pad_lines(fp, mpn, des, net_nodes, net_ids, x, y, rot, pins):
    """SOIC-8 with verified nets; symmetric 2-pin with exact per-label nets;
    SOT-23 geometry net-0; anything else gets no pads (never guessed)."""
    if "SOIC-8" not in fp:
        geom = _two_pin_geom(fp)
        if geom and pins:
            dx, w, h = geom
            labels = list(pins.keys())
            first = "1" if "1" in labels else ("A" if "A" in labels else labels[0])
            order = [first] + [l for l in labels if l != first]
            out = []
            for i, label in enumerate(order[:2]):
                nid = 0
                for net_name in net_nodes:
                    if f"{des}.{label}" in net_nodes[net_name]:
                        nid = net_ids.get(net_name, 0)
                        break
                ox = -dx if i == 0 else dx
                ax, ay = _rot(ox, 0, rot)
                out.append(
                    f'    (pad "{i + 1}" smd roundrect (at {x + ax:.3f} {y + ay:.3f} {rot})'
                    f' (size {w} {h}) (layers "F.Cu" "F.Paste" "F.Mask") (net {nid})'
                    f' (roundrect_rratio 0.25) (tstamp {uuid4()}))'
                )
            return out
        if "SOT-23" in fp:
            table = _pinout_for(mpn) or {}
            out = []
            for n, dx, dy in SOT23_PADS:
                label = next((l for l, num in table.items() if num == n and l in pins), None)
                nid = 0
                if label:
                    for net_name in net_nodes:
                        if f"{des}.{label}" in net_nodes[net_name]:
                            nid = net_ids.get(net_name, 0)
                            break
                ax, ay = _rot(dx, dy, rot)
                out.append(
                    f'    (pad "{n}" smd rect (at {x + ax:.3f} {y + ay:.3f} {rot})'
                    f' (size 0.8 1.0) (layers "F.Cu" "F.Paste" "F.Mask") (net {nid})'
                    f' (tstamp {uuid4()}))'
                    + ("" if label else " ; PLACEHOLDER: SOT-23 pinout not yet verified")
                )
            return out
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
            c.get("pins", {}) or {},
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
