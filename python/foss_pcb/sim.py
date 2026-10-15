"""Power-stage checks (mirrors lib/sim/power.ts) so plugins can reuse them."""


def buck_boost(vin: float, vout_abs: float, iout: float, freq_hz: float, l_uh: float):
    d = vout_abs / (vin + vout_abs)
    t = 1.0 / freq_hz
    l = l_uh * 1e-6
    di = vin * d * t / l
    ipk = iout / (1 - d) + di / 2
    return {"D": d, "rippleA": di, "peakA": ipk}
