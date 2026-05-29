import { Worker }   from 'worker_threads'
import * as path    from 'path'
import { app }      from 'electron'
import { Category } from '../shared/types'

export interface GenerationResult {
  success:    boolean
  voicePaths: string[]
  error?:     string
}

export interface PendingGeneration {
  segmentId: number
  category:  Category
  topic:     string
  promise:   Promise<GenerationResult>
}

// Currently running worker
let activeWorker:   Worker | null          = null
let pendingResult:  Promise<GenerationResult> | null = null
let pendingSegId:   number | null          = null

export function generateInBackground(
  segmentId:  number,
  category:   Category,
  topic:      string,
  voiceId:    string,
  musicPath:  string | null,
  onProgress: (msg: string) => void
): Promise<GenerationResult> {

  // Cancel any existing worker
  if (activeWorker) {
    activeWorker.terminate()
    activeWorker = null
  }

  // Get DB path inside function — app is ready by this point
  const { app } = require('electron')
  const dbPath  = path.join(app.getPath('userData'), 'radio.db')

  const workerPath = path.join(__dirname, 'generatorWorker.js')

  const promise = new Promise<GenerationResult>((resolve) => {
    const worker = new Worker(workerPath, {
      workerData: {
        segmentId,
        category,
        topic,
        voiceId,
        musicPath,
        cwd:     process.cwd(),
        dirname: __dirname,
        dbPath,
      }
    })

    activeWorker = worker

    worker.on('message', (msg: any) => {
        if (msg.type === 'progress') {
            onProgress(`[Worker] ${msg.message}`)
        } else if (msg.type === 'complete') {
            activeWorker = null
            console.log(`[WorkerManager] Complete with ${msg.voicePaths?.length ?? 0} files`)
            resolve({ success: true, voicePaths: msg.voicePaths ?? [] })
        } else if (msg.type === 'error') {
            activeWorker = null
            console.error(`[WorkerManager] Error: ${msg.error}`)
            resolve({ success: false, voicePaths: [], error: msg.error })
        } else {
            console.log(`[WorkerManager] Unknown message type:`, msg)
        }
        })

        worker.on('error', (err) => {
            activeWorker = null
            console.error(`[WorkerManager] Worker threw:`, err)
            resolve({ success: false, voicePaths: [], error: err.message })
        })

        worker.on('exit', (code) => {
            console.log(`[WorkerManager] Worker exited with code ${code}`)
            if (code !== 0) {
                activeWorker = null
                resolve({ success: false, voicePaths: [], error: `Worker exited ${code}` })
        }
        })
    })

  pendingResult = promise
  pendingSegId  = segmentId
  return promise
}

export function cancelWorker(): void {
  if (activeWorker) {
    activeWorker.terminate()
    activeWorker  = null
    pendingResult = null
    pendingSegId  = null
  }
}

export function isWorkerRunning(): boolean {
  return activeWorker !== null
}

export function getPendingSegmentId(): number | null {
  return pendingSegId
}