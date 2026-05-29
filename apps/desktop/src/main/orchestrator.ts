import * as path  from 'path'
import * as fs    from 'fs'
import { EventEmitter } from 'events'


// Import all modules
import { generateSchedule }           from './scheduler'
import { fetchArticlesForTopic }       from './dataFetcher'
import { generateSubSegments }        from './contentGenerator'
import { generateAudio }              from './voiceEngine'
import { mixVoiceWithMusic,
         getRandomTrack,
        playVoiceOverMusic }             from './audioMixer'
import { switchScene, isOBSConnected,
        updateLowerThird,
         SCENES }                     from './OBSController'
import { connectChat, processChatWindow,
         isChatConnected }            from './chatEngine'
import { getDatabase, saveSchedule,
         saveSubSegments,
         saveArticles,
         updateSubSegmentAudio,
         updateSubSegmentMixedAudio,
         startStreamSession,
         endStreamSession }           from './database'
import { updateSessionSegmentCount }  from './analytics'
import { Category, ScheduleSegment,
         SubSegment }                 from '../shared/types'

import {
  generateInBackground,
  cancelWorker,
  GenerationResult,
} from './workerManager'        

// ── Types ──────────────────────────────────────────────────────────

export type OrchestratorState =
  | 'idle'
  | 'initializing'
  | 'generating'
  | 'live'
  | 'segment'
  | 'chat_window'
  | 'stopping'
  | 'error'

export interface OrchestratorStatus {
  state:           OrchestratorState
  currentSegment?: string
  currentTopic?:   string
  currentScript?:  string    // ← add this
  segmentIndex:    number
  totalSegments:   number
  sessionId?:      number
  error?:          string
}

export interface OrchestratorConfig {
  categories:          Category[]
  chatWindowInterval:  number   // respond to chat every N segments
  maxChatResponses:    number   // max responses per chat window
  voiceId:             string   // Kokoro voice
  targetHours:         number   // stream duration target
}
// ── Orchestrator pre-check ─────────────────────────────────────────────────────────

export interface PreflightResult {
  ready:    boolean
  checks:   { name: string; pass: boolean; message: string }[]
}


// ── State ─────────────────────────────────────────────────────────

const emitter       = new EventEmitter()
let state:          OrchestratorState = 'idle'
let running:        boolean           = false
let sessionId:      number | null     = null
let segmentsAired:  number            = 0
let stopRequested:  boolean           = false

// ── Status Emitter ────────────────────────────────────────────────

function emit(status: Partial<OrchestratorStatus>): void {
  emitter.emit('status', {
    state,
    segmentIndex:  segmentsAired,
    totalSegments: 0,
    ...status,
  })
}

export function onStatus(cb: (status: OrchestratorStatus) => void): void {
  emitter.on('status', cb)
}

export function offStatus(cb: (status: OrchestratorStatus) => void): void {
  emitter.off('status', cb)
}



// ── Helpers ───────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function log(msg: string): void {
  console.log(`[Orchestrator] ${msg}`)
}

async function playAudioFile(filePath: string): Promise<void> {
  return new Promise((resolve) => {
    const { spawn } = require('child_process')

    if (!fs.existsSync(filePath)) {
      log(`File not found: ${filePath}`)
      resolve()
      return
    }

    log(`Playing: ${path.basename(filePath)}`)

    const proc = spawn('ffplay', [
    '-nodisp',
    '-autoexit',
    '-volume', '100',
    filePath,
    ], {
    stdio: 'pipe',
    env: {
        ...process.env,
        SDL_AUDIODRIVER: 'directsound',
        AUDIODEV:        'CABLE Input (VB-Audio Virtual Cable)',
    }
    })

    let stderr = ''
    proc.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
    })

    proc.on('close', (code: number) => {
      if (code !== 0) {
        log(`ffplay stderr: ${stderr.slice(-500)}`)
      }
      resolve()
    })

    proc.on('error', (err: Error) => {
      log(`ffplay error: ${err.message}`)
      resolve()
    })
  })
}

async function generateSegmentContent(
  seg:    ScheduleSegment,
  config: OrchestratorConfig
): Promise<string[]> {
  if (!seg.id) return []

  // Check for pre-generated content in DB
  const db           = getDatabase()
  const existingSubs = db.prepare(
    'SELECT * FROM sub_segments WHERE schedule_id = ? ORDER BY article_index'
  ).all(seg.id) as any[]

  if (existingSubs.length > 0 && existingSubs[0].audio_file_path) {
    log(`Using DB pre-generated audio (${existingSubs.length} parts)`)
    return existingSubs
      .map((s: any) => s.audio_file_path)
      .filter((p: string) => p && fs.existsSync(p))
  }

  // Generate fresh
  log('Fetching articles...')
  const articles = await fetchArticlesForTopic(seg.topic, seg.category, 4)
  if (articles.length > 0) saveArticles(articles)

  log('Generating scripts...')
  const subs  = await generateSubSegments(seg.id, seg.category, seg.topic, articles)
  const saved = saveSubSegments(subs)

  log('Generating voice audio...')
  const voicePaths: string[] = []
  for (const sub of saved) {
    if (!sub.id || stopRequested) continue
    emit({
      state:          'segment',
      currentSegment: seg.category,
      currentTopic:   seg.topic,
      currentScript:  `${(sub as any).articleIndex + 1}/${saved.length}: ${sub.headline}`,
      segmentIndex:   segmentsAired + 1,
      totalSegments:  0,
    })
    const tts = await generateAudio(sub.script, sub.id, config.voiceId)
    if (tts.success && tts.audioPath) {
      updateSubSegmentAudio(sub.id, tts.audioPath, tts.durationSec ?? 0)
      voicePaths.push(tts.audioPath)
    }
  }

  return voicePaths
}

async function playSegment(
  voicePaths: string[],
  config:     OrchestratorConfig
): Promise<void> {
  if (voicePaths.length === 0) {
    log('No audio files to play, skipping')
    return
  }

  // Switch to On Air before playing
  if (isOBSConnected()) {
    let switched = false
    for (let attempt = 0; attempt < 3; attempt++) {
      switched = await switchScene(SCENES.ON_AIR)
      if (switched) { log('On Air'); break }
      await delay(2000)
    }
  }

  const track = getRandomTrack()
  if (!track) {
    for (const p of voicePaths) {
      if (stopRequested) return
      await playAudioFile(p)
      await delay(800)
    }
  } else {
    log(`Playing ${voicePaths.length} parts over ${track.filename}`)
    await playVoiceOverMusic(voicePaths, track.fullPath)
    log('Playback complete')
  }

  segmentsAired++
  if (sessionId) updateSessionSegmentCount(sessionId, segmentsAired)
  log(`Segment complete. Total aired: ${segmentsAired}`)
}


// ── Core Pipeline — One Segment ───────────────────────────────────

async function processSegment(
  seg:    ScheduleSegment,
  config: OrchestratorConfig
): Promise<void> {
  if (!seg.id) return
  if (stopRequested) return

  log(`Processing: [${seg.category}] ${seg.topic}`)
  emit({ state: 'segment', currentSegment: seg.category, currentTopic: seg.topic })

  // Check for pre-generated content
  const db           = getDatabase()
  const existingSubs = db.prepare(
    'SELECT * FROM sub_segments WHERE schedule_id = ? ORDER BY article_index'
  ).all(seg.id) as any[]

  let voicePaths: string[] = []

  if (existingSubs.length > 0 && existingSubs[0].audio_file_path) {
    // Use pre-generated voice files
    log(`Using pre-generated audio (${existingSubs.length} parts)`)
    voicePaths = existingSubs
      .map((s: any) => s.audio_file_path)
      .filter((p: string) => p && fs.existsSync(p))
  } else {
    // Generate from scratch
    log('Fetching articles...')
    const articles = await fetchArticlesForTopic(seg.topic, seg.category, 4)
    if (articles.length > 0) saveArticles(articles)

    log('Generating scripts...')
    const subs  = await generateSubSegments(seg.id, seg.category, seg.topic, articles)
    const saved = saveSubSegments(subs)

    // Generate all voice files
    log('Generating voice audio...')
    for (const sub of saved) {
      if (!sub.id || stopRequested) continue
      emit({
        state:          'segment',
        currentSegment: seg.category,
        currentTopic:   seg.topic,
        currentScript:  `${(sub as any).articleIndex + 1}/${saved.length}: ${sub.headline}`,
        segmentIndex:   segmentsAired + 1,
        totalSegments:  0,
      })

      const tts = await generateAudio(sub.script, sub.id, config.voiceId)
      if (tts.success && tts.audioPath) {
        updateSubSegmentAudio(sub.id, tts.audioPath, tts.durationSec ?? 0)
        voicePaths.push(tts.audioPath)
      }
    }
  }

  if (voicePaths.length === 0) {
    log('No audio files to play, skipping')
    return
  }
    // Switch to On Air BEFORE playing so stream captures audio
  if (isOBSConnected()) {
    log('Switching to On Air before playback...')
    let switched = false
    for (let attempt = 0; attempt < 3; attempt++) {
      switched = await switchScene(SCENES.ON_AIR)
      if (switched) break
      await delay(2000)
    }
    if (!switched) log('WARNING: Could not switch to On Air')
  }

  // Pick one music track for the whole segment
  const track = getRandomTrack()
  if (!track) {
    // No music — play voice files individually
    for (const p of voicePaths) {
      if (stopRequested) return
      await playAudioFile(p)
      await delay(800)
    }
  } else {
    // Play all voice files continuously over one music track
    log(`Playing ${voicePaths.length} parts over ${track.filename}`)
    await playVoiceOverMusic(voicePaths, track.fullPath)
    log('playVoiceOverMusic returned')  
  }
  
  log(`stopRequested is: ${stopRequested}`)
  log(`isOBSConnected: ${isOBSConnected()}`)
  segmentsAired++
  if (sessionId) updateSessionSegmentCount(sessionId, segmentsAired)
  log(`Segment complete. Total aired: ${segmentsAired}`)


}

// ── Chat Window ───────────────────────────────────────────────────

async function runChatWindow(config: OrchestratorConfig): Promise<void> {
  if (!isChatConnected()) return

  log('Running chat window...')
  emit({ state: 'chat_window' })

  try {
    const responses = await processChatWindow(config.maxChatResponses)

    for (const r of responses) {
      if (stopRequested) return

      // Generate audio for this chat response
      const tmpId   = Date.now()
      const ttsResult = await generateAudio(r.response, tmpId, config.voiceId)

      if (ttsResult.success && ttsResult.audioPath) {
        const mixResult = await mixVoiceWithMusic(
          ttsResult.audioPath,
          tmpId,
          getRandomTrack()?.fullPath
        )
        const audioPath = mixResult.success && mixResult.outputPath
          ? mixResult.outputPath
          : ttsResult.audioPath

        log(`Al responds to ${r.username}: playing audio`)
        await playAudioFile(audioPath)
        await delay(1000)
      }
    }
  } catch (err: any) {
    log(`Chat window error: ${err.message}`)
  }
}

// ── Main Orchestrator Loop ────────────────────────────────────────

export async function startOrchestrator(
  config: OrchestratorConfig
): Promise<void> {
  if (running) {
    log('Already running')
    return
  }

  running       = true
  stopRequested = false
  segmentsAired = 0
  state         = 'initializing'

  emit({ state: 'initializing' })
  log('Starting orchestrator...')

  try {
    // 1. Generate schedule
    state = 'generating'
    emit({ state: 'generating' })
    log('Generating schedule...')
    const schedule     = generateSchedule(config.categories)
    const savedSchedule = saveSchedule(schedule)
    const segments     = savedSchedule.segments
    log(`Schedule: ${segments.length} segments`)
    // Emit immediately so UI can load schedule
    state = 'generating'
    emit({
      state:         'generating',
      segmentIndex:  0,
      totalSegments: segments.length,  // ← this triggers UI to load
    })
    // 2. Start stream session tracking
    sessionId = startStreamSession('twitch')

    // 3. Connect chat if not already connected
    if (!isChatConnected()) {
      log('Connecting to Twitch chat...')
      await connectChat()
    }

    // 4. Switch to On Air scene
    // Switch to Starting scene while we prepare
    if (isOBSConnected()) {
        await switchScene(SCENES.STARTING)
        log('On Starting scene - pre-generating first segment...')
    }

    // Pre-generate first segment FULLY (scripts + TTS + mix)
    // In startOrchestrator, replace the pre-generation block:
    const firstSeg = segments[0]
    if (firstSeg?.id) {
      log('Fetching articles for first segment...')
      const articles = await fetchArticlesForTopic(firstSeg.topic, firstSeg.category, 4)
      if (articles.length > 0) saveArticles(articles)

      log('Generating scripts...')
      const subs  = await generateSubSegments(firstSeg.id, firstSeg.category, firstSeg.topic, articles)
      const saved = saveSubSegments(subs)

      log('Generating audio for first segment...')
      for (const sub of saved) {
        if (!sub.id) continue
        const tts = await generateAudio(sub.script, sub.id, config.voiceId)
        if (tts.success && tts.audioPath) {
          // Save ONLY the voice path — do NOT mix yet
          // playVoiceOverMusic will handle the music mixing
          updateSubSegmentAudio(sub.id, tts.audioPath, tts.durationSec ?? 0)
        }
      }
      log('First segment voice ready — going On Air!')
    }

    // NOW go On Air — audio is ready
    if (isOBSConnected()) {
    await switchScene(SCENES.ON_AIR)
    }

    state = 'live'
    emit({ state: 'live', totalSegments: segments.length })
    log(`Starting broadcast with ${segments.length} segments`)

    // 5. Main loop — process each segment
    // Pre-generate next segment while current one plays
    let nextSegPrepped = true // first segment already prepped
    
    let workerPromise:     Promise<GenerationResult> | null = null
    let nextSegmentResult: GenerationResult | null          = null
    let nextSegmentIndex:  number                           = -1

    for (let i = 0; i < segments.length; i++) {
      if (stopRequested) break

      const seg = segments[i]
      emit({
        state:          'segment',
        currentSegment: seg.category,
        currentTopic:   seg.topic,
        segmentIndex:   i + 1,
        totalSegments:  segments.length,
      })

      // Get voice paths
      let voicePaths: string[] = []
      if (nextSegmentResult && nextSegmentIndex === i) {
        log(`Using pre-generated content from worker (${nextSegmentResult.voicePaths.length} files)`)
        voicePaths        = nextSegmentResult.voicePaths
        nextSegmentResult = null
        nextSegmentIndex  = -1
      } else {
        log('Generating synchronously...')
        voicePaths = await generateSegmentContent(seg, config)
      }

      // Start worker for NEXT segment — assign to outer workerPromise
      const nextSeg = segments[i + 1]
      workerPromise = null  // reset before potentially setting
      if (nextSeg?.id && !stopRequested) {
        const track = getRandomTrack()
        log(`Starting background generation for: ${nextSeg.topic}`)
        workerPromise    = generateInBackground(   // ← no const/let, assigns outer
          nextSeg.id,
          nextSeg.category,
          nextSeg.topic,
          config.voiceId,
          track?.fullPath ?? null,
          (msg) => log(msg)
        )
        nextSegmentIndex = i + 1
        workerPromise.then(result => {
          nextSegmentResult = result
          log(`Worker completed: ${result.voicePaths.length} files ready`)
        })
      }

      // Play current segment
      await playSegment(voicePaths, config)
      if (stopRequested) break

      // Chat window
      if ((i + 1) % config.chatWindowInterval === 0) {
        if (isOBSConnected()) await switchScene(SCENES.BREAK)
        await runChatWindow(config)
        if (isOBSConnected()) await switchScene(SCENES.ON_AIR)
        log('Back to On Air after chat')
      }

      // Switch to Break and wait for worker
      if (i < segments.length - 1 && !stopRequested) {
        if (isOBSConnected()) {
          await switchScene(SCENES.BREAK)
          log('Break scene...')
        }

        if (workerPromise && nextSegmentResult === null) {
          log('Waiting for worker to finish...')
          const result = await workerPromise.catch(() => null)
          if (result) nextSegmentResult = result
        }
      }
    }

  } catch (err: any) {
    log(`Orchestrator error: ${err.message}`)
    state = 'error'
    emit({ state: 'error', error: err.message })
  } finally {
    // Clean up
    if (sessionId) endStreamSession(sessionId)
    running   = false
    state     = 'idle'
    emit({ state: 'idle' })
    log('Orchestrator stopped')
  }
}

export async function stopOrchestrator(): Promise<void> {
  log('Stop requested...')
  stopRequested = true
  cancelWorker()  

  if (isOBSConnected()) {
    await switchScene(SCENES.BREAK)
  }

  // Wait for running to clear then reset
  const waitForStop = new Promise<void>(resolve => {
    const check = setInterval(() => {
      if (!running) {
        clearInterval(check)
        resolve()
      }
    }, 500)
    // Force reset after 10 seconds
    setTimeout(() => {
      clearInterval(check)
      running       = false
      stopRequested = false
      state         = 'idle'
      resolve()
    }, 10000)
  })

  await waitForStop
  log('Orchestrator fully stopped')
}

export function isRunning(): boolean {
  return running
}

export function getOrchestratorState(): OrchestratorState {
  return state
}

export async function runPreflight(): Promise<PreflightResult> {
  const checks = []

  // Check Streamlabs connected
  checks.push({
    name:    'Streamlabs',
    pass:    isOBSConnected(),
    message: isOBSConnected()
      ? 'Connected'
      : 'Not connected — open OBS panel and connect first',
  })

  // Check Ollama running
  try {
    await require('axios').get('http://localhost:11434/api/tags', { timeout: 3000 })
    checks.push({ name: 'Ollama', pass: true, message: 'Running' })
  } catch {
    checks.push({
      name:    'Ollama',
      pass:    false,
      message: 'Not running — run: ollama serve',
    })
  }

  // Check music files exist
  const musicDir  = path.join(process.cwd(), '..', '..', 'data', 'music')
  const hasTracks = fs.existsSync(musicDir) &&
    fs.readdirSync(musicDir).some(f => /\.(mp3|wav)$/i.test(f))
  checks.push({
    name:    'Music',
    pass:    hasTracks,
    message: hasTracks ? 'Tracks found' : 'No music in data/music/',
  })

  // Check NewsAPI key
  const hasKey = !!process.env.NEWS_API_KEY
  checks.push({
    name:    'NewsAPI',
    pass:    hasKey,
    message: hasKey ? 'Key found' : 'NEWS_API_KEY missing from .env',
  })

  // Check Twitch token
  const hasToken = !!process.env.TWITCH_OAUTH_TOKEN
  checks.push({
    name:    'Twitch',
    pass:    hasToken,
    message: hasToken ? 'Token found' : 'TWITCH_OAUTH_TOKEN missing from .env',
  })

  return {
    ready:  checks.every(c => c.pass),
    checks,
  }


  
}