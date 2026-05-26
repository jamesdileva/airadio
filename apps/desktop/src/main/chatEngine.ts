import * as tmi  from 'tmi.js'
import * as fs   from 'fs'
import * as path from 'path'
import axios     from 'axios'
import { HOST }  from './hostCharacter'

// ── Types ──────────────────────────────────────────────────────────

export interface ChatMessage {
  id:          string
  username:    string
  message:     string
  receivedAt:  string
  responded:   boolean
  response?:   string
}

export interface ChatResponse {
  question:   string
  username:   string
  response:   string
  audioPath?: string
}

// ── State ─────────────────────────────────────────────────────────

let client:       tmi.Client | null = null
let isConnected:  boolean           = false
let messageQueue: ChatMessage[]     = []
const MAX_QUEUE   = 50

// ── Load .env ─────────────────────────────────────────────────────

function loadEnv(): void {
  const possiblePaths = [
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '../../../../.env'),
    path.join(__dirname, '../../../.env'),
  ]
  for (const envPath of possiblePaths) {
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf-8').split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq > 0) {
          process.env[trimmed.substring(0, eq).trim()] = trimmed.substring(eq + 1).trim()
        }
      }
      return
    }
  }
}

loadEnv()

// ── Connection ────────────────────────────────────────────────────

export async function connectChat(): Promise<{ success: boolean; error?: string }> {
  const channel  = process.env.TWITCH_CHANNEL      || ''
  const username = process.env.TWITCH_BOT_USERNAME  || ''
  const token    = process.env.TWITCH_OAUTH_TOKEN   || ''

  if (!channel || !token) {
    return { success: false, error: 'TWITCH_CHANNEL and TWITCH_OAUTH_TOKEN required in .env' }
  }

  try {
    client = new tmi.Client({
        options: { debug: true },  // ← enable full debug logging
        connection: {
            reconnect: true,
            secure:    true,
        },
        identity: {
            username: process.env.TWITCH_CHANNEL || '',
            password: process.env.TWITCH_OAUTH_TOKEN || '',
        },
        channels: [`#${process.env.TWITCH_CHANNEL || ''}`],  // ← add # prefix
    })
    
    const recentIds = new Set<string>()

    client.on('message', (_channel, tags, message, self) => {
      if (self) return  // ignore bot's own messages
        // Deduplicate FIRST before doing anything else
        const msgId = tags.id || ''
        if (msgId && recentIds.has(msgId)) return
        if (msgId) {
            recentIds.add(msgId)
            if (recentIds.size > 100) {
            const first = recentIds.values().next().value
            if (first !== undefined) recentIds.delete(first)
            }
        }
      console.log(`[Chat] ${tags['display-name']}: ${message}`)
      const username = tags['display-name'] || tags.username || 'viewer'
      console.log(`[Chat] ${username}: ${message}`)

      // Add to queue
      if (messageQueue.length >= MAX_QUEUE) {
        messageQueue.shift()  // remove oldest
      }

      messageQueue.push({
        id:         tags.id || Date.now().toString(),
        username,
        message:    message.trim(),
        receivedAt: new Date().toISOString(),
        responded:  false,
      })
    })
    
    // Chat event listener
    client.on('notice', (_channel, msgid, message) => {
        console.log(`[Chat Notice] ${msgid}: ${message}`)
    })

    client.on('connected', (addr, port) => {
      console.log(`Chat connected to ${addr}:${port}`)
      isConnected = true
    })

    client.on('disconnected', (reason) => {
      console.log('Chat disconnected:', reason)
      isConnected = false
    })

    await client.connect()
    return { success: true }

  } catch (err: any) {
    console.error('Chat connection failed:', err.message)
    return { success: false, error: err.message }
  }
}

export async function disconnectChat(): Promise<void> {
  if (client) {
    await client.disconnect()
    client      = null
    isConnected = false
    console.log('Chat disconnected')
  }
}

// ── Queue Management ──────────────────────────────────────────────

export function getMessageQueue(): ChatMessage[] {
  return [...messageQueue]
}

export function clearQueue(): void {
  messageQueue = []
}

export function getUnrespondedMessages(): ChatMessage[] {
  return messageQueue.filter(m => !m.responded)
}

export function isChatConnected(): boolean {
  return isConnected
}

// ── Question Picker ───────────────────────────────────────────────

export async function pickBestQuestion(
  messages: ChatMessage[]
): Promise<ChatMessage | null> {
  if (messages.length === 0) return null

  // Filter for actual questions
  const questions = messages.filter(m =>
    m.message.includes('?') ||
    m.message.toLowerCase().startsWith('what') ||
    m.message.toLowerCase().startsWith('how') ||
    m.message.toLowerCase().startsWith('why') ||
    m.message.toLowerCase().startsWith('who') ||
    m.message.toLowerCase().startsWith('when') ||
    m.message.toLowerCase().startsWith('tell me') ||
    m.message.toLowerCase().startsWith('can you')
  )

  // Prefer questions, fall back to any message
  const pool = questions.length > 0 ? questions : messages

  // Pick a random one from the pool for variety
  return pool[Math.floor(Math.random() * pool.length)]
}

// ── Response Generator ────────────────────────────────────────────

export async function generateChatResponse(
  msg: ChatMessage
): Promise<string> {
  const prompt = `${HOST.systemPrompt}

---

A viewer named ${msg.username} has sent this message in the chat:
"${msg.message}"

Respond as ${HOST.name} in 2-4 sentences. Be warm and engaging.
If it is a question, answer it factually.
If it is a comment, acknowledge it with personality.
Keep it brief — this is a quick live chat response, not a full segment.
Do not start with "You're listening to AI Radio Network".
Address ${msg.username} by name once.`

  try {
    const response = await axios.post(
      'http://localhost:11434/api/generate',
      {
        model:  'mistral',
        prompt,
        stream: false,
        options: {
          temperature: 0.8,
          num_predict: 150,
          stop: ['```', '\n\n\n'],
        },
      },
      { timeout: 60000 }
    )
    return response.data.response?.trim() ?? ''
  } catch (err: any) {
    console.error('Chat response generation failed:', err.message)
    return `Thanks for the message ${msg.username}, great to have you in the chat!`
  }
}

// ── Full Chat Response Pipeline ───────────────────────────────────

export async function processChatWindow(
  maxResponses: number = 3
): Promise<ChatResponse[]> {
  const unresponded = getUnrespondedMessages()
  if (unresponded.length === 0) {
    console.log('No chat messages to respond to')
    return []
  }

  console.log(`Processing chat window: ${unresponded.length} messages, responding to ${maxResponses}`)

  const responses: ChatResponse[] = []
  const toRespond: ChatMessage[]  = []

  // Pick up to maxResponses questions
  const pool = [...unresponded]
  while (toRespond.length < maxResponses && pool.length > 0) {
    const picked = await pickBestQuestion(pool)
    if (!picked) break
    toRespond.push(picked)
    pool.splice(pool.indexOf(picked), 1)
  }

  for (const msg of toRespond) {
    console.log(`Generating response for ${msg.username}: "${msg.message}"`)

    const response = await generateChatResponse(msg)

    // Mark as responded
    const queueMsg = messageQueue.find(m => m.id === msg.id)
    if (queueMsg) {
      queueMsg.responded = true
      queueMsg.response  = response
    }

    responses.push({
      question:  msg.message,
      username:  msg.username,
      response,
    })
  }

  return responses
}

async function refreshToken(): Promise<string | null> {
  const clientId     = process.env.TWITCH_CLIENT_ID     || ''
  const clientSecret = process.env.TWITCH_CLIENT_SECRET || ''
  const refreshToken = process.env.TWITCH_REFRESH_TOKEN || ''

  if (!clientId || !clientSecret || !refreshToken) return null

  try {
    const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
      params: {
        grant_type:    'refresh_token',
        refresh_token: refreshToken,
        client_id:     clientId,
        client_secret: clientSecret,
      }
    })

    const newToken = `oauth:${response.data.access_token}`
    console.log('Token refreshed successfully')
    return newToken
  } catch (err: any) {
    console.error('Token refresh failed:', err.message)
    return null
  }
}