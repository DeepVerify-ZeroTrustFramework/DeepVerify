"""Start the REAL DeepVerify backend (uvicorn) with in-memory MongoDB/Redis, for manual/exploratory testing.

Use when Docker is not available. Nothing in the application code is changed.
    python -m qa_tests.tools.run_local_server   (from the backend folder)  -> http://127.0.0.1:8000
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from qa_tests import _bootstrap  # noqa: F401,E402
from qa_tests import _harness    # noqa: F401,E402  (importing patches nothing; we patch explicitly below)
import api.main as main_module   # noqa: E402
from modules.face_verifier import face_verifier_service  # noqa: E402

main_module.connect_mongodb = _harness._connect_mongodb
main_module.close_mongodb = _harness._close_mongodb
main_module.connect_redis = _harness._connect_redis
main_module.close_redis = _harness._close_redis
face_verifier_service._rekognition_client = None   # never talk to real AWS

# Optional: some OpenCV builds ship without the Haar face-detector XML. Point QA_HAAR_DIR at a folder that has
# haarcascade_frontalface_default.xml so the app's local face check behaves as it does in the Docker image.
import os  # noqa: E402
if os.environ.get("QA_HAAR_DIR"):
    import cv2  # noqa: E402
    cv2.data.haarcascades = os.environ["QA_HAAR_DIR"].rstrip("/") + "/"

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(main_module.app, host="127.0.0.1", port=8000, log_level="info")
