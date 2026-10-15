"""Parametric footprint 3D body sizes (mm). Python side mirrors lib/models-3d.ts."""
SIZES = {
    "0805": (2.0, 1.25, 0.9),
    "SOIC-8": (5.0, 4.0, 1.75),
    "SMA": (4.5, 2.5, 2.2),
    "6.3x7.7": (6.6, 6.6, 7.7),
    "SRR1280": (12.5, 12.5, 8.0),
    "MKDS": (10.0, 9.0, 12.0),
}


def body_size(footprint: str):
    for k, v in SIZES.items():
        if k in footprint:
            return v
    return (4.0, 4.0, 1.5)
