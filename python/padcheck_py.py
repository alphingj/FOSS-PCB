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
print("PYTHON PAD CHECKS PASSED")
