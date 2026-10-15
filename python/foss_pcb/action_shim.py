"""KiCad ActionPlugin shim: real KiCad plugins subclass ActionPlugin; ours accepts the same shape."""
try:
    from pcbnew import ActionPlugin as KiCadActionPlugin  # type: ignore
except ImportError:
    class KiCadActionPlugin:  # fallback when KiCad not installed
        def defaults(self): ...
        def Run(self): ...


class FossActionPlugin(KiCadActionPlugin):
    name = "FOSS Base"
    category = "FOSS-PCB"
    description = ""
