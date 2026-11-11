import sys
sys.path.append('c:\\Users\\naren\\OneDrive\\Desktop\\DEEPVERIFY - BUILD\\backend')
import numpy as np
from modules.prnu import estimate_prnu_reference, analyze_frame_prnu

# Create dummy frames (320x240 BGR)
frames = [np.random.randint(0, 256, (240, 320, 3), dtype=np.uint8) for _ in range(3)]

try:
    print("Estimating PRNU reference...")
    k_hat = estimate_prnu_reference(frames)
    print("Reference shape:", k_hat.shape)

    print("Analyzing test frame...")
    test_frame = np.random.randint(0, 256, (240, 320, 3), dtype=np.uint8)
    result = analyze_frame_prnu(test_frame, k_hat, source='webrtc')
    print("Result:", result)
    print("SUCCESS")
except Exception as e:
    print("ERROR:", e)
