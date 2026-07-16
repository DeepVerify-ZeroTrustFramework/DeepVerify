import numpy as np
import sys
import os

# Ensure backend is in path
backend_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
sys.path.append(backend_dir)

from prnu import extract_noise_residual

# Create a dummy 100x100 BGR image
img = np.random.randint(0, 256, (100, 100, 3), dtype=np.uint8)
try:
    res = extract_noise_residual(img)
    print(f"PRNU Extraction Success! Residual shape: {res.shape}")
except Exception as e:
    print(f"PRNU Extraction Error: {e}")
