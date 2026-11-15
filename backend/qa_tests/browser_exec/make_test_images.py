"""Create the three test photos used by the browser scripts (needs scikit-image for the sample portrait)."""
import cv2, numpy as np, os, skimage.data as d
os.makedirs("/tmp/imgs", exist_ok=True)
a = d.astronaut()[:, :, ::-1].copy()
cv2.imwrite("/tmp/imgs/face1.jpg", a)
cv2.imwrite("/tmp/imgs/twofaces.jpg", np.hstack([a, a]))
w = np.full((512, 512, 3), 200, np.uint8); cv2.randn(w, (200, 200, 200), (4, 4, 4)); cv2.imwrite("/tmp/imgs/wall.jpg", w)
