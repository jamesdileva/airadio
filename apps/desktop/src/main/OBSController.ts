import SockJS from 'sockjs-client'
import * as fs   from 'fs'
import * as path from 'path'

function loadEnv(): void {
  const possiblePaths = [
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '../../../../.env'),
    path.join(__dirname, '../../../.env'),
    path.join(__dirname, '../../.env'),
  ]
  for (const envPath of possiblePaths) {
    if (fs.existsSync(envPath)) {
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
}

// Load immediately when module is imported
loadEnv()

// ── Config ────────────────────────────────────────────────────────

export const SCENES = {
  STARTING: 'Starting',
  ON_AIR:   'On Air',
  BREAK:    'Break',
} as const

export type SceneName = typeof SCENES[keyof typeof SCENES]

export interface OBSStatus {
  connected:    boolean
  currentScene: string | null
  streaming:    boolean
  error?:       string
}

export interface OBSConfig {
  host:     string
  port:     number
  password: string  // API token
}

// ── State ─────────────────────────────────────────────────────────

let socket:       any     = null
let isConnected:  boolean = false
let currentScene: string | null = null
let nextId:       number  = 1
const pending:    Map<number, { resolve: Function; reject: Function }> = new Map()
const subs:       Map<string, Function> = new Map()

// ── Core Message Handler ──────────────────────────────────────────

function onMessage(data: string) {
  try {
    const msg = JSON.parse(data)
    
    // Handle request responses
    const req = pending.get(msg.id)
    if (req) {
      pending.delete(msg.id)
      if (msg.error) req.reject(new Error(msg.error.message))
      else req.resolve(msg.result)
      return
    }

    // Handle subscription events
    const result = msg.result
    if (result?._type === 'EVENT' && result?.emitter === 'STREAM') {
      const cb = subs.get(result.resourceId)
      if (cb) cb(result.data)
    }
  } catch (err) {
    // ignore parse errors
  }
}

// ── Request Helper ────────────────────────────────────────────────

function request(resourceId: string, method: string, ...args: any[]): Promise<any> {
  return new Promise((resolve, reject) => {
    // During auth, socket exists but isConnected isn't set yet
    // so check socket directly instead of isConnected
    if (!socket) {
      reject(new Error('Not connected to Streamlabs'))
      return
    }

    const id = nextId++
    const body = {
      jsonrpc: '2.0',
      id,
      method,
      params: { resource: resourceId, args }
    }

    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify(body))

    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error(`Request timed out: ${method}`))
      }
    }, 8000)
  })
}

function subscribe(resourceId: string, channel: string, cb: Function): void {
  request(resourceId, channel).then((info: any) => {
    subs.set(info.resourceId, cb)
  }).catch(console.error)
}

// ── Connection ────────────────────────────────────────────────────

export async function connectOBS(config: OBSConfig): Promise<OBSStatus> {
    
  return new Promise((resolve) => {
    if (socket && isConnected) {
      resolve(getStatus())
      return
    }
     // Use .env values as fallback if config fields are empty
    if (!config.password) {
        config.password = process.env.STREAMLABS_TOKEN || ''
    }
    if (!config.port || config.port === 4455) {
        config.port = parseInt(process.env.STREAMLABS_PORT || '59650')
    } 

    const url = `http://${config.host}:${config.port}/api`
    console.log(`Connecting to Streamlabs at ${url}...`)

    socket = new SockJS(url)

    const timeout = setTimeout(() => {
      socket?.close()
      socket = null
      resolve({
        connected:    false,
        currentScene: null,
        streaming:    false,
        error:        'Connection timed out',
      })
    }, 10000)

    socket.onopen = () => {
      console.log('Socket open, authenticating...')
      // Authenticate with token
      request('TcpServerService', 'auth', config.password)
        .then(async () => {
          clearTimeout(timeout)
          isConnected = true
          console.log('Streamlabs authenticated!')

          // Get current scene
          try {
            const scenes = await request('ScenesService', 'getScenes')
            const activeId = await request('ScenesService', 'activeSceneId')
            const active = scenes.find((s: any) => s.id === activeId)
            currentScene = active?.name ?? null
            console.log('Current scene:', currentScene)
            // Push initial scene to renderer
            try {
              const { BrowserWindow } = require('electron')
              BrowserWindow.getAllWindows().forEach((win: any) => {
                win.webContents.send('obs:sceneChanged', currentScene)
              })
            } catch {}
            // Subscribe to scene switches
            subscribe('ScenesService', 'sceneSwitched', (scene: any) => {
              currentScene = scene.name
              console.log('Scene switched to:', currentScene)
                // Push to renderer
                try {
                  const { BrowserWindow } = require('electron')
                  BrowserWindow.getAllWindows().forEach((win: any) => {
                    win.webContents.send('obs:sceneChanged', scene.name)
                  })
                } catch {}
              })

          } catch (err) {
            console.warn('Could not get scenes:', err)
          }

          resolve(getStatus())
        })
        .catch((err: Error) => {
          clearTimeout(timeout)
          socket?.close()
          socket      = null
          isConnected = false
          resolve({
            connected:    false,
            currentScene: null,
            streaming:    false,
            error:        `Auth failed: ${err.message}`,
          })
        })
    }

    socket.onmessage = (e: any) => {
      onMessage(e.data)
      // Parse scene switch events
      try {
        const msg = JSON.parse(e.data)
        if (msg?.result?.resourceId === 'ScenesService.activeSceneChanged') {
          currentScene = msg?.result?.data?.name ?? currentScene
          console.log('Scene changed to:', currentScene)
          // ADD THIS — push to renderer
          try {
            const { BrowserWindow } = require('electron')
            BrowserWindow.getAllWindows().forEach((win: any) => {
              win.webContents.send('obs:sceneChanged', currentScene)
            })
          } catch {}
        }
      } catch {}
    }

    socket.onclose = () => {
      console.log('Streamlabs disconnected')
      isConnected  = false
      currentScene = null
      socket       = null
    }

    socket.onerror = (err: any) => {
      console.error('Socket error:', err)
    }
  })
}

export async function disconnectOBS(): Promise<void> {
  if (socket) {
    socket.close()
    socket       = null
    isConnected  = false
    currentScene = null
  }
}

// ── Scene Control ─────────────────────────────────────────────────
// Cache scenes after first fetch
let cachedScenes: { id: string; name: string }[] = []

export async function switchScene(sceneName: string): Promise<boolean> {
  try {
    // Refresh cache if empty
    if (cachedScenes.length === 0) {
      const result = await request('ScenesService', 'getSceneNames')
      // getSceneNames returns simpler format
      cachedScenes = result.map((s: any) => ({
        id:   s.id   ?? s,
        name: s.name ?? s,
      }))
    }

    const scene = cachedScenes.find((s: any) => s.name === sceneName)
    if (!scene) {
      // Try fetching full scene list as fallback
      const scenes = await request('ScenesService', 'getScenes')
      cachedScenes = scenes
      const found  = cachedScenes.find((s: any) => s.name === sceneName)
      if (!found) {
        console.error(`Scene not found: ${sceneName}`)
        return false
      }
      await request('ScenesService', 'makeSceneActive', found.id)
    } else {
      await request('ScenesService', 'makeSceneActive', scene.id)
    }

    currentScene = sceneName
    console.log('Switched to scene:', sceneName)

    // Push directly to renderer — don't wait for event
    try {
      const { BrowserWindow } = require('electron')
      BrowserWindow.getAllWindows().forEach((win: any) => {
        win.webContents.send('obs:sceneChanged', sceneName)
      })
    } catch {}

    return true
  } catch (err: any) {
    console.error('Scene switch failed:', err.message)
    cachedScenes = [] // clear cache on error
    return false
  }
}

// Populate cache on connect
export async function getScenes(): Promise<string[]> {
  try {
    cachedScenes = await request('ScenesService', 'getScenes')
    return cachedScenes.map((s: any) => s.name)
  } catch (err: any) {
    console.error('Get scenes failed:', err.message)
    return []
  }
}

// ── Stream Control ────────────────────────────────────────────────

export async function startStreaming(): Promise<boolean> {
  try {
    await request('StreamingService', 'startStreaming')
    console.log('Stream started')
    return true
  } catch (err: any) {
    console.error('Start stream failed:', err.message)
    return false
  }
}

export async function stopStreaming(): Promise<boolean> {
  try {
    await request('StreamingService', 'stopStreaming')
    console.log('Stream stopped')
    return true
  } catch (err: any) {
    console.error('Stop stream failed:', err.message)
    return false
  }
}

export async function getStreamStatus(): Promise<{ streaming: boolean }> {
  try {
    const status = await request('StreamingService', 'getModel')
    return { streaming: status?.streamingStatus === 'live' }
  } catch {
    return { streaming: false }
  }
}

// ── Status ────────────────────────────────────────────────────────

export function getStatus(): OBSStatus {
  return {
    connected:    isConnected,
    currentScene: currentScene,
    streaming:    false,
  }
}

export function isOBSConnected(): boolean {
  return isConnected
}

export async function updateLowerThird(topic: string): Promise<void> {
  // Placeholder — lower third automation requires a text source
  // named "Lower Third" in Streamlabs with GDI+ or similar
  // Sprint 10 polish item
  console.log(`[Lower Third] ${topic}`)
}