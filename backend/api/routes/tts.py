"""
DeepVerify — Sarvam AI Text-to-Speech API Route.
Provides text-to-speech audio generation for candidate guidance during the System Check Wizard.
"""
import os
import json
import asyncio
import urllib.request
import urllib.error
from pathlib import Path
from pydantic import BaseModel, Field
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import JSONResponse

# Attempt to load .env if available
try:
    from dotenv import load_dotenv
    env_path = Path(__file__).resolve().parents[2] / ".env"
    if env_path.exists():
        load_dotenv(env_path)
    else:
        load_dotenv()
except Exception:
    pass

router = APIRouter()

SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech"
DEFAULT_SARVAM_KEY = "sk_0l2l2gl8_XCCV2rvtlznZCfpFRsW9xAFl"


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2500, description="Text to convert to speech")
    language_code: str = Field(default="en-IN", description="Language code e.g. en-IN")
    speaker: str = Field(default="ishita", description="Speaker voice name")


def _call_sarvam_tts(text: str, language_code: str, speaker: str, api_key: str) -> list[str]:
    """Synchronous HTTP call to Sarvam AI TTS endpoint."""
    headers = {
        "Content-Type": "application/json",
        "api-subscription-key": api_key.strip(),
    }
    payload = {
        "text": text,
        "language_code": language_code,
        "model": "bulbul:v3",
        "speaker": speaker,
    }
    req = urllib.request.Request(
        SARVAM_TTS_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=12) as response:
        resp_data = json.loads(response.read().decode("utf-8"))
        audios = resp_data.get("audios", [])
        if audios and len(audios) > 0:
            return audios
        raise ValueError("No audio returned by Sarvam AI")


@router.post("/tts")
async def generate_speech(request: TTSRequest):
    """
    Generate speech audio for the given text using Sarvam AI.
    Returns base64 encoded audio in the response.
    """
    api_key = os.getenv("SARVAM_API_KEY") or DEFAULT_SARVAM_KEY
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SARVAM_API_KEY is not configured."
        )

    try:
        audios = await asyncio.to_thread(
            _call_sarvam_tts,
            request.text,
            request.language_code,
            request.speaker,
            api_key
        )
        return JSONResponse(content={
            "audios": audios,
            "format": "wav",
            "speaker": request.speaker,
            "status": "success"
        })
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else str(e)
        print(f"[TTS Error] Sarvam HTTP {e.code}: {error_body}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Sarvam AI TTS service error: {e.code} - {error_body}"
        )
    except Exception as e:
        print(f"[TTS Error] Unexpected error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate speech: {str(e)}"
        )
