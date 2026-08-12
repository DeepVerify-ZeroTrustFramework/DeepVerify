<div align="center">

<img src="https://img.shields.io/badge/IEEE-ICOSAAS%202026-A4123F?style=for-the-badge&logo=ieee&logoColor=white" alt="IEEE ICOSAAS 2026"/>
<img src="https://img.shields.io/badge/Status-Active%20Development-22C55E?style=for-the-badge" alt="Status"/>
<img src="https://img.shields.io/badge/License-MIT-6B7280?style=for-the-badge" alt="License"/>

<br/><br/>

```
██████╗ ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗ ██╗███████╗██╗   ██╗
██╔══██╗██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗██║██╔════╝╚██╗ ██╔╝
██║  ██║█████╗  █████╗  ██████╔╝██║   ██║█████╗  ██████╔╝██║█████╗   ╚████╔╝ 
██║  ██║██╔══╝  ██╔══╝  ██╔═══╝ ╚██╗ ██╔╝██╔══╝  ██╔══██╗██║██╔══╝    ╚██╔╝  
██████╔╝███████╗███████╗██║      ╚████╔╝ ███████╗██║  ██║██║██║        ██║   
╚═════╝ ╚══════╝╚══════╝╚═╝       ╚═══╝  ╚══════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   
```

# DeepVerify
### Zero-Trust Interview Integrity Platform

*Verifying the physics of a video call — not just what a candidate looks like.*

**Accepted · IEEE ICOSAAS 2026**

[Live Demo](#) · [Research Paper](#) · [Report a Bug](issues) · [Request Feature](issues)

</div>

---

## Table of Contents

- [What Is DeepVerify](#what-is-deepverify)
- [Why It Exists](#why-it-exists)
- [The Four-Module Forensic Pipeline](#the-four-module-forensic-pipeline)
- [How It Works — End-to-End Flow](#how-it-works--end-to-end-flow)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [WebSocket Protocol](#websocket-protocol)
- [Database Schema](#database-schema)
- [Sequential Gate Logic](#sequential-gate-logic)
- [Security Model](#security-model)
- [Known Limitations & Scope Boundaries](#known-limitations--scope-boundaries)
- [Research & Academic Context](#research--academic-context)
- [Team](#team)
- [License](#license)

---

## What Is DeepVerify

DeepVerify is a **standalone web portal for conducting remote technical interviews with continuous, passive forensic integrity verification**. It is not a plugin or extension layered on top of Zoom, Teams, or Meet — it IS the meeting platform.

Unlike every existing proctoring solution (HackerRank, ProctorU, Onfido), DeepVerify does not attempt to detect deepfakes by analysing visual appearance. Visual artifact detection fails as soon as a new GAN architecture is released. DeepVerify instead attacks **signals that cannot be faked**:

| Signal | What it proves | Can a deepfake fake it? |
|--------|---------------|------------------------|
| PRNU sensor noise | This pixel came from this specific physical camera | No — requires physical device cloning |
| rPPG blood flow | A living person's cardiovascular system is present | No — GPU-rendered faces have no heartbeat |
| Network jitter | No real-time GPU rendering happening on this machine | Partially — only if using a separate render box |
| Gaze + behavior | Candidate attention is on the interview, not an external source | Partially — AI agents could theoretically mimic gaze |

The identity layer (PRNU + rPPG) together carry 60% of the trust score weight and are grounded in physics, not statistics. This makes the core of DeepVerify **architecture-agnostic to future deepfake improvements**.

---

## Why It Exists

### The Problem

Remote interviews have created three threat surfaces that no existing platform addresses:

**1. Identity fraud via deepfake or human proxy**
- AI-generated candidates have passed multiple technical rounds before detection (documented FBI IC3 PSA, 2022)
- In 2024, a Hong Kong company lost $25M when executives in a video call were all deepfakes (Arup incident)
- Tools like DeepFaceLive enable real-time face-swap on commodity hardware

**2. Assistance fraud via off-screen resources**
- A second monitor outside camera view, a hidden earpiece, or a phone running ChatGPT
- Tab-switching to AI assistants during live coding assessments
- Pasting AI-generated code into the interview IDE

**3. Knowledge fraud via silent AI assistance**
- The candidate's question is captured, silently sent to an LLM, and the answer is read back verbally
- Behavioral signal: unnatural pause followed by unusually fluent technical response

### Why Existing Tools Fail

| Capability | HackerRank/Mettl | Onfido/Jumio | ProctorU | **DeepVerify** |
|-----------|-----------------|-------------|----------|----------------|
| Identity verification scope | Session start only | One-time check | Human-led | **Continuous** |
| PRNU hardware fingerprint | ✗ | ✗ | ✗ | **✓** |
| rPPG biological liveness | ✗ | ✗ | ✗ | **✓** |
| Network jitter analysis | ✗ | ✗ | ✗ | **✓** |
| Virtual camera detection | ✗ | ✗ | ✗ | **✓** |
| Continuous trust score 0–100 | ✗ | ✗ | Limited | **✓** |
| Per-candidate threshold calibration | ✗ | ✗ | ✗ | **✓** |
| Gaze & tab monitoring | Limited | ✗ | ✓ | **✓** |

---

## The Four-Module Forensic Pipeline

### Module 1 — PRNU Hardware Fingerprinting (Weight: 30%)

Every camera sensor has microscopic manufacturing imperfections that cause each pixel to respond slightly differently to identical light input. This variation — called Photo Response Non-Uniformity (PRNU) — is unique to each physical device, stable across time, and survives typical video compression to a degree.

**Algorithm:**
```
Enrollment:  90 I-frames captured → noise residual W = I - F(I) extracted per frame
             (F = Daubechies-8 wavelet denoising, 4-level decomposition)
             MLE estimator: K̂ = Σ(Wₙ·Iₙ) / Σ(Iₙ²)  →  zero-mean normalized
             K̂ stored in GridFS as session's camera fingerprint

Live check:  Each I-frame → extract W_test → compute PCE(W_test, K̂)
             PCE = |IFFT[FFT(W) · conj(FFT(K̂))]|²_peak / mean(rest²)
             PCE > τ (default 60) → AUTHENTIC
             PCE ≤ τ           → FLAG: IDENTITY_FRAUD
```

**What it catches:** Virtual camera injection (OBS, ManyCam, XSplit), pre-recorded video loops, wrong physical device.

**What it cannot catch:** Deepfake rendered on a separate machine routed via HDMI capture card (this attack also bypasses the jitter module — covered by rPPG).

**Important:** PRNU only works on I-frames (keyframes). P-frames and B-frames are skipped because inter-frame prediction in H.264 destroys the PRNU signal.

---

### Module 2 — rPPG Biological Liveness Detection (Weight: 30%)

Blood absorbs and reflects light differently depending on oxygenation level. Each heartbeat causes a periodic change in blood volume in facial capillaries, which modulates the green channel intensity of skin pixels at 0.7–3.5 Hz (42–210 BPM). A GAN-synthesised face or pre-recorded video has no cardiovascular system — no pulse signal exists.

**Algorithm (POS method — de Haan & Jeanne, IEEE TBME 2013):**
```
Per frame:   Extract mean RGB over facial ROI (forehead + cheeks via MediaPipe landmarks)
             sR(t), sG(t), sB(t)

Accumulate:  Minimum 150 frames (5 seconds at 30fps) before decision

POS signal:  H(t) = 3·sR - 2·sG
             α = σ(H) / σ(sR - sB)
             h(t) = H + α·(sR - sB)

Filter:      Butterworth bandpass [0.7, 3.5] Hz at 30fps, order 4

Liveness:    FFT → SNR in band = 10·log₁₀(peak_power / noise_power)
             HR = argmax freq in [0.7, 3.5] Hz × 60
             LIVE if SNR > β AND 42 ≤ HR ≤ 210 BPM
```

**Key fairness requirement:** The SNR threshold β is calibrated **per candidate** during a 60-second baseline capture at session start. A global fixed threshold would produce false positives for candidates with darker skin tones (higher melanin reduces amplitude of the rPPG signal). This per-session calibration directly addresses the fairness concern documented in our paper (§VII.B).

---

### Module 3 — Network Jitter Analysis (Weight: 15%)

Real-time deepfake rendering is GPU-intensive. Processing each video frame through a GAN or diffusion model introduces 10–30 ms of variable overhead per frame, which manifests as irregular spikes in the RTP packet Inter-Arrival Time (IAT) distribution. A genuine webcam feed produces near-constant IAT (33ms at 30fps, CV ≈ 0.05–0.10).

**Algorithm (RFC 3550 jitter + statistical detection):**
```
Capture:     Passive AsyncSniffer on UDP/RTP packets (Scapy, server-side)

Per packet:  IAT = arrival_time[i] - arrival_time[i-1]
             Running jitter (RFC 3550): Jᵢ = Jᵢ₋₁ + (|d_{i-1,i}| - Jᵢ₋₁) / 16

Over 100 packets:
             CV = σ(IAT) / μ(IAT)
             Skewness = scipy.stats.skew(IAT)

Decision:    SYNTHETIC if CV > γ AND skewness > 0.5
             Confidence = min(1.0, CV / (2γ))

Thresholds:  γ = 0.15 (fiber/WiFi), γ = 0.20 (4G cellular)
             Connection type set during Phase 0 network check
```

**Scope limit:** This module only detects deepfakes running on the **same machine** as the webcam stream. A separate GPU box connected via HDMI capture card bypasses jitter detection. This is a documented limitation — PRNU and rPPG cover most of these cases independently.

---

### Module 4 — Behavioral Telemetry (Weight: 25%)

Catches off-screen assistance and knowledge fraud that the physical modules cannot detect.

**Signals:**

| Signal | Method | Alert threshold |
|--------|--------|----------------|
| Gaze deviation Δ | MediaPipe FaceMesh iris landmarks 468/473, normalized iris position | Δ > λ (per-candidate from 60s baseline) |
| Head pose yaw | PnP solver on 6 reference landmarks | \|yaw\| > 30° sustained |
| Tab switches | `document.visibilitychange` DOM event | Any occurrence |
| Window blur | `window.blur` event | Duration > 2s |
| Large clipboard paste | `paste` event, text length check | > 200 characters |

**Scoring:**
```
B = 0.35 · gaze_score + 0.25 · tab_score + 0.20 · paste_score + 0.20 · pose_score

gaze_score  = 1 - fraction(recent Δ readings > λ)
tab_score   = max(0, 1 - switch_rate_per_min / 3)
paste_score = max(0, 1 - large_pastes_5min / 2)
pose_score  = 1 - fraction(|yaw| > 30°)
```

All thresholds (λ) are calibrated per-candidate during the 60-second gaze calibration step in the system check wizard — not global fixed values.

---

### Axiom Fusion Engine

```
Trust Score T ∈ [0, 100]  —  continuous float, NEVER binary

T = 100
  - 30 · max(0, 1 - pce/τ)          ← PRNU penalty (max 30 pts)
  - 30 · max(0, (β - snr)/β)         ← rPPG penalty (max 30 pts)
  - 15 · min(1, (cv - γ)/γ)          ← Jitter penalty (max 15 pts, only if cv > γ)
  - 25 · (1 - B)                      ← Behavioral penalty (max 25 pts)

Zero-trust property:
  PRNU + rPPG together carry 60% of weight.
  If both fail fully → T = 40, regardless of behavioral score.
  A candidate cannot compensate for hardware failure with perfect behavior.

Alert thresholds:
  T ≥ 80   → GREEN  "Session verified"
  60 ≤ T < 80 → AMBER "Caution — review recommended"
  T < 60   → RED    "Integrity alert — auto-flag triggered"
```

**Adaptive weights (roadmap):** The current implementation uses fixed weights. Phase 3 of development will implement scenario-aware weight shifting: if PRNU variance is high (unstable sensor), weight shifts toward rPPG; if jitter is nominal, its weight redistributes to behavioral. This addresses the feedback from our panel review (Vinod Sir, Robin Sir — June 2026).

---

## How It Works — End-to-End Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         RECRUITER (app.deepverify.io/create)            │
│                                                                         │
│  Fill in: candidate name, email, interviewer name, role, duration       │
│  Toggle: which forensic modules to enable (PRNU/rPPG/Jitter)           │
│  Click: "Generate session link"                                         │
│                          │                                              │
│  POST /api/sessions ─────┤                                              │
│  ← { candidateUrl, dashboardUrl, sessionId }                           │
│                          │                                              │
│  candidateUrl ──────────────── emailed to candidate                    │
│  dashboardUrl ──────────────── kept by interviewer                     │
└─────────────────────────────────────────────────────────────────────────┘
                           │
                           ▼ candidate opens their link
┌─────────────────────────────────────────────────────────────────────────┐
│                    SYSTEM CHECK WIZARD (/check/:token)                  │
│                                                                         │
│  Step 1 — Permissions & device check                                   │
│    • getUserMedia() → camera + mic access                               │
│    • Virtual camera scan (OBS/ManyCam/XSplit → HARD BLOCK)             │
│    • Camera preview strip appears                                       │
│                                                                         │
│  Step 2 — Network classification                                        │
│    • WebRTC STUN/TURN connectivity test                                 │
│    • RTT measurement → fiber/WiFi/4G classification                    │
│    • Jitter threshold γ stored: POST /api/sessions/:id/network          │
│                                                                         │
│  Step 3 — PRNU camera enrollment                                        │
│    • 90 I-frames captured via WebCodecs API (chunk.type === 'key')     │
│    • Batch POST /api/sessions/:id/enroll/prnu                          │
│    • Backend: wavelet denoise → MLE estimator → K̂ stored in GridFS    │
│                                                                         │
│  Step 4 — rPPG biological baseline                                      │
│    • 60-second facial RGB sampling at 30fps                            │
│    • POST /api/sessions/:id/enroll/rppg                                │
│    • Backend: POS → FFT → SNR baseline β stored (per-candidate)        │
│                                                                         │
│  Step 5 — Gaze calibration                                              │
│    • 9-point dot grid (MediaPipe FaceMesh in web worker)               │
│    • Per-candidate deviation threshold λ computed and stored            │
│    • POST /api/sessions/:id/enroll/gaze                                │
│                                                                         │
│  Step 6 — Consent acknowledgment                                        │
│    • Candidate types "I CONSENT" exactly                               │
│    • POST /api/sessions/:id/consent → timestamp logged                 │
│                                                                         │
│  Step 7 — Readiness gate                                                │
│    • All 6 checks confirmed                                             │
│    • "Begin Interview" button → PATCH session checkCompleted: true      │
│    • Navigate to /session/:token                                        │
└─────────────────────────────────────────────────────────────────────────┘
                           │
          ┌────────────────┴────────────────┐
          │                                 │
          ▼                                 ▼
┌─────────────────────┐          ┌──────────────────────────────────────┐
│  CANDIDATE SESSION  │          │       INTERVIEWER DASHBOARD          │
│  (/session/:token)  │          │       (/dashboard/:sessionId)        │
│                     │          │                                      │
│  • WebRTC peer conn │◄───P2P───►│  • WebRTC peer conn                 │
│  • Monaco editor    │          │  • Trust score gauge (live)          │
│    (JS/Py/C++/etc)  │          │  • 4 module breakdown bars          │
│  • MediaPipe gaze   │──WS──►  │  • Remote media controls            │
│    web worker       │          │  • Alert feed (empty until Axiom     │
│  • DOM hooks        │──WS──►  │    Engine fires real alerts)         │
│  • I-frame capture  │──POST─► │  • Flag for review button            │
│    → /api/frames    │          │  • Export forensic PDF               │
│  • Telemetry strip  │          │                                      │
│    (passive, bottom)│          │  Waiting room shown if session not   │
│                     │          │  yet active (polls /api/sessions/:id │
│  Trust score hidden │          │  every 5s, auto-transitions)         │
│  from candidate     │          │                                      │
└─────────────────────┘          └──────────────────────────────────────┘
          │                                 │
          └────────────────┬────────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   BACKEND   │
                    │  PIPELINE   │
                    │             │
                    │ Frame POST  │
                    │ ─► PRNU    │
                    │ ─► rPPG    │
                    │             │
                    │ WS events  │
                    │ ─► Behav.  │
                    │             │
                    │ Scapy sniff │
                    │ ─► Jitter  │
                    │             │
                    │ Every 275ms │
                    │ ─► Axiom   │
                    │    Fusion  │
                    │ ─► Redis   │
                    │ ─► WS push │
                    │ ─► MongoDB │
                    └─────────────┘
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React Portal)                      │
│                                                                      │
│  ┌──────────────────────────┐    ┌─────────────────────────────┐   │
│  │   Candidate Interface    │    │     Admin Dashboard         │   │
│  │  • Webcam Capture        │    │  • Alerts Panel             │   │
│  │  • Browser Tracking      │    │  • Trust Score View         │   │
│  │    (MediaPipe worker)    │    │  • Session Review           │   │
│  └──────────────────────────┘    └─────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │   SECURITY LAYER    │
                    │  JWT OAuth + RBAC   │
                    │     API Gateway     │
                    └─────────┬──────────┘
                              │
┌─────────────────────────────▼───────────────────────────────────────┐
│                        BACKEND SERVICES                              │
│                                                                      │
│  ┌────────────────────────┐  ┌───────────────────────────────────┐  │
│  │  Identity Verification │  │      Behavioral Analysis          │  │
│  │  • Camera Fingerprint  │  │  • Gaze Tracking (MediaPipe)     │  │
│  │    (PRNU — FastAPI)    │  │  • Event Monitoring (DOM hooks)  │  │
│  │  • Pulse Detection     │  └───────────────────────────────────┘  │
│  │    (rPPG)             │                                          │
│  └────────────────────────┘  ┌───────────────────────────────────┐  │
│                               │      Network Integrity            │  │
│                               │  • Packet Analysis (Scapy/RTP)   │  │
│                               │  • Jitter / IAT Analysis          │  │
│                               └───────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────────────┐
│                          DATA LAYER                                  │
│                                                                      │
│  ┌──────────────────────────────┐   ┌─────────────────────────────┐ │
│  │       Forensic Store         │   │       Trust Layer           │ │
│  │  • Audit Logs (MongoDB)      │   │  • Trust Fusion Engine      │ │
│  │  • Session Telemetry         │   │    (Axiom Engine)           │ │
│  │  • Trust Timeline            │   │  • Feature Fusion           │ │
│  │  • PRNU K̂ (GridFS)          │   │  • Score Computation        │ │
│  └──────────────────────────────┘   └─────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

### Frontend
| Technology | Purpose |
|-----------|---------|
| React 18 + Vite + TypeScript | UI framework |
| Tailwind CSS | Styling (light mode throughout) |
| React Router v6 | Routing + route-level access control |
| @monaco-editor/react | In-session code editor (8 languages, custom templates) |
| @mediapipe/face_mesh | Gaze tracking (runs in web worker, WASM) |
| WebCodecs API | I-frame detection and capture for PRNU |
| WebRTC native browser APIs | Peer-to-peer video |
| Lucide React | Icons |

### Backend
| Technology | Purpose |
|-----------|---------|
| FastAPI + uvicorn | Async API server (Python 3.11) |
| WebSockets (FastAPI) | Pure P2P WebRTC signaling relay |
| PyWavelets | PRNU Daubechies-8 wavelet decomposition |
| OpenCV | Frame decoding and processing |
| scipy + numpy | rPPG signal processing, jitter statistics |
| mediapipe | Server-side fallback facial landmark detection |
| Scapy | Passive RTP packet sniffing for jitter analysis |
| python-jose | JWT token creation and validation |
| motor | Async MongoDB driver |
| redis-py (async) | Trust score pub/sub pipeline (275ms cycle) |
| WeasyPrint | Server-side forensic PDF export |

### Infrastructure
| Technology | Purpose |
|-----------|---------|
| MongoDB Atlas | Sessions, telemetry, alerts, behavioral events |
| Redis | WebSocket pub/sub for real-time trust score streaming |
| GridFS | Binary storage for PRNU reference fingerprint K̂ |
| Docker Compose | Local development stack |
| Railway / Render | Production deployment |

---

## Project Structure

```
deepverify/
│
├── frontend/                          # React + Vite + TypeScript
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Landing.tsx            # Marketing landing page (/ route)
│   │   │   ├── CreateSession.tsx      # Recruiter session form (/create)
│   │   │   ├── SystemCheck.tsx        # 7-step candidate wizard (/check/:token)
│   │   │   ├── CandidateSession.tsx   # Live interview room (/session/:token)
│   │   │   ├── InterviewerDash.tsx    # Forensic dashboard (/dashboard/:sessionId)
│   │   │   ├── WaitingRoom.tsx        # Shown to interviewer while session pending
│   │   │   └── NotFound.tsx           # 404 + expired session screen
│   │   │
│   │   ├── components/
│   │   │   ├── TrustGauge.tsx         # SVG ring gauge (animated)
│   │   │   ├── ModuleBreakdown.tsx    # 4 module bars with badges
│   │   │   ├── AlertFeed.tsx          # Real-time alert list (empty on mount)
│   │   │   ├── Sparkline.tsx          # Score history bar chart
│   │   │   ├── WizardProgress.tsx     # 7-dot step indicator
│   │   │   ├── CheckItem.tsx          # Individual wizard check row
│   │   │   ├── VideoRoom.tsx          # WebRTC video + toolbar + PiP
│   │   │   ├── TelemetryStrip.tsx     # Live 4-metric bottom panel
│   │   │   └── Nav.tsx                # Sticky nav (Home + Create session only)
│   │   │
│   │   ├── hooks/
│   │   │   ├── useWebRTC.ts           # RTCPeerConnection setup + offer/answer/ICE
│   │   │   ├── useTrustScore.ts       # WebSocket consumer for dashboard
│   │   │   ├── useBehavioralHooks.ts  # DOM hooks (blur, paste, visibilitychange)
│   │   │   ├── useSessionGate.ts      # Route-level access control (checks JWT + DB)
│   │   │   └── useTimer.ts            # Session elapsed time HH:MM:SS
│   │   │
│   │   ├── workers/
│   │   │   ├── mediapipe.worker.ts    # FaceMesh gaze + iris tracking (off main thread)
│   │   │   └── frameCapture.worker.ts # WebCodecs I-frame detection + POST
│   │   │
│   │   ├── utils/
│   │   │   ├── deviceCheck.ts         # Virtual camera detection (OBS/ManyCam/etc)
│   │   │   ├── jwt.ts                 # Token decode (client-side, no secret)
│   │   │   └── api.ts                 # Typed fetch wrapper for all endpoints
│   │   │
│   │   ├── types/
│   │   │   └── index.ts               # Session, Alert, TrustScore, TelemetryEvent types
│   │   │
│   │   └── App.tsx                    # Router setup with route guards
│   │
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   └── package.json
│
├── backend/                           # FastAPI Python 3.11
│   ├── main.py                        # App entrypoint, CORS, router registration
│   │
│   ├── api/
│   │   └── routes/
│   │       ├── sessions.py            # POST /api/sessions, GET, PATCH
│   │       ├── enrollment.py          # /enroll/prnu, /enroll/rppg, /enroll/gaze
│   │       ├── frames.py              # POST /api/frames/:sessionId (live analysis)
│   │       ├── websocket.py           # /ws/candidate/:id, /ws/dashboard/:id
│   │       ├── signaling.py           # P2P WebRTC relay (/ws/signaling/:sessionId)
│   │       ├── consent.py             # POST /api/sessions/:id/consent
│   │       └── export.py              # GET /api/sessions/:id/report (PDF)
│   │
│   ├── modules/
│   │   ├── prnu.py                    # extract_noise_residual, estimate_prnu_reference, compute_pce
│   │   ├── rppg.py                    # compute_pos_signal, detect_liveness
│   │   ├── jitter.py                  # JitterAnalyzer (Scapy + RFC 3550)
│   │   ├── behavioral.py              # compute_behavioral_score
│   │   └── axiom.py                   # axiom_fusion_engine (T ∈ [0,100])
│   │
│   ├── models/
│   │   └── schemas.py                 # Pydantic models for all request/response bodies
│   │
│   ├── db/
│   │   ├── mongo.py                   # Motor async client + GridFS setup
│   │   └── redis.py                   # Redis async client + pub/sub helpers
│   │
│   ├── auth/
│   │   └── jwt.py                     # Token creation (candidate + interviewer roles)
│   │
│   └── requirements.txt
│
├── docker-compose.yml                 # FastAPI + MongoDB + Redis
├── .env.example                       # Environment variable template
└── README.md                          # This file
```

---

## Getting Started

### Prerequisites

- Node.js ≥ 18
- Python 3.11
- Docker + Docker Compose
- Git

### 1. Clone the repository

```bash
git clone https://github.com/Naren-bit/deepverify.git
cd deepverify
```

### 2. Set up environment variables

```bash
cp .env.example .env
# Edit .env with your values (see Environment Variables section below)
```

### 3. Start infrastructure (MongoDB + Redis)

```bash
docker-compose up -d mongodb redis
```

### 4. Start the backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The FastAPI server will be available at `http://localhost:8000`.
API docs (Swagger): `http://localhost:8000/docs`

### 5. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

The React app will be available at `http://localhost:5173`.

### Full stack with Docker Compose

```bash
docker-compose up --build
```

All three services (FastAPI, MongoDB, Redis) start together. The frontend dev server runs separately via `npm run dev` (hot reload is not supported inside Docker for development).

---

## Environment Variables

Create a `.env` file in the root directory:

```env
# ── Backend ────────────────────────────────────────────────
MONGODB_URL=mongodb://localhost:27017/deepverify
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-256-bit-secret-key-here
JWT_ALGORITHM=HS256
JWT_EXPIRY_HOURS=24
CORS_ORIGINS=http://localhost:5173,https://app.deepverify.io

# ── PRNU ───────────────────────────────────────────────────
PRNU_PCE_THRESHOLD=60          # τ — PCE decision threshold (Lukas et al.)
PRNU_ENROLLMENT_FRAMES=90      # Number of I-frames for enrollment

# ── rPPG ───────────────────────────────────────────────────
RPPG_MIN_FRAMES=150            # Minimum frames before liveness decision (5s at 30fps)
RPPG_BASELINE_DURATION_S=60    # Enrollment baseline duration in seconds
# Note: SNR threshold β is per-candidate from enrollment — not set here

# ── Jitter ─────────────────────────────────────────────────
JITTER_GAMMA_FIBER=0.15        # CV threshold for fiber connections
JITTER_GAMMA_WIFI=0.15         # CV threshold for WiFi
JITTER_GAMMA_CELLULAR=0.20     # CV threshold for cellular/4G

# ── Frontend ───────────────────────────────────────────────
VITE_API_BASE_URL=http://localhost:8000
VITE_WS_BASE_URL=ws://localhost:8000

# ── Email (optional — for candidate invite sending) ─────────
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

---

## API Reference

### Sessions

| Method | Endpoint | Auth | Description |
|--------|---------|------|-------------|
| `POST` | `/api/sessions` | None | Create session, returns candidate + dashboard URLs |
| `GET` | `/api/sessions/:id` | JWT | Get session details and current status |
| `PATCH` | `/api/sessions/:id` | JWT | Update status, checkCompleted flag |
| `GET` | `/api/sessions/:id/status` | None | Lightweight status poll (for waiting room) |

### Enrollment

| Method | Endpoint | Auth | Description |
|--------|---------|------|-------------|
| `POST` | `/api/sessions/:id/network` | Candidate JWT | Store connection type, set γ threshold |
| `POST` | `/api/sessions/:id/enroll/prnu` | Candidate JWT | 90 JPEG frames → compute K̂, store in GridFS |
| `POST` | `/api/sessions/:id/enroll/rppg` | Candidate JWT | RGB timeseries → compute SNR baseline β |
| `POST` | `/api/sessions/:id/enroll/gaze` | Candidate JWT | Gaze calibration data → compute λ |
| `POST` | `/api/sessions/:id/consent` | Candidate JWT | Log typed consent with timestamp |

### Live Analysis

| Method | Endpoint | Auth | Description |
|--------|---------|------|-------------|
| `POST` | `/api/frames/:sessionId` | Candidate JWT | Submit I-frame JPEG → runs PRNU check, contributes to rPPG |
| `POST` | `/api/sessions/:id/start-jitter` | Candidate JWT | Start Scapy AsyncSniffer for this session |

### WebRTC

| Method | Endpoint | Auth | Description |
|--------|---------|------|-------------|
| `WS` | `/ws/signaling/:sessionId?role=` | URL Query | Real-time P2P WebRTC signaling (offer/answer/ice) |

### Export

| Method | Endpoint | Auth | Description |
|--------|---------|------|-------------|
| `GET` | `/api/sessions/:id/report` | Interviewer JWT | Download forensic PDF report |

### WebSockets

| URL | Auth | Direction | Description |
|-----|------|-----------|-------------|
| `ws://host/ws/candidate/:sessionId` | Candidate JWT | Client → Server | Gaze events, behavioral events |
| `ws://host/ws/dashboard/:sessionId` | Interviewer JWT | Server → Client | Trust score updates, alerts |
| `ws://host/ws/signaling/:sessionId` | URL Query | Bi-directional | P2P WebRTC offer/answer/ice relay |

---

## WebSocket Protocol

### Candidate → Backend (`/ws/candidate/:sessionId`)

```jsonc
// Gaze data — sent every 500ms from MediaPipe worker
{
  "type": "GAZE",
  "gaze_x": 0.52,
  "gaze_y": 0.48,
  "delta": 0.08,
  "yaw": 3.2,
  "pitch": -1.1,
  "roll": 0.4,
  "timestamp": 1720000000000
}

// Behavioral events — sent on occurrence
{ "type": "TAB_SWITCH", "timestamp": 1720000000000 }
{ "type": "WINDOW_BLUR", "duration_ms": 3200, "timestamp": 1720000000000 }
{ "type": "LARGE_PASTE", "char_count": 847, "timestamp": 1720000000000 }
```

### Backend → Interviewer Dashboard (`/ws/dashboard/:sessionId`)

```jsonc
// Trust score update — every 275ms
{
  "type": "TRUST_UPDATE",
  "trust_score": 87.4,
  "breakdown": {
    "prnu": 28.1,
    "rppg": 27.9,
    "jitter": 14.2,
    "behavioral": 17.2
  },
  "raw": {
    "pce": 84.2,
    "snr_rppg": 7.2,
    "cv_jitter": 0.06,
    "behavioral_score": 0.72,
    "hr_bpm": 73
  },
  "timestamp": 1720000000000
}

// Alert — fired when Axiom Engine threshold is breached
{
  "type": "ALERT",
  "alertId": "a-001",
  "alertType": "GAZE_ANOMALY",  // IDENTITY_FRAUD | LIVENESS_FAIL | DEEPFAKE_RENDERING | ASSISTANCE_FRAUD | GAZE_ANOMALY | TAB_SWITCH | LARGE_PASTE
  "module": "BEHAVIORAL",
  "severity": "MEDIUM",          // CRITICAL | HIGH | MEDIUM | LOW
  "description": "Sustained off-screen gaze detected",
  "value": 0.41,
  "timestamp": 1720000000000
}

// Session status change
{ "type": "STATUS_CHANGE", "status": "COMPLETED", "timestamp": 1720000000000 }
```

---

## Database Schema

### `sessions` collection

```javascript
{
  _id: "DV-2025-XXXX",
  candidateName: String,
  candidateEmail: String,
  interviewerName: String,
  role: String,
  duration: String,            // "60 minutes"
  interviewType: String,       // "Technical coding"
  modules: {
    prnu: Boolean,
    rppg: Boolean,
    jitter: Boolean,
    behavioral: Boolean        // always true, cannot be disabled
  },
  status: String,              // PENDING | CHECKING | ACTIVE | COMPLETED | FLAGGED
  checkCompleted: Boolean,     // route guard for /session/:token
  createdAt: ISODate,
  tokenExpiry: ISODate,        // +24h from creation
  consentTimestamp: ISODate,
  consentText: "I CONSENT",
  enrollment: {
    prnu_reference_id: ObjectId,  // GridFS binary (K̂)
    snr_baseline: Number,          // per-candidate β — calibrated to skin tone
    baseline_hr: Number,
    gaze_baseline: {
      lambda_gaze: Number,         // per-candidate λ
      natural_yaw_range: Number    // degrees
    },
    connection_type: String,       // fiber | wifi | cellular
    enrolledAt: ISODate
  },
  thresholds: {
    pce_tau: 60,
    snr_beta: Number,             // from enrollment.snr_baseline
    jitter_gamma: Number,         // from connection_type mapping
    behavioral_lambda: Number     // from gaze_baseline.lambda_gaze
  }
}
```

### `telemetry` collection (time-series, high-frequency)

```javascript
{
  session_id: String,
  timestamp: ISODate,
  trust_score: Number,
  breakdown: { prnu: Number, rppg: Number, jitter: Number, behavioral: Number },
  raw: { pce: Number, snr_rppg: Number, cv_jitter: Number, behavioral_score: Number, hr_bpm: Number }
}
```

### `alerts` collection

```javascript
{
  session_id: String,
  alertId: String,
  type: String,            // IDENTITY_FRAUD | LIVENESS_FAIL | DEEPFAKE_RENDERING | ASSISTANCE_FRAUD | GAZE_ANOMALY | TAB_SWITCH | LARGE_PASTE
  module: String,          // PRNU | rPPG | JITTER | BEHAVIORAL
  severity: String,        // CRITICAL | HIGH | MEDIUM | LOW
  description: String,
  value: Number,
  timestamp: ISODate,
  acknowledged: Boolean
}
```

### `behavioral_events` collection

```javascript
{
  session_id: String,
  type: String,            // TAB_SWITCH | WINDOW_BLUR | LARGE_PASTE | GAZE_ANOMALY
  timestamp: ISODate,
  metadata: Object         // { charCount: Number } for LARGE_PASTE, { duration_ms } for WINDOW_BLUR
}
```

---

## Sequential Gate Logic

Every route enforces access control at the server side. Bypassing the UI does not bypass the gates.

```
Route: /                    → Always accessible (public marketing page)
Route: /create              → Always accessible (recruiter form)

Route: /check/:token
  1. Decode JWT from :token
  2. If invalid signature → /404 "This session link is invalid"
  3. If expired → /404 "This session link has expired"
  4. If session.checkCompleted === true → redirect to /session/:token
  5. If session.status === COMPLETED → "This session has already ended"
  6. Otherwise → render wizard

Route: /session/:token
  1. Decode JWT → extract sessionId, verify role === 'candidate'
  2. GET /api/sessions/:sessionId
  3. If session.checkCompleted !== true → redirect to /check/:token
  4. If session.status === COMPLETED → show "Session ended" screen
  5. Otherwise → render interview room

Route: /dashboard/:sessionId
  1. Validate sessionId format
  2. GET /api/sessions/:sessionId
  3. If not found → /404
  4. If status === PENDING or CHECKING → render WaitingRoom (polls every 5s)
  5. If status === ACTIVE → render dashboard + connect WebSocket
  6. If status === COMPLETED → render read-only session summary
```

---

## Security Model

**JWT token scoping:**
- Each session generates two separate JWTs: one with `role: 'candidate'` (embedded in the /check URL), one with `role: 'interviewer'` (used for the dashboard)
- Candidate JWT has 24h expiry. Once enrollment begins, the token becomes single-device via a device fingerprint stored in the session document
- All sensitive API endpoints verify the JWT role before processing

**Consent and data privacy:**
- Candidates must type "I CONSENT" exactly before any biometric processing begins
- The consent timestamp is logged immutably in MongoDB
- Session data is flagged for automatic deletion on `status: COMPLETED`
- No biometric data (PRNU K̂, rPPG timeseries, gaze coordinates) is retained beyond the active session
- The PRNU fingerprint K̂ is specific to a single session — it has no value outside that context

**Virtual camera detection:**
- Candidate device labels are scanned against 13 known virtual camera signatures at enrollment
- If detected: enrollment is hard-blocked, session cannot proceed
- Frameate anomaly check as secondary signal (virtual cams often report 0fps or >120fps)

**Zero-trust property:**
- Even a candidate with perfect behavioral scores (no gaze deviation, no tab switches) gets T < 60 if PRNU and rPPG both fail
- Behavioral compliance cannot compensate for hardware-level identity fraud

---

## Known Limitations & Scope Boundaries

| Limitation | Details | Mitigation |
|-----------|---------|-----------|
| Capture-card relay attack | A deepfake rendered on a separate GPU box and routed via HDMI capture card bypasses both jitter (different machine) and PRNU (new physical device) | rPPG still detects — a rendered face has no heartbeat regardless of routing |
| rPPG in very low light | Green channel signal-to-noise ratio drops significantly in dark environments | System check provides lighting guidance; low-light sessions are flagged as low-confidence rather than hard-failed |
| High-quality rPPG spoofing | Adversarial pixel perturbation could theoretically inject a pulse signal | PRNU check independently validates hardware origin; combined failure probability is very low |
| Jitter on high-end GPUs | As GPU rendering speeds increase, CV of deepfake streams will narrow toward genuine range | Adaptive weight shifting (Phase 3) will reduce jitter's weight when it becomes unreliable |
| Behavioral mimicry by AI agents | A sufficiently advanced AI co-pilot could learn to mimic natural gaze patterns | PRNU + rPPG identity layer (60% weight) operates independently of behavioral signals |
| Mobile devices | Not currently supported — WebCodecs I-frame capture and MediaPipe performance require desktop browsers | Roadmap item: native mobile app with on-device processing |

---

## Research & Academic Context

DeepVerify is the implementation of research published and accepted at the **IEEE International Conference on Signal, Speech and Audio Processing Systems (ICOSAAS) 2026**.

**Paper:** *DeepVerify: A Zero-Trust Multi-Modal Framework for Interview Integrity Verification*

**Authors:**
- Akilan C (CB.SC.U4CSE23607)
- Naren Moorthy S (CB.SC.U4CSE23637)
- Regella Krishna Saketh (CB.SC.U4CSE23649)
- Vijay Aditya R V (CB.SC.U4CSE23657)

**Guide:** Dr. T Senthilkumar, Professor, Department of Computer Science & Engineering, Amrita Vishwa Vidyapeetham, Coimbatore

**Key references from the paper:**

| Module | Primary Reference |
|--------|------------------|
| PRNU | Lukáš, Fridrich & Goljan — *Digital Image Forensics Based on Sensor Pattern Noise*, IEEE Trans. Inf. Forensics Security, 2006 |
| rPPG | de Haan & Jeanne — *Robust Pulse Rate from Chrominance-Based rPPG*, IEEE TBME, 2013 |
| Jitter | RFC 3550 — *RTP: A Transport Protocol for Real-Time Applications*, IETF, 2003 |
| rPPG baseline | Verkruysse, Svaasand & Nelson — *Remote plethysmographic imaging using ambient light*, 2008 |
| Deepfake context | Verdoliva — *Media Forensics and Deepfakes: An Overview*, IEEE J. Sel. Topics Signal Process., 2020 |

**Test datasets (used for threshold validation only — no model training):**
- FaceForensics++ (Rössler et al., 2019) — PRNU threshold τ validation
- DFDC (Facebook AI, 2020) — rPPG SNR absence validation
- Celeb-DF v2 (Li et al., 2020) — cross-dataset generalization
- DeepFake-Eval-2024 — current-generation model robustness

---

## Team

| Member | Registration | Primary Module | GitHub |
|--------|-------------|---------------|--------|
| Akilan C | CB.SC.U4CSE23607 | PRNU module + Axiom Fusion Engine | — |
| Naren Moorthy S | CB.SC.U4CSE23637 | rPPG module + Frontend portal | [@Naren-bit](https://github.com/Naren-bit) |
| Regella Krishna Saketh | CB.SC.U4CSE23649 | Jitter module + Interviewer dashboard | — |
| Vijay Aditya R V | CB.SC.U4CSE23657 | Behavioral module + WebRTC P2P | — |

**Guide:** Dr. T Senthilkumar, Professor, Dept. of CSE, Amrita Vishwa Vidyapeetham

---

## License

MIT License — see [LICENSE](LICENSE) for details.

The research paper content is copyright the authors. Citation required for academic use.

---

<div align="center">

**DeepVerify** · Amrita Vishwa Vidyapeetham · IEEE ICOSAAS 2026

*"Trust the person, verify the physics."*

</div>
