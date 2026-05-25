// ─── Schedule Types ───────────────────────────────────────────────

export type Category = 'finance' | 'tech' | 'gaming' | 'news' | 'niche'

export type SegmentStatus = 'pending' | 'active' | 'completed'

export interface ScheduleSegment {
  id?: number
  date: string               // 'YYYY-MM-DD'
  segmentOrder: number       // 1, 2, 3...
  category: Category
  topic: string
  durationSeconds: number
  status: SegmentStatus
}

export interface DailySchedule {
  date: string
  segments: ScheduleSegment[]
  totalDurationSeconds: number
}

// ─── Stream Types ─────────────────────────────────────────────────

export type StreamStatus = 'idle' | 'generating' | 'rendering' | 'broadcasting' | 'stopped'

export type Platform = 'youtube' | 'twitch'

// ─── Config Types ─────────────────────────────────────────────────

export interface RadioConfig {
  selectedCategories: Category[]
  streamPlatform: Platform
  hostName: string
  streamStartHour: number    // 0-23, default 8 (8am)
  targetDurationHours: number // default 8
}

