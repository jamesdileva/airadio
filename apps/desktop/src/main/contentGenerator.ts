import axios from 'axios'
import { HOST } from './hostCharacter'
import { FetchedArticle, FinanceData } from './dataFetcher'
import { Category, SubSegment } from '../shared/types'

const OLLAMA_URL = 'http://localhost:11434/api/generate'
const MODEL      = 'mistral'

// ── Types ──────────────────────────────────────────────────────────

export interface GeneratedScript {
  segmentId?:  number
  category:    Category
  topic:       string
  script:      string
  durationSec: number
  generatedAt: string
}

// ── Ollama API Call ────────────────────────────────────────────────

async function callOllama(prompt: string): Promise<string> {
  const MAX_RETRIES = 2

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.post(
        OLLAMA_URL,
        {
          model:  MODEL,
          prompt,
          stream: false,
          options: {
            temperature: 0.7,
            top_p:       0.9,
            num_predict: 800,
            num_ctx:     2048,  // smaller context = less VRAM
            stop:        ['```', 'def ', 'import ', 'class '],
          },
        },
        { timeout: 120000 }
      )
      return response.data.response?.trim() ?? ''

    } catch (err: any) {
      console.error(`Ollama attempt ${attempt} failed:`, err.message)
      if (attempt < MAX_RETRIES) {
        console.log('Retrying in 5 seconds...')
        await new Promise(resolve => setTimeout(resolve, 5000))
      }
    }
  }

  throw new Error('Ollama failed after retries')
}

// ── Script Builders ────────────────────────────────────────────────

function buildNewsPrompt(
  category: Category,
  topic: string,
  articles: FetchedArticle[]
): string {
  const articleContext = articles
    .slice(0, 3)
    .map((a, i) => `Article ${i + 1}: ${a.title}\nSummary: ${a.summary}`)
    .join('\n\n')

  return `${HOST.systemPrompt}

---

SEGMENT INFO:
Category: ${category}
Topic: ${topic}
Segment length: approximately 3-5 minutes when spoken aloud

REAL HEADLINES TO DISCUSS:
${articleContext}

Write a radio script for this segment. Use the headlines above as your source material. Speak naturally as ${HOST.name}.`
}

function buildFinancePrompt(
  topic: string,
  articles: FetchedArticle[],
  financeData: FinanceData[]
): string {
  const marketContext = financeData
    .slice(0, 4)
    .map(f => {
      const sign      = f.change >= 0 ? '+' : ''
      const direction = f.change >= 0 ? 'up' : 'down'
      return `${f.symbol}: $${f.price.toFixed(2)} (${direction} ${sign}${f.changePercent.toFixed(2)}%)`
    })
    .join('\n')

  const articleContext = articles
    .slice(0, 2)
    .map((a, i) => `Headline ${i + 1}: ${a.title}\nSummary: ${a.summary}`)
    .join('\n\n')

  return `${HOST.systemPrompt}

---

SEGMENT INFO:
Category: finance
Topic: ${topic}
Segment length: approximately 3-5 minutes when spoken aloud

CURRENT MARKET DATA:
${marketContext}

FINANCE HEADLINES:
${articleContext}

Write a radio script covering today's market movement and the headlines above. Use the real numbers provided. Speak naturally as ${HOST.name}.`
}

// ── Main Generator ─────────────────────────────────────────────────

export async function generateScript(
  category:    Category,
  topic:       string,
  articles:    FetchedArticle[],
  financeData: FinanceData[] = []
): Promise<GeneratedScript> {
  console.log(`Generating script: [${category}] ${topic}`)

  const cleanArticles = articles.filter(a => {
    if (!a.title || !a.summary)        return false
    if (a.title.includes('[Removed]')) return false
    if (/[^\x00-\x7F]/.test(a.title)) return false
    return true
  })

  const prompt = category === 'finance' && financeData.length > 0
    ? buildFinancePrompt(topic, cleanArticles, financeData)
    : buildNewsPrompt(category, topic, cleanArticles)

  const rawScript = await callOllama(prompt)

  // Strip any code that slipped through
  const cleanScript = rawScript
    .split('\n')
    .filter(line => {
      const trimmed = line.trim()
      if (trimmed.startsWith('```'))       return false
      if (trimmed.startsWith('def '))      return false
      if (trimmed.startsWith('import '))   return false
      if (trimmed.startsWith('class '))    return false
      if (trimmed.includes('employee_id')) return false
      if (/\w+\s*=\s*['"]/.test(trimmed) && trimmed.includes('_')) return false
      return true
    })
    .join('\n')
    .trim()

  const wordCount   = cleanScript.split(/\s+/).length
  const durationSec = Math.round((wordCount / 150) * 60)

  return {
    category,
    topic,
    script:      cleanScript,
    durationSec,
    generatedAt: new Date().toISOString(),
  }
}

// ── Fallback Script ────────────────────────────────────────────────
// Used when Ollama is unavailable or returns empty

export function generateFallbackScript(
  category: Category,
  topic:    string
): GeneratedScript {
  const script = `This is ${HOST.name} on West Wave Gem Network. 
We're having a brief technical moment on our end, but we will be right back 
with your ${category} coverage. Stay tuned.`

  return {
    category,
    topic,
    script,
    durationSec: 15,
    generatedAt: new Date().toISOString(),
  }
}

export async function generateSubSegments(
  scheduleId:  number,
  category:    Category,
  topic:       string,
  articles:    FetchedArticle[],
  financeData: FinanceData[] = []
): Promise<SubSegment[]> {
  const results: SubSegment[] = []

  // Use finance data as articles if it's a finance segment
  const targets = articles.slice(0, 4)

  for (let i = 0; i < targets.length; i++) {
    const article = targets[i]
    console.log(`Generating sub-segment ${i + 1}/${targets.length}: ${article.title}`)

    const prompt = buildSingleArticlePrompt(
      category,
      topic,
      article,
      financeData,
      i + 1,
      targets.length
    )

    try {
      const rawScript = await callOllama(prompt)

      const cleanScript = rawScript
        .split('\n')
        .filter(line => {
          const trimmed = line.trim()
          if (trimmed.startsWith('```'))       return false
          if (trimmed.startsWith('def '))      return false
          if (trimmed.startsWith('import '))   return false
          if (trimmed.startsWith('class '))    return false
          if (trimmed.includes('employee_id')) return false
          if (/\w+\s*=\s*['"]/.test(trimmed) && trimmed.includes('_')) return false
          return true
        })
        .join('\n')
        .trim()

      const wordCount   = cleanScript.split(/\s+/).length
      const durationSec = Math.round((wordCount / 150) * 60)

        // Ensure script ends on a complete sentence (don't cut mid-sentence)
        const finalScript = cleanScript.replace(/([^.!?])(\s*)$/, '$1.')

      results.push({
        scheduleId,
        articleIndex: i,
        category,
        topic,
        headline:    article.title,
        script:      finalScript,
        durationSec,
        generatedAt: new Date().toISOString(),
      })

    } catch (err: any) {
      console.error(`Sub-segment ${i + 1} failed:`, err.message)
      // Add fallback so one failure doesn't kill the whole segment
      
      results.push({
        scheduleId,
        articleIndex: i,
        category,
        topic,
        headline:    article.title,
        script:      `We'll be right back with more ${category} coverage after a short break.`,
        durationSec: 10,
        generatedAt: new Date().toISOString(),
      })
    }
  }

  return results
}

function buildSingleArticlePrompt(
  category:    Category,
  topic:       string,
  article:     FetchedArticle,
  financeData: FinanceData[],
  partNum:     number,
  totalParts:  number
): string {
  const isFirst  = partNum === 1
  const isLast   = partNum === totalParts

  const intro = isFirst
  ? `This is the opening of the ${topic} segment. Open with "You're listening to West Wave Gem Network" then introduce the story.`
  : `This is part ${partNum} of ${totalParts}. Do NOT say "You're listening to West Wave Gem Network" — jump straight into the story with a brief transition from the previous piece.`

const outro = isLast
  ? `End with: "That's all for this segment on ${topic}. Stay tuned to West Wave Gem Network."`
  : `End with a short generic transition like "Up next on West Wave Gem Network, we have another story worth your attention." NEVER mention or hint at what the next story is about.`

  const marketContext = category === 'finance' && financeData.length > 0
    ? `\nCURRENT MARKET DATA:\n${financeData.slice(0, 4).map(f => {
        const sign = f.change >= 0 ? '+' : ''
        return `${f.symbol}: $${f.price.toFixed(2)} (${sign}${f.changePercent.toFixed(2)}%)`
      }).join('\n')}\n`
    : ''

    return `${HOST.systemPrompt}

---

SEGMENT CONTEXT:
Category: ${category}
Topic: ${topic}
${intro}
${outro}

${marketContext}
ARTICLE TO COVER:
Headline: ${article.title}
Summary:  ${article.summary}
Source:   ${article.source}

Write a 2-3 minute radio script covering this article.
Target length: 300-400 words spoken naturally.
Speak as ${HOST.name}. Use only the facts given above.`
}