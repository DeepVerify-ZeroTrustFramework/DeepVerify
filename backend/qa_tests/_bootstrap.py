"""Test bootstrap: puts backend/ on sys.path and makes sure no real cloud credentials are used.

Imported first by every test module. It must run BEFORE any DeepVerify module is imported,
because the face-verifier service reads AWS/Cloudinary settings at import time.
"""
import os
import sys
import warnings

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# Never talk to real cloud services from tests: dummy AWS keys, no Cloudinary / DB URLs.
os.environ["AWS_ACCESS_KEY_ID"] = "testing"
os.environ["AWS_SECRET_ACCESS_KEY"] = "testing"
os.environ["AWS_SESSION_TOKEN"] = "testing"
os.environ["AWS_REGION"] = "us-east-1"
for _k in ("CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET",
           "MONGODB_URL", "REDIS_URL", "SIGHTENGINE_API_USER", "SIGHTENGINE_API_SECRET"):
    os.environ.pop(_k, None)

warnings.filterwarnings("ignore")
