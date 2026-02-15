# MediHack Dashboard v0.8

A modern medical education platform with AI avatar generation, voice-powered discussions, and interactive assessments.

## 🌟 Features

### Avatar Generator
- ✅ **AI Avatar Videos** — Generate talking avatar videos with custom text, character & style
- ✅ **Multiple Characters** — Lisa, Harry, Max, Lori and more
- ✅ **Custom Backgrounds** — Photo library or paste any URL
- ✅ **Voice Selection** — Male/female neural voices
- ✅ **Cloudinary Storage** — Videos stored with custom filenames

### Video Library
- ✅ **Cloud Video Library** — Browse all generated avatar videos
- ✅ **Video Playback** — In-browser player with thumbnails
- ✅ **Delete Management** — Remove videos from Cloudinary

### Assessments
- ✅ **Assessment CRUD** — Create, edit, delete assessments
- ✅ **Multi-Video Support** — Attach multiple videos per assessment
- ✅ **Per-Video Questions** — Custom question for each video
- ✅ **Deadlines** — Set expiry dates, auto-block after deadline
- ✅ **Full Marks** — Configure total marks per assessment

### Answer Assessment
- ✅ **Interactive Chat** — Answer assessments via chat interface
- ✅ **Voice Recording** — Record voice answers (Thai STT transcription)
- ✅ **Text Messages** — Type text responses
- ✅ **Sequential Videos** — Watch and answer videos in order
- ✅ **Fullscreen Mode** — Immersive chat experience
- ✅ **Retest** — Clear all answers and start over

### Assessment Board (Admin)
- ✅ **Student Responses** — View all student answers per assessment
- ✅ **Inline Grading** — Edit marks directly in the table
- ✅ **Summary Statistics** — Responded, graded, full marks, average
- ✅ **Status Badges** — Track completion status per student

### Voice Live 🆕
- ✅ **AI Voice Chat** — Real-time voice conversations with AI (Google Gemini)
- ✅ **Azure Speech STT** — Continuous speech recognition
- ✅ **Azure Speech TTS** — AI responses spoken aloud (Jenny Neural voice)
- ✅ **Live Avatar** — Optional real-time talking avatar via WebRTC
- ✅ **Discussion Topics** — Set medical topics to focus the AI
- ✅ **Avatar Characters** — Choose character & style for live avatar

### Infrastructure
- ✅ **Authentication** — Session-based login with role management (admin/data-entry)
- ✅ **Cloudinary CDN** — Media storage for videos, voice recordings, images
- ✅ **Redis (Upstash)** — Fast data store for assessments, messages, marks, users
- ✅ **Azure Speech Service** — STT, TTS, and real-time avatar synthesis
- ✅ **Google Gemini** — AI conversation backend for Voice Live
- ✅ **Responsive Design** — Works on desktop and mobile

## 🚀 Quick Start

### 1. Prerequisites
- Node.js 18+ from https://nodejs.org
- Cloudinary account (free tier)
- Upstash Redis (free tier)
- Azure Speech Service key & region
- Google Gemini API key (free at https://aistudio.google.com/apikey)

### 2. Environment Setup
Copy `.env.example` to `.env` and fill in:
```bash
# Cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Server
PORT=4000
SESSION_SECRET=your-random-secret

# Redis
REDIS_URL=rediss://default:PASSWORD@HOST:6379

# Azure Speech (STT, TTS, Avatar)
AZURE_SPEECH_KEY=your_speech_key
AZURE_SPEECH_REGION=southeastasia
AZURE_AVATAR_ENDPOINT=https://southeastasia.api.cognitive.microsoft.com/

# Google Gemini (Voice Live AI)
GEMINI_API_KEY=your_gemini_key
GEMINI_MODEL=gemini-2.0-flash

# Optional
RESEND_API_KEY=your_resend_key
FROM_EMAIL=newsletter@yourdomain.com
```

### 3. Install & Run
```bash
npm install
npm start
```

### 4. Open Dashboard
http://localhost:4000/index.html

## 🔌 API Endpoints

### Avatar
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/avatar/voices` | List available voices |
| GET | `/api/avatar/models` | List avatar characters & styles |
| POST | `/api/avatar/generate` | Generate avatar video |
| GET | `/api/avatar/videos` | List generated videos |
| DELETE | `/api/avatar/videos/:publicId` | Delete a video |

### Assessments
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/assessments` | List all assessments |
| POST | `/api/assessments` | Create assessment |
| PUT | `/api/assessments/:id` | Update assessment |
| DELETE | `/api/assessments/:id` | Delete assessment |

### Assessment Recordings
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/assessment-recordings/upload` | Upload voice recording |
| POST | `/api/assessment-recordings/message` | Send text message |
| GET | `/api/assessment-recordings/:id` | Get messages for assessment |
| GET | `/api/assessment-recordings/status/all` | Get completion status |
| DELETE | `/api/assessment-recordings/:id` | Retest (clear all answers) |
| GET | `/api/assessment-recordings/:id/all-responses` | Admin: all student responses |
| POST | `/api/assessment-marks/:id` | Admin: save student marks |

### Voice Live
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/speech-token` | Get Azure Speech auth token |
| GET | `/api/ice-token` | Get WebRTC ICE credentials (avatar) |
| POST | `/api/voice-chat` | Send message to AI (Gemini) |

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/login` | User login |
| POST | `/auth/logout` | User logout |
| GET | `/auth/check` | Check session |

### System
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Server health check |

## 📂 Project Structure

```
dashboard/
├── server.js          # Express server (all API routes)
├── index.html         # Dashboard UI
├── index.js           # Frontend logic
├── index.css          # Styles
├── login.html         # Login page
├── login.js           # Login logic
├── login.css          # Login styles
├── package.json       # Dependencies
├── .env               # Environment variables (not in git)
├── .env.example       # Environment template
└── data/              # Local fallback storage
    ├── pdf/
    └── thumbnails/
```

## 🔒 Security
- Session-based authentication with role management
- Admin-only routes for grading and viewing all responses
- Azure Speech tokens issued server-side (keys never exposed to browser)
- File type validation and size limits on uploads
- CORS configuration
- Environment variables for all secrets

## 🐛 Troubleshooting

**Gemini 403/429 errors:**
- Enable the Generative Language API: visit the activation URL in the error
- Or get a fresh key from https://aistudio.google.com/apikey
- Quota resets daily for free tier

**Avatar not connecting:**
- Verify `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` in `.env`
- Check Azure Speech Service pricing tier supports avatar
- Ensure browser allows microphone access

**Port in use:**
```bash
lsof -ti:4000 | xargs kill -9
npm start
```

## 📄 License

MIT License

## 👥 Authors

**MediHack Team** — Medical education technology platform

---

**v0.8** — Voice Live with AI avatar, assessment grading board, interactive chat assessments
