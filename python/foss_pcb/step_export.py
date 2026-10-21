"""STEP export through KiCad's own OpenCASCADE exporter.

Why KiCad instead of CadQuery/PythonOCC: KiCad is already an optional dependency
of this app, ships a verified STEP kernel, and needs no ~500 MB pip install.
The board is serialised to `.kicad_pcb`, exported by `kicad-cli pcb export step`,
and the resulting AP214 text is returned to the caller.

When no KiCad is found the module returns `{"error": ...}` — it never emits a
placeholder file. Set KICAD_CLI to an explicit binary if auto-detection fails.
"""
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile


def find_kicad_cli():
    """Locate kicad-cli on Windows/macOS. Explicit KICAD_CLI wins."""
    cands = []
    env = os.environ.get("KICAD_CLI")
    if env:
        cands.append(env)
    which = shutil.which("kicad-cli")
    if which:
        cands.append(which)

    if sys.platform == "darwin":
        patterns = [
            "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli",
            "/Applications/KiCad/*/KiCad.app/Contents/MacOS/kicad-cli",
        ]
        for pattern in patterns:
            cands.extend(glob.glob(pattern))
    else:
        roots = [
            os.environ.get("LOCALAPPDATA"),
            os.environ.get("ProgramFiles"),
            os.environ.get("ProgramFiles(x86)"),
        ]
        for root in roots:
            if not root:
                continue
            cands.extend(glob.glob(os.path.join(root, "Programs", "KiCad", "*", "bin", "kicad-cli.exe")))
            cands.extend(glob.glob(os.path.join(root, "KiCad", "*", "bin", "kicad-cli.exe")))

    # Newest version first: sort by the version component when present.
    cands = [c for c in dict.fromkeys(cands) if c and os.path.isfile(c)]
    cands.sort(reverse=True)
    return cands[0] if cands else None


def export_step(foss: dict) -> str:
    """Return JSON: {ok, backend, file, step} or {error}."""
    kicad = find_kicad_cli()
    if not kicad:
        return json.dumps({
            "error": "STEP export needs KiCad 8 or newer (kicad-cli). "
                     "Install KiCad or set KICAD_CLI to its kicad-cli binary."
        })

    try:
        from .kicad_compat import foss_to_kicad_pcb
    except ImportError:  # direct script execution
        from foss_pcb.kicad_compat import foss_to_kicad_pcb

    # Resolve official KiCad 3D bodies (downloaded once, then cached). Any
    # failure is reported and the export continues without that body.
    models = {"enabled": False, "paths": {}, "resolved": [], "missing": []}
    try:
        from .models3d import ensure_models
    except ImportError:
        from foss_pcb.models3d import ensure_models
    try:
        models = ensure_models(foss, enabled=os.environ.get("FOSS_3D", "1") != "0")
    except Exception as exc:  # never block the board on a model problem
        models["warning"] = f"3D models unavailable: {exc}"

    try:
        pcb_text = foss_to_kicad_pcb(foss, models.get("paths", {}))
    except Exception as exc:  # malformed board data
        return json.dumps({"error": f"Could not serialise the board for STEP: {exc}"})

    with tempfile.TemporaryDirectory(prefix="foss-step-") as tmp:
        src = os.path.join(tmp, "board.kicad_pcb")
        out = os.path.join(tmp, "board.step")
        with open(src, "w", encoding="utf-8") as fh:
            fh.write(pcb_text)
        try:
            proc = subprocess.run(
                [kicad, "pcb", "export", "step", "--force", "-o", out, src],
                capture_output=True, text=True, timeout=300,
            )
        except subprocess.TimeoutExpired:
            return json.dumps({"error": "KiCad STEP export timed out after 300 s."})
        except OSError as exc:
            return json.dumps({"error": f"Could not run kicad-cli: {exc}"})

        if proc.returncode != 0 or not os.path.isfile(out):
            detail = (proc.stderr or proc.stdout or "").strip()[-600:]
            return json.dumps({"error": f"KiCad STEP export failed (exit {proc.returncode}): {detail}"})

        with open(out, "r", encoding="utf-8", errors="replace") as fh:
            text = fh.read()

    if not text.startswith("ISO-10303-21"):
        return json.dumps({"error": "KiCad produced a file that is not STEP (missing ISO-10303-21 header)."})

    name = foss.get("project_metadata", {}).get("design_name", "board")
    safe = "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in str(name)) or "board"
    return json.dumps({
        "ok": True,
        "backend": "kicad-cli",
        "file": f"{safe}.step",
        "bytes": len(text),
        "step": text,
        "models": {
            "enabled": models.get("enabled", False),
            "used": len(models.get("paths", {})),
            "resolved": models.get("resolved", []),
            "missing": models.get("missing", []),
            "cache": models.get("cache"),
            "warning": models.get("warning"),
        },
    })


if __name__ == "__main__":
    payload = json.load(sys.stdin) if not sys.stdin.isatty() else {
        "project_metadata": {"design_name": "board"}, "components": [], "nets": []
    }
    print(export_step(payload))
