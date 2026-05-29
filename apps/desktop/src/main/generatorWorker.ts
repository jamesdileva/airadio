import { workerData, parentPort } from 'worker_threads'
import * as path from 'path'
import * as fs   from 'fs'

// Worker receives a task and reports back progress
interface WorkerTask {
  segmentId:   number
  category:    string
  topic:       string
  voiceId:     string
  musicPath:   string | null
  cwd:         string
  dirname:     string
  dbPath:      string    // ← add this
}

interface WorkerProgress {
  type:     'progress' | 'complete' | 'error'
  message?: string
  voicePaths?: string[]
  error?:   string
}

async function run() {
  const task = workerData as WorkerTask

  function post(msg: WorkerProgress) {
    parentPort?.postMessage(msg)
  }

  try {
    post({ type: 'progress', message: `Worker starting for: ${task.topic}` })
    post({ type: 'progress', message: `cwd: ${task.cwd}, __dirname: ${__dirname}` })

    const { fetchArticlesForTopic } = require('./dataFetcher')
    post({ type: 'progress', message: 'dataFetcher loaded' })

    const { generateSubSegments } = require('./contentGenerator')
    post({ type: 'progress', message: 'contentGenerator loaded' })

    const { generateAudio } = require('./voiceEngine')
    post({ type: 'progress', message: 'voiceEngine loaded' })

    const {
      saveArticles,
      saveSubSegments,
      updateSubSegmentAudio,
      initDatabase,
    } = require('./database')
    post({ type: 'progress', message: 'database loaded' })

    // Worker needs its own DB connection
    // Replace initDatabase() with:
    const Database = require('better-sqlite3')
    const db       = new Database(task.dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')

    // Override the database module's getter
    const dbModule = require('./database')
    dbModule._setDatabase(db)  // we'll add this function

    // Fetch articles
    post({ type: 'progress', message: `Fetching articles for: ${task.topic}` })
    const articles = await fetchArticlesForTopic(task.topic, task.category, 4)
    post({ type: 'progress', message: `Articles fetched: ${articles.length}` })

    if (articles.length > 0) saveArticles(articles)

    // Generate scripts
    post({ type: 'progress', message: 'Generating scripts...' })
    const subs  = await generateSubSegments(
      task.segmentId,
      task.category,
      task.topic,
      articles
    )
    post({ type: 'progress', message: `Scripts done: ${subs.length}` })

    const saved = saveSubSegments(subs)

    // Generate voice audio
    const voicePaths: string[] = []
    for (const sub of saved) {
      if (!sub.id) continue
      post({ type: 'progress', message: `TTS: ${sub.headline}` })
      const tts = await generateAudio(sub.script, sub.id, task.voiceId)
      post({ type: 'progress', message: `TTS result: ${tts.success} path: ${tts.audioPath}` })
      if (tts.success && tts.audioPath) {
        updateSubSegmentAudio(sub.id, tts.audioPath, tts.durationSec ?? 0)
        voicePaths.push(tts.audioPath)
      }
    }

    post({ type: 'progress', message: `Voice paths generated: ${voicePaths.length}` })
    post({ type: 'complete', voicePaths })

  } catch (err: any) {
    post({ type: 'error', error: `Worker error: ${err.message}\nStack: ${err.stack}` })
  }
}

run()