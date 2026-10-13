Lens People: on-device face grouping files (downloaded only when a user turns People on).

sface-v1.tflite
  SFace face recognition model (MobileFaceNet trained with the SFace loss) from
  OpenCV Zoo: https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface
  Licensed under the Apache License 2.0 (LICENSE-SFace.txt).
  Modified by Lens: converted from face_recognition_sface_2021dec.onnx to TFLite
  (onnx2tf) with dynamic-range int8 weights. SHA-256:
  37cf4c81b31c7115a926cb435641ed338fc8722919569d48ecd096dc3aa152e3

test/ (used only by the app's self-test)
  Public-domain photos (works of the US federal government), via Wikimedia Commons:
  - biden-2021.jpg: "Joe Biden presidential portrait"
  - biden-2013.jpg: "Joe Biden official portrait 2013"
  - obama-2012.jpg: "President Barack Obama" (Pete Souza, White House)
  - family-2011.jpg: "Barack Obama family portrait 2011" (Pete Souza, White House)
  expected.json: results of research/faces/testphotos.py on a PC.
