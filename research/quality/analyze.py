#!/usr/bin/env python3
"""Quality Lab analysis (docs/research/camera-quality.md).

Downloads Quality Lab sets, builds every candidate pipeline from the same raw
ingredients, measures them on identical regions and writes an HTML report with
a blind mode.

    research/.venv/bin/python research/quality/analyze.py sync      # S3 → data/sets
    research/.venv/bin/python research/quality/analyze.py report     # all sets → out/
    research/.venv/bin/python research/quality/analyze.py report <setId>

Candidates
  as captured: single, single-uhdr, ext-*, lens-night8, reference
  burst-q8 / burst-l8:  <step>/frame0 (one frame of that capture mode),
                        <step>/mean   (global align + average, like NightMerge),
                        <step>/robust (tile align + noise-aware merge, HDR+-lite)
  raw-6:                raw-6/single (one DNG, neutral develop),
                        raw-6/merge  (linear-domain align + average, same develop)

Metrics (all candidates registered onto `single`, compared on the same blocks)
  noise    high-pass std in the flattest 5 % of blocks (lower = cleaner)
  detail   Laplacian energy in the 10 % most textured blocks (higher = more detail;
           read together with noise, since noise also raises it)
  mean / clip_hi / clip_lo   exposure; ms; thermal before → after
"""
from __future__ import annotations

import html
import json
import os
import random
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data' / 'sets'
OUT = ROOT / 'out'
BUCKET = os.environ.get('LENS_MEDIA_BUCKET', 'lens-media-495026846839')
PROFILE = os.environ.get('AWS_PROFILE', 'lens')
WORK_WIDTH = 2000  # every candidate is compared at this width
BLOCK = 32


# ---------- Loading ----------

def load_rgb(path: Path) -> np.ndarray:
    """float32 RGB 0..1, upright (EXIF orientation applied)."""
    if path.suffix.lower() == '.dng':
        return develop_raw([path])
    img = cv2.imread(str(path), cv2.IMREAD_COLOR | cv2.IMREAD_ANYDEPTH)
    if img is None:
        raise ValueError(f'cannot read {path}')
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    return img.astype(np.float32) / (65535.0 if img.dtype == np.uint16 else 255.0)


def to_work(img: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    if w == WORK_WIDTH:
        return img
    return cv2.resize(img, (WORK_WIDTH, round(h * WORK_WIDTH / w)), interpolation=cv2.INTER_AREA)


def luma(img: np.ndarray) -> np.ndarray:
    return img[..., 0] * 0.2126 + img[..., 1] * 0.7152 + img[..., 2] * 0.0722


# ---------- Alignment ----------

def global_shift(ref_l: np.ndarray, l: np.ndarray) -> tuple[float, float]:
    win = cv2.createHanningWindow(ref_l.shape[::-1], cv2.CV_32F)
    (dx, dy), _ = cv2.phaseCorrelate(ref_l.astype(np.float32), l.astype(np.float32), win)
    return dx, dy


def estimate_warp(ref: np.ndarray, img: np.ndarray) -> np.ndarray:
    """Affine warp (ECC on small luma; phase-correlation shift as fallback)."""
    s = 0.25
    a = cv2.resize(luma(ref), None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    b = cv2.resize(luma(img), None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    warp = np.eye(2, 3, dtype=np.float32)
    try:
        _, warp = cv2.findTransformECC(a, b, warp, cv2.MOTION_AFFINE, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 100, 1e-5), None, 5)
    except cv2.error:
        dx, dy = global_shift(a, b)
        warp[0, 2], warp[1, 2] = dx, dy
    warp[:, 2] /= s
    return warp


def register(ref: np.ndarray, img: np.ndarray) -> np.ndarray:
    """Warps img onto ref (used for merging; resampling smooths noise, so metrics don't use it)."""
    if img.shape[:2] != ref.shape[:2]:
        img = cv2.resize(img, (ref.shape[1], ref.shape[0]), interpolation=cv2.INTER_AREA)
    warp = estimate_warp(ref, img)
    return cv2.warpAffine(img, warp, (ref.shape[1], ref.shape[0]), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REFLECT)


# ---------- Merges ----------

def merge_mean(frames: list[np.ndarray]) -> np.ndarray:
    """Sharpest frame as reference, others globally aligned, averaged; pixels that
    differ a lot from the reference (motion) are skipped (no ghosts)."""
    ref_i = max(range(len(frames)), key=lambda i: cv2.Laplacian(luma(frames[i]), cv2.CV_32F).var())
    ref = frames[ref_i]
    acc = ref.copy()
    cnt = np.ones(ref.shape[:2], np.float32)
    for i, f in enumerate(frames):
        if i == ref_i:
            continue
        a = register(ref, f)
        ok = (np.abs(luma(a) - luma(ref)) < 0.08).astype(np.float32)
        acc += a * ok[..., None]
        cnt += ok
    return acc / cnt[..., None]


def merge_robust(frames: list[np.ndarray], tile: int = 32) -> np.ndarray:
    """HDR+-lite on processed frames: global registration, then per-tile residual
    shift, then a per-tile weight that falls off when a tile differs from the
    reference by more than the estimated noise (motion or misalignment)."""
    ref_i = max(range(len(frames)), key=lambda i: cv2.Laplacian(luma(frames[i]), cv2.CV_32F).var())
    ref = frames[ref_i]
    h, w = ref.shape[:2]
    ref_l = luma(ref)
    sigma = noise_sigma(ref_l)
    acc = ref.copy()
    wsum = np.ones((h, w), np.float32)
    for i, f in enumerate(frames):
        if i == ref_i:
            continue
        a = register(ref, f)
        a_l = luma(a)
        weights = np.zeros((h, w), np.float32)
        aligned = a.copy()
        for y in range(0, h - tile + 1, tile):
            for x in range(0, w - tile + 1, tile):
                rt = ref_l[y:y + tile, x:x + tile]
                at = a_l[y:y + tile, x:x + tile]
                dx, dy = global_shift(rt, at)
                if abs(dx) > 2 or abs(dy) > 2:
                    dx, dy = 0.0, 0.0
                if dx or dy:
                    m = np.float32([[1, 0, dx], [0, 1, dy]])
                    aligned[y:y + tile, x:x + tile] = cv2.warpAffine(a[y:y + tile, x:x + tile], m, (tile, tile), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REFLECT)
                d = float(np.mean((luma(aligned[y:y + tile, x:x + tile]) - rt) ** 2))
                weights[y:y + tile, x:x + tile] = 1.0 / (1.0 + d / (4 * sigma * sigma + 1e-8))
        weights = cv2.GaussianBlur(weights, (0, 0), tile / 4)
        acc += aligned * weights[..., None]
        wsum += weights
    return acc / wsum[..., None]


# ---------- RAW ----------

def raw_linear(path: Path):
    import rawpy

    with rawpy.imread(str(path)) as raw:
        rgb = raw.postprocess(gamma=(1, 1), no_auto_bright=True, output_bps=16, use_camera_wb=True, user_flip=None)
    return rgb.astype(np.float32) / 65535.0


def develop_raw(paths: list[Path]) -> np.ndarray:
    """Average aligned linear frames, then one neutral develop: exposure to a
    mid-grey target, filmic-ish tone curve, sRGB gamma."""
    frames = [raw_linear(p) for p in paths]
    lin = frames[0] if len(frames) == 1 else merge_mean(frames)
    g = np.percentile(luma(lin), 50)
    lin = lin * (0.18 / max(g, 1e-4))
    tone = lin / (1 + lin)  # Reinhard
    tone = tone / max(np.percentile(tone, 99.9), 1e-4)
    srgb = np.where(tone <= 0.0031308, 12.92 * tone, 1.055 * np.power(np.clip(tone, 0, None), 1 / 2.4) - 0.055)
    return np.clip(srgb, 0, 1).astype(np.float32)


# ---------- Metrics ----------

def noise_sigma(l: np.ndarray) -> float:
    hp = l - cv2.GaussianBlur(l, (0, 0), 1.5)
    return float(np.median(np.abs(hp)) / 0.6745)


def blocks(ref_l: np.ndarray):
    """Flattest 5 % and most textured 10 % blocks of the reference."""
    h, w = ref_l.shape
    gx = cv2.Sobel(ref_l, cv2.CV_32F, 1, 0)
    gy = cv2.Sobel(ref_l, cv2.CV_32F, 0, 1)
    g = np.sqrt(gx * gx + gy * gy)
    cells = []
    for y in range(BLOCK, h - 2 * BLOCK, BLOCK):
        for x in range(BLOCK, w - 2 * BLOCK, BLOCK):
            m = float(ref_l[y:y + BLOCK, x:x + BLOCK].mean())
            if 0.08 < m < 0.92:  # skip crushed/clipped areas
                cells.append((float(g[y:y + BLOCK, x:x + BLOCK].mean()), y, x))
    cells.sort()
    n = len(cells)
    flat = [(y, x) for _, y, x in cells[: max(1, n // 20)]]
    textured = [(y, x) for _, y, x in cells[-max(1, n // 10):]]
    return flat, textured


def measure(img: np.ndarray, flat, textured, offset=(0, 0)) -> dict:
    """Measured in the image's own pixels (no resampling): blocks chosen on the
    reference are looked up at a whole-pixel offset.

    noise:  high-pass std in flat blocks.
    detail: mid-frequency band energy in textured blocks minus the same band's
            energy in flat blocks (which is noise), so noise doesn't count as detail.
    """
    l = luma(img)
    h, w = l.shape
    dx, dy = offset
    hp = l - cv2.GaussianBlur(l, (0, 0), 1.5)
    bp = cv2.GaussianBlur(l, (0, 0), 1.0) - cv2.GaussianBlur(l, (0, 0), 3.0)

    def cut(a, y, x):
        y, x = min(max(0, y + dy), h - BLOCK), min(max(0, x + dx), w - BLOCK)
        return a[y:y + BLOCK, x:x + BLOCK]

    noise = float(np.mean([cut(hp, y, x).std() for y, x in flat]))
    band_noise = float(np.mean([cut(bp, y, x).var() for y, x in flat]))
    band_texture = float(np.mean([cut(bp, y, x).var() for y, x in textured]))
    detail = max(0.0, band_texture - band_noise)
    return {
        'noise': noise * 1000,
        'detail': detail * 10000,
        'mean': float(l.mean()),
        'clip_hi': float((img.max(axis=2) >= 0.995).mean() * 100),
        'clip_lo': float((img.max(axis=2) <= 0.005).mean() * 100),
    }


# ---------- Report ----------

def crop_png(img: np.ndarray, y: int, x: int, size: int, path: Path):
    c = img[max(0, y - size // 2): y + size // 2, max(0, x - size // 2): x + size // 2]
    c = cv2.resize(c, (size * 2, size * 2), interpolation=cv2.INTER_NEAREST)
    cv2.imwrite(str(path), cv2.cvtColor((np.clip(c, 0, 1) * 255).astype(np.uint8), cv2.COLOR_RGB2BGR))


def candidates(set_dir: Path, meta: dict):
    """(name, step meta, loader) for every candidate in the set."""
    out = []
    for step in meta.get('steps', []):
        if step.get('error') or not step.get('files'):
            continue
        sid = step['id']
        paths = [set_dir / f['name'] for f in step['files']]
        if not all(p.exists() for p in paths):
            continue
        if sid.startswith('burst-'):
            out.append((f'{sid}/frame0', step, lambda p=paths: load_rgb(p[0])))
            out.append((f'{sid}/mean', step, lambda p=paths: merge_mean([to_work(load_rgb(q)) for q in p])))
            out.append((f'{sid}/robust', step, lambda p=paths: merge_robust([to_work(load_rgb(q)) for q in p])))
        elif sid.startswith('raw-'):
            out.append((f'{sid}/single', step, lambda p=paths: develop_raw(p[:1])))
            out.append((f'{sid}/merge', step, lambda p=paths: develop_raw(p)))
        else:
            out.append((sid, step, lambda p=paths: load_rgb(p[0])))
    return out


def report(set_id: str):
    set_dir = DATA / set_id
    meta = json.loads((set_dir / 'meta.json').read_text())
    cands = candidates(set_dir, meta)
    ref_c = next((c for c in cands if c[0] == 'single'), cands[0])
    ref = to_work(ref_c[2]())
    flat, textured = blocks(luma(ref))
    out = OUT / set_id
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    # Crops: flattest block, most textured block, darkest mid-tone block.
    spots = {'flat': flat[len(flat) // 2], 'detail': textured[-1]}
    for name, step, load in cands:
        try:
            img = ref if name == ref_c[0] else to_work(load())
            if img.shape[:2] != ref.shape[:2]:
                img = cv2.resize(img, (ref.shape[1], ref.shape[0]), interpolation=cv2.INTER_AREA)
            warp = np.eye(2, 3, dtype=np.float32) if img is ref else estimate_warp(ref, img)
        except Exception as e:  # noqa: BLE001 — report and keep going
            print(f'  {name}: failed ({e})')
            continue
        # Inverse-map convention: ref pixel p is at img pixel p + translation.
        offset = (round(float(warp[0, 2])), round(float(warp[1, 2])))
        m = measure(img, flat, textured, offset)
        m['offset'] = offset
        m.update(name=name, ms=step.get('durationMs'), thermal=f"{step.get('thermalBefore')}→{step.get('thermalAfter')}")
        slug = name.replace('/', '_')
        for spot, (y, x) in spots.items():
            crop_png(img, y + offset[1] + BLOCK // 2, x + offset[0] + BLOCK // 2, 160, out / f'{slug}_{spot}.png')
        rows.append(m)
        print(f"  {name:22s} noise {m['noise']:6.2f}  detail {m['detail']:7.2f}  mean {m['mean']:.3f}  clip {m['clip_hi']:.2f}%")
    write_html(out, set_id, meta, rows)


def write_html(out: Path, set_id: str, meta: dict, rows: list[dict]):
    dev = meta.get('device', {}).get('device', {})
    order = list(range(len(rows)))
    random.Random(set_id).shuffle(order)
    letters = {i: chr(65 + k) for k, i in enumerate(order)}
    table = ''.join(
        f"<tr><td><span class=name>{html.escape(r['name'])}</span><span class=blind>{letters[i]}</span></td>"
        f"<td>{r['noise']:.2f}</td><td>{r['detail']:.2f}</td><td>{r['mean']:.3f}</td><td>{r['clip_hi']:.2f}%</td>"
        f"<td>{(r['ms'] or 0) / 1000:.1f}s</td><td>{html.escape(r['thermal'])}</td></tr>"
        for i, r in enumerate(rows)
    )
    tiles = ''.join(
        f"<figure style='order:{order.index(i)}'><figcaption><span class=name>{html.escape(r['name'])}</span><span class=blind>{letters[i]}</span></figcaption>"
        f"<img src='{r['name'].replace('/', '_')}_detail.png'><img src='{r['name'].replace('/', '_')}_flat.png'></figure>"
        for i, r in enumerate(rows)
    )
    page = f"""<!doctype html><meta charset=utf-8><title>Lab {html.escape(set_id)}</title>
<style>body{{font:14px system-ui;background:#111;color:#eee;margin:16px}}table{{border-collapse:collapse}}td,th{{padding:4px 10px;border-bottom:1px solid #333;text-align:right}}td:first-child{{text-align:left}}
.grid{{display:flex;flex-wrap:wrap;gap:12px}}figure{{margin:0}}img{{display:block;width:320px;image-rendering:pixelated;margin-top:4px}}
body.blindmode .name{{display:none}}body:not(.blindmode) .blind{{display:none}}button{{margin:8px 0;padding:6px 12px}}</style>
<h2>{html.escape(dev.get('manufacturer', ''))} {html.escape(dev.get('model', ''))} · {html.escape(meta.get('scene', ''))}</h2>
<p>{html.escape(meta.get('note', ''))} · set {html.escape(set_id)}</p>
<button onclick="document.body.classList.toggle('blindmode')">Toggle blind mode</button>
<table><tr><th>pipeline</th><th>noise ↓</th><th>detail ↑</th><th>mean</th><th>clipped</th><th>time</th><th>thermal</th></tr>{table}</table>
<p>Crops (2× zoom): most textured area, then flattest area. In blind mode names are hidden and the order is shuffled.</p>
<div class=grid>{tiles}</div>"""
    (out / 'report.html').write_text(page)
    print(f'  → {out / "report.html"}')


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'report'
    if cmd == 'sync':
        DATA.mkdir(parents=True, exist_ok=True)
        subprocess.run(['aws', 's3', 'sync', f's3://{BUCKET}/lab/sets', str(DATA), '--profile', PROFILE], check=True)
        return
    if cmd == 'report':
        ids = sys.argv[2:] or sorted(p.name for p in DATA.iterdir() if (p / 'meta.json').exists())
        for set_id in ids:
            print(set_id)
            report(set_id)
        return
    sys.exit(__doc__)


if __name__ == '__main__':
    main()
