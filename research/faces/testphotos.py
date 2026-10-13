"""People self-test fixtures: public-domain photos (site/public/people/test,
US government works from Wikimedia Commons) → expected results on the PC.

Checks, per model (.tflite) and alignment (4 or 5 points):
  - same person (Biden 2013 vs 2021) must match,
  - different people (Biden vs Obama) must not,
  - the family photo has 4 faces and Obama in it matches his portrait.
Writes expected.json next to the photos for the phone self-test.

Run: nice -n 19 <venv with ai-edge-litert + opencv>/bin/python research/faces/testphotos.py
"""
import json
from pathlib import Path

import cv2
import numpy as np
from ai_edge_litert.interpreter import Interpreter

D = Path(__file__).parent
P = D.parent.parent / 'site/public/people/test'  # served to the phone self-test
REF = np.array([[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366],
                [41.5493, 92.3655], [70.7299, 92.2041]], dtype=np.float64)
MATCH, MERGE = 0.363, 0.45


def similarity(src, dst):
    n = src.shape[0]
    mu_s, mu_d = src.mean(0), dst.mean(0)
    s, d = src - mu_s, dst - mu_d
    U, S, Vt = np.linalg.svd(d.T @ s / n)
    E = np.eye(2)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0:
        E[1, 1] = -1
    R = U @ E @ Vt
    scale = np.trace(np.diag(S) @ E) / (s ** 2).sum(1).mean()
    return np.hstack([scale * R, (mu_d - scale * R @ mu_s)[:, None]])


def faces(img):
    # YuNet misses faces that fill a big frame: detect on a <= 640 px copy, scale points back.
    k = min(1.0, 640 / max(img.shape[:2]))
    small = cv2.resize(img, None, fx=k, fy=k, interpolation=cv2.INTER_AREA) if k < 1 else img
    det = cv2.FaceDetectorYN.create(str(D / 'models/yunet.onnx'), '', (small.shape[1], small.shape[0]), 0.7)
    _, f = det.detect(small)
    if f is None:
        return []
    f = f.copy()
    f[:, :14] /= k
    return sorted(f, key=lambda x: x[0])  # left to right


def run(model, use):
    it = Interpreter(model_path=str(model))
    it.allocate_tensors()
    i, o = it.get_input_details()[0], it.get_output_details()[0]

    def embed(img, face):
        pts = face[4:14].reshape(5, 2).astype(np.float64)
        crop = cv2.warpAffine(img, similarity(pts[use], REF[use]), (112, 112), flags=cv2.INTER_LINEAR)
        it.set_tensor(i['index'], cv2.cvtColor(crop, cv2.COLOR_BGR2RGB).astype(np.float32)[None])
        it.invoke()
        e = it.get_tensor(o['index']).flatten()
        return e / np.linalg.norm(e)

    E = {}
    for name in ('biden-2021', 'biden-2013', 'obama-2012', 'family-2011'):
        img = cv2.imread(str(P / f'{name}.jpg'))
        E[name] = [embed(img, f) for f in faces(img)]
    cos = lambda a, b: float(a @ b)
    same = cos(E['biden-2021'][0], E['biden-2013'][0])
    diff = max(cos(E['biden-2021'][0], E['obama-2012'][0]), cos(E['biden-2013'][0], E['obama-2012'][0]))
    fam = [cos(E['obama-2012'][0], e) for e in E['family-2011']]
    return E, {'sameBiden': same, 'bidenVsObama': diff, 'familyFaces': len(E['family-2011']), 'obamaInFamily': max(fam), 'familyOthersMax': sorted(fam)[-2]}


def main():
    models = sorted((D / 'models/tflite').glob('sface_*.tflite'))
    for m in models:
        for use, label in (([0, 1, 2, 3, 4], '5 pts'), ([0, 1, 3, 4], '4 pts')):
            _, r = run(m, use)
            ok = r['sameBiden'] >= MERGE and r['bidenVsObama'] < MATCH and r['familyFaces'] == 4 and r['obamaInFamily'] >= MERGE and r['familyOthersMax'] < MATCH
            print(f"{m.name:26s} {label}: same {r['sameBiden']:.3f}  diff {r['bidenVsObama']:.3f}  family faces {r['familyFaces']}  "
                  f"obama-in-family {r['obamaInFamily']:.3f}  others {r['familyOthersMax']:.3f}  {'PASS' if ok else 'FAIL'}")
    # Expected values for the phone (the model the app ships, 4-point alignment like the phone).
    ship = D / 'models/tflite/sface_dynamic_int8.tflite'
    E, r = run(ship, [0, 1, 3, 4])
    out = {'model': ship.name, 'align': '4 points', 'thresholds': {'match': MATCH, 'merge': MERGE}, 'pc': r,
           'embeddings': {k: [list(map(lambda x: round(float(x), 6), e)) for e in v] for k, v in E.items()}}
    (P / 'expected.json').write_text(json.dumps(out))
    print('wrote', P / 'expected.json')


if __name__ == '__main__':
    main()
