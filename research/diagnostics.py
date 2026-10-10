#!/usr/bin/env python3
"""Summarise anonymous camera diagnostics (docs/features/diagnostics.md).

    research/.venv/bin/python research/diagnostics.py            # sync last 14 days + summary
    research/.venv/bin/python research/diagnostics.py --days 60

Per phone model: camera starts, photo size vs the largest the camera offers
(the S8 1.5 MP bug shows up as a low ratio), preview path (cameraTransform),
hardware level, fallbacks (bind attempts > 0, OpenGL, basic camera) and errors.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'quality' / 'data' / 'diag'
BUCKET = os.environ.get('LENS_MEDIA_BUCKET', 'lens-media-495026846839')
PROFILE = os.environ.get('AWS_PROFILE', 'lens')


def area(size: str | None) -> int:
    try:
        w, h = (int(v) for v in (size or '').split('x'))
        return w * h
    except ValueError:
        return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--days', type=int, default=14)
    ap.add_argument('--no-sync', action='store_true')
    args = ap.parse_args()
    days = [(dt.date.today() - dt.timedelta(days=i)).isoformat() for i in range(args.days)]
    if not args.no_sync:
        for day in days:
            subprocess.run(['aws', 's3', 'sync', f's3://{BUCKET}/diag/{day}', str(DATA / day), '--profile', PROFILE, '--only-show-errors'], check=True)

    models: dict[str, dict] = defaultdict(lambda: defaultdict(list))
    for day in days:
        for f in (DATA / day).glob('*/*.json'):
            r = json.loads(f.read_text())
            dev = r.get('device', {})
            name = f"{dev.get('manufacturer')} {dev.get('model')} (Android {dev.get('android')})"
            build = (r.get('build') or {}).get('code') or 'local'
            for e in r.get('events', []):
                models[name][e['kind']].append({**e.get('details', {}), 'build': build})

    if not models:
        print('No diagnostics yet.')
        return
    for name in sorted(models):
        k = models[name]
        print(f'\n{name}')
        for c in k.get('camera', []):
            ratio = area(c.get('photoSize')) / max(1, area(c.get('maxPhotoSize')))
            flag = '  ⚠ photo smaller than the camera offers' if c.get('photoSize') and ratio < 0.9 else ''
            print(f"  camera  dev-{c['build']} {c.get('position')}/{c.get('lens')}/{c.get('mode')}: photo {c.get('photoSize')} of {c.get('maxPhotoSize')}"
                  f" ({ratio:.0%}), preview {c.get('previewSize')}, {c.get('level')}, attempt {c.get('bindAttempt')}{flag}")
        for p in k.get('preview', []):
            print(f"  preview dev-{p['build']} {p.get('position')}: cameraTransform={p.get('cameraTransform')} mirroring={p.get('mirroring')} buffer {p.get('buffer')}")
        for kind in ('glFallback', 'fallbackBasic', 'cameraError'):
            for e in k.get(kind, []):
                print(f"  {kind} dev-{e['build']}: {e.get('message')}")
        for t in k.get('selftest', []):
            print(f"  selftest dev-{t['build']}: {t.get('passed')} passed, {t.get('failed')} failed, {t.get('skipped')} skipped")
            for st in t.get('steps', []):
                if st.get('status') != 'pass':
                    print(f"    {st.get('status')} {st.get('label')}: {st.get('message')}")
        for b in k.get('basicPhoto', []):
            print(f"  basicPhoto dev-{b['build']}: {b.get('size')}")


if __name__ == '__main__':
    main()
