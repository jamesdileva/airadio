import { spawn }  from 'child_process'
import * as path  from 'path'
import * as fs    from 'fs'

// ── Config ────────────────────────────────────────────────────────

const AUDIO_OUTPUT_DIR = path.join(process.cwd(), 'data', 'audio-output')
const PYTHON_SCRIPT    = path.join(process.cwd(), 'src', 'python', 'tts.py')
const MODEL_DIR        = path.resolve(process.cwd(), '..', '..')

// ── Types ──────────────────────────────────────────────────────────

export interface TTSResult {
  success:      boolean
  audioPath?:   string
  durationSec?: number
  error?:       string
}

// ── Helpers ────────────────────────────────────────────────────────

function ensureOutputDir(): void {
  if (!fs.existsSync(AUDIO_OUTPUT_DIR)) {
    fs.mkdirSync(AUDIO_OUTPUT_DIR, { recursive: true })
  }
}

function buildAudioPath(subSegmentId: number): string {
  return path.join(AUDIO_OUTPUT_DIR, `segment_${subSegmentId}.wav`)
}

function writeTempScript(text: string, subSegmentId: number): string {
  const tmpPath = path.join(AUDIO_OUTPUT_DIR, `script_${subSegmentId}.txt`)
  fs.writeFileSync(tmpPath, text, 'utf-8')
  return tmpPath
}

// ── Core TTS Function ─────────────────────────────────────────────

export async function generateAudio(
  script:       string,
  subSegmentId: number,
  voice:        string = 'af_heart',
  speed:        number = 1.0
): Promise<TTSResult> {
  ensureOutputDir()

  const audioPath  = buildAudioPath(subSegmentId)
  const scriptPath = writeTempScript(script, subSegmentId)

  console.log(`Generating audio for sub-segment ${subSegmentId}...`)

  return new Promise((resolve) => {
    const args = [
      PYTHON_SCRIPT,
      '--input',  scriptPath,
      '--output', audioPath,
      '--voice',  voice,
      '--speed',  String(speed),
    ]

    // Set PYTHONPATH to include model directory
    const env = {
      ...process.env,
      PYTHONPATH: MODEL_DIR,
    }

    const python = spawn('python', args, { 
        env, 
        cwd: MODEL_DIR  // run from ~/airadio where .onnx files are
    })

    let stdout = ''
    let stderr = ''

    python.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
      console.log('[TTS]', data.toString().trim())
    })

    python.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
      console.error('[TTS ERROR]', data.toString().trim())
    })

    python.on('close', (code: number) => {
      // Clean up temp script file
      try { fs.unlinkSync(scriptPath) } catch {}

      if (code !== 0) {
        resolve({
          success: false,
          error:   stderr || `Python process exited with code ${code}`,
        })
        return
      }

      // Parse duration from stdout
      const durationMatch = stdout.match(/DURATION:\s*([\d.]+)/)
      const durationSec   = durationMatch ? parseFloat(durationMatch[1]) : 0

      resolve({
        success:    true,
        audioPath,
        durationSec,
      })
    })

    python.on('error', (err: Error) => {
      resolve({
        success: false,
        error:   `Failed to start Python: ${err.message}`,
      })
    })
  })
}

// ── Batch Generator ───────────────────────────────────────────────

export interface SubSegmentAudio {
  subSegmentId: number
  audioPath:    string
  durationSec:  number
}

export async function generateAudioForSegments(
  subSegments: { id: number; script: string }[],
  voice:       string = 'af_heart',
  onProgress?: (current: number, total: number) => void
): Promise<SubSegmentAudio[]> {
  const results: SubSegmentAudio[] = []

  for (let i = 0; i < subSegments.length; i++) {
    const seg = subSegments[i]
    onProgress?.(i + 1, subSegments.length)

    const result = await generateAudio(seg.script, seg.id, voice)

    if (result.success && result.audioPath) {
      results.push({
        subSegmentId: seg.id,
        audioPath:    result.audioPath,
        durationSec:  result.durationSec ?? 0,
      })

      // Update SQLite with audio path
      // (we'll call this from the IPC handler)
    } else {
      console.error(`Audio generation failed for sub-segment ${seg.id}:`, result.error)
    }
  }

  return results
}

// ── Check If Audio Already Exists ─────────────────────────────────

export function audioExists(subSegmentId: number): boolean {
  return fs.existsSync(buildAudioPath(subSegmentId))
}

export function getAudioPath(subSegmentId: number): string {
  return buildAudioPath(subSegmentId)
}