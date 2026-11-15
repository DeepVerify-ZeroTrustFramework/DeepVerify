"""LEVEL 2 - INTEGRATION (part E: AWS Rekognition face verification, 4 tests).
A real boto3 Rekognition client is used with botocore's Stubber, so request validation and
response parsing run for real but nothing leaves the machine."""
import unittest
import boto3
from botocore.stub import Stubber
from qa_tests import _bootstrap  # noqa: F401
from modules.face_verifier import face_verifier_service as svc

PHOTO = b"\xff\xd8" + b"x" * 2000      # >1000 bytes so the service accepts it as an image


class TestRekognitionIntegration(unittest.TestCase):
    def setUp(self):
        self.saved = svc._rekognition_client
        self.client = boto3.client("rekognition", region_name="us-east-1",
                                   aws_access_key_id="testing", aws_secret_access_key="testing")
        self.stub = Stubber(self.client)
        svc._rekognition_client = self.client

    def tearDown(self):
        svc._rekognition_client = self.saved

    def test_01_single_clear_face_passes_reference_validation(self):
        self.stub.add_response("detect_faces", {"FaceDetails": [{"Confidence": 99.2}]})
        with self.stub:
            r = svc.validate_reference_photo(PHOTO)
        self.assertTrue(r["valid"])
        self.assertEqual(r["face_count"], 1)

    def test_02_photo_with_two_faces_is_rejected(self):
        self.stub.add_response("detect_faces", {"FaceDetails": [{"Confidence": 99.0}, {"Confidence": 97.0}]})
        with self.stub:
            r = svc.validate_reference_photo(PHOTO)
        self.assertFalse(r["valid"])
        self.assertEqual(r["error_code"], "MULTIPLE_FACES_DETECTED")

    def test_03_live_snapshot_matching_reference_is_verified(self):
        self.stub.add_response("compare_faces", {
            "FaceMatches": [{"Similarity": 98.4, "Face": {"Confidence": 99.9}}], "UnmatchedFaces": []})
        with self.stub:
            r = svc.compare_candidate_faces(PHOTO, PHOTO)
        self.assertTrue(r["verified"])
        self.assertEqual(r["status"], "VERIFIED")
        self.assertAlmostEqual(r["similarity"], 98.4)

    def test_04_different_person_is_flagged_as_face_mismatch(self):
        self.stub.add_response("compare_faces", {"FaceMatches": [], "UnmatchedFaces": [{"Confidence": 99.0}]})
        with self.stub:
            r = svc.compare_candidate_faces(PHOTO, PHOTO)
        self.assertFalse(r["verified"])
        self.assertEqual(r["error_code"], "FACE_MISMATCH")


if __name__ == "__main__":
    unittest.main()
