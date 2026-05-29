import { Category, ScheduleSegment, DailySchedule } from '../shared/types'

const SEGMENT_DURATIONS = [300, 600, 900]
const TARGET_DURATION_SECONDS = 8 * 60 * 60

const topicBank: Record<Category, string[]> = {
  finance: [
    'Stock market morning briefing',
    'Cryptocurrency market update',
    'Federal Reserve latest decisions',
    'Personal finance tips for beginners',
    'Real estate market trends',
    'Inflation and cost of living update',
    'Top performing ETFs this week',
    'Small business finance spotlight',
  ],
  tech: [
    'AI news and breakthroughs',
    'Big tech company updates',
    'New gadgets and hardware releases',
    'Cybersecurity threats this week',
    'Open source software spotlight',
    'Gaming hardware news',
    'Space tech and satellite updates',
    'Mobile app trends',
  ],
  gaming: [
    'Top trending games this week',
    'Upcoming game releases',
    'Esports results and highlights',
    'Indie game spotlight',
    'Gaming industry business news',
    'Retro gaming corner',
    'Game patch and update roundup',
    'Streamer and content creator news',
  ],
  news: [
    'World news morning briefing',
    'US domestic news update',
    'Science and health headlines',
    'Environment and climate update',
    'Politics roundup',
    'Sports headlines',
    'Entertainment and culture news',
    'Viral stories of the day',
  ],
  niche: [
    'Weird science facts',
    'History spotlight',
    'Deep dive: how everyday things work',
    'Unsolved mysteries corner',
    'Internet culture and memes explained',
    'Obscure world records',
    'Behind the scenes of major industries',
    'Future predictions and futurism',
  ],
}

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0]
}

function getRandomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function getRandomDuration(): number {
  return SEGMENT_DURATIONS[Math.floor(Math.random() * SEGMENT_DURATIONS.length)]
}

function getTopicForCategory(category: Category, usedTopics: Set<string>): string {
  const available = topicBank[category].filter(t => !usedTopics.has(t))
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

  const segments:    ScheduleSegment[] = []
  const usedTopics = new Set<string>()
  let totalSeconds = 0
  let order        = 1
  let categoryIdx  = 0  // round-robin index

  while (totalSeconds < TARGET_DURATION_SECONDS) {
    const remaining = TARGET_DURATION_SECONDS - totalSeconds
    const duration  = Math.min(getRandomDuration(), remaining)

    // Round-robin through categories instead of random
    const category = categories[categoryIdx % categories.length]
    categoryIdx++

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

  return { date, segments, totalDurationSeconds: totalSeconds }
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${seconds}s`
}