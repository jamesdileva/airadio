import axios from 'axios'
import * as fs from 'fs'
import * as path from 'path'
import { Category } from '../shared/types'
import { parseStringPromise } from 'xml2js'

// Load .env manually (electron doesn't use dotenv automatically)
function loadEnv(): void {
  // Try multiple possible locations
  const possiblePaths = [
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '../../../../.env'),
    path.join(__dirname, '../../../.env'),
    path.join(__dirname, '../../.env'),
  ]

  for (const envPath of possiblePaths) {
    if (fs.existsSync(envPath)) {
      console.log('Found .env at:', envPath)
      const lines = fs.readFileSync(envPath, 'utf-8').split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eqIndex = trimmed.indexOf('=')
        if (eqIndex > 0) {
          const key = trimmed.substring(0, eqIndex).trim()
          const val = trimmed.substring(eqIndex + 1).trim()
          process.env[key] = val
        }
      }
      return
    }
  }

  console.warn('.env file not found in any expected location')
}

loadEnv()

// ── Types ──────────────────────────────────────────────────────────

export interface FetchedArticle {
  title: string
  summary: string
  source: string
  url: string
  category: Category
  fetchedAt: string
}

export interface FinanceData {
  symbol: string
  price: number
  change: number
  changePercent: number
  fetchedAt: string
}

const TOPIC_GOOGLE_QUERIES: Record<string, string> = {
  // News
  'World news morning briefing':    'world news today',
  'US domestic news update':        'US news today congress white house',
  'Science and health headlines':   'science health medical research',
  'Environment and climate update': 'climate change environment',
  'Politics roundup':               'politics election congress',
  'Sports headlines':               'sports news today',
  'Entertainment and culture news': 'entertainment celebrity culture',
  'Viral stories of the day':       'trending viral news today',
  // Tech
  'AI news and breakthroughs':      'artificial intelligence AI news',
  'Big tech company updates':       'Apple Google Microsoft Meta tech news',
  'New gadgets and hardware':       'new gadgets hardware releases',
  'Cybersecurity threats':          'cybersecurity hack data breach',
  'Gaming hardware news':           'GPU gaming hardware news',
  'Space tech and satellites':      'SpaceX NASA space news',
  // Gaming
  'Top trending games this week':   'video games trending this week',
  'Upcoming game releases':         'upcoming video game releases 2026',
  'Esports results and highlights': 'esports tournament results',
  'Indie game spotlight':           'indie game new release',
  'Retro gaming corner':            'retro gaming classic games',
  'Streamer and content creator news': 'Twitch YouTube streaming news',
  // Finance
  'Stock market morning briefing':  'stock market today S&P nasdaq',
  'Cryptocurrency market update':   'bitcoin ethereum crypto market',
  'Federal Reserve latest':         'federal reserve interest rates',
  'Real estate market trends':      'real estate housing market',
  'Inflation and cost of living':   'inflation cost of living CPI',
  // Niche
  'Weird science facts':            'weird science discovery unusual',
  'History spotlight':              'history discovery archaeology',
  'Unsolved mysteries corner':      'unsolved mystery unexplained',
  'Future predictions and futurism':'future technology innovation',
  'Obscure world records':          'bizarre world record unusual achievement',
  'Internet culture and memes':     'internet culture viral meme explained',
}

const TOPIC_SUBREDDIT_MAP: Record<string, string> = {
  'Weird science facts':              'todayilearned',
  'Obscure world records':            'mildlyinteresting',
  'Internet culture and memes':       'OutOfTheLoop',
  'Future predictions and futurism':  'Futurology',
  'History spotlight':                'history',
  'Unsolved mysteries corner':        'UnresolvedMysteries',
  'Retro gaming corner':              'retrogaming',
  'Streamer and content creator news':'LivestreamFail',
  'Esports results and highlights':   'esports',
  'Indie game spotlight':             'indiegaming',
  'AI news and breakthroughs':        'artificial',
  'Cybersecurity threats this week':  'netsec',
  'Viral stories of the day':         'popular',
  'World news morning briefing':      'worldnews',
  'Entertainment and culture news':   'entertainment',
}

export async function fetchArticlesForTopic(
  topic:    string,
  category: Category,
  max:      number = 4
): Promise<FetchedArticle[]> {

  const subreddit = TOPIC_SUBREDDIT_MAP[topic]
  if (subreddit) {
    console.log(`Reddit: r/${subreddit} for "${topic}"`)
    const reddit = await fetchRedditPosts(subreddit, category, max)
    if (reddit.length >= 2) return reddit
  }

  const query  = TOPIC_GOOGLE_QUERIES[topic] ?? topic
  console.log(`Google News: "${query}"`)
  const google = await fetchGoogleNews(query, category, max)
  if (google.length >= 2) return google

  // Try simplified query as second attempt
  const shortQuery = query.split(' ').slice(0, 3).join(' ')
  if (shortQuery !== query) {
    console.log(`Retrying with simplified query: "${shortQuery}"`)
    const retry = await fetchGoogleNews(shortQuery, category, max)
    if (retry.length >= 2) return retry
  }

  console.warn(`No articles found for "${topic}"`)
  return []
}


async function fetchGoogleNews(
  query:    string,
  category: Category,
  max:      number = 5
): Promise<FetchedArticle[]> {
  try {
    const encoded  = encodeURIComponent(query)
    const url      = `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`
    const response = await axios.get(url, { timeout: 8000 })
    const parsed   = await parseStringPromise(response.data)
    const items    = parsed?.rss?.channel?.[0]?.item ?? []

    return items
      .slice(0, max + 3)
      .map((item: any): FetchedArticle => ({
        title:     (item.title?.[0] ?? '').replace(/<[^>]*>/g, '').trim(),
        summary:   (item.description?.[0] ?? '').replace(/<[^>]*>/g, '').trim(),
        source:    item.source?.[0]?._ ?? 'Google News',
        url:       item.link?.[0] ?? '',
        category,
        fetchedAt: new Date().toISOString(),
      }))
      .filter((a: FetchedArticle) => {
        if (!a.title || a.title.length < 10)          return false
        if (/[^\x00-\x7F]/.test(a.title))             return false
        if (a.title.includes('[Removed]'))             return false
        return true
      })
      .slice(0, max)
      
  } 
  catch (err: any) {
    console.error(`Google News fetch failed for "${query}":`, err.message)
    return []
  }
}

async function fetchRedditPosts(
  subreddit: string,
  category:  Category,
  max:       number = 5
): Promise<FetchedArticle[]> {
  try {
    const url      = `https://www.reddit.com/r/${subreddit}/hot.json?limit=${max + 5}`
    const response = await axios.get(url, {
      timeout: 8000,
      headers: { 'User-Agent': 'WestWaveGem/1.0' },
    })

    const posts = response.data?.data?.children ?? []
    return posts
      .filter((p: any) =>
        !p.data.stickied &&
        p.data.score > 50 &&
        p.data.title?.length > 15 &&
        !/[^\x00-\x7F]/.test(p.data.title)
      )
      .slice(0, max)
      .map((p: any): FetchedArticle => ({
        title:     p.data.title,
        summary:   p.data.selftext?.slice(0, 300) || p.data.title,
        source:    `r/${subreddit}`,
        url:       `https://reddit.com${p.data.permalink}`,
        category,
        fetchedAt: new Date().toISOString(),
      }))

  } catch (err: any) {
    console.error(`Reddit fetch failed for r/${subreddit}:`, err.message)
    return []
  }
}