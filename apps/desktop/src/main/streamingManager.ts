import { getStreamStatus, startStreaming, stopStreaming, switchScene, isOBSConnected } from './OBSController'
import { SCENES } from './OBSController'

// ── Types ──────────────────────────────────────────────────────────

export type StreamState =
  | 'idle'
  | 'starting'
  | 'live'
  | 'stopping'
  | 'error'

export interface StreamStatus {
  state:        StreamState
  streaming:    boolean
  duration?:    number
  error?:       string
  startedAt?:   string
}

// ── State ─────────────────────────────────────────────────────────

let currentState:  StreamState = 'idle'
let startedAt:     string | null = null
let monitorInterval: NodeJS.Timeout | null = null

// ── Callbacks ─────────────────────────────────────────────────────

type StatusCallback = (status: StreamStatus) => void
let onStatusChange: StatusCallback | null = null

export function setStatusCallback(cb: StatusCallback): void {
  onStatusChange = cb
}

function emitStatus(status: StreamStatus): void {
  onStatusChange?.(status)
}

// ── Core Functions ────────────────────────────────────────────────

export async function startStream(): Promise<StreamStatus> {
  if (!isOBSConnected()) {
    return {
      state:     'error',
      streaming: false,
      error:     'Streamlabs not connected. Connect first.',
    }
  }

  if (currentState === 'live') {
    return {
      state:     'live',
      streaming: true,
      error:     'Already streaming',
    }
  }

  try {
    currentState = 'starting'
    emitStatus({ state: 'starting', streaming: false })
    console.log('Starting ElmWave stream...')

    // Switch to Starting scene first
    await switchScene(SCENES.STARTING)
    console.log('Switched to Starting scene')

    // Small delay so viewers see the starting screen
    await delay(3000)

    // Start the actual stream
    const success = await startStreaming()

    if (!success) {
      currentState = 'error'
      return {
        state:     'error',
        streaming: false,
        error:     'Streamlabs failed to start stream',
      }
    }

    // Switch to On Air scene
    await delay(2000)
    await switchScene(SCENES.ON_AIR)

    currentState = 'live'
    startedAt    = new Date().toISOString()

    console.log('ElmWave is LIVE!')
    const status: StreamStatus = {
      state:     'live',
      streaming: true,
      startedAt,
    }

    emitStatus(status)
    startMonitor()
    return status

  } catch (err: any) {
    currentState = 'error'
    const status: StreamStatus = {
      state:     'error',
      streaming: false,
      error:     err.message,
    }
    emitStatus(status)
    return status
  }
}

export async function stopStream(): Promise<StreamStatus> {
  if (currentState !== 'live') {
    return { state: currentState, streaming: false }
  }

  try {
    currentState = 'stopping'
    emitStatus({ state: 'stopping', streaming: true })
    console.log('Stopping ElmWave stream...')

    // Switch to Break scene before stopping
    await switchScene(SCENES.BREAK)
    await delay(3000)

    // Stop the stream
    await stopStreaming()

    stopMonitor()
    currentState = 'idle'
    startedAt    = null

    console.log('Stream stopped')
    const status: StreamStatus = { state: 'idle', streaming: false }
    emitStatus(status)
    return status

  } catch (err: any) {
    currentState = 'error'
    return {
      state:     'error',
      streaming: false,
      error:     err.message,
    }
  }
}

export async function getStatus(): Promise<StreamStatus> {
  try {
    const obsStatus = await getStreamStatus()
    if (obsStatus.streaming && currentState !== 'live') {
      currentState = 'live'
    }
    return {
      state:     currentState,
      streaming: obsStatus.streaming,
      startedAt: startedAt ?? undefined,
    }
  } catch {
    return { state: currentState, streaming: false }
  }
}

// ── Monitor ───────────────────────────────────────────────────────

function startMonitor(): void {
  stopMonitor()
  monitorInterval = setInterval(async () => {
    try {
      const status = await getStreamStatus()
      if (!status.streaming && currentState === 'live') {
        // Stream dropped unexpectedly
        console.warn('Stream dropped! Attempting recovery...')
        currentState = 'error'
        emitStatus({
          state:     'error',
          streaming: false,
          error:     'Stream dropped unexpectedly',
        })
        stopMonitor()
      }
    } catch (err) {
      console.error('Monitor check failed:', err)
    }
  }, 15000) // check every 15 seconds
}

function stopMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval)
    monitorInterval = null
  }
}

// ── Helpers ───────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function getCurrentState(): StreamState {
  return currentState
}

export function getStreamDuration(): string | null {
  if (!startedAt) return null
  const ms      = Date.now() - new Date(startedAt).getTime()
  const hours   = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}