import { app, BrowserWindow, ipcMain, protocol, net } from 'electron'
import * as fs from 'fs'
// Must be called before app is ready
protocol.registerSchemesAsPrivileged([
  {
    scheme:     'radio',
    privileges: {
      secure:           true,
      standard:         true,
      supportFetchAPI:  true,
      stream:           true,
    }
  }
])

import path from 'path'
import { Category } from '../shared/types'

// Scheduler
import { generateSchedule } from './scheduler'

// Data fetching
import {
  fetchDataForSchedule,
  fetchFinanceData,
  fetchArticlesForTopic,
  FetchedArticle,
} from './dataFetcher'

// Content generation
import {
  generateSubSegments,
  generateFallbackScript,
} from './contentGenerator'

// Database
import {
  initDatabase,
  saveSchedule,
  loadTodaySchedule,
  saveArticles,
  saveFinanceData,
  loadArticlesForCategory,
  loadLatestFinanceData,
  saveSubSegments,
  loadSubSegments,
  clearSubSegments,
  updateSubSegmentAudio,
} from './database'

import {
  generateAudio,
  generateAudioForSegments,
  audioExists,
  getAudioPath,
} from './voiceEngine'


// ── IPC Handlers ──────────────────────────────────────────────────

ipcMain.handle('schedule:generate', (_event, categories: string[]) => {
  try {
    const schedule = generateSchedule(categories as any)
    const savedSchedule = saveSchedule(schedule)
    return savedSchedule
  } catch (err) {
    console.error('Schedule generation error:', err)
    throw err
  }
})

ipcMain.handle('schedule:load', () => {
  try {
    return loadTodaySchedule()
  } catch (err) {
    console.error('Schedule load error:', err)
    throw err
  }
})

ipcMain.handle('data:fetchForSchedule', async (_event, categories: Category[]) => {
  try {
    const dataMap = await fetchDataForSchedule(categories)
    for (const [, articles] of dataMap) {
      if (articles.length > 0) saveArticles(articles)
    }
    const result: Record<string, FetchedArticle[]> = {}
    for (const [cat, articles] of dataMap) {
      result[cat] = articles
    }
    return result
  } catch (err) {
    console.error('Data fetch error:', err)
    throw err
  }
})

ipcMain.handle('data:fetchFinance', async () => {
  try {
    const data = await fetchFinanceData()
    if (data.length > 0) saveFinanceData(data)
    return data
  } catch (err) {
    console.error('Finance fetch error:', err)
    throw err
  }
})

ipcMain.handle('data:loadArticles', (_event, category: string) => {
  return loadArticlesForCategory(category)
})

ipcMain.handle('data:loadFinance', () => {
  return loadLatestFinanceData()
})

ipcMain.handle('script:generate', async (_event, payload: {
  scheduleId: number
  category:   string
  topic:      string
}) => {
  console.log('=== SCRIPT GENERATE CALLED ===')
  console.log('Payload:', payload)

  try {
    clearSubSegments(payload.scheduleId)

    console.log(`Fetching articles for topic: "${payload.topic}"`)
    const articles = await fetchArticlesForTopic(
      payload.topic,
      payload.category as any,
      4
    )
    console.log('Articles found:', articles.length)
    if (articles.length > 0) saveArticles(articles)

    const financeData = payload.category === 'finance'
      ? loadLatestFinanceData()
      : []

    const subSegments = await generateSubSegments(
      payload.scheduleId,
      payload.category as any,
      payload.topic,
      articles,
      financeData
    )

    const saved = saveSubSegments(subSegments)
    console.log(`Saved ${saved.length} sub-segments`)
    return saved

  } catch (err: any) {
    console.error('=== SCRIPT GENERATION FAILED ===')
    console.error('Error:', err.message)
    return []
  }
})

ipcMain.handle('script:loadSubSegments', (_event, scheduleId: number) => {
  return loadSubSegments(scheduleId)
})

ipcMain.handle('tts:generate', async (_event, payload: {
  subSegmentId: number
  script:       string
  voice?:       string
}) => {
  console.log(`TTS: generating audio for sub-segment ${payload.subSegmentId}`)

  // Return cached audio if it already exists
  if (audioExists(payload.subSegmentId)) {
    console.log('TTS: using cached audio')
    return {
      success:   true,
      audioPath: getAudioPath(payload.subSegmentId),
      cached:    true,
    }
  }

  const result = await generateAudio(
    payload.script,
    payload.subSegmentId,
    payload.voice ?? 'af_heart'
  )

  if (result.success && result.audioPath) {
    updateSubSegmentAudio(
      payload.subSegmentId,
      result.audioPath,
      result.durationSec ?? 0
    )
  }

  return result
})

ipcMain.handle('tts:generateBatch', async (_event, payload: {
  subSegments: { id: number; script: string }[]
  voice?:      string
}) => {
  console.log(`TTS: batch generating ${payload.subSegments.length} audio files`)

  // Filter out already generated segments
  const toGenerate = payload.subSegments.filter(s => !audioExists(s.id))
  const alreadyDone = payload.subSegments.filter(s => audioExists(s.id))

  console.log(`TTS: ${alreadyDone.length} cached, ${toGenerate.length} to generate`)

  const results = await generateAudioForSegments(
    toGenerate,
    payload.voice ?? 'af_heart',
    (current, total) => {
      console.log(`TTS progress: ${current}/${total}`)
    }
  )

  // Save audio paths to database
  for (const r of results) {
    updateSubSegmentAudio(r.subSegmentId, r.audioPath, r.durationSec)
  }

  // Include already-cached results
  const cachedResults = alreadyDone.map(s => ({
    subSegmentId: s.id,
    audioPath:    getAudioPath(s.id),
    durationSec:  0,
  }))

  return [...cachedResults, ...results]
})

ipcMain.handle('tts:getPath', (_event, subSegmentId: number) => {
  return audioExists(subSegmentId)
    ? getAudioPath(subSegmentId)
    : null
})

ipcMain.handle('tts:getAudioData', (_event, filePath: string) => {
  try {
    const data = fs.readFileSync(filePath)
    return data.toString('base64')
  } catch (err: any) {
    console.error('Audio read failed:', err.message)
    return null
  }
})




// ── Window ────────────────────────────────────────────────────────

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    title: 'AI Radio Network',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Register custom protocol to serve local audio files
  protocol.handle('radio', (request) => {
    // Extract path after radio:///
    const url = request.url.slice('radio:///'.length)
    const decoded = decodeURIComponent(url)
    // Reconstruct proper Windows file path
    const filePath = decoded.replace(/\//g, '\\')
    console.log('Serving audio file:', filePath)
    return net.fetch('file:///' + decoded)
  })

  try {
    initDatabase()
    console.log('Database ready')
  } catch (err) {
    console.error('Database init failed:', err)
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})