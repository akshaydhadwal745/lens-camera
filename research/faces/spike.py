"""People spike (docs/design/people.md, build step 1).

1. Our 5-point alignment (the maths the phone will run on ML Kit landmarks)
   against OpenCV's reference FaceRecognizerSF.alignCrop.
2. SFace same-person / different-person cosine on LFW pairs, to choose:
   - MATCH: "probably the same person" (suggest / show together),
   - MERGE: strict threshold for automatic grouping (false-merge rate <= 0.1 %).

YuNet stands in for ML Kit here (both give eyes, nose, mouth corners).
Run: nice -n 19 research/.venv/bin/python research/faces/spike.py [pairs_limit]
"""
import sys, time
from pathlib import Path

import os

import cv2
import numpy as np

cv2.setNumThreads(2)  # keep the PC responsive
D = Path(__file__).parent
det = cv2.FaceDetectorYN.create(str(D / 'models/yunet.onnx'), '', (250, 250), 0.6)
rec = cv2.FaceRecognizerSF.create(str(D / 'models/sface.onnx'), '')

# SFACE_TFLITE=<model.tflite>: embed with that LiteRT model instead (what the phone runs).
if os.environ.get('SFACE_TFLITE'):
    from ai_edge_litert.interpreter import Interpreter
    _it = Interpreter(model_path=os.environ['SFACE_TFLITE'])
    _it.allocate_tensors()
    _in, _out = _it.get_input_details()[0], _it.get_output_details()[0]

    def embed(crop):
        _it.set_tensor(_in['index'], cv2.cvtColor(crop, cv2.COLOR_BGR2RGB).astype(np.float32)[None])
        _it.invoke()
        return _it.get_tensor(_out['index']).flatten()
else:
    def embed(crop):
        return rec.feature(crop).flatten()

# ArcFace/SFace 112x112 template: right eye, left eye, nose, right mouth, left mouth (image coords).
REF = np.array([[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366],
                [41.5493, 92.3655], [70.7299, 92.2041]], dtype=np.float64)


def similarity(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    """Umeyama least-squares similarity transform (rotation + uniform scale + shift), 2x3."""
    n = src.shape[0]
    mu_s, mu_d = src.mean(0), dst.mean(0)
    s, d = src - mu_s, dst - mu_d
    cov = d.T @ s / n
    U, S, Vt = np.linalg.svd(cov)
    E = np.eye(2)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0:
        E[1, 1] = -1
    R = U @ E @ Vt
    scale = np.trace(np.diag(S) @ E) / (s ** 2).sum(1).mean()
    t = mu_d - scale * R @ mu_s
    return np.hstack([scale * R, t[:, None]])


# ALIGN_POINTS=4: eyes + mouth corners only (the phone's ML Kit nose point is the
# nose base, not the template's nose tip). Default 5 = OpenCV's reference.
USE = [0, 1, 3, 4] if os.environ.get('ALIGN_POINTS') == '4' else [0, 1, 2, 3, 4]


def ours(img, face):
    pts = face[4:14].reshape(5, 2).astype(np.float64)
    return cv2.warpAffine(img, similarity(pts[USE], REF[USE]), (112, 112), flags=cv2.INTER_LINEAR)


def biggest_face(img):
    h, w = img.shape[:2]
    det.setInputSize((w, h))
    _, faces = det.detect(img)
    if faces is None:
        return None
    return max(faces, key=lambda f: f[2] * f[3])


def path(name, n):
    return D / 'data/lfw_funneled' / name / f'{name}_{int(n):04d}.jpg'


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 6000
    lines = (D / 'data/pairs.txt').read_text().split('\n')[1:]
    pairs = []
    for l in lines:
        p = l.split('\t')
        if len(p) == 3:
            pairs.append((path(p[0], p[1]), path(p[0], p[2]), 1))
        elif len(p) == 4:
            pairs.append((path(p[0], p[1]), path(p[2], p[3]), 0))
    pairs = pairs[:limit]

    cache, align_diff, align_cos = {}, [], []
    def emb(p):
        if p not in cache:
            img = cv2.imread(str(p))
            f = biggest_face(img)
            if f is None:
                cache[p] = None
            else:
                mine = ours(img, f)
                ref = rec.alignCrop(img, f)
                align_diff.append(np.abs(mine.astype(int) - ref.astype(int)).mean())
                e_mine = embed(mine)
                e_ref = rec.feature(ref).flatten()
                align_cos.append(float(e_mine @ e_ref / np.linalg.norm(e_mine) / np.linalg.norm(e_ref)))
                cache[p] = e_mine / np.linalg.norm(e_mine)
        return cache[p]

    t0 = time.time()
    same, diff, missed = [], [], 0
    for a, b, label in pairs:
        ea, eb = emb(a), emb(b)
        if ea is None or eb is None:
            missed += 1
            continue
        (same if label else diff).append(float(ea @ eb))
    secs = time.time() - t0
    # SAVE_EMB=<file.npz>: keep every face's embedding + identity for the grouping simulation (cluster.py).
    if os.environ.get('SAVE_EMB'):
        keys = [k for k, v in cache.items() if v is not None]
        np.savez(os.environ['SAVE_EMB'], emb=np.array([cache[k] for k in keys]), who=np.array([k.parent.name for k in keys]))
    same, diff = np.array(same), np.array(diff)

    print(f'pairs {len(pairs)}  faces {len(cache)}  no face found {missed}  {secs:.0f}s ({secs / max(len(cache), 1) * 1000:.0f} ms/face incl. detect, 2 threads)')
    print(f'alignment vs OpenCV: mean pixel diff {np.mean(align_diff):.2f}/255, embedding cosine min {min(align_cos):.4f} mean {np.mean(align_cos):.4f}')
    for th in (0.30, 0.363, 0.40, 0.45, 0.50, 0.55):
        tp = (same >= th).mean() * 100
        fp = (diff >= th).mean() * 100
        acc = ((same >= th).sum() + (diff < th).sum()) / (len(same) + len(diff)) * 100
        print(f'  cos >= {th:.3f}: same-person found {tp:5.1f} %  wrong person merged {fp:5.2f} %  accuracy {acc:5.1f} %')
    strict = np.quantile(diff, 0.999)
    print(f'strict MERGE threshold (0.1 % wrong merges on LFW): {strict:.3f} -> keeps {(same >= strict).mean() * 100:.1f} % of same-person pairs')


if __name__ == '__main__':
    main()
