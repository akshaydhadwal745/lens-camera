"""People: SFace ONNX -> TFLite for LiteRT (Play services), and the parity gate.

Gate (docs/design/people.md): every aligned face's TFLite embedding must match
the ONNX original with cosine >= 0.99, or we fall back to a slim ONNX Runtime.

Run (venv with tensorflow-cpu 2.19, onnx2tf, onnxruntime, ai-edge-litert):
  nice -n 19 <venv>/bin/python research/faces/convert.py [faces]
"""
import subprocess, sys
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort
from ai_edge_litert.interpreter import Interpreter

D = Path(__file__).parent
ONNX = D / 'models/sface.onnx'
OUT = D / 'models/tflite'


def convert():
    if not (OUT / 'sface_float32.tflite').exists():
        subprocess.run(['onnx2tf', '-i', str(ONNX), '-o', str(OUT), '-n'], check=True)
    return sorted(OUT.glob('*.tflite'))


def aligned_faces(n):
    """Aligned 112x112 crops from LFW (YuNet + OpenCV alignCrop, same as the spike)."""
    det = cv2.FaceDetectorYN.create(str(D / 'models/yunet.onnx'), '', (250, 250), 0.6)
    rec = cv2.FaceRecognizerSF.create(str(ONNX), '')
    out = []
    for p in sorted((D / 'data/lfw_funneled').glob('*/*.jpg'))[::7]:
        img = cv2.imread(str(p))
        det.setInputSize((img.shape[1], img.shape[0]))
        _, faces = det.detect(img)
        if faces is None:
            continue
        out.append(rec.alignCrop(img, max(faces, key=lambda f: f[2] * f[3])))
        if len(out) >= n:
            break
    return out


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 500
    models = convert()
    faces = aligned_faces(n)
    sess = ort.InferenceSession(str(ONNX), providers=['CPUExecutionProvider'])
    name = sess.get_inputs()[0].name
    # OpenCV FaceRecognizerSF preprocessing: RGB, 0..255 floats, no mean/scale.
    rgb = [cv2.cvtColor(f, cv2.COLOR_BGR2RGB).astype(np.float32) for f in faces]
    ref = [sess.run(None, {name: f.transpose(2, 0, 1)[None]})[0].flatten() for f in rgb]
    for m in models:
        it = Interpreter(model_path=str(m))
        it.allocate_tensors()
        i, o = it.get_input_details()[0], it.get_output_details()[0]
        cos = []
        for f, r in zip(rgb, ref):
            x = f[None] if tuple(i['shape']) == (1, 112, 112, 3) else f.transpose(2, 0, 1)[None]
            it.set_tensor(i['index'], x.astype(i['dtype']))
            it.invoke()
            e = it.get_tensor(o['index']).flatten()
            cos.append(float(e @ r / np.linalg.norm(e) / np.linalg.norm(r)))
        cos = np.array(cos)
        verdict = 'PASS' if cos.min() >= 0.99 else 'FAIL'
        print(f'{m.name:28s} {m.stat().st_size / 1e6:5.1f} MB  input {list(i["shape"])}  '
              f'cosine vs ONNX: min {cos.min():.5f} mean {cos.mean():.5f}  ({len(cos)} faces)  {verdict}')


if __name__ == '__main__':
    main()
