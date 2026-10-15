import json
import sys
sys.path.insert(0, "python")
from foss_pcb.kicad_compat import foss_to_kicad_pcb

foss = {
    "components": [
        {"designator": "U1", "value": "UC3843B", "mpn": "UC3843BD1",
         "footprint": "SOIC-8_3.9x4.9mm_P1.27mm",
         "pcb_placement_mm": {"x": 16, "y": 8, "rotation": 0}},
    ],
    "nets": [
        {"net_name": "VIN", "nodes": ["U1.VCC"]},
        {"net_name": "GND", "nodes": ["U1.GND"]},
        {"net_name": "FB", "nodes": ["U1.FB"]},
        {"net_name": "GATE_DRV", "nodes": ["U1.OUT"]},
    ],
    "pcb_traces": [],
}
s = foss_to_kicad_pcb(foss)
pads = [l for l in s.splitlines() if "(pad " in l]
assert len(pads) == 8, pads
depth = 0
for ch in s:
    depth += (ch == "(") - (ch == ")")
assert depth == 0, depth
by_num = {}
for l in pads:
    import re
    m = re.search(r'\(pad "(\d)".*\(net (\d+)\)', l)
    by_num[m.group(1)] = int(m.group(2))
# net ids: VIN=1 GND=2 FB=3 GATE_DRV=4
assert by_num == {"1": 0, "2": 3, "3": 0, "4": 0, "5": 2, "6": 4, "7": 1, "8": 0}, by_num

sot = {
    "components": [
        {"designator": "Q9", "value": "AO3400", "mpn": "AO3400A",
         "footprint": "SOT-23", "pins": {"G": "G9", "D": "D9", "S": "GND"},
         "pcb_placement_mm": {"x": 10, "y": 10, "rotation": 0}},
    ],
    "nets": [
        {"net_name": "GND", "nodes": ["Q9.S"]},
        {"net_name": "G9", "nodes": ["Q9.G"]},
        {"net_name": "D9", "nodes": ["Q9.D"]},
    ],
    "pcb_traces": [],
}
s2 = foss_to_kicad_pcb(sot)
got = {}
for l in s2.splitlines():
    m = re.search(r'\(pad "(\d)".*\(net (\d+)\)', l)
    if m:
        got[m.group(1)] = int(m.group(2))
# net ids: GND=1 G9=2 D9=3 → G:1→2, S:2→1, D:3→3
assert got == {"1": 2, "2": 1, "3": 3}, got

sot2 = {
    "components": [
        {"designator": "U8", "value": "LM358", "mpn": "LM358DR",
         "footprint": "SOIC-8_3.9x4.9mm_P1.27mm",
         "pins": {"OUT1": "O1", "V-": "GND", "OUT2": "O2", "V+": "VCC8"},
         "pcb_placement_mm": {"x": 30, "y": 10, "rotation": 0}},
    ],
    "nets": [
        {"net_name": "GND", "nodes": ["U8.V-"]},
        {"net_name": "O1", "nodes": ["U8.OUT1"]},
        {"net_name": "O2", "nodes": ["U8.OUT2"]},
        {"net_name": "VCC8", "nodes": ["U8.V+"]},
    ],
    "pcb_traces": [],
}
s3 = foss_to_kicad_pcb(sot2)
got2 = {}
for l in s3.splitlines():
    m = re.search(r'\(pad "(\d)".*\(net (\d+)\)', l)
    if m:
        got2[m.group(1)] = int(m.group(2))
# net ids: GND=1 O1=2 O2=3 VCC8=4
assert got2 == {"1": 2, "2": 0, "3": 0, "4": 1, "5": 0, "6": 0, "7": 3, "8": 4}, got2
print("PYTHON PAD CHECKS PASSED")
