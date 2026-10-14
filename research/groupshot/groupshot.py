"""Best group photo, prototype (docs/design/switch-features.md §5).

From a burst: keep the best frame (base) and, for a person whose eyes are shut
or expression is worse there, take their face from the frame where it's best
(donor). Steps for one face:
  1. find the same face in both frames (5 landmarks: eyes, nose, mouth corners),
  2. align donor → base with a similarity transform from the landmarks,
  3. match colour/brightness in Lab using the skin around the face,
  4. blend inside a feathered ellipse with a Laplacian pyramid (no visible seam),
  5. refuse when the surroundings disagree (moved, occluded, turned head).

Test (no real bursts needed): take a group photo, paint one person's eyes shut
(the "blink" base), make a donor = the original shifted and 8 % brighter, swap,
and compare with the untouched original (PSNR in the face, seam error, ring NCC).

Run: research/.venv/bin/python -I research/groupshot/groupshot.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
YUNET = ROOT / 'research/faces/models/yunet.onnx'
OUT = Path(__file__).parent / 'out'


def detect(img: np.ndarray) -> list[np.ndarray]:
    """Faces as (5, 2) landmark arrays: right eye, left eye, nose, right mouth, left mouth (YuNet order)."""
    h, w = img.shape[:2]
    det = cv2.FaceDetectorYN.create(str(YUNET), '', (w, h), 0.85, 0.3, 5000)
    _, faces = det.detect(img)
    if faces is None:
        return []
    return [f[4:14].reshape(5, 2).astype(np.float64) for f in faces]


def match(base: list[np.ndarray], donor: list[np.ndarray], shift: np.ndarray) -> list[tuple[int, int]]:
    """Pairs (base i, donor j) of the same face: nearest eye-centre after the global shift, within half an eye distance."""
    pairs = []
    for i, b in enumerate(base):
        c = b[:2].mean(0)
        eye = np.linalg.norm(b[0] - b[1])
        best = min(range(len(donor)), key=lambda j: np.linalg.norm(donor[j][:2].mean(0) - shift - c), default=None)
        if best is not None and np.linalg.norm(donor[best][:2].mean(0) - shift - c) < eye / 2:
            pairs.append((i, best))
    return pairs


def global_shift(base: np.ndarray, donor: np.ndarray) -> np.ndarray:
    """Translation donor → base (phase correlation on grey, like NightMerge.align)."""
    a = cv2.cvtColor(base, cv2.COLOR_BGR2GRAY).astype(np.float32)
    b = cv2.cvtColor(donor, cv2.COLOR_BGR2GRAY).astype(np.float32)
    (dx, dy), _ = cv2.phaseCorrelate(a, b)
    return np.array([dx, dy])


def face_geometry(lm: np.ndarray):
    """Centre, axes and angle of the ellipse that covers forehead to chin."""
    eyes = lm[:2].mean(0)
    mouth = lm[3:5].mean(0)
    d = np.linalg.norm(lm[0] - lm[1])
    centre = eyes + (mouth - eyes) * 0.35
    angle = np.degrees(np.arctan2(lm[1][1] - lm[0][1], lm[1][0] - lm[0][0]))
    return centre, (1.05 * d, 1.45 * d), angle, d


def laplacian_blend(a: np.ndarray, b: np.ndarray, mask: np.ndarray, levels: int = 4) -> np.ndarray:
    """Mask 1 = take b. Float images, same size."""
    ga, gb, gm = [a], [b], [mask]
    for _ in range(levels):
        ga.append(cv2.pyrDown(ga[-1]))
        gb.append(cv2.pyrDown(gb[-1]))
        gm.append(cv2.pyrDown(gm[-1]))
    out = ga[-1] * (1 - gm[-1][..., None]) + gb[-1] * gm[-1][..., None]
    for i in range(levels - 1, -1, -1):
        size = (ga[i].shape[1], ga[i].shape[0])
        la = ga[i] - cv2.pyrUp(ga[i + 1], dstsize=size)
        lb = gb[i] - cv2.pyrUp(gb[i + 1], dstsize=size)
        out = cv2.pyrUp(out, dstsize=size) + la * (1 - gm[i][..., None]) + lb * gm[i][..., None]
    return out


def swap(base: np.ndarray, donor: np.ndarray, b_lm: np.ndarray, d_lm: np.ndarray, min_ncc: float = 0.6):
    """Base with donor's face (same person). Returns (image, report); image is None when refused.

    Landmarks only find and pair the faces and catch a turned head; the face area is
    aligned densely (ECC, rotation + translation) because landmarks are a few pixels
    noisy, and a few pixels is a visible seam. The eye band is left out of the
    alignment: it's exactly what differs between the frames.
    """
    centre, axes, angle, d = face_geometry(b_lm)
    r = int(2.2 * d)
    x0, y0 = max(0, int(centre[0] - r)), max(0, int(centre[1] - r))
    x1, y1 = min(base.shape[1], int(centre[0] + r)), min(base.shape[0], int(centre[1] + r))
    crop = base[y0:y1, x0:x1].astype(np.float32)
    h, w = crop.shape[:2]

    # Pose guard from landmarks: a turned or tilted head can't be swapped naturally.
    m_lm, _ = cv2.estimateAffinePartial2D(d_lm.astype(np.float32), b_lm.astype(np.float32), method=cv2.LMEDS)
    if m_lm is None:
        return None, {'refused': 'no transform'}
    scale = float(np.hypot(m_lm[0, 0], m_lm[1, 0]))
    rot = float(np.degrees(np.arctan2(m_lm[1, 0], m_lm[0, 0])))
    if not 0.85 < scale < 1.15 or abs(rot) > 12:
        return None, {'refused': f'head moved too much (scale {scale:.2f}, rotation {rot:.1f}°)'}

    # Dense alignment: the donor is first moved into the crop by the landmark translation
    # (same size as the crop), then ECC refines rotation + translation on top.
    t = (d_lm.mean(0) - b_lm.mean(0))
    init = np.float32([[1, 0, x0 + t[0]], [0, 1, y0 + t[1]]])
    pre = cv2.warpAffine(donor, init, (w, h), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REFLECT)
    tmpl = cv2.cvtColor(crop.astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32)
    src = cv2.cvtColor(pre, cv2.COLOR_BGR2GRAY).astype(np.float32)
    use = np.full((h, w), 255, np.uint8)
    eyes = (b_lm[:2] - [x0, y0]).astype(int)
    cv2.line(use, tuple(eyes[0]), tuple(eyes[1]), 0, max(4, int(d * 0.5)))
    if MODE == 'ecc':
        refine = np.eye(2, 3, dtype=np.float32)
        try:
            _, refine = cv2.findTransformECC(tmpl, src, refine, cv2.MOTION_EUCLIDEAN,
                                             (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 80, 1e-5), use, 5)
        except cv2.error as e:
            return None, {'refused': f'could not align the face ({str(e).splitlines()[-1][:120]})'}
    else:
        refine = search_align(tmpl, src, use > 0)
    # crop x → pre(refine·x) = donor(refine·x + init offset)
    warp = refine.copy()
    warp[:, 2] += init[:, 2]
    warped = cv2.warpAffine(donor, warp, (w, h), flags=cv2.INTER_CUBIC | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REFLECT).astype(np.float32)

    face = np.zeros((h, w), np.float32)
    cv2.ellipse(face, (int(centre[0] - x0), int(centre[1] - y0)), (int(axes[0]), int(axes[1])), angle, 0, 360, 1, -1)
    ring = np.zeros((h, w), np.float32)
    cv2.ellipse(ring, (int(centre[0] - x0), int(centre[1] - y0)), (int(axes[0] * 1.45), int(axes[1] * 1.3)), angle, 0, 360, 1, -1)
    ring = (ring > 0) & (face == 0)

    # Guard: around the face, the two frames must show the same thing (no hand, hair or head turn in between).
    g1 = cv2.cvtColor(crop.astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32)[ring]
    g2 = cv2.cvtColor(warped.astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32)[ring]
    ncc = float(np.corrcoef(g1, g2)[0, 1]) if g1.std() > 1 and g2.std() > 1 else 1.0
    if ncc < min_ncc:
        return None, {'refused': f'surroundings differ (ncc {ncc:.2f})', 'ncc': ncc}

    # Colour/brightness: match the donor's Lab statistics to the base on the ring (light changes between frames).
    lab_b = cv2.cvtColor(crop.astype(np.uint8), cv2.COLOR_BGR2LAB).astype(np.float32)
    lab_d = cv2.cvtColor(warped.astype(np.uint8), cv2.COLOR_BGR2LAB).astype(np.float32)
    for c in range(3):
        mb, sb = lab_b[..., c][ring].mean(), lab_b[..., c][ring].std() + 1e-3
        md, sd = lab_d[..., c][ring].mean(), lab_d[..., c][ring].std() + 1e-3
        lab_d[..., c] = (lab_d[..., c] - md) * (sb / sd) ** 0.5 + mb  # half-strength contrast match: stable
    warped = cv2.cvtColor(np.clip(lab_d, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR).astype(np.float32)

    # Feathered mask (soft edge ~ a quarter of the eye distance), then multi-band blend.
    soft = cv2.GaussianBlur(face, (0, 0), d / 4)
    blended = laplacian_blend(crop, warped, soft)
    out = base.copy()
    out[y0:y1, x0:x1] = np.clip(blended, 0, 255).astype(np.uint8)
    return out, {'ncc': ncc, 'scale': scale, 'rotation': rot, 'box': (x0, y0, x1, y1)}


MODE = 'search'  # 'ecc' (OpenCV) or 'search' (what the phone does: GroupShot.kt)


def search_align(tmpl: np.ndarray, src: np.ndarray, use: np.ndarray) -> np.ndarray:
    """Rotation (−3…3°, 0.5° steps) × translation (±8 px) minimising mean |difference| on `use`,
    at half size, then a ±1 px refinement at full size with a parabolic sub-pixel fit. Plain loops
    over small arrays: easy to port, fast enough on a face crop."""
    h, w = tmpl.shape
    c = (w / 2, h / 2)
    def cost(img_t, img_s, mask, angle, dx, dy):
        m = cv2.getRotationMatrix2D(c if img_t.shape == tmpl.shape else (img_t.shape[1] / 2, img_t.shape[0] / 2), angle, 1.0)
        m[:, 2] += (dx, dy)
        moved = cv2.warpAffine(img_s, m, (img_t.shape[1], img_t.shape[0]), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REFLECT)
        return float(np.abs(moved - img_t)[mask].mean())
    ht, hs = cv2.resize(tmpl, (w // 2, h // 2)), cv2.resize(src, (w // 2, h // 2))
    hm = cv2.resize(use.astype(np.uint8), (w // 2, h // 2), interpolation=cv2.INTER_NEAREST) > 0
    best = (1e9, 0.0, 0, 0)
    for a in np.arange(-3, 3.01, 0.5):
        for dy in range(-4, 5):
            for dx in range(-4, 5):
                v = cost(ht, hs, hm, a, dx, dy)
                if v < best[0]:
                    best = (v, a, dx, dy)
    _, a, dx, dy = best
    dx, dy = dx * 2.0, dy * 2.0
    def axis(get):
        vals = [get(k) for k in (-1, 0, 1)]
        den = vals[0] - 2 * vals[1] + vals[2]
        return 0.0 if den <= 0 else 0.5 * (vals[0] - vals[2]) / den
    for _ in range(2):
        cx = min(range(-1, 2), key=lambda k: cost(tmpl, src, use, a, dx + k, dy)); dx += cx
        cy = min(range(-1, 2), key=lambda k: cost(tmpl, src, use, a, dx, dy + k)); dy += cy
    dx += axis(lambda k: cost(tmpl, src, use, a, dx + k, dy))
    dy += axis(lambda k: cost(tmpl, src, use, a, dx, dy + k))
    m = cv2.getRotationMatrix2D(c, a, 1.0)
    m[:, 2] += (dx, dy)
    return m.astype(np.float32)


def psnr(a: np.ndarray, b: np.ndarray) -> float:
    mse = float(np.mean((a.astype(np.float64) - b.astype(np.float64)) ** 2))
    return 99.0 if mse == 0 else 10 * np.log10(255 ** 2 / mse)


def blink(img: np.ndarray, lm: np.ndarray) -> np.ndarray:
    """Paint the eyes shut: skin-coloured lids over both eyes (from the cheek just below)."""
    out = img.copy()
    d = np.linalg.norm(lm[0] - lm[1])
    for eye in lm[:2]:
        x, y = int(eye[0]), int(eye[1])
        rx, ry = int(d * 0.28), int(d * 0.14)
        skin = img[min(img.shape[0] - 1, y + int(d * 0.45)), x].tolist()
        cv2.ellipse(out, (x, y), (rx, ry), 0, 0, 360, skin, -1)
        cv2.line(out, (x - rx, y), (x + rx, y), (40, 30, 30), max(1, int(d * 0.03)))
    return out


def main():
    OUT.mkdir(exist_ok=True)
    original = cv2.imread(str(ROOT / 'site/public/people/test/family-2011.jpg'))
    faces = detect(original)
    print(f'faces: {len(faces)}')
    target = max(range(len(faces)), key=lambda i: np.linalg.norm(faces[i][0] - faces[i][1]))
    base = blink(original, faces[target])
    # Donor: the same moment a little later: hand moved the phone 11 px right, 6 px down, turned 1°, light 8 % brighter.
    m = cv2.getRotationMatrix2D((original.shape[1] / 2, original.shape[0] / 2), 1.0, 1.0)  # a 1° wobble
    m[:, 2] += (11, 6)
    donor = np.clip(cv2.warpAffine(original, m, (original.shape[1], original.shape[0]), borderMode=cv2.BORDER_REFLECT).astype(np.float32) * 1.08, 0, 255).astype(np.uint8)

    shift = global_shift(base, donor)
    b_faces, d_faces = detect(base), detect(donor)
    pairs = dict(match(b_faces, d_faces, shift))
    # The painted eyes can move YuNet's eye landmarks: use the base's original landmarks (the phone uses the frame where eyes were open).
    i_base = min(range(len(b_faces)), key=lambda i: np.linalg.norm(b_faces[i][2] - faces[target][2]))
    if i_base not in pairs:
        print('FAIL: face not matched between frames'); sys.exit(1)
    result, report = swap(base, donor, faces[target], d_faces[pairs[i_base]])
    if result is None:
        print('FAIL: refused', report); sys.exit(1)
    x0, y0, x1, y1 = report['box']
    before = psnr(base[y0:y1, x0:x1], original[y0:y1, x0:x1])
    after = psnr(result[y0:y1, x0:x1], original[y0:y1, x0:x1])
    # Seam: the edge band of the swapped region vs the original (a visible seam shows up here).
    ring = np.zeros(original.shape[:2], np.uint8)
    c, ax, ang, _ = face_geometry(faces[target])
    cv2.ellipse(ring, (int(c[0]), int(c[1])), (int(ax[0]), int(ax[1])), ang, 0, 360, 255, max(2, int(ax[0] * 0.2)))
    seam = float(np.abs(result.astype(np.float32) - original.astype(np.float32))[ring > 0].mean())
    print(f'shift found {shift.round(1)} · ncc {report["ncc"]:.3f} · scale {report["scale"]:.3f} · rot {report["rotation"]:.2f}°')
    print(f'face PSNR vs original: blink {before:.1f} dB → fixed {after:.1f} dB · seam error {seam:.2f}/255')

    # Guard check: a donor where something covers the face's surroundings must be refused.
    blocked = donor.copy()
    bx, by = int(d_faces[pairs[i_base]][2][0]), int(d_faces[pairs[i_base]][2][1])
    cv2.rectangle(blocked, (bx - 200, by - 160), (bx + 200, by + 220), (30, 140, 30), -1)
    refused, why = swap(base, blocked, faces[target], d_faces[pairs[i_base]])
    print(f'occluded donor: {"refused (" + why["refused"] + ")" if refused is None else "NOT refused"}')

    cv2.imwrite(str(OUT / 'base-blink.jpg'), base)
    cv2.imwrite(str(OUT / 'fixed.jpg'), result)
    ok = after > 30 and after - before > 6 and seam < 8 and refused is None
    print('PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
