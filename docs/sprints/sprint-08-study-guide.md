# Sprint 8 Study Guide: Chat Engine

**Sprint Goal:** Connect Al to Twitch chat so viewers can interact live and Al responds in character.

**Status:** Complete

**Builds toward:** Sprint 10 (Full Integration) wires chat responses into the automated broadcast schedule so Al speaks responses aloud via Kokoro TTS during dedicated chat windows.

---

## 1. What We Built

A live Twitch chat integration that:

- Connects to Twitch IRC via the tmi.js library
- Reads all incoming chat messages in real time
- Queues messages with responded/unresponded tracking
- Picks the best questions from the queue using keyword detection
- Generates Al's responses via Ollama/Mistral in character
- Displays the chat queue and responses in the dashboard
- Saves all responses to SQLite for analytics
- Deduplicates messages to prevent double processing
- Auto-reconnects if the connection drops

Al responds as a radio host — addressing viewers by name, staying in character, keeping responses brief and conversational.

---

## 2. How Chat Fits The Broadcast

The full chat flow during a live stream:

```
Stream is live (Sprint 7)
        |
Viewers type in Twitch chat
        |
Chat Engine reads messages via IRC
        |
Messages queue up during segment playback
        |
Schedule reaches a "chat window" slot
        |
Orchestrator calls processChatWindow()
        |
Al picks 2-3 best questions
        |
Ollama generates responses in Al's voice
        |
Kokoro converts responses to audio (Sprint 10)
        |
Audio plays through stream
        |
Viewers hear Al answer their questions live
```

Chat windows are scheduled between content segments. Viewers hear Al respond to them directly — the defining interactive feature of WestWaveGem Radio.

---

## 3. Key Concepts Explained

### What is IRC?

IRC stands for Internet Relay Chat. It is one of the oldest internet communication protocols, dating to 1988. Twitch built its entire chat system on IRC because it is lightweight, battle-tested, and handles millions of concurrent connections.

When you connect to Twitch chat you are actually connecting to an IRC server at `irc-ws.chat.twitch.tv:443`. Twitch extended the standard IRC protocol with custom tags that carry metadata like display names, subscriber status, and message IDs.

### What is tmi.js?

tmi.js (Twitch Messaging Interface) is a Node.js library that wraps Twitch's IRC protocol in a simple event-based API. Instead of parsing raw IRC messages, you just listen for events:

```typescript
client.on('message', (channel, tags, message, self) => {
  // channel  = '#westwavegem'
  // tags     = { 'display-name': 'ViewerName', id: 'msg-uuid', ... }
  // message  = 'what is the stock market doing today?'
  // self     = true if this message came from our own bot account
})
```

tmi.js handles connection management, reconnection, rate limiting, and IRC command formatting automatically.

### What is OAuth for Chat?

Twitch requires OAuth tokens to authenticate chat connections. The token proves that a real Twitch account authorized your application to read and write chat on their behalf.

The OAuth flow:

```
1. Register an app at dev.twitch.tv
2. User authorizes the app (you, in this case)
3. Twitch issues an access token and refresh token
4. Access token used for API calls and chat auth
5. Refresh token used to get a new access token when it expires
```

For chat authentication, tmi.js expects the token prefixed with `oauth:`:
```
TWITCH_OAUTH_TOKEN=oauth:dxsikh34lhq9bp3vnjlh1p6gn3tgko
```

### What is Token Expiry?

Twitch access tokens expire. The `expires_in` field from the validate endpoint tells you how many seconds remain. When it reaches 0 the token is rejected.

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
     https://id.twitch.tv/oauth2/validate
# Returns: { "expires_in": 14635 }  -- valid
# Returns: { "expires_in": 0 }      -- expired, refresh needed
```

To refresh without user interaction:
```
POST https://id.twitch.tv/oauth2/token
  grant_type=refresh_token
  refresh_token=YOUR_REFRESH_TOKEN
  client_id=YOUR_CLIENT_ID
  client_secret=YOUR_CLIENT_SECRET
```

### What is a Message Queue?

Instead of responding to every chat message instantly, we collect them in a queue and process them in batches during scheduled chat windows. This has several advantages:

- Al can focus on content segments without interruption
- Multiple messages can be grouped into one chat response session
- The best questions can be selected rather than just the first one
- Viewers who ask late in a segment still get answered

The queue has a maximum size of 50 messages. When full, the oldest message is removed to make room for new ones (FIFO — First In First Out).

### What is Question Detection?

Not every chat message is a question worth answering. Someone typing "lol" or "GG" should not trigger a response. The question picker filters messages using keyword detection:

```typescript
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
```

If no questions are found, it falls back to any message so Al always has something to respond to.

### What is Message Deduplication?

In Electron development mode, events can fire twice due to React Strict Mode and Electron's dual-process architecture. Each Twitch message has a unique UUID in `tags.id`. We track seen IDs in a Set and skip any message whose ID we have already processed:

```typescript
const recentIds = new Set<string>()

if (msgId && recentIds.has(msgId)) return  // already seen
recentIds.add(msgId)
```

The Set is capped at 100 entries to prevent unbounded memory growth.

---

## 4. Architecture: How Sprint 8 Fits the Big Picture

```
Twitch IRC Server
    |
    | WebSocket (wss://)
    |
tmi.js client in chatEngine.ts
    |
    | 'message' events
    |
messageQueue (in memory, max 50)
    |
    | IPC: chat:processWindow
    |
pickBestQuestion()
    |
generateChatResponse() via Ollama
    |
    | returns response text
    |
saveChatMessage() to SQLite chat_log
    |
    | IPC: returns responses to renderer
    |
ChatPanel.tsx displays responses
    |
Sprint 10: responses fed to Kokoro TTS
    |
Al speaks responses during chat windows
```

---

## 5. File-by-File Walkthrough

### chatEngine.ts

**connectChat()**

Reads credentials from environment variables, creates a tmi.Client with the correct configuration, registers event handlers, then calls client.connect(). Returns success or failure with an error message.

Key configuration:
```typescript
connection: { reconnect: true, secure: true }
```
`reconnect: true` means tmi.js automatically reconnects if the connection drops. `secure: true` uses WSS (WebSocket Secure) over port 443.

**Message handler:**
```typescript
client.on('message', (_channel, tags, message, self) => {
  if (self) return                    // ignore bot's own messages
  if (recentIds.has(tags.id)) return  // deduplicate
  // queue the message
})
```

**pickBestQuestion()**

Filters messages for question-like content, then picks randomly from the matching pool. Random selection prevents the same early message from always being picked. If no questions found, picks from all messages.

**generateChatResponse()**

Builds a focused prompt using the host character system prompt plus specific instructions for chat responses:
- Keep it 2-4 sentences (brief, not a full segment)
- Address the viewer by name once
- Answer factually if a question, react with personality if a comment
- Do not start with the radio station intro phrase

**processChatWindow()**

The main orchestration function called during scheduled chat windows:
1. Gets all unresponded messages
2. Picks up to `maxResponses` questions
3. Generates a response for each
4. Marks them as responded in the queue
5. Returns the responses for saving and display

---

### ChatPanel.tsx

Displays three sections:

**Connection controls**
Shows a connect button when disconnected. Shows connected status, unread count, and disconnect button when connected.

**Message queue**
Updates every 3 seconds via polling. Shows the last 20 messages with username and content. Responded messages are faded out with a checkmark. Auto-scrolls to the newest message.

**Response display**
Shows the latest batch of Al's responses after processing. Each card shows the original question and Al's response text.

The "Al Responds To Chat" button is disabled when no unresponded messages exist, preventing unnecessary Ollama calls.

---

### Database additions

The `chat_log` table was created in Sprint 0. Sprint 8 adds two functions:

**saveChatMessage()** inserts a record with platform, username, message, response, and timestamp.

**loadRecentChatLog()** returns the most recent N records ordered by ID descending. Used for analytics in Sprint 9.

---

## 6. Twitch Authentication Reference

Getting a working token requires three steps that must use the same app credentials:

```
Step 1: Register app at dev.twitch.tv/console/apps
  - Note the Client ID
  - Generate and note the Client Secret
  - Set redirect URL to https://twitchtokengenerator.com

Step 2: Generate token at twitchtokengenerator.com
  - Enter your Client ID and Client Secret
  - Select scopes: chat:read, chat:edit, user:read:chat
  - Authorize and copy access token and refresh token

Step 3: Validate the token
  curl -H "Authorization: Bearer ACCESS_TOKEN" \
       -H "Client-Id: CLIENT_ID" \
       https://id.twitch.tv/oauth2/validate
  Confirm expires_in is greater than 0

Step 4: Add to .env
  TWITCH_CHANNEL=westwavegem
  TWITCH_BOT_USERNAME=westwavegem
  TWITCH_OAUTH_TOKEN=oauth:ACCESS_TOKEN
  TWITCH_REFRESH_TOKEN=REFRESH_TOKEN
  TWITCH_CLIENT_ID=CLIENT_ID
  TWITCH_CLIENT_SECRET=CLIENT_SECRET
```

Common errors and causes:

```
"No response from Twitch"   -- expired token or wrong channel name
"Invalid client secret"     -- client secret does not match client ID
"Invalid refresh token"     -- refresh token generated with different client ID
expires_in: 0               -- token expired, needs refresh
JOIN #westwavetv            -- wrong TWITCH_CHANNEL value in .env
```

---

## 7. Al's Chat Response Quality

Example responses from testing:

Viewer: "how are you"
Al: "Doing great and loving every minute of being on air, westwavegem! Thanks for tuning in to WestWaveGem Radio — we have a fantastic lineup coming up today."

Viewer: "spaghetti or nachos?"
Al: "That is a tough call, westwavegem! If I had to choose I would go with spaghetti — a timeless classic. But both have their place at the table. What is on your menu tonight?"

Viewer: "whats the weather like today"
Al: "I do not have live weather data on hand, westwavegem, but check your local forecast for the full picture! Stay comfortable out there."

Key qualities working correctly:
- Addresses viewer by name
- Stays in Al's radio host character
- Keeps responses to 2-4 sentences
- Does not repeat the station intro phrase
- Deflects questions it cannot answer (weather) without making things up

---

## 8. What Comes Next in Sprint 10

In Sprint 10 the chat responses will be fully automated:

```
Schedule slot: "Chat Window - 5 minutes"
        |
Orchestrator calls processChatWindow(3)
        |
3 responses generated by Ollama
        |
Each response fed to Kokoro TTS
        |
Audio files generated
        |
Mixed with background music (Sprint 5)
        |
Played sequentially through stream
        |
Orchestrator moves to next content segment
```

Viewers will hear Al say something like: "We have got some great questions from chat. First up, westwavegem asks what the weather is like today..."

---

## 9. Testing Checklist

```
[ ] TWITCH_OAUTH_TOKEN in .env with oauth: prefix
[ ] Token validated with expires_in greater than 0
[ ] TWITCH_CHANNEL matches actual channel name exactly
[ ] Click Connect to Twitch Chat in ChatPanel
[ ] Terminal 2 shows "Joined #westwavegem"
[ ] Type a message in Twitch chat from any account
[ ] Message appears in dashboard queue within 3 seconds
[ ] Click "Al Responds To Chat"
[ ] Terminal 2 shows "Generating response for [username]"
[ ] Response appears in Latest Responses panel
[ ] Response addresses viewer by name
[ ] Response stays in character as Al
[ ] Responded messages show checkmark and fade out
[ ] SQLite chat_log table has new rows
[ ] Disconnect and reconnect works cleanly
```

---

## 10. Git Reference

```
git add .
git commit -m "sprint-8: Twitch chat engine, message queue, Al responds live in character"
git push
```

Files added or modified:

```
apps/desktop/src/main/chatEngine.ts              (new) Twitch IRC connection and response pipeline
apps/desktop/src/main/main.ts                    (modified) chat IPC handlers
apps/desktop/src/main/preload.ts                 (modified) exposed chat IPC calls
apps/desktop/src/main/database.ts               (modified) chat log functions
apps/desktop/src/renderer/components/ChatPanel.tsx (new) chat queue and response display
apps/desktop/src/renderer/App.tsx                (modified) added Chat panel
apps/desktop/src/styles/global.css               (modified) chat panel styles
```

---

## 11. Sprint Summary and What Is Next

### What Sprint 8 Accomplished

- Live Twitch chat reading via tmi.js and IRC
- Message queue with deduplication and max size management
- Question detection to pick the most interesting messages
- Al generates in-character responses via Ollama
- Dashboard shows live chat queue and responses
- All responses saved to SQLite
- OAuth token management and validation documented
- Auto-reconnect on connection drop

### What Sprint 9 Will Build

**Analytics and Logging** — a metrics dashboard showing stream performance.

Sprint 9 adds a proper analytics view showing segments aired, chat activity per session, peak engagement times, audio files generated, and storage usage. It also adds the automatic audio cleanup for files older than 30 days that we noted back in Sprint 4.

### What Sprint 10 Will Build

**Full Integration** — everything runs automatically.

The Orchestrator takes over: generates the schedule, fetches data, writes scripts, generates audio, mixes music, switches scenes, starts the stream, plays segments sequentially, reads chat during windows, and runs for 8 hours unattended. The .exe is packaged with electron-builder.