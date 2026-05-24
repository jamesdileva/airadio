import Database from 'better-sqlite3'
import path from 'path'
import { app } from 'electron'
import { ScheduleSegment, DailySchedule } from '../shared/types'

let db: Database.Database

export function initDatabase(): Database.Database {
  const dbPath = path.join(app.getPath('userData'), 'radio.db')
  db = new Database(dbPath)

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  createTables(db)
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
  `)
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error('Database not initialized')
  return db
}



export function saveSchedule(schedule: DailySchedule): void {
  const db = getDatabase()

  // Clear existing schedule for this date
  db.prepare('DELETE FROM schedule WHERE date = ?').run(schedule.date)

  const insert = db.prepare(`
    INSERT INTO schedule (date, segment_order, category, topic, duration_seconds, status)
    VALUES (@date, @segmentOrder, @category, @topic, @durationSeconds, @status)
  `)

  const insertMany = db.transaction((segments: ScheduleSegment[]) => {
    for (const seg of segments) {
      insert.run(seg)
    }
  })

  insertMany(schedule.segments)
}

export function loadTodaySchedule(): ScheduleSegment[] {
  const db = getDatabase()
  const today = new Date().toISOString().split('T')[0]

  return db.prepare(`
    SELECT * FROM schedule WHERE date = ? ORDER BY segment_order
  `).all(today) as ScheduleSegment[]
}
