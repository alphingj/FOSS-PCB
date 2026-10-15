"""FOSS-PCB Python side: KiCad-compat, 3D helpers, sim."""
from .kicad_compat import foss_to_kicad_pcb, kicad_pcb_to_foss
from . import footprint, step_export, sim

__all__ = ["foss_to_kicad_pcb", "kicad_pcb_to_foss", "footprint", "step_export", "sim"]
__version__ = "0.1.0"
