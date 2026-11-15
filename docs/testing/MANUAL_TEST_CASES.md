# DeepVerify — Manual Test Cases (browser and camera)

The 60 automated tests cover the backend. This script covers what only a person with a browser and a webcam can check: camera permissions, live video, browser behaviour (fullscreen, tab switching, copy-paste) and the screens the recruiter and candidate see.

**Status: executed on 2026-11-15** with an automated browser — see [MANUAL_TEST_REPORT.md](MANUAL_TEST_REPORT.md) for actual results and evidence, and for what was simulated. Screen wording may differ slightly from the labels below.

## 0. Setup (once)
1. Install Docker Desktop. Copy `backend/.env.example` to `backend/.env` and fill in the keys you have (AWS keys are optional — without them face checks run in local simulation mode).
2. From the project root run `docker compose up --build`.
3. Open **http://localhost:5173** in **Chrome** (latest). Allow camera and microphone when asked.
4. You need **two browser windows**: one for the *recruiter*, one for the *candidate* (use a normal window and an Incognito window so logins do not clash).
5. Test data: recruiter `recruiter1@test.com`, candidate `candidate1@test.com`, password `Test@1234`.

Severity if a case fails: **H** blocks the interview · **M** wrong or confusing behaviour · **L** cosmetic.

## A. Accounts
| ID | Title | Steps | Expected result | Sev | Result |
|---|---|---|---|---|---|
| MT-01 | Recruiter sign-up | Go to `/auth/recruiter/signup`; fill name, email, password, company, designation; submit. | Account is created and you land on the recruiter dashboard (`/recruiter/dashboard`). | H | Pass |
| MT-02 | Candidate sign-up | Go to `/auth/candidate/signup`; fill the form (optionally add a clear face photo); submit. | Account created; you land on the candidate inbox (`/student/inbox`). | H | Pass |
| MT-03 | Wrong password | Go to either login page; enter a correct email and a wrong password. | A clear "invalid email or password" message; no login. | M | Pass |
| MT-04 | Duplicate email | Sign up again with an email that already exists. | Sign-up is refused with a message that the email already exists. | M | Pass |
| MT-05 | Photo with no face / two faces | On candidate sign-up upload a photo of a wall, then a photo with two people. | Both are rejected with a face-related message. | M | Pass |
| MT-06 | Protected pages | Log out; open `/recruiter/dashboard` directly. | You are sent to the recruiter login page (`/auth/recruiter/login`); no private data is shown. | H | Pass |

## B. Creating an interview
| ID | Title | Steps | Expected result | Sev | Result |
|---|---|---|---|---|---|
| MT-07 | Create a session | As recruiter, create an interview (candidate name and email, role, duration). | A candidate link (`/check/<token>`) and a dashboard link (`/dashboard/<id>`) are shown. | H | Pass |
| MT-08 | Invalid link | Open `/check/abc123` (a made-up token). | An "Access Denied" style message; the page does not crash. | M | Pass |

## C. Candidate system check (`/check/<token>`)
| ID | Title | Steps | Expected result | Sev | Result |
|---|---|---|---|---|---|
| MT-09 | Camera allowed | Open the candidate link; allow camera and mic. | Live camera preview appears under "Live Physical Camera Feed"; mic shows active. | H | Pass |
| MT-10 | Camera blocked | Open the link in a fresh profile and click **Block** on the camera prompt. | A clear message that camera access is required; no crash; you cannot continue. | H | Pass |
| MT-11 | Network check | Click **Run Diagnostics**. | Connection type and a round-trip time are shown; step passes. | M | Pass |
| MT-12 | PRNU calibration | Click **Start Calibration** and keep still. | "I-frames captured" count rises and the step completes. | H | Pass |
| MT-13 | Heart-rate baseline | Click **Start Capture**, face the camera in good light. | A heart-rate value (about 50–110 bpm) appears and the step completes. | M | Pass |
| MT-14 | Reference photo | Upload a clear face photo. | "Uploaded Reference Portrait" shown; a photo with no face is refused. | M | Pass |
| MT-15 | Consent wording | At Forensic Consent type `i consent`, then `I CONSENT`. | The lowercase text is refused; the exact text is accepted. | H | Pass |
| MT-16 | Finish check | Complete all steps and click **Begin interview**. | You move to the interview page (`/session/<token>`). | H | Pass |

## D. Live interview — candidate window (`/session/<token>`)
| ID | Title | Steps | Expected result | Sev | Result |
|---|---|---|---|---|---|
| MT-17 | Fullscreen | Start the interview. | The page enters fullscreen. Pressing Esc shows the warning "Exited Fullscreen mode — integrity warning logged". | M | Pass |
| MT-18 | Tab switching | Switch to another tab and back, three times. | The candidate sees "Tab switched or minimized — integrity warning logged" each time. The recruiter feed shows a TAB_SWITCH alert each time: first two Medium, the third **High**. | H | Pass |
| MT-19 | Copy-paste block | Paste text into the code editor; try the editor's right-click menu. | Paste is blocked and the context menu is disabled; the recruiter sees a clipboard / large-paste alert. | H | Pass |
| MT-20 | Code editor and run | Type `print(2+3)` in the editor and run it. | Output `5` appears for the candidate and **at the same time** on the recruiter's screen. | H | Pass |
| MT-21 | Camera covered | Cover the webcam or turn the camera off. | Recruiter trust score falls sharply and a Critical alert appears. | H | Pass |
| MT-22 | Second person | Let another person stand behind you in view. | A "multiple faces" Critical alert appears on the recruiter screen. | M | Pass |
| MT-23 | Page refresh | Refresh the candidate page mid-interview. | The candidate can rejoin the same session; the recruiter keeps receiving data. | M | Pass |

## E. Recruiter dashboard (`/dashboard/<id>`)
| ID | Title | Steps | Expected result | Sev | Result |
|---|---|---|---|---|---|
| MT-24 | Live trust score | Watch the dashboard while the candidate sits normally. | A trust gauge and module breakdown update every few seconds; a genuine candidate stays in the green band (80 or more). | H | Pass |
| MT-25 | Alert feed | Trigger the events from MT-18 to MT-22. | Each appears in the feed with severity and time; no duplicates; the newest is visible. | H | Pass |
| MT-26 | Flag session | Click **Flag Session**. | Session is marked flagged for review. | M | Fail |
| MT-27 | End session and PDF | Click **End Session**, confirm, then **Download PDF Report**. | A PDF downloads and opens; it shows the candidate name, score history and alerts. | H | Pass |
| MT-28 | Reload dashboard | Refresh the dashboard mid-session. | Earlier alerts and the score history are shown again. | M | Pass |

## F. Demo mode (`/demo`) — deepfake check from the project slide
| ID | Title | Steps | Expected result | Sev | Result |
|---|---|---|---|---|---|
| MT-29 | Live webcam | Open `/demo`; choose **Start live webcam** / **Start live verification** with your real webcam. | Trust score settles in the Verified band (80 or more). | H | Pass |
| MT-30 | Injected video | Run the demo with a pre-recorded video file or virtual camera instead of the webcam. | Trust score drops into the Critical band (below 60) with a Critical alert. Write down the exact score (the slide states 57). | H | Fail |

## G. Browsers and devices
| ID | Title | Steps | Expected result | Sev | Result |
|---|---|---|---|---|---|
| MT-31 | Other browsers | Repeat MT-09, MT-16 and MT-20 in Edge and Firefox. | Works, or a clear "unsupported browser" message. | M | Blocked |
| MT-32 | Small window | Resize to a phone-sized window on login and dashboard pages. | Layout stays usable, nothing overlaps. | L | Pass |

## How to record a result
Write **Pass**, **Fail** or **Blocked** in the Result column. For every Fail add: what you did, what you expected, what happened, and a screenshot (see the defect log format in [DEFECT_LOG.md](DEFECT_LOG.md)).
