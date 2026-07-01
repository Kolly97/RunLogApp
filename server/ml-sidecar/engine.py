#!/usr/bin/env python3
"""RunLog ML-Sidecar. Liest einen Job (JSON) von stdin, liefert ein Ergebnis (JSON) auf stdout.

Protokoll:
  stdin  = {"kind": str, "payload": {...}}
  stdout = {"ok": bool, "kind": str, "result"|"error": ..., "meta": {...}}
  exit   = 0 bei Erfolg, 1 bei Fehler

Der Kern ist stdlib-only (Harness-Beweis: health/echo/ols laufen ohne Fremd-Pakete).
Schwere Libs (numpy / lightgbm / numpyro) sind OPTIONAL und erst für die echten Modelle (L2/L3/L6)
nötig — siehe requirements.txt. So bleibt der Sidecar auch ohne installierte Runtime testbar.
"""
import sys
import json
import platform


def _meta():
    meta = {"engine": "python", "python": platform.python_version(), "numpy": None}
    try:
        import numpy  # noqa: F401
        meta["numpy"] = numpy.__version__
    except Exception:
        pass
    return meta


def job_health(_payload):
    return {"status": "ok"}


def job_echo(payload):
    return {"echo": payload}


def job_ols(payload):
    """Einfache OLS-Geradenanpassung y ~ a + b*x (pure Python) — beweist den numerischen Datenpfad."""
    xs = payload.get("x", [])
    ys = payload.get("y", [])
    n = len(xs)
    if n < 2 or n != len(ys):
        raise ValueError("x und y brauchen gleiche Länge >= 2")
    mx = sum(xs) / n
    my = sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    if sxx == 0:
        raise ValueError("x ohne Varianz")
    b = sxy / sxx
    a = my - b * mx
    ss_tot = sum((y - my) ** 2 for y in ys)
    ss_res = sum((y - (a + b * x)) ** 2 for x, y in zip(xs, ys))
    r2 = (1 - ss_res / ss_tot) if ss_tot > 0 else None
    return {"intercept": a, "slope": b, "r2": r2, "n": n}


HANDLERS = {"health": job_health, "echo": job_echo, "ols": job_ols}


def main():
    kind = None
    try:
        raw = sys.stdin.read()
        job = json.loads(raw) if raw.strip() else {}
        kind = job.get("kind", "health")
        handler = HANDLERS.get(kind)
        if handler is None:
            raise ValueError("unbekannter job kind: %s" % kind)
        result = handler(job.get("payload", {}))
        out = {"ok": True, "kind": kind, "result": result, "meta": _meta()}
    except Exception as e:  # noqa: BLE001
        out = {"ok": False, "kind": kind, "error": str(e), "meta": _meta()}
    sys.stdout.write(json.dumps(out))
    sys.stdout.flush()
    sys.exit(0 if out["ok"] else 1)


if __name__ == "__main__":
    main()
