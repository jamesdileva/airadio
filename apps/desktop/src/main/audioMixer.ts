import { spawn }  from 'child_process'
import * as path  from 'path'
import * as fs    from 'fs'

// ── Config ────────────────────────────────────────────────────────

const MUSIC_DIR      = path.join(process.cwd(), '..', '..', 'data', 'music')
const AUDIO_OUT_DIR  = path.join(process.cwd(), 'data', 'audio-output')
const MIXED_OUT_DIR  = path.join(process.cwd(), 'data', 'audio-output', 'mixed')

// Volume levels (0.0 to 1.0)
const VOICE_VOLUME   = 1.0    // Al's voice — full volume
const MUSIC_VOLUME   = 0.12   // Background music — subtle

// ── Types ──────────────────────────────────────────────────────────

export interface MixResult {
  success:    boolean
  outputPath?: string
  duration?:  number
  error?:     string
}

export interface MusicTrack {
  filename: string
  fullPath: string
}

// ── Helpers ────────────────────────────────────────────────────────

function ensureDirs(): void {
  if (!fs.existsSync(MIXED_OUT_DIR)) {
    fs.mkdirSync(MIXED_OUT_DIR, { recursive: true })
  }
}

export function getAvailableTracks(): MusicTrack[] {
  if (!fs.existsSync(MUSIC_DIR)) {
    fs.mkdirSync(MUSIC_DIR, { recursive: true })
    return []
  }

  return fs.readdirSync(MUSIC_DIR)
    .filter(f => /\.(mp3|wav|ogg|flac)$/i.test(f))
    .map(f => ({
      filename: f,
      fullPath: path.join(MUSIC_DIR, f),
    }))
}

export function getRandomTrack(): MusicTrack | null {
  const tracks = getAvailableTracks()
  if (tracks.length === 0) return null
  return tracks[Math.floor(Math.random() * tracks.length)]
}

function runFFmpeg(args: string[]): Promise<{ success: boolean; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-y', ...args])  // -y overwrites existing files

    let stderr = ''
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on('close', (code: number) => {
      resolve({ success: code === 0, stderr })
    })

    proc.on('error', (err: Error) => {
      resolve({ success: false, stderr: err.message })
    })
  })
}

// ── Core Mix Function ─────────────────────────────────────────────

export async function mixVoiceWithMusic(
  voicePath:   string,
  subSegmentId: number,
  musicPath?:  string
): Promise<MixResult> {
  ensureDirs()

  // Use provided music or pick random
  const track = musicPath
    ? { fullPath: musicPath, filename: path.basename(musicPath) }
    : getRandomTrack()

  if (!track) {
    console.warn('No music tracks found in data/music/ — returning voice only')
    return {
      success:    true,
      outputPath: voicePath,
    }
  }

  const outputPath = path.join(MIXED_OUT_DIR, `mixed_${subSegmentId}.wav`)

  console.log(`Mixing: ${path.basename(voicePath)} + ${track.filename}`)

  // FFmpeg command:
  // -i voicePath          input 1: Al's voice
  // -i musicPath          input 2: background music
  // -filter_complex       audio processing chain
  //   [1:a]volume=0.12    reduce music volume to 12%
  //   [0:a][1:a]amix      mix voice and music together
  //   inputs=2            two input streams
  //   duration=first      stop when voice ends
  //   dropout_transition=2  smooth fadeout at end
  const args = [
    '-i', voicePath,
    '-i', track.fullPath,
    '-filter_complex',
    `[1:a]volume=${MUSIC_VOLUME}[music];[0:a][music]amix=inputs=2:duration=first:dropout_transition=2`,
    '-ac', '2',          // stereo output
    '-ar', '44100',      // 44.1kHz sample rate (CD quality)
    outputPath,
  ]

  const result = await runFFmpeg(args)

  if (!result.success) {
    console.error('FFmpeg mix failed:', result.stderr.slice(-500))
    return { success: false, error: result.stderr.slice(-200) }
  }

  console.log(`Mix complete: ${outputPath}`)
  return { success: true, outputPath }
}

// ── Batch Mixer ───────────────────────────────────────────────────

export async function mixAllSubSegments(
  subSegments:  { id: number; audioPath: string }[],
  onProgress?:  (current: number, total: number) => void
): Promise<{ id: number; mixedPath: string }[]> {
  const results: { id: number; mixedPath: string }[] = []

  // Pick one track for the whole session for consistency
  const track = getRandomTrack()

  for (let i = 0; i < subSegments.length; i++) {
    const seg = subSegments[i]
    onProgress?.(i + 1, subSegments.length)

    if (!fs.existsSync(seg.audioPath)) {
      console.warn(`Voice file missing for sub-segment ${seg.id}, skipping`)
      continue
    }

    const result = await mixVoiceWithMusic(
      seg.audioPath,
      seg.id,
      track?.fullPath
    )

    if (result.success && result.outputPath) {
      results.push({ id: seg.id, mixedPath: result.outputPath })
    }
  }

  return results
}

// ── Check If Mixed File Exists ────────────────────────────────────

export function mixedAudioExists(subSegmentId: number): boolean {
  return fs.existsSync(
    path.join(MIXED_OUT_DIR, `mixed_${subSegmentId}.wav`)
  )
}

export function getMixedAudioPath(subSegmentId: number): string {
  return path.join(MIXED_OUT_DIR, `mixed_${subSegmentId}.wav`)
}