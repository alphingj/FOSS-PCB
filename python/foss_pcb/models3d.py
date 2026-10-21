"""Official KiCad 3D models, downloaded on demand for maximum-precision exports.

KiCad publishes its 3D library as `kicad-packages3d` on GitHub. The directory
layout mirrors the footprint libraries exactly:

    <FootprintLib>.3dshapes/<FootprintName>.step

so a footprint such as `Package_SO:SOIC-8_3.9x4.9mm_P1.27mm` maps to
`Package_SO.3dshapes/SOIC-8_3.9x4.9mm_P1.27mm.step`. Nothing is invented: if
the official library has no model under the exact footprint name (or a known
rename alias), the part is reported as missing instead of using a lookalike.
The SRR1280 is a real example — KiCad ships SRR1260, not SRR1280.

Downloads are validated as STEP (`ISO-10303-21`) and cached atomically in a
per-user cache directory, so repeated exports are offline and fast.
"""

import os
import re
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

MODEL_RAW_BASE = "https://raw.githubusercontent.com/KiCad/kicad-packages3d/master/"
MODEL_TIMEOUT_S = 25
MODEL_MAX_BYTES = 12 * 1024 * 1024
STEP_HEADER = "ISO-10303-21"

# Renames between the footprint names used by this app (and older KiCad
# releases) and the name used by the official 3D library. Only verified
# aliases belong here; never map a part onto a different part.
MODEL_ALIASES = {
    "TerminalBlock_Phoenix_MKDS-1,5-2_5.08mm": (
        "TerminalBlock_Phoenix",
        "TerminalBlock_Phoenix_MKDS-1,5-2-5.08_1x02_P5.08mm_Horizontal",
    ),
    "TerminalBlock_Phoenix_MKDS-1,5-2_5.08mm_Horizontal": (
        "TerminalBlock_Phoenix",
        "TerminalBlock_Phoenix_MKDS-1,5-2-5.08_1x02_P5.08mm_Horizontal",
    ),
    "TerminalBlock_Phoenix_MKDS-1,5-3_5.08mm_Horizontal": (
        "TerminalBlock_Phoenix",
        "TerminalBlock_Phoenix_MKDS-1,5-3-5.08_1x03_P5.08mm_Horizontal",
    ),
    "TerminalBlock_Phoenix_MKDS-1,5-4_5.08mm_Horizontal": (
        "TerminalBlock_Phoenix",
        "TerminalBlock_Phoenix_MKDS-1,5-4-5.08_1x04_P5.08mm_Horizontal",
    ),
    "TerminalBlock_Phoenix_MKDS-1,5-5_5.08mm_Horizontal": (
        "TerminalBlock_Phoenix",
        "TerminalBlock_Phoenix_MKDS-1,5-5-5.08_1x05_P5.08mm_Horizontal",
    ),
}

# Footprint-name prefixes that identify the official library. Ordered: the
# first match wins. These are naming conventions, not guesses about geometry.
LIBRARY_PREFIXES = [
    ("TerminalBlock_Phoenix_", "TerminalBlock_Phoenix"),
    ("Connector_Phoenix_", "Connector_Phoenix_MC"),
    ("SOIC-", "Package_SO"),
    ("TSSOP-", "Package_SO"),
    ("SSOP-", "Package_SO"),
    ("MSOP-", "Package_SO"),
    ("SOT-23", "Package_TO_SOT_SMD"),
    ("SOT-223", "Package_TO_SOT_SMD"),
    ("SOD-", "Diode_SMD"),
    ("D_SMA", "Diode_SMD"),
    ("D_SMB", "Diode_SMD"),
    ("D_SMC", "Diode_SMD"),
    ("CP_Elec", "Capacitor_SMD"),
    ("CP_", "Capacitor_SMD"),
    ("C_", "Capacitor_SMD"),
    ("R_", "Resistor_SMD"),
    ("L_", "Inductor_SMD"),
    ("Crystal_", "Crystal"),
    ("USB_", "Connector_USB"),
    ("PinHeader_", "Connector_PinHeader_2.54mm"),
]


def _clean_footprint(fp):
    return str(fp or "").strip()


def split_footprint(fp):
    """`Lib:Name` -> (Lib, Name); bare names return (None, Name)."""
    fp = _clean_footprint(fp)
    if ":" in fp:
        lib, name = fp.split(":", 1)
        return lib.strip(), name.strip()
    return None, fp


def guess_library(name):
    for prefix, library in LIBRARY_PREFIXES:
        if name.startswith(prefix):
            return library
    return None


def resolve_model(footprint):
    """Return {library, name, url} for the official model, or None.

    Pure and offline: no request is made here, so checks can assert the mapping.
    """
    lib, name = split_footprint(footprint)
    if not name:
        return None
    alias = MODEL_ALIASES.get(name)
    if alias:
        lib, name = alias
    target_lib = lib or guess_library(name)
    if not target_lib:
        return None
    path = f"{target_lib}.3dshapes/{name}.step"
    url = MODEL_RAW_BASE + "/".join(urllib.parse.quote(part, safe="-_.,") for part in path.split("/"))
    return {"library": target_lib, "name": name, "url": url}


def cache_dir():
    """Per-user model cache. FOSS_3D_CACHE overrides (used by checks)."""
    override = os.environ.get("FOSS_3D_CACHE")
    if override:
        return override
    if sys.platform == "win32":
        root = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        return os.path.join(root, "FOSS-PCB", "3dmodels")
    if sys.platform == "darwin":
        return os.path.join(os.path.expanduser("~"), "Library", "Caches", "FOSS-PCB", "3dmodels")
    return os.path.join(os.path.expanduser("~"), ".cache", "foss-pcb", "3dmodels")


def _cache_path(model, root):
    safe = re.sub(r"[^A-Za-z0-9._,-]+", "_", f"{model['library']}__{model['name']}.step")
    return os.path.join(root, safe)


def _download(url, timeout=MODEL_TIMEOUT_S):
    req = urllib.request.Request(url, headers={"User-Agent": "FOSS-PCB/1.0 (+official KiCad 3D models)"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        data = res.read(MODEL_MAX_BYTES + 1)
    if len(data) > MODEL_MAX_BYTES:
        raise ValueError(f"model is larger than {MODEL_MAX_BYTES // (1024 * 1024)} MB")
    if not data[:32].decode("ascii", "replace").lstrip().startswith(STEP_HEADER):
        raise ValueError("downloaded file is not STEP (missing ISO-10303-21 header)")
    return data


def ensure_models(foss, enabled=True, cache=None, fetch=None):
    """Resolve and download official models for every component footprint.

    Returns:
      {
        "enabled": bool,
        "paths": {designator: absolute step path},
        "resolved": [{designator, footprint, url, cached}],
        "missing": [{designator, footprint, reason}],
        "cache": path,
      }

    A network or cache failure for one part never aborts the export; that part
    is reported in `missing` and exported without a body.
    """
    root = cache or cache_dir()
    result = {"enabled": bool(enabled), "paths": {}, "resolved": [], "missing": [], "cache": root}
    if not enabled:
        return result

    by_footprint = {}
    for component in foss.get("components", []) or []:
        des = str(component.get("designator") or "")
        fp = _clean_footprint(component.get("footprint"))
        if not des or not fp:
            continue
        model = resolve_model(fp)
        if not model:
            result["missing"].append({"designator": des, "footprint": fp, "reason": "no official KiCad 3D model for this footprint"})
            continue
        try:
            os.makedirs(root, exist_ok=True)
            dest = _cache_path(model, root)
            cached = os.path.isfile(dest) and os.path.getsize(dest) > 0
            if not cached:
                data = fetch(model["url"]) if fetch else _download(model["url"])
                fd, tmp = tempfile.mkstemp(prefix=".foss-model-", suffix=".step", dir=root)
                try:
                    with os.fdopen(fd, "wb") as fh:
                        fh.write(data)
                    os.replace(tmp, dest)
                finally:
                    if os.path.exists(tmp):
                        os.unlink(tmp)
            result["paths"][des] = os.path.abspath(dest)
            result["resolved"].append({"designator": des, "footprint": fp, "url": model["url"], "cached": cached})
            by_footprint[fp] = dest
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
            reason = str(getattr(exc, "reason", exc)) or exc.__class__.__name__
            result["missing"].append({"designator": des, "footprint": fp, "reason": f"download failed: {reason}"})
    return result


def cached_model_paths(foss, cache=None):
    """Model paths that already exist on disk (no network). Used by the
    `.kicad_pcb` writer so a previously downloaded body is referenced too."""
    root = cache or cache_dir()
    paths = {}
    for component in foss.get("components", []) or []:
        des = str(component.get("designator") or "")
        model = resolve_model(component.get("footprint"))
        if not des or not model:
            continue
        dest = _cache_path(model, root)
        if os.path.isfile(dest) and os.path.getsize(dest) > 0:
            paths[des] = os.path.abspath(dest)
    return paths


if __name__ == "__main__":
    import json

    payload = json.load(sys.stdin) if not sys.stdin.isatty() else {"components": []}
    print(json.dumps(ensure_models(payload), indent=2))
