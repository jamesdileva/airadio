export type Category = 'finance' | 'tech' | 'gaming' | 'news' | 'niche'

export type SegmentStatus = 'pending' | 'active' | 'completed'

export interface ScheduleSegment {
  id?: number
  date: string
  segmentOrder: number
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

export type StreamStatus = 'idle' | 'generating' | 'rendering' | 'broadcasting' | 'stopped'

export type Platform = 'youtube' | 'twitch'

export interface RadioConfig {
  selectedCategories: Category[]
  streamPlatform: Platform
  hostName: string
  streamStartHour: number
  targetDurationHours: number
}

export interface SubSegment {
  id?:              number
  scheduleId:       number
  articleIndex:     number
  category:         Category
  topic:            string
  headline:         string
  script:           string
  durationSec:      number
  generatedAt:      string
  audioFilePath?:   string    // ← add
  mixedAudioPath?:  string    // ← add
  // SQLite snake_case versions
  audio_file_path?: string    // ← add
  mixed_audio_path?: string   // ← add
}