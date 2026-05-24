# AI Radio Network — Master Architecture Guide

> **Version:** 1.0 | **Last Updated:** Sprint 0  
> **Project:** Autonomous AI radio station for local streaming to YouTube  
> **Developer:** Solo / Local machine  

---

## 1. Project Vision

An autonomous desktop application that runs a fully self-managed radio station capable of:

- Generating a fresh daily schedule based on selected content categories
- Fetching real headlines and data from the web
- Writing scripts using a local AI model
- Speaking those scripts aloud using a local text-to-speech engine
- Playing background music underneath the voice
- Switching scenes in Streamlabs OBS automatically
- Streaming live to YouTube
- Reading and responding to YouTube chat messages in character
- Logging analytics and performance per session
- Running for 8+ hours unattended

---

## 2. Hardware & Environment

| Component | Spec | Notes |
|---|---|---|
| OS | Windows 11 | All tooling targets Windows |
| CPU | AMD Ryzen 5 5500 (6 core) | Handles orchestration, FFmpeg, Node.js |
| RAM | 16GB | Sufficient for Electron + Ollama CPU inference |
| GPU | AMD Radeon RX 6400 (4GB VRAM) | Too small for large LLMs; we run AI on CPU |
| Storage | Local SSD | Audio output files, SQLite DB, logs |

---

## 3. Technology Stack

| Layer | Technology | Why |
|---|---|---|
| Desktop UI | Electron + React + TypeScript | Cross-platform shell, web-based UI |
| Backend Logic | Node.js | Event-driven, great for orchestration |
| Database | SQLite via better-sqlite3 | Lightweight, local, no server needed |
| LLM | Ollama + Phi-3 Mini 4K | Free, runs locally, good at structured writing |
| Text-to-Speech | Kokoro TTS (Python/ONNX) | Free, local, natural sounding, CPU capable |
| Audio Mixing | FFmpeg | Industry standard, powerful CLI audio tool |
| Streaming | Streamlabs OBS + WebSocket | User already has it; WebSocket enables automation |
| Chat | YouTube Data API | Read and respond to live chat |
| Music | Pre-downloaded royalty-free tracks | No copyright strikes; sourced from Free Music Archive |
| Packaging | electron-builder | Produces Windows .exe for distribution |
| Version Control | Git + GitHub | Source control and public portfolio |

---

## 4. Full System Architecture

```
┌─────────────────────────────────────────────┐
│         Desktop Application                  │
│         Electron + React + TypeScript        │
│  - Control dashboard                         │
│  - Configuration UI                          │
│  - Analytics display                         │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│              Orchestrator                    │
│              Node.js EventEmitter            │
│  - Owns the stream state machine             │
│  - Coordinates all modules via events        │
│  - Controls stream lifecycle                 │
└──────┬──────────────┬───────────────┬───────┘
       │              │               │
       ▼              ▼               ▼
┌────────────┐ ┌─────────────┐ ┌───────────────┐
│ Scheduler  │ │ AI Content  │ │ Data Fetchers  │
│ Engine     │ │ Generator   │ │ News / Finance │
│            │ │ Ollama      │ │ Gaming / Tech  │
└─────┬──────┘ └──────┬──────┘ └───────┬───────┘
      │               │                │
      └───────────────┴────────────────┘
                      │
                      ▼
             ┌─────────────────┐
             │  Voice Engine   │
             │  Kokoro TTS     │
             │  .wav output    │
             └────────┬────────┘
                      │
                      ▼
             ┌─────────────────┐
             │  Audio Mixer    │
             │  FFmpeg         │
             │  Voice + Music  │
             └────────┬────────┘
                      │
                      ▼
             ┌─────────────────┐
             │  OBS Controller │
             │  WebSocket      │
             │  Scene control  │
             └────────┬────────┘
                      │
                      ▼
             ┌─────────────────┐
             │ Streaming Mgr   │
             │ Start/Stop/Mon  │
             │ YouTube RTMP    │
             └─────────────────┘
                      ▲
                      │
             ┌─────────────────┐
             │  Chat Engine    │
             │  YouTube API    │
             │  Host character │
             └─────────────────┘
```

---

## 5. Orchestrator State Machine

The Orchestrator is the brain of the entire system. It manages state and wires all modules together using Node.js's built-in `EventEmitter`.

```
States:
  IDLE ──► GENERATING ──► VOICE_RENDERING ──► MIXING ──► BROADCASTING
                                                               │
                                                    CHAT_LISTENING (parallel)
                                                               │
                                                          next segment
                                                               │
                                                        back to GENERATING
```

**Event flow example for one segment:**
```
scheduler.emit('segment:ready', segmentData)
  → orchestrator triggers contentGenerator
contentGenerator.emit('script:ready', scriptText)
  → orchestrator triggers voiceEngine
voiceEngine.emit('audio:ready', filePath)
  → orchestrator triggers audioMixer
audioMixer.emit('mix:ready', mixedFilePath)
  → orchestrator triggers obsController
obsController.emit('scene:switched')
  → orchestrator triggers streamingManager
  → segment airs
  → loop back to next segment
```

---

## 6. SQLite Database Schema

**Location:** `%APPDATA%/ai-radio-desktop/radio.db`  
**Mode:** WAL (Write-Ahead Logging) for performance  
**Foreign keys:** Enabled  

```sql
-- Daily programming schedule
CREATE TABLE schedule (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  date             TEXT NOT NULL,
  segment_order    INTEGER NOT NULL,
  category         TEXT NOT NULL,   -- 'finance'|'tech'|'gaming'|'news'
  topic            TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending'
                                    -- 'pending'|'active'|'completed'
);

-- Generated scripts and their audio output
CREATE TABLE segments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id      INTEGER REFERENCES schedule(id),
  script           TEXT,
  audio_file_path  TEXT,
  generated_at     TEXT,
  aired_at         TEXT
);

-- Every chat message received and response sent
CREATE TABLE chat_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  platform         TEXT NOT NULL,   -- 'youtube'
  username         TEXT NOT NULL,
  message          TEXT NOT NULL,
  response         TEXT,
  responded_at     TEXT
);

-- One row per stream session
CREATE TABLE stream_sessions (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at            TEXT NOT NULL,
  ended_at              TEXT,
  platform              TEXT NOT NULL,
  peak_viewers          INTEGER DEFAULT 0,
  total_chat_messages   INTEGER DEFAULT 0,
  segments_aired        INTEGER DEFAULT 0
);

-- Per-segment performance metrics
CREATE TABLE segment_analytics (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  segment_id          INTEGER REFERENCES segments(id),
  session_id          INTEGER REFERENCES stream_sessions(id),
  viewer_count_avg    INTEGER DEFAULT 0,
  chat_activity_count INTEGER DEFAULT 0
);
```

---

## 7. Repository Structure

```
airadio/
├── apps/
│   └── desktop/
│       ├── src/
│       │   ├── main/           ← Electron main process (Node.js)
│       │   │   ├── main.ts
│       │   │   ├── preload.ts
│       │   │   └── database.ts
│       │   ├── renderer/       ← React UI
│       │   │   ├── main.tsx
│       │   │   └── App.tsx
│       │   └── styles/
│       │       └── global.css
│       ├── index.html
│       ├── vite.config.ts
│       ├── tsconfig.json
│       ├── tsconfig.main.json
│       └── package.json
├── packages/
│   ├── scheduler/              ← Sprint 1
│   ├── data-fetchers/          ← Sprint 2
│   ├── content-generator/      ← Sprint 3
│   ├── voice-engine/           ← Sprint 4
│   ├── audio-mixer/            ← Sprint 5
│   ├── obs-controller/         ← Sprint 6
│   ├── streaming-manager/      ← Sprint 7
│   ├── chat-engine/            ← Sprint 8
│   ├── analytics/              ← Sprint 9
│   └── shared/                 ← Shared types and utilities
├── data/
│   ├── music/                  ← Pre-downloaded royalty-free tracks
│   ├── audio-output/           ← Generated TTS and mixed audio
│   └── logs/                   ← Runtime logs
├── docs/
│   └── sprints/                ← Study guides (this folder)
├── scripts/                    ← Build and utility scripts
├── .gitignore
└── package.json                ← Root workspace config
```

---

## 8. AI Host Character

The radio host persona is defined once as a system prompt and applied to every LLM call and chat response. This keeps the voice consistent across all 8+ hours of content.

**Character brief:**
- Name: TBD (define in Sprint 3)
- Personality: Knowledgeable, engaging, slightly witty
- Style: Conversational radio host, not robotic
- Scope: Finance, tech, gaming, world news, niche topics
- Chat behavior: Responds in character, answers factually but with personality

---

## 9. Key Technical Decisions & Rationale

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| LLM provider | Ollama (local) | OpenAI API | Cost — OpenAI charges per token; 8hr streams would add up |
| LLM model | Phi-3 Mini 4K | Larger models | Only model that fits in 16GB RAM on this hardware |
| TTS | Kokoro TTS | ElevenLabs, OpenAI TTS | Both cost money per character; Kokoro is free and local |
| Database | SQLite | PostgreSQL, MySQL | No server needed; local app; more than sufficient |
| OBS | Streamlabs OBS | OBS Studio | User already has it; same WebSocket protocol |
| Audio | FFmpeg | Commercial mixers | Free, powerful, scriptable from Node.js |
| Music | Pre-downloaded royalty-free | Streaming services | Copyright strikes would kill the stream |

---

## 10. Sprint Roadmap

| Sprint | Module | Goal |
|---|---|---|
| **0** ✅ | Foundation | Electron+React shell, SQLite schema, folder structure |
| **1** | Scheduler | Category picker, dynamic 8-hour schedule generation |
| **2** | Data Fetchers | News headlines, finance data, gaming updates |
| **3** | Content Generator | Ollama + Phi-3 Mini, host character, script writing |
| **4** | Voice Engine | Kokoro TTS, audio file output per segment |
| **5** | Audio Mixer | FFmpeg voice + music blending |
| **6** | OBS Controller | Streamlabs WebSocket, scene switching |
| **7** | Streaming Manager | YouTube RTMP, start/stop, monitoring |
| **8** | Chat Engine | YouTube chat read + host character replies |
| **9** | Analytics | Metrics dashboard in Electron UI |
| **10** | Integration + Packaging | Full end-to-end run, electron-builder .exe |
