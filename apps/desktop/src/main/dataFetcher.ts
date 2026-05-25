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
  finance:  'stock market OR federal reserve OR inflation OR economy OR cryptocurrency OR earnings',
  tech:     'artificial intelligence OR cybersecurity OR apple OR google OR microsoft OR startup',
  gaming:   'video game OR playstation OR xbox OR nintendo OR esports OR game release OR steam',
  news:     'politics OR climate OR health OR international OR election OR congress OR diplomacy',
  niche:    'space exploration OR scientific discovery OR psychology OR archaeology OR future technology',
}

const TOPIC_QUERY_MAP: Record<string, string> = {
  // News topics
  'World news morning briefing': '"world news" OR "international" OR war OR sanctions OR "foreign policy" OR diplomat',
  'US domestic news update':     'congress OR "white house" OR senate OR "supreme court" OR president OR legislation',
  'Science and health headlines':   'medical research OR disease OR NASA OR climate science OR health study',
  'Environment and climate update': 'climate change OR emissions OR wildfire OR flooding OR energy policy',
  'Politics roundup':            'election OR congress OR senate OR "white house" OR "political party" OR legislation',
  'Sports headlines':               'NFL OR NBA OR soccer OR olympics OR championship OR tournament',
  'Entertainment and culture news': 'film OR music OR celebrity OR art OR culture OR streaming',
  'Viral stories of the day':       'trending OR viral OR social media OR internet OR popular',

  // Tech topics
  'AI news and breakthroughs':        'artificial intelligence OR machine learning OR OpenAI OR Google AI OR LLM',
  'Big tech company updates':         'Apple OR Google OR Microsoft OR Meta OR Amazon earnings OR announcement',
  'New gadgets and hardware releases':'smartphone OR laptop OR hardware release OR product launch OR review',
  'Cybersecurity threats this week':  'cybersecurity OR hack OR data breach OR ransomware OR vulnerability',
  'Open source software spotlight':   'open source OR Linux OR GitHub OR developer tools OR programming',
  'Gaming hardware news':             'GPU OR graphics card OR gaming PC OR console hardware OR processor',
  'Space tech and satellite updates': 'SpaceX OR NASA OR satellite OR rocket launch OR space exploration',
  'Mobile app trends':                'iOS OR Android OR app store OR mobile app OR smartphone software',

  // Gaming topics
  'Top trending games this week':         'video game sales OR trending game OR most played OR game charts',
  'Upcoming game releases':               'game release date OR coming soon OR announced game OR game trailer',
  'Esports results and highlights':       'esports OR tournament OR competitive gaming OR championship OR prize pool',
  'Indie game spotlight':                 'indie game OR independent developer OR Steam OR itch.io OR small studio',
  'Gaming industry business news':        'gaming company OR acquisition OR publisher OR game studio OR revenue',
  'Retro gaming corner':                  'retro game OR classic game OR remake OR remaster OR nostalgic gaming',
  'Game patch and update roundup':        'game update OR patch notes OR bug fix OR game patch OR DLC',
  'Streamer and content creator news':    'Twitch OR YouTube gaming OR streamer OR content creator OR livestream',

  // Finance topics
  'Stock market morning briefing':        'stock market OR S&P 500 OR dow jones OR nasdaq OR market rally',
  'Cryptocurrency market update':         'bitcoin OR ethereum OR crypto market OR blockchain OR digital currency',
  'Federal Reserve latest decisions':     'federal reserve OR interest rates OR inflation OR monetary policy OR Powell',
  'Personal finance tips for beginners':  'personal finance OR savings OR budgeting OR investing tips OR financial advice',
  'Real estate market trends':            'real estate OR housing market OR mortgage rates OR home prices OR property',
  'Inflation and cost of living update':  'inflation OR cost of living OR consumer prices OR CPI OR purchasing power',
  'Top performing ETFs this week':        'ETF OR index fund OR vanguard OR blackrock OR fund performance',
  'Small business finance spotlight':     'small business OR entrepreneur OR startup funding OR business loan OR SMB',

  // Niche topics
  'Weird science facts':                  'scientific discovery OR unusual research OR bizarre study OR science experiment',
  'History spotlight':                    'historical discovery OR archaeology OR ancient history OR museum OR artifact',
  'Deep dive: how everyday things work':  'engineering OR how it works OR manufacturing OR technology explained OR science',
  'Unsolved mysteries corner':            'unsolved mystery OR cold case OR unexplained OR paranormal OR investigation',
  'Internet culture and memes explained': 'internet culture OR meme OR social media trend OR viral OR online community',
  'Obscure world records':                'bizarre world record OR strangest record OR unusual achievement OR Guinness weird OR oddest record',
  'Behind the scenes of major industries':'industry insider OR supply chain OR manufacturing OR business operations',
  'Future predictions and futurism':      'future technology OR prediction OR innovation OR emerging technology OR forecast',
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
        q:        query,
        language: 'en',
        sortBy:   'publishedAt',
        pageSize: maxArticles,    // ← maxArticles not max
        apiKey,
        domains:  'bbc.com,reuters.com,apnews.com,theverge.com,techcrunch.com,ign.com,polygon.com,bloomberg.com,cnbc.com,wired.com,arstechnica.com,gamespot.com',
      },
      timeout: 8000,
    })

    const articles = response.data.articles || []
    return articles
      .filter((a: any) => {
        if (!a.title || !a.description)           return false
        if (a.title.includes('[Removed]'))        return false
        if (/[^\x00-\x7F]/.test(a.title))        return false
        if (/driver\s+\d+\.\d+/i.test(a.title))  return false
        if (/version\s+\d+\.\d+/i.test(a.title)) return false
        if (/github\.com/i.test(a.title))         return false
        if (/anime/i.test(a.title))               return false
        if (/k-pop/i.test(a.title))               return false
        if (/CNG|LNG|GATC/i.test(a.title))        return false
        if (a.title.split(/\s+/).length < 5)      return false
        return true
      })
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

export async function fetchArticlesForTopic(
  topic:    string,
  category: Category,
  max:      number = 4
): Promise<FetchedArticle[]> {
  const apiKey = process.env.NEWS_API_KEY
  if (!apiKey) return []

  const query = TOPIC_QUERY_MAP[topic] ?? topic
  console.log(`Topic "${topic}" → query: "${query}"`)

  try {
    const response = await axios.get('https://newsapi.org/v2/everything', {
      params: {
        q:        query,
        language: 'en',
        sortBy:   'publishedAt',
        pageSize: max + 3,        // ← fetch extra to account for filtering
        apiKey,
        domains:  'bbc.com,reuters.com,apnews.com,theverge.com,techcrunch.com,ign.com,polygon.com,bloomberg.com,cnbc.com,wired.com,arstechnica.com,gamespot.com',
      },
      timeout: 8000,
    })

    const articles = response.data.articles || []
    const isSportsTopic = topic.toLowerCase().includes('sport')

    const filtered = articles
      .filter((a: any) => {
        if (!a.title || !a.description)           return false
        if (a.title.includes('[Removed]'))        return false
        if (/[^\x00-\x7F]/.test(a.title))        return false
        if (/driver\s+\d+\.\d+/i.test(a.title))  return false
        if (/version\s+\d+\.\d+/i.test(a.title)) return false
        if (/github\.com/i.test(a.title))         return false
        if (a.title.split(/\s+/).length < 5)      return false
        // Sports filter — only apply to non-sports topics
        if (!isSportsTopic) {
          if (/WSL|relegation|premier league|football club|heavyweight|boxing|UFC|NBA|NFL|cricket/i.test(a.title)) return false
        }
        // Add to filter block in fetchArticlesForTopic:
        if (/sport\.bbc|bbc\.com\/sport/i.test(a.url))  return false
        if (/bleacherreport|skysports|espn\.com/i.test(a.url)) return false
        return true
      })
      .slice(0, max)              // trim back down to max after filtering
      .map((a: any): FetchedArticle => ({
        title:     a.title,
        summary:   a.description || '',
        source:    a.source?.name || 'Unknown',
        url:       a.url || '',
        category,
        fetchedAt: new Date().toISOString(),
      }))

    if (filtered.length === 0) {
      console.log(`No results for mapped query, falling back to category`)
      return fetchNewsForCategory(category, max)
    }

    return filtered

  } catch (err: any) {
    console.error(`Topic fetch failed for "${topic}":`, err.message)
    return fetchNewsForCategory(category, max)
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