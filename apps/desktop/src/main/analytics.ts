import * as fs   from 'fs'
import * as path from 'path'
import { getDatabase } from './database'

// ── Types ──────────────────────────────────────────────────────────

export interface SessionSummary {
  id:                 number
  startedAt:          string
  endedAt:            string | null
  platform:           string
  durationMinutes:    number
  segmentsAired:      number
  chatMessages:       number
  peakViewers:        number
}

export interface StorageSummary {
  audioFileCount:     number
  audioSizeMB:        number
  mixedFileCount:     number
  mixedSizeMB:        number
  totalSizeMB:        number
  oldestFileDate:     string | null
}

export interface AnalyticsSummary {
  totalSessions:      number
  totalStreamMinutes: number
  totalSegments:      number
  totalChatMessages:  number
  totalScripts:       number
  recentSessions:     SessionSummary[]
  storage:            StorageSummary
}

// ── Session Analytics ─────────────────────────────────────────────

export function getSessionSummaries(limit: number = 10): SessionSummary[] {
  const db = getDatabase()

  const sessions = db.prepare(`
    SELECT
      ss.id,
      ss.started_at,
      ss.ended_at,
      ss.platform,
      ss.peak_viewers,
      COUNT(DISTINCT cl.id) as chat_count
    FROM stream_sessions ss
    LEFT JOIN chat_log cl ON date(cl.responded_at) = date(ss.started_at)
    GROUP BY ss.id
    ORDER BY ss.id DESC
    LIMIT ?
  `).all(limit) as any[]

  return sessions.map(s => {
    const start    = new Date(s.started_at)
    const end      = s.ended_at ? new Date(s.ended_at) : null
    const duration = end
      ? Math.round((end.getTime() - start.getTime()) / 60000)
      : 0

    return {
      id:              s.id,
      startedAt:       s.started_at,
      endedAt:         s.ended_at,
      platform:        s.platform,
      durationMinutes: duration,
      segmentsAired:   s.segments_aired || 0,
      chatMessages:    s.chat_count     || 0,
      peakViewers:     s.peak_viewers   || 0,
    }
  })
}

export function getOverallStats(): {
  totalSessions:      number
  totalStreamMinutes: number
  totalSegments:      number
  totalChatMessages:  number
  totalScripts:       number
} {
  const db = getDatabase()

  const sessions = db.prepare(`
    SELECT COUNT(*) as count,
           SUM(CASE WHEN ended_at IS NOT NULL
             THEN CAST((julianday(ended_at) - julianday(started_at)) * 1440 AS INTEGER)
             ELSE 0 END) as total_minutes,
           SUM(segments_aired) as total_segments
    FROM stream_sessions
  `).get() as any

  const chat = db.prepare(
    'SELECT COUNT(*) as count FROM chat_log'
  ).get() as any

  const scripts = db.prepare(
    'SELECT COUNT(*) as count FROM sub_segments'
  ).get() as any

  return {
    totalSessions:      sessions?.count         || 0,
    totalStreamMinutes: sessions?.total_minutes || 0,
    totalSegments:      sessions?.total_segments || 0,
    totalChatMessages:  chat?.count             || 0,
    totalScripts:       scripts?.count          || 0,
  }
}

// ── Storage Analytics ─────────────────────────────────────────────

function getDirectoryStats(dirPath: string): {
  count: number
  sizeMB: number
  oldest: string | null
} {
  if (!fs.existsSync(dirPath)) {
    return { count: 0, sizeMB: 0, oldest: null }
  }

  const files  = fs.readdirSync(dirPath)
    .filter(f => f.endsWith('.wav'))
    .map(f => ({
      name:  f,
      path:  path.join(dirPath, f),
      stats: fs.statSync(path.join(dirPath, f)),
    }))

  if (files.length === 0) return { count: 0, sizeMB: 0, oldest: null }

  const totalBytes = files.reduce((sum, f) => sum + f.stats.size, 0)
  const oldest     = files.reduce((min, f) =>
    f.stats.mtime < min.stats.mtime ? f : min
  )

  return {
    count:  files.length,
    sizeMB: Math.round(totalBytes / 1024 / 1024 * 10) / 10,
    oldest: oldest.stats.mtime.toISOString(),
  }
}

export function getStorageSummary(): StorageSummary {
  const audioDir = path.join(process.cwd(), 'data', 'audio-output')
  const mixedDir = path.join(audioDir, 'mixed')

  const audio = getDirectoryStats(audioDir)
  const mixed = getDirectoryStats(mixedDir)

  return {
    audioFileCount: audio.count,
    audioSizeMB:    audio.sizeMB,
    mixedFileCount: mixed.count,
    mixedSizeMB:    mixed.sizeMB,
    totalSizeMB:    Math.round((audio.sizeMB + mixed.sizeMB) * 10) / 10,
    oldestFileDate: audio.oldest,
  }
}

// ── Full Summary ──────────────────────────────────────────────────

export function getAnalyticsSummary(): AnalyticsSummary {
  const stats    = getOverallStats()
  const sessions = getSessionSummaries(5)
  const storage  = getStorageSummary()

  return {
    ...stats,
    recentSessions: sessions,
    storage,
  }
}

// ── Audio Cleanup ─────────────────────────────────────────────────

export interface CleanupResult {
  filesDeleted:  number
  mbFreed:       number
  errors:        number
}

export function cleanupOldAudio(daysOld: number = 30): CleanupResult {
  const audioDir  = path.join(process.cwd(), 'data', 'audio-output')
  const mixedDir  = path.join(audioDir, 'mixed')
  const cutoff    = new Date()
  cutoff.setDate(cutoff.getDate() - daysOld)

  let filesDeleted = 0
  let bytesFreed   = 0
  let errors       = 0

  const cleanDir = (dirPath: string) => {
    if (!fs.existsSync(dirPath)) return

    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.wav'))
    for (const file of files) {
      const filePath = path.join(dirPath, file)
      try {
        const stats = fs.statSync(filePath)
        if (stats.mtime < cutoff) {
          bytesFreed += stats.size
          fs.unlinkSync(filePath)
          filesDeleted++
        }
      } catch (err) {
        errors++
      }
    }
  }

  cleanDir(audioDir)
  cleanDir(mixedDir)

  const mbFreed = Math.round(bytesFreed / 1024 / 1024 * 10) / 10
  console.log(`Cleanup: deleted ${filesDeleted} files, freed ${mbFreed}MB`)

  return { filesDeleted, mbFreed, errors }
}

// ── Update Session Stats ──────────────────────────────────────────

export function updateSessionSegmentCount(
  sessionId: number,
  count:      number
): void {
  const db = getDatabase()
  db.prepare(`
    UPDATE stream_sessions
    SET segments_aired = ?
    WHERE id = ?
  `).run(count, sessionId)
}

export function updateSessionPeakViewers(
  sessionId: number,
  count:      number
): void {
  const db = getDatabase()
  db.prepare(`
    UPDATE stream_sessions
    SET peak_viewers = ?
    WHERE id = ?
  `).run(count, sessionId)
}