#!/usr/bin/env python3
"""Summarises a Firebase Test Lab results folder (scripts/testlab.sh downloads it).

For each phone: the self-test steps (pass/warn/fail + message), the feature
probes and measurements that fill docs/research/camera-features.md "Measured
results", and crashes / freezes of Lens found in the logcat.

Usage: scripts/testlab-summary.py <results dir>
"""
import json
import re
import sys
from pathlib import Path

PACKAGE = "com.akshay.lens"
MARK = {"pass": "✓", "warn": "!", "fail": "✗", "skip": "–"}


def phones(root: Path):
    """Each phone's folder (e.g. a14xm-34-en-portrait) with its self-test result, if any."""
    for d in sorted(p for p in root.iterdir() if p.is_dir()):
        result = None
        for f in d.rglob("*.json"):
            try:
                r = json.loads(f.read_text())
            except Exception:
                continue
            if isinstance(r, dict) and "steps" in r:
                result = r
                break
        yield d, result


def crashes(phone_dir: Path):
    """Lens crashes (FATAL EXCEPTION / native signal) and freezes (ANR) in the logcat."""
    found = []
    for log in phone_dir.rglob("logcat*"):
        if not log.is_file():
            continue
        lines = log.read_text(errors="replace").splitlines()
        for i, line in enumerate(lines):
            context = " ".join(lines[i : i + 3])
            if "FATAL EXCEPTION" in line and PACKAGE in context:
                found.append("crash: " + " | ".join(l.split(": ", 1)[-1] for l in lines[i + 1 : i + 4]))
            elif re.search(r"ANR in " + re.escape(PACKAGE), line):
                found.append("freeze (ANR): " + " | ".join(l.split(": ", 1)[-1] for l in lines[i : i + 3]))
            elif "Fatal signal" in line and PACKAGE in context:
                found.append("native crash: " + line.split(": ", 1)[-1])
    return found


def step(r, sid):
    return next((s for s in r["steps"] if s["id"] == sid), None)


def detail(r, sid, key):
    s = step(r, sid)
    return (s or {}).get("details", {}).get(key) if s else None


def probes(r):
    """One line per phone for the Measured results table."""
    device = r.get("device") or {}
    back = next((c for c in device.get("cameras", []) if c.get("facing") == "back"), {})
    f = back.get("features") or {}
    slow = f.get("slowMotion") or f.get("slowMotionCamera2")
    slow_txt = ", ".join(f"{k}" for k in slow) if isinstance(slow, dict) and slow else (str(slow) if slow else "no")
    fps60 = ", ".join(k for k, v in (f.get("fps60") or {}).items() if v) or "no"
    vwp = ", ".join(k for k, v in (f.get("videoWithPhoto") or {}).items() if v) or "no"
    video = (step(r, "video") or {}).get("details", {})
    burst = detail(r, "burst", "perSecond")
    encoders = device.get("videoEncoders")
    if isinstance(encoders, list):
        encoders = ", ".join(e.get("name", "?") if isinstance(e, dict) else str(e) for e in encoders[:4])
    return {
        "tier": device.get("tier"),
        "slow-mo": slow_txt,
        "60 fps": fps60,
        "video+photo": f"{vwp} (test: {video.get('videoPhoto')})",
        "burst/s": burst,
        "low-light boost": f.get("lowLightBoost"),
        "face priority": f.get("facePriority"),
        "preview stab.": f.get("previewStabilization"),
        "video stab.": f.get("videoStabilization"),
        "ZSL": f.get("zeroShutterLag"),
        "time-lapse profiles": f.get("timeLapseProfiles"),
        "extensions": back.get("extensions"),
        "max shutter s": (back.get("shutter") or {}).get("max") if isinstance(back.get("shutter"), dict) else back.get("shutter"),
        "encoders": encoders,
        "start delay ms": video.get("startDelayMs"),
        "preview fps": {s["id"]: s["details"]["previewFps"] for s in r["steps"] if s.get("details", {}).get("previewFps") is not None},
        "thermal": r.get("thermal"),
    }


def main():
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    any_result = False
    for d, r in phones(root):
        print(f"\n=== {d.name}")
        bad = crashes(d)
        for c in bad[:5]:
            print(f"  ✗ {c}")
        if not bad:
            print("  logcat: no Lens crash or freeze")
        if not r:
            print("  no self-test result file (see video.mp4 / logcat)")
            continue
        any_result = True
        build = (r.get("build") or {}).get("build")
        print(f"  build {build}: {r['passed']} passed, {r.get('warnings', 0)} warnings, {r['failed']} failed, {r['skipped']} skipped ({r['totalMs'] / 1000:.0f} s)")
        for s in r["steps"]:
            d2 = s.get("details") or {}
            size = f" {d2.get('saved')} of {d2.get('max')}" if d2.get("saved") else ""
            print(f"  {MARK[s['status']]} {s['label']}{size}{' — ' + s['message'] if s.get('message') else ''}")
        print("  probes:")
        for k, v in probes(r).items():
            print(f"    {k}: {v}")
    if not any_result:
        print("\nNo self-test result files found in", root)


if __name__ == "__main__":
    main()
