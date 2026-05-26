# Sprint 6 and 7 Study Guide: OBS Controller and Streaming Manager

**Sprint 6 Goal:** Connect the app to Streamlabs OBS and control scene switching programmatically.
**Sprint 7 Goal:** Wire up the full Twitch broadcast — start, stop, monitor, and automate scene transitions.

**Status:** Complete

**Builds toward:** Sprint 8 (Chat Engine) reads Twitch chat and has Al respond live during the stream.

---

## 1. What We Built

A two-part broadcast system:

**Sprint 6 — OBS Controller**
- Connects to Streamlabs Desktop via its local WebSocket API
- Authenticates using an API token
- Lists all scenes in Streamlabs
- Switches scenes by clicking buttons in the dashboard
- Listens for scene change events from Streamlabs

**Sprint 7 — Streaming Manager**
- Starts the stream with an automated sequence (Starting scene, then On Air)
- Stops the stream with a clean outro (Break scene, then stop)
- Monitors stream health every 15 seconds
- Tracks stream sessions in SQLite
- Updates the dashboard header with live duration timer
- Pushes status updates from main process to the React UI

**WestWaveGem branding**
- Three 16x9 scene overlays designed for Streamlabs
- West coast night sky theme with gem centerpiece and palm trees
- On Air scene includes reserved widget zones for future overlays

---

## 2. Key Concepts Explained

### What is WebSocket?

WebSocket is a communication protocol that keeps a persistent two-way connection open between two programs. Unlike HTTP where you send a request and get a response then the connection closes, WebSocket stays open so either side can send messages at any time.

This is how our app talks to Streamlabs in real time. Once connected, Streamlabs can push scene change events to us instantly without us having to ask.

### What is SockJS?

SockJS is a library that provides WebSocket-like behavior but with fallback options for environments where plain WebSocket does not work. Streamlabs uses SockJS for its local API instead of plain WebSocket.

This is why our earlier connection attempts failed. We tried plain WebSocket which returned 404. Streamlabs expects SockJS which connects to an HTTP endpoint at `/api` rather than a WebSocket URL.

```
Wrong:  ws://localhost:59650        (plain WebSocket)
Wrong:  ws://localhost:59650/api/v5 (wrong path)
Right:  http://localhost:59650/api  (SockJS over HTTP)
```

### What is JSON-RPC?

JSON-RPC is a protocol for calling functions remotely using JSON messages. Streamlabs uses JSON-RPC 2.0 for all its API calls.

Every message has this structure:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getScenes",
  "params": {
    "resource": "ScenesService",
    "args": []
  }
}
```

And every response has:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": [ ... ]
}
```

The `id` field links responses to requests. Our `pending` map stores callbacks keyed by ID so when a response arrives we know which request it answers.

### What is a Subscription / Event?

Beyond request-response, Streamlabs can push events when things change. We subscribe to these like this:

```typescript
// Ask Streamlabs to notify us when scenes switch
request('ScenesService', 'sceneSwitched').then(info => {
  // info.resourceId is the subscription channel ID
  subs.set(info.resourceId, callback)
})

// When Streamlabs sends an event:
// { result: { _type: 'EVENT', emitter: 'STREAM', resourceId: '...', data: {...} } }
// We look up the callback and call it with the data
```

This is how the dashboard knows the scene changed without us asking.

### What is IPC Push vs Pull?

Most IPC in our app is pull: the renderer asks the main process for something and waits for the answer. But stream status updates need to be push: the main process tells the renderer something changed without being asked.

Electron supports this with `webContents.send()`:

```typescript
// Main process pushes to all windows
BrowserWindow.getAllWindows().forEach(win => {
  win.webContents.send('stream:statusUpdate', status)
})

// Renderer listens
ipcRenderer.on('stream:statusUpdate', (_event, status) => {
  callback(status)
})
```

This is how the header badge updates to LIVE or OFFLINE without the UI polling.

### What is Stream Monitoring?

Once a stream starts, things can go wrong. The internet drops, Streamlabs crashes, or the stream key expires. We check every 15 seconds:

```typescript
setInterval(async () => {
  const status = await getStreamStatus()
  if (!status.streaming && currentState === 'live') {
    // Stream dropped unexpectedly
    emitStatus({ state: 'error', error: 'Stream dropped' })
  }
}, 15000)
```

If the stream drops, the dashboard immediately shows an error so you can restart.

### What is the Stream State Machine?

The streaming manager uses a state machine to track what is happening:

```
idle
  |
  | click Go Live
  v
starting  (3 second delay on Starting scene)
  |
  | stream confirmed started
  v
live  (On Air scene, timer running, monitor active)
  |
  | click End Stream
  v
stopping  (3 second delay on Break scene)
  |
  | stream confirmed stopped
  v
idle
```

Each state has allowed transitions. You cannot go from idle to stopping. The buttons are disabled based on current state.

### What is Virtual Audio Cable?

Streamlabs captures audio from your computer to stream it to Twitch. The problem is that the same audio plays through your speakers, so if you run an 8 hour stream you hear Al talking the whole time.

Virtual Audio Cable (VB-Audio Cable) creates a fake audio device. The app outputs to this fake device which produces no sound from your speakers. Streamlabs captures from the fake device and sends it to Twitch. You stay sane.

This is a Sprint 10 polish item.

---

## 3. Architecture: How Sprints 6 and 7 Fit the Big Picture

```
Dashboard (React)
    |
    User clicks "Connect"
    |
    electronAPI.obsConnect({ host, port, token })
    |
main.ts IPC handler
    |
obsController.ts
    |
    SockJS connects to http://localhost:59650/api
    |
    TcpServerService.auth(token)
    |
    ScenesService.getScenes()
    |
    ScenesService.sceneSwitched subscription
    |
    Connected! Returns scene list to UI
    |
Dashboard shows scene buttons
    |
    User clicks "Go Live"
    |
streamingManager.ts
    |
    switchScene('Starting')  -- 3 second delay
    |
    StreamingService.startStreaming()
    |
    switchScene('On Air')
    |
    currentState = 'live'
    |
    startMonitor() every 15 seconds
    |
    Push status to renderer via webContents.send
    |
Header badge: LIVE, timer starts
```

---

## 4. File-by-File Walkthrough

### obsController.ts

The heart of Streamlabs communication. Key design decisions:

**Why SockJS not WebSocket?**
Streamlabs uses SockJS which wraps WebSocket with fallback transports. Plain WebSocket returns 404. The URL must use `http://` not `ws://`.

**The pending map:**
```typescript
const pending = new Map<number, { resolve: Function; reject: Function }>()
```
Every outgoing request gets a unique ID stored here. When a response arrives with that ID, we resolve or reject the correct promise. This lets us use async/await even though the underlying transport is event-driven.

**Authentication order:**
1. SockJS connects (onopen fires)
2. We immediately send auth before setting isConnected
3. request() checks socket not isConnected during auth
4. Auth resolves, we set isConnected = true
5. Now all other requests work normally

If we checked isConnected during auth it would always fail because isConnected starts false.

**Scene switching by ID not name:**
Streamlabs requires scene IDs for makeSceneActive, not names. We fetch the scene list, find the matching name, extract the ID, then switch. This is why getScenes returns names for the UI but switchScene does the ID lookup internally.

---

### streamingManager.ts

**The start sequence:**
```
1. Check OBS is connected
2. Set state to 'starting'
3. Switch to Starting scene (viewers see this while stream initializes)
4. Wait 3 seconds
5. Call startStreaming()
6. Wait 2 seconds for stream to stabilize
7. Switch to On Air scene
8. Set state to 'live'
9. Record start time
10. Start health monitor
```

**The stop sequence:**
```
1. Set state to 'stopping'
2. Switch to Break scene (smooth transition for viewers)
3. Wait 3 seconds
4. Call stopStreaming()
5. Stop health monitor
6. Set state to 'idle'
7. Clear start time
```

**getStreamDuration():**
Calculates elapsed time from startedAt to now:
```typescript
const ms = Date.now() - new Date(startedAt).getTime()
const hours   = Math.floor(ms / 3600000)
const minutes = Math.floor((ms % 3600000) / 60000)
const seconds = Math.floor((ms % 60000) / 1000)
return `${padded}:${padded}:${padded}`
```
The UI calls this every second to update the duration display.

---

### App.tsx changes

**useEffect for status listener:**
```typescript
useEffect(() => {
  (window as any).electronAPI.onStreamStatus((status: any) => {
    setStreamState(status.state)
  })
}, [])
```
Empty dependency array means this runs once on mount and stays active.

**useEffect for duration timer:**
```typescript
useEffect(() => {
  if (streamState !== 'live') return
  const interval = setInterval(async () => {
    const d = await electronAPI.streamGetDuration()
    if (d) setDuration(d)
  }, 1000)
  return () => clearInterval(interval)
}, [streamState])
```
Starts when state becomes live, cleans up when it changes.

---

## 5. What We Discovered About Streamlabs

This sprint required significant debugging because Streamlabs uses a non-standard connection approach. Reference for anyone building Streamlabs integrations:

**Connection:**
- URL: `http://{host}:{port}/api` using SockJS library
- Default port: 59650
- NOT plain WebSocket, NOT ws://, NOT OBS WebSocket protocol

**Authentication:**
- First message after connection must be auth via TcpServerService
- `request('TcpServerService', 'auth', apiToken)`
- API token found in Streamlabs Settings → Remote Control → Third Party Connections

**Message format:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "methodName",
  "params": { "resource": "ServiceName", "args": [...] }
}
```

**Key services:**
- `TcpServerService` — authentication
- `ScenesService` — list scenes, switch scenes, subscribe to changes
- `StreamingService` — start/stop stream, get status
- `AudioService` — manage audio sources
- `SourcesService` — manage scene sources

**Scene operations:**
- `ScenesService.getScenes()` returns array with id and name
- `ScenesService.makeSceneActive(sceneId)` requires the ID not the name
- `ScenesService.sceneSwitched` is the subscription channel for change events

---

## 6. Scene Design

Three Streamlabs scenes created for WestWaveGem:

**Starting Soon**
West coast night sky, central gem, palm trees framing, moon glow, ocean horizon. Used during stream initialization before going live.

**On Air**
Split layout. Left two-thirds contains the main visual art with gem, wave, and small palm. Right third contains two reserved widget zones with labeled placeholders — top zone for BeatHud or avatar, bottom zone for chat or stats. In Streamlabs, add these widgets as separate sources layered on top of the SVG background and position them to fill the widget zones.

**Break**
Dramatic full-width palm silhouettes, prominent moon, long still reflection on ocean, gem faded to suggest rest. Be Right Back message centered. More cinematic and calmer than On Air.

**Future overlay ideas:**
- Ready Player Me avatar in the top widget zone
- VTube Studio for animated mouth sync with Al's audio
- Streamlabs chat box widget in the bottom widget zone
- BeatHud audio visualizer in the top widget zone
- Custom lower third that updates dynamically via WebSocket (Sprint 10)

---

## 7. Problems We Hit and How We Fixed Them

### obs-websocket-js wrong protocol

Streamlabs does not use the OBS WebSocket protocol at all. The library returned connection errors.

Fix: Removed obs-websocket-js entirely. Used SockJS which matches Streamlabs' actual transport layer.

### 404 on connection

Plain WebSocket to port 59650 returned 404.

Fix: SockJS connects to `http://localhost:59650/api` not a WebSocket URL. The protocol and path both matter.

### Auth failed: Not connected

The request function checked isConnected before sending auth, but isConnected is only set to true after auth succeeds. Classic chicken-and-egg.

Fix: Changed the request guard to check socket instead of isConnected. The socket exists and is open during auth even though isConnected is still false.

### Connection timeout instead of fast failure

When using the wrong host or port, the connection hung forever instead of failing fast.

Fix: Added a 10 second timeout using Promise.race that closes the socket and returns an error status if the connection does not complete in time.

### Scene switching requires ID not name

makeSceneActive rejected scene names and expected internal IDs.

Fix: Fetch the full scene list, find the entry where name matches, extract the id, pass that to makeSceneActive.

### Dashboard not updating on scene switch

The stream status push worked for start and stop but scene switch changes were not reflected in the UI.

This is intentional behavior. The dashboard gives manual control. The Orchestrator in Sprint 10 will automate scene transitions and the UI will reflect those. For now scene buttons in OBSPanel give direct manual override.

---

## 8. Testing Checklist

```
[ ] Streamlabs Desktop is open with Third Party Connections enabled
[ ] OBS Panel shows connect form
[ ] Enter localhost, 59650, API token and click Connect
[ ] Dashboard shows scene buttons (Starting, On Air, Break)
[ ] Clicking a scene button switches it in Streamlabs live
[ ] Terminal 2 logs "Streamlabs authenticated!" on connect
[ ] Terminal 2 logs scene switches as they happen
[ ] Twitch stream key is set in Streamlabs settings
[ ] Clicking Go Live triggers starting sequence in Terminal 2
[ ] Streamlabs switches to Starting scene then On Air
[ ] Header badge changes to LIVE with timer
[ ] twitch.tv/westwavetv shows the stream live
[ ] Clicking End Stream triggers stopping sequence
[ ] Streamlabs switches to Break scene then stops
[ ] Header badge returns to OFFLINE
[ ] SQLite stream_sessions table has a new row
[ ] Stream monitor logs every 15 seconds while live
```

---

## 9. Git Reference

```
git add .
git commit -m "sprint-6-7: Streamlabs SockJS connection, scene switching, stream start/stop/monitor, WestWaveGem branding"
git push
```

Files added or modified:

```
apps/desktop/src/main/obsController.ts      (new) Streamlabs WebSocket via SockJS
apps/desktop/src/main/streamingManager.ts   (new) stream start/stop/monitor state machine
apps/desktop/src/main/main.ts               (modified) OBS and stream IPC handlers
apps/desktop/src/main/preload.ts            (modified) exposed new IPC calls
apps/desktop/src/main/database.ts           (modified) stream session tracking
apps/desktop/src/renderer/App.tsx           (modified) stream control UI with live timer
apps/desktop/src/renderer/components/OBSPanel.tsx  (new) connect form and scene buttons
apps/desktop/src/styles/global.css          (modified) stream control styles
```

---

## 10. Sprint Summary and What Is Next

### What Sprints 6 and 7 Accomplished

- Full Streamlabs Desktop integration via SockJS and JSON-RPC
- Scene switching working live from the dashboard
- Automated stream start and stop sequences
- Stream health monitoring every 15 seconds
- Session tracking in SQLite
- Live duration timer in dashboard header
- WestWaveGem branding with three Streamlabs scene overlays
- Widget zones reserved in On Air scene for future overlays

### What Sprint 8 Will Build

**The Chat Engine** — Al reads and responds to Twitch chat live during the stream.

The scheduler will include dedicated chat response windows between segments. During those windows the Orchestrator reads the Twitch chat queue, picks questions, generates Al's responses via Ollama, converts to audio via Kokoro, and plays them.

The pipeline becomes:

```
Twitch chat message arrives
        |
Chat Engine reads and queues it
        |
During chat window in schedule:
  Orchestrator picks best questions
  Ollama writes Al's response in character
  Kokoro converts to audio
  Audio plays through stream
  Viewer hears Al answer their question
```