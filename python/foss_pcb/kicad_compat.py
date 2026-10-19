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


# Pad geometry + verified pinouts. Source of truth is lib/kicad-pads.ts — keep
# the numbers identical when editing either side. Geometry is read from the
# official KiCad 10.0 footprint library on disk, NOT estimated.
# PINOUT SOURCES: TI UCx84x datasheet (COMP=1 VFB=2 ISENSE=3 RTCT=4 GND=5
# OUT=6 VCC=7 VREF=8); TI NE555 datasheet (GND=1 TRIG=2 OUT=3 RESET=4 CONT=5
# THRES=6 DISCH=7 VCC=8).
SOIC8_DX = 2.475
# KiCad-native y-down offsets, verbatim from the .kicad_mod
SOIC8_DY = [-1.905, -0.635, 0.635, 1.905]
SOIC8_W = 1.95
SOIC8_H = 0.6
# Symmetric 2-pin footprints: pad centers at ±dx (pad "1" left, "2" right).
# Nets attach per pin label so connectivity is exact regardless of convention.
# (dx, w, h) from R_0805_2012Metric / D_SOD-123 / D_SMA .kicad_mod files.
TWO_PIN = [
    ("R_0805", 0.9125, 1.025, 1.4),
    ("C_0805", 0.9125, 1.025, 1.4),
    ("LED_0805", 0.9125, 1.025, 1.4),
    ("SOD-123", 1.65, 0.9, 1.2),
    ("D_SMA", 2.0, 2.5, 1.8),
]
# (n, dx, dy, w, h) from Package_TO_SOT_SMD.pretty/SOT-23.kicad_mod
SOT23_PADS = [
    (1, -0.9375, -0.95, 1.475, 0.6),
    (2, -0.9375, 0.95, 1.475, 0.6),
    (3, 0.9375, 0.0, 1.475, 0.6),
]
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


def _net_field(nid, net_names):
    """KiCad requires a quoted name in every (net ...) field, including the
    reserved unconnected net 0. Verified: '(net 0)' alone makes kicad-cli
    refuse to load the board."""
    name = "" if nid == 0 else _q(net_names[nid - 1]) if 0 < nid <= len(net_names) else ""
    return f'(net {nid} "{name}")'


def _pad_lines(fp, mpn, des, net_nodes, net_ids, net_names, rot, pins):
    """SOIC-8 with verified nets; symmetric 2-pin with exact per-label nets;
    SOT-23 geometry net-0; anything else gets no pads (never guessed).
    Pad coordinates are offsets from the footprint origin (KiCad places pads
    relative to the footprint `(at ...)`), so they must NOT include x/y."""
    def nid_for(label):
        if not label:
            return 0
        for net_name in net_nodes:
            if f"{des}.{label}" in net_nodes[net_name]:
                return net_ids.get(net_name, 0)
        return 0

    notes = []
    if "SOIC-8" not in fp:
        geom = _two_pin_geom(fp)
        if geom and pins:
            dx, w, h = geom
            labels = list(pins.keys())
            first = "1" if "1" in labels else ("A" if "A" in labels else labels[0])
            order = [first] + [l for l in labels if l != first]
            out = []
            for i, label in enumerate(order[:2]):
                ox = -dx if i == 0 else dx
                out.append(
                    f'    (pad "{i + 1}" smd roundrect (at {ox:.3f} 0.000 {rot})'
                    f' (size {w} {h}) (layers "F.Cu" "F.Paste" "F.Mask")'
                    f' {_net_field(nid_for(label), net_names)}'
                    f' (roundrect_rratio 0.25) (tstamp {uuid4()}))'
                )
            return out
        if "SOT-23" in fp:
            table = _pinout_for(mpn) or {}
            out = []
            unverified = 0
            for n, dx, dy, w, h in SOT23_PADS:
                label = next((l for l, num in table.items() if num == n and l in pins), None)
                if not label:
                    unverified += 1
                out.append(
                    f'    (pad "{n}" smd rect (at {dx:.3f} {dy:.3f} {rot})'
                    f' (size {w} {h}) (layers "F.Cu" "F.Paste" "F.Mask")'
                    f' {_net_field(nid_for(label), net_names)} (tstamp {uuid4()}))'
                )
            if unverified:
                notes.append(f'SOT-23 pinout not verified for {mpn} — {unverified} pad(s) left on net 0')
            return out
        return []
    table = _pinout_for(mpn) or {}
    label_of = {num: label for label, num in table.items()}
    out = []
    unverified = 0
    for i in range(8):
        n = i + 1
        dx = -SOIC8_DX if n <= 4 else SOIC8_DX
        dy = SOIC8_DY[(n - 1) % 4]
        label = label_of.get(n)
        if not label:
            unverified += 1
        out.append(
            f'    (pad "{n}" smd roundrect (at {dx:.3f} {dy:.3f} {rot})'
            f' (size {SOIC8_W} {SOIC8_H}) (layers "F.Cu" "F.Paste" "F.Mask")'
            f' {_net_field(nid_for(label), net_names)}'
            f' (roundrect_rratio 0.25) (tstamp {uuid4()}))'
        )
    if unverified:
        notes.append(f'Pinout not verified for {mpn or des} — {unverified} pad(s) left on net 0')
    return out + [f'    (property "FOSS_NOTE" "{_q(notes[0])}")'] if notes else out


def _q(v) -> str:
    return str(v if v is not None else "").replace('"', "")


def foss_to_kicad_pcb(foss: dict) -> str:
    lines = ["(kicad_pcb (version 20240101) (generator foss-pcb)"]
    nets = foss.get("nets", [])
    net_ids = {}
    for i, n in enumerate(nets, start=1):
        name = _q(n.get("net_name", ""))
        if not name:
            name = f"NET{i}"
        net_ids[n.get("net_name")] = i
        lines.append(f'  (net {i} "{name}")')
    for c in foss.get("components", []):
        p = c.get("pcb_placement_mm", {}) or {}
        fp = _q(c.get("footprint", ""))
        lines.append(
            f'  (footprint "{fp}" (layer "F.Cu")'
            f' (at {p.get("x", 0)} {p.get("y", 0)} {p.get("rotation", 0)})'
            f' (property "Reference" "{_q(c.get("designator", ""))}"'
            f' (at 0 -2 0) (layer "F.SilkS") (uuid {uuid4()})'
            f' (effects (font (size 1 1) (thickness 0.15))))'
            f' (property "Value" "{_q(c.get("value", ""))}"'
            f' (at 0 2 0) (layer "F.Fab") (hide yes) (uuid {uuid4()})'
            f' (effects (font (size 1 1) (thickness 0.15))))'
            f' (attr smd)'
            + (f' (property "MPN" "{_q(c.get("mpn", ""))}")' if c.get("mpn") else "")
        )
        net_nodes = {n.get("net_name"): (n.get("nodes", []) or []) for n in nets}
        lines.extend(_pad_lines(
            fp, c.get("mpn", ""), c.get("designator", ""), net_nodes, net_ids,
            [n.get("net_name", "") for n in nets], float(p.get("rotation", 0)),
            c.get("pins", {}) or {},
        ))
        lines.append("  )")
    # Board outline on Edge.Cuts — without it KiCad DRC reports a malformed
    # outline. Verified with kicad-cli 10.0.6.
    spec = (foss.get("project_metadata", {}) or {}).get("pcb_specifications", {}) or {}
    w = float(spec.get("board_width_mm", 0) or 0)
    h = float(spec.get("board_height_mm", 0) or 0)
    if w > 0 and h > 0:
        for (x1, y1), (x2, y2) in (((0, 0), (w, 0)), ((w, 0), (w, h)),
                                   ((w, h), (0, h)), ((0, h), (0, 0))):
            lines.append(
                f'  (gr_line (start {x1} {y1}) (end {x2} {y2})'
                f' (layer "Edge.Cuts") (width 0.05) (tstamp {uuid4()}))'
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
                f' (width {t.get("width_mm", 0.25)}) (layer "{layer}")'
                f' {_net_field(nid, [n.get("net_name", "") for n in nets])})'
            )
    # Copper pour zones — KiCad computes the filled polygon on load; we emit
    # the zone boundary + pad connection rules. Verified with kicad-cli 10.0.6.
    # NOTE: KiCad 10's zone grammar uses `polygon`, `connect_pads`,
    # `min_thickness`, `fill`, `hatch` — not the older `chain`/`pad_connections`
    # tokens. Net name is implied by the (net N) id.
    for z in foss.get("pcb_layout_zones", []):
        nid = net_ids.get(z.get("net"), 0)
        layer = "B.Cu" if str(z.get("layer", "Top")).lower().startswith("bottom") else "F.Cu"
        bb = z.get("bounding_box_mm", {}) or {}
        x1, y1, x2, y2 = bb.get("x1", 0), bb.get("y1", 0), bb.get("x2", 0), bb.get("y2", 0)
        pts = f"(xy {x1} {y1}) (xy {x2} {y1}) (xy {x2} {y2}) (xy {x1} {y2})"
        lines.append(f'  (zone (net {nid}) (layer "{layer}") (tstamp {uuid4()})')
        lines.append('    (hatch edge 0.508)')
        lines.append('    (priority 0)')
        lines.append('    (connect_pads (clearance 0.2))')
        lines.append('    (min_thickness 0.254)')
        lines.append('    (fill yes (thermal_gap 0.508) (thermal_bridge_width 0.508))')
        lines.append(f'    (polygon (pts {pts}))')
        lines.append('  )')
    # Vias: plated through-hole. KiCad 10 uses (net N) with no quoted name
    # for vias (verified against a real .kicad_pcb from the KiCad 10 demos).
    for v in foss.get("pcb_vias", []):
        nid = net_ids.get(v.get("net"), 0)
        lines.append(
            f'  (via (at {v.get("x", 0)} {v.get("y", 0)}) (size {v.get("pad_mm", 0.6)})'
            f' (drill {v.get("drill_mm", 0.3)}) (layers "F.Cu" "B.Cu")'
            f' (net {nid}) (tstamp {uuid4()}))'
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
