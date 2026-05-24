import { Category, ScheduleSegment, DailySchedule } from '../../shared/src/types.js'
import { topicBank } from './topics'

// Segment durations in seconds
const SEGMENT_DURATIONS = [300, 600, 900] // 5, 10, or 15 minutes
const TARGET_DURATION_SECONDS = 8 * 60 * 60 // 8 hours

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0] // 'YYYY-MM-DD'
}

function getRandomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function getRandomDuration(): number {
  return SEGMENT_DURATIONS[Math.floor(Math.random() * SEGMENT_DURATIONS.length)]
}

function getTopicForCategory(category: Category, usedTopics: Set<string>): string {
  const available = topicBank[category].filter(t => !usedTopics.has(t))
  // If we've used all topics, reset and allow repeats
  const pool = available.length > 0 ? available : topicBank[category]
  const topic = getRandomItem(pool)
  usedTopics.add(topic)
  return topic
}

export function generateSchedule(
  categories: Category[],
  date: string = getTodayDate()
): DailySchedule {
  if (categories.length === 0) {
    throw new Error('At least one category must be selected')
  }

  const segments: ScheduleSegment[] = []
  const usedTopics = new Set<string>()
  let totalSeconds = 0
  let order = 1

  while (totalSeconds < TARGET_DURATION_SECONDS) {
    const remaining = TARGET_DURATION_SECONDS - totalSeconds
    const duration = Math.min(getRandomDuration(), remaining)

    const category = getRandomItem(categories)
    const topic = getTopicForCategory(category, usedTopics)

    segments.push({
      date,
      segmentOrder: order,
      category,
      topic,
      durationSeconds: duration,
      status: 'pending',
    })

    totalSeconds += duration
    order++
  }

  return {
    date,
    segments,
    totalDurationSeconds: totalSeconds,
  }
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${s}s`
}