import Database from 'better-sqlite3'
import path from 'path'
import { app } from 'electron'
import { ScheduleSegment, DailySchedule, SubSegment } from '../shared/types'
import { FetchedArticle, FinanceData } from './dataFetcher'
import { GeneratedScript } from './contentGenerator'

let db: Database.Database

export function initDatabase(): Database.Database {
  const dbPath = path.join(app.getPath('userData'), 'radio.db')
  db = new Database(dbPath)

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  createTables(db)
  // Add audio_file_path column if it doesn't exist (migration)
  try {
    db.prepare('ALTER TABLE sub_segments ADD COLUMN audio_file_path TEXT').run()
    console.log('Migrated sub_segments table')
  } catch {
    // Column already exists, ignore
  }
  console.log('Database initialized at:', dbPath)
  return db
}

function createTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      segment_order INTEGER NOT NULL,
      category TEXT NOT NULL,
      topic TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id INTEGER REFERENCES schedule(id),
      script TEXT,
      audio_file_path TEXT,
      generated_at TEXT,
      aired_at TEXT
    );

    CREATE TABLE IF NOT EXISTS chat_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      username TEXT NOT NULL,
      message TEXT NOT NULL,
      response TEXT,
      responded_at TEXT
    );

    CREATE TABLE IF NOT EXISTS stream_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      platform TEXT NOT NULL,
      peak_viewers INTEGER DEFAULT 0,
      total_chat_messages INTEGER DEFAULT 0,
      segments_aired INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS segment_analytics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      segment_id INTEGER REFERENCES segments(id),
      session_id INTEGER REFERENCES stream_sessions(id),
      viewer_count_avg INTEGER DEFAULT 0,
      chat_activity_count INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS fetched_articles (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      category     TEXT NOT NULL,
      title        TEXT NOT NULL,
      summary      TEXT NOT NULL,
      source       TEXT NOT NULL,
      url          TEXT NOT NULL,
      fetched_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS finance_data (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol         TEXT NOT NULL,
      price          REAL NOT NULL,
      change         REAL NOT NULL,
      change_percent REAL NOT NULL,
      fetched_at     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sub_segments (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id       INTEGER REFERENCES schedule(id),
      article_index     INTEGER NOT NULL,
      category          TEXT NOT NULL,
      topic             TEXT NOT NULL,
      headline          TEXT NOT NULL,
      script            TEXT NOT NULL,
      duration_sec      INTEGER NOT NULL,
      generated_at      TEXT NOT NULL,
      audio_file_path   TEXT
    );


  `)
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error('Database not initialized')
  return db
}



export function saveSchedule(schedule: DailySchedule): DailySchedule {
  const db = getDatabase()

  const saveTransaction = db.transaction(() => {
    const existingRows = db.prepare(
      'SELECT id FROM schedule WHERE date = ?'
    ).all(schedule.date) as { id: number }[]

    for (const row of existingRows) {
      // Delete in order: deepest child first
      db.prepare(
        'DELETE FROM segment_analytics WHERE segment_id IN (SELECT id FROM segments WHERE schedule_id = ?)'
      ).run(row.id)
      db.prepare(
        'DELETE FROM sub_segments WHERE schedule_id = ?'   // ← add this line
      ).run(row.id)
      db.prepare(
        'DELETE FROM segments WHERE schedule_id = ?'
      ).run(row.id)
    }

    db.prepare('DELETE FROM schedule WHERE date = ?').run(schedule.date)

    const insert = db.prepare(`
      INSERT INTO schedule (date, segment_order, category, topic, duration_seconds, status)
      VALUES (@date, @segmentOrder, @category, @topic, @durationSeconds, @status)
    `)

    const segmentsWithIds = schedule.segments.map(seg => {
      const result = insert.run(seg)
      return { ...seg, id: result.lastInsertRowid as number }
    })

    return segmentsWithIds
  })

  const segmentsWithIds = saveTransaction()

  return {
    ...schedule,
    segments: segmentsWithIds,
  }
}

export function loadTodaySchedule(): ScheduleSegment[] {
  const db = getDatabase()
  const today = new Date().toISOString().split('T')[0]

  return db.prepare(`
    SELECT * FROM schedule WHERE date = ? ORDER BY segment_order
  `).all(today) as ScheduleSegment[]
}

export function saveArticles(articles: FetchedArticle[]): void {
  const db = getDatabase()
  const insert = db.prepare(`
    INSERT INTO fetched_articles
      (category, title, summary, source, url, fetched_at)
    VALUES
      (@category, @title, @summary, @source, @url, @fetchedAt)
  `)
  const insertMany = db.transaction((items: FetchedArticle[]) => {
    for (const item of items) insert.run(item)
  })
  insertMany(articles)
}

export function saveFinanceData(data: FinanceData[]): void {
  const db = getDatabase()
  const insert = db.prepare(`
    INSERT INTO finance_data
      (symbol, price, change, change_percent, fetched_at)
    VALUES
      (@symbol, @price, @change, @changePercent, @fetchedAt)
  `)
  const insertMany = db.transaction((items: FinanceData[]) => {
    for (const item of items) insert.run(item)
  })
  insertMany(data)
}

export function loadArticlesForCategory(category: string): FetchedArticle[] {
  const db = getDatabase()
  const today = new Date().toISOString().split('T')[0]
  return db.prepare(`
    SELECT * FROM fetched_articles
    WHERE category = ?
    AND date(fetched_at) = ?
    ORDER BY id DESC
    LIMIT 10
  `).all(category, today) as FetchedArticle[]
}

export function loadLatestFinanceData(): FinanceData[] {
  const db = getDatabase()
  return db.prepare(`
    SELECT * FROM finance_data
    ORDER BY fetched_at DESC
    LIMIT 12
  `).all() as FinanceData[]
}

export function saveGeneratedScript(
  scheduleId: number,
  script:     GeneratedScript
): number {
  const db = getDatabase()
  const result = db.prepare(`
    INSERT INTO segments
      (schedule_id, script, generated_at)
    VALUES
      (@scheduleId, @script, @generatedAt)
  `).run({
    scheduleId,
    script:      script.script,
    generatedAt: script.generatedAt,
  })
  return result.lastInsertRowid as number
}

export function loadScript(segmentId: number): string | null {
  const db     = getDatabase()
  const result = db.prepare(
    'SELECT script FROM segments WHERE id = ?'
  ).get(segmentId) as { script: string } | undefined
  return result?.script ?? null
}

export function loadLatestScript(): { script: string; category: string; topic: string } | null {
  const db = getDatabase()
  return db.prepare(`
    SELECT s.script, sc.category, sc.topic
    FROM segments s
    JOIN schedule sc ON s.schedule_id = sc.id
    ORDER BY s.generated_at DESC
    LIMIT 1
  `).get() as { script: string; category: string; topic: string } | null
}

export function saveSubSegments(subSegments: SubSegment[]): SubSegment[] {
  const db = getDatabase()

  const insert = db.prepare(`
    INSERT INTO sub_segments
      (schedule_id, article_index, category, topic, headline, script, duration_sec, generated_at)
    VALUES
      (@scheduleId, @articleIndex, @category, @topic, @headline, @script, @durationSec, @generatedAt)
  `)

  const insertMany = db.transaction((items: SubSegment[]) => {
    return items.map(item => {
      const result = insert.run(item)
      return { ...item, id: result.lastInsertRowid as number }
    })
  })

  return insertMany(subSegments)
}

export function loadSubSegments(scheduleId: number): SubSegment[] {
  const db = getDatabase()
  return db.prepare(`
    SELECT * FROM sub_segments
    WHERE schedule_id = ?
    ORDER BY article_index ASC
  `).all(scheduleId) as SubSegment[]
}

export function clearSubSegments(scheduleId: number): void {
  const db = getDatabase()
  db.prepare('DELETE FROM sub_segments WHERE schedule_id = ?').run(scheduleId)
}

export function updateSubSegmentAudio(
  subSegmentId: number,
  audioPath:    string,
  durationSec:  number
): void {
  const db = getDatabase()
  db.prepare(`
    UPDATE sub_segments
    SET audio_file_path = ?, duration_sec = ?
    WHERE id = ?
  `).run(audioPath, durationSec, subSegmentId)
}

export function loadSubSegmentsWithAudio(scheduleId: number): any[] {
  const db = getDatabase()
  return db.prepare(`
    SELECT * FROM sub_segments
    WHERE schedule_id = ?
    ORDER BY article_index ASC
  `).all(scheduleId)
}