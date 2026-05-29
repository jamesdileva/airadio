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

export async function playVoiceOverMusic(
  voicePaths: string[],
  musicPath:  string
): Promise<void> {
  console.log(`[playVoiceOverMusic] ENTERED with ${voicePaths.length} files`)
  
  const validPaths = voicePaths.filter(p => fs.existsSync(p))
  console.log(`[playVoiceOverMusic] Valid paths: ${validPaths.length}`)
  
  if (validPaths.length === 0) {
    console.log('[playVoiceOverMusic] No valid paths, returning early')
    return
  }

  ensureDirs()
  const timestamp     = Date.now()
  // Write concat list
  const concatContent = validPaths
    .map(p => `file '${p.replace(/\\/g, '/')}'`)
    .join('\n')
  const concatFile = path.join(MIXED_OUT_DIR, 'concat_list.txt')
  fs.writeFileSync(concatFile, concatContent)

  // First concatenate all voice files into one temp file
  const combinedVoice = path.join(MIXED_OUT_DIR, `combined_${timestamp}.wav`)

  await new Promise<void>((resolve) => {
    const concat = spawn('ffmpeg', [
      '-y',
      '-f',    'concat',
      '-safe', '0',
      '-i',    concatFile,
      '-c',    'copy',
      combinedVoice,
    ], { stdio: 'pipe' })
    concat.on('close', () => resolve())
    concat.on('error', () => resolve())
  })

  if (!fs.existsSync(combinedVoice)) {
    console.error('Voice concatenation failed, playing files individually')
    for (const p of validPaths) {
      await new Promise<void>((resolve) => {
        const proc = spawn('ffplay', [
          '-nodisp', '-autoexit', '-volume', '100', p
        ], {
          stdio: 'pipe',
          env: {
            ...process.env,
            SDL_AUDIODRIVER: 'directsound',
            AUDIODEV:        'CABLE Input (VB-Audio Virtual Cable)',
          }
        })
        proc.on('close', () => resolve())
        proc.on('error', () => resolve())
      })
    }
    return
  }
  
  // Now mix combined voice with looping music and play
  const mixedOutput   = path.join(MIXED_OUT_DIR, `continuous_${timestamp}.wav`)

  await new Promise<void>((resolve) => {
  const mix = spawn('ffmpeg', [
    '-y',
    '-i',           combinedVoice,
    '-stream_loop', '-1',
    '-i',           musicPath,
    '-filter_complex',
    '[0:a]volume=1.0[voice];[1:a]volume=0.12[music];[voice][music]amix=inputs=2:duration=first:dropout_transition=2',
    '-ar', '44100',
    '-ac', '2',
    mixedOutput,
  ], { stdio: 'pipe' })

  mix.stderr?.on('data', (d: Buffer) => {
    process.stdout.write('.')
  })

  // ✅ File checks go INSIDE close handler — after ffmpeg finishes
  mix.on('close', (code) => {
    console.log(`\nMix complete (code ${code})`)

    if (!fs.existsSync(mixedOutput)) {
      console.error('Mixed output file not created!')
      resolve()  // resolve not return — lets the Promise complete
      return
    }

    const fileSize = fs.statSync(mixedOutput).size
    console.log(`Mixed file size: ${fileSize} bytes`)

    if (fileSize < 1000) {
      console.error('Mixed file too small')
      resolve()
      return
    }

    resolve()
  })

  mix.on('error', (err) => {
    console.error('FFmpeg mix error:', err.message)
    resolve()
  })
})

  // Play the final mixed file
await new Promise<void>((resolve) => {
  console.log(`[Mixer] Starting playback of ${mixedOutput}`)

  // Calculate expected duration from file size
  // WAV at 44100Hz stereo 16bit = 176400 bytes/sec
  const fileSizeBytes   = fs.statSync(mixedOutput).size
  const expectedSeconds = Math.ceil(fileSizeBytes / 176400)
  const timeoutMs       = (expectedSeconds + 30) * 1000 // add 30s buffer
  console.log(`[Mixer] Expected duration: ~${expectedSeconds}s, timeout: ${timeoutMs / 1000}s`)

  const play = spawn('ffplay', [
    '-nodisp',
    '-autoexit',
    '-volume', '100',
    mixedOutput,
  ], {
    stdio: 'ignore',  // ← change from 'pipe' to 'ignore'
    detached: false,
    env: {
      ...process.env,
      SDL_AUDIODRIVER: 'directsound',
      AUDIODEV:        'CABLE Input (VB-Audio Virtual Cable)',
    }
  })

  // Primary exit — close event
  play.on('close', (code: number) => {
    console.log(`[Mixer] ffplay closed code ${code}`)
    clearTimeout(timeout)
    cleanup()
    resolve()
  })

  play.on('error', (err: Error) => {
    console.log(`[Mixer] ffplay error: ${err.message}`)
    clearTimeout(timeout)
    cleanup()
    resolve()
  })

  // Safety timeout based on file duration
  const timeout = setTimeout(() => {
    console.log('[Mixer] Duration timeout reached — continuing')
    try { play.kill() } catch {}
    cleanup()
    resolve()
  }, timeoutMs)

  function cleanup() {
    try { fs.unlinkSync(concatFile)    } catch {}
    try { fs.unlinkSync(combinedVoice) } catch {}
  }
})

console.log('[playVoiceOverMusic] COMPLETE')
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