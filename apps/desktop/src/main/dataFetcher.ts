import axios from 'axios'
import * as fs from 'fs'
import * as path from 'path'
import { Category } from '../shared/types'

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

// ── NewsAPI Fetcher ────────────────────────────────────────────────

const NEWS_CATEGORY_QUERIES: Record<Category, string> = {
  finance:  'finance OR stocks OR economy OR cryptocurrency',
  tech:     'technology OR artificial intelligence OR software OR gadgets',
  gaming:   'gaming OR video games OR esports OR game release',
  news:     'world news OR breaking news OR politics OR international',
  niche:    'science OR space OR history OR psychology OR weird',
}

export async function fetchNewsForCategory(
  category: Category,
  maxArticles: number = 5
): Promise<FetchedArticle[]> {
  const apiKey = process.env.NEWS_API_KEY
  if (!apiKey) {
    console.warn('NEWS_API_KEY not set - using fallback topics')
    return []
  }

  try {
    const query = NEWS_CATEGORY_QUERIES[category]
    const response = await axios.get('https://newsapi.org/v2/everything', {
      params: {
        q: query,
        language: 'en',
        sortBy: 'publishedAt',
        pageSize: maxArticles,
        apiKey,
      },
      timeout: 8000,
    })

    const articles = response.data.articles || []

    return articles
      .filter((a: any) => a.title && a.description)
      .map((a: any): FetchedArticle => ({
        title:     a.title,
        summary:   a.description || '',
        source:    a.source?.name || 'Unknown',
        url:       a.url || '',
        category,
        fetchedAt: new Date().toISOString(),
      }))

  } catch (err: any) {
    console.error(`News fetch failed for ${category}:`, err.message)
    return []
  }
}

// ── Finance Fetcher ────────────────────────────────────────────────

const TRACKED_SYMBOLS = ['SPY', 'QQQ', 'BTC-USD', 'ETH-USD', 'AAPL', 'NVDA']

export async function fetchFinanceData(): Promise<FinanceData[]> {
  const results: FinanceData[] = []

  for (const symbol of TRACKED_SYMBOLS) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`
      const response = await axios.get(url, {
        timeout: 8000,
        headers: {
          'User-Agent': 'Mozilla/5.0'
        }
      })

      const meta = response.data?.chart?.result?.[0]?.meta
      if (!meta) continue

      const price         = meta.regularMarketPrice ?? 0
      const prevClose     = meta.chartPreviousClose ?? price
      const change        = price - prevClose
      const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0

      results.push({
        symbol,
        price,
        change,
        changePercent,
        fetchedAt: new Date().toISOString(),
      })
    } catch (err: any) {
      console.error(`Finance fetch failed for ${symbol}:`, err.message)
    }
  }

  return results
}
// ── Combined Fetcher ───────────────────────────────────────────────

export async function fetchDataForSchedule(
  categories: Category[]
): Promise<Map<Category, FetchedArticle[]>> {
  const results = new Map<Category, FetchedArticle[]>()

  for (const category of categories) {
    console.log(`Fetching data for: ${category}`)
    const articles = await fetchNewsForCategory(category)
    results.set(category, articles)

    // Small delay to respect API rate limits
    await new Promise(resolve => setTimeout(resolve, 300))
  }

  return results
}