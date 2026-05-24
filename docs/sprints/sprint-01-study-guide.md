# Sprint 1 Study Guide — Scheduler Engine

> **Sprint Goal:** Build the Scheduler Engine — category selection UI, dynamic 8-hour schedule generation, SQLite persistence, and live display in the dashboard.
> **Status:** ✅ Complete
> **Builds toward:** Every other module depends on the schedule. The Orchestrator will read it to know what to generate next.

---

## 1. What We Built

A fully working **Scheduler Engine** that:
- Lets the user select content categories (Finance, Tech, Gaming, News, Niche)
- Generates a dynamic 8-hour block of timed segments on demand
- Saves the schedule to SQLite
- Displays the first 6 segments live in the dashboard
- Allows regeneration at any time with different category selections

The data pipeline established in this sprint is the **template for every future sprint**:
```
UI Event → IPC Call → Main Process Handler → Module Logic → SQLite → Return to UI
```

---

## 2. Key Concepts Explained

### What is IPC?
IPC stands for **Inter-Process Communication**. In Electron, your app has two completely separate processes:
- **Main process** — Node.js, has access to the file system, database, OS
- **Renderer process** — Chromium browser, runs your React UI

These two cannot talk directly. IPC is the message system between them.

**Analogy:** Think of it like a restaurant. The customer (renderer) doesn't walk into the kitchen — they place an order with the waiter (IPC), the kitchen (main process) prepares it, and the waiter brings it back.

```
Renderer                    Main Process
   │                              │
   │  ipcRenderer.invoke(         │
   │    'schedule:generate',      │
   │    ['tech', 'news']          │
   │  )                           │
   │ ─────────────────────────►  │
   │                              │  generates schedule
   │                              │  saves to SQLite
   │  ◄─────────────────────────  │
   │  receives schedule data      │
   │                              │
```

### ipcMain.handle vs ipcMain.on
| | `ipcMain.handle` | `ipcMain.on` |
|---|---|---|
| Returns data? | ✅ Yes (like an async function) | ❌ No |
| Used for | Requests that need a response | Fire-and-forget events |
| Renderer uses | `ipcRenderer.invoke()` | `ipcRenderer.send()` |

We use `handle/invoke` for everything in this project because we almost always need data back.

### What is contextBridge?
`contextBridge.exposeInMainWorld()` in `preload.ts` is how the renderer safely accesses IPC. Without it, the renderer would have no way to call `ipcRenderer` at all (because `nodeIntegration` is false for security).

```typescript
// preload.ts — runs in a special bridged context
contextBridge.exposeInMainWorld('electronAPI', {
  generateSchedule: (categories) => ipcRenderer.invoke('schedule:generate', categories)
})

// Now in React, you can call:
window.electronAPI.generateSchedule(['tech', 'news'])
```

### What is a Union Type in TypeScript?
```typescript
type Category = 'finance' | 'tech' | 'gaming' | 'news' | 'niche'
```
This means a `Category` can ONLY be one of those five strings. If you try to pass `'sports'` anywhere that expects a `Category`, TypeScript catches it immediately. This prevents bugs where a typo in a category name silently breaks the scheduler.

### What is a Generic Function?
```typescript
function getRandomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}
```
The `<T>` means "whatever type you pass in, return that same type." This lets one function work for arrays of strings, numbers, objects — anything. TypeScript figures out the type automatically from what you pass.

### What is a Record Type?
```typescript
const topicBank: Record<Category, string[]> = {
  finance: ['Stock market...', 'Crypto...'],
  tech: ['AI news...', 'Big tech...'],
  ...
}
```
`Record<Category, string[]>` means "an object where every key is a Category and every value is an array of strings." TypeScript will error if you forget a category or add an invalid one.

---

## 3. Architecture: How Sprint 1 Fits The Big Picture

```
┌─────────────────────────────────────────────┐
│  Electron App                               │
│                                             │
│  ┌──────────────────────────────────────┐   │
│  │  React Dashboard                     │   │
│  │  SchedulePanel.tsx                   │   │
│  │  - Category toggle buttons           │   │
│  │  - Generate button                   │   │
│  │  - Segment list display              │   │
│  └──────────────┬───────────────────────┘   │
│                 │ window.electronAPI         │
│                 │ .generateSchedule()        │
│  ┌──────────────▼───────────────────────┐   │
│  │  preload.ts (bridge)                 │   │
│  └──────────────┬───────────────────────┘   │
│                 │ ipcRenderer.invoke         │
│  ┌──────────────▼───────────────────────┐   │
│  │  main.ts                             │   │
│  │  ipcMain.handle('schedule:generate') │   │
│  │       │                              │   │
│  │       ├── generateSchedule()         │   │
│  │       │   scheduler.ts               │   │
│  │       │                              │   │
│  │       └── saveSchedule()             │   │
│  │           database.ts → SQLite       │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

---

## 4. File-by-File Walkthrough

### `src/shared/types.ts`
Defines the data shapes used across the entire app. Living in `src/shared/` makes it accessible to both the main process and renderer without crossing package boundaries.

Key types:
```typescript
type Category = 'finance' | 'tech' | 'gaming' | 'news' | 'niche'

interface ScheduleSegment {
  date: string          // 'YYYY-MM-DD'
  segmentOrder: number  // position in the day
  category: Category
  topic: string
  durationSeconds: number
  status: 'pending' | 'active' | 'completed'
}

interface DailySchedule {
  date: string
  segments: ScheduleSegment[]
  totalDurationSeconds: number  // should be ~28800 (8 hours)
}
```

---

### `src/main/scheduler.ts`
The core scheduling logic. No UI, no database — pure input/output function.

**The generation algorithm:**
```
1. Start with empty segments array, totalSeconds = 0
2. While totalSeconds < 28800 (8 hours):
   a. Pick a random category from selected categories
   b. Pick a random topic from that category (avoiding repeats)
   c. Pick a random duration (5, 10, or 15 minutes)
   d. Add segment to array
   e. Add duration to totalSeconds
3. Return the complete schedule
```

**Topic deduplication:**
```typescript
const usedTopics = new Set<string>()

function getTopicForCategory(category, usedTopics) {
  const available = topicBank[category].filter(t => !usedTopics.has(t))
  const pool = available.length > 0 ? available : topicBank[category]
  // ↑ If all topics used, allow repeats rather than getting stuck
  const topic = getRandomItem(pool)
  usedTopics.add(topic)
  return topic
}
```
A `Set` is used for O(1) lookup — checking if a topic was used is instant regardless of how many topics exist.

---

### `src/main/database.ts`
Handles all SQLite operations. Two key functions added this sprint:

**saveSchedule:**
```typescript
// First delete any existing schedule for today (allow regeneration)
db.prepare('DELETE FROM schedule WHERE date = ?').run(schedule.date)

// Then insert all segments in a single transaction
const insertMany = db.transaction((segments) => {
  for (const seg of segments) {
    insert.run(seg)
  }
})
insertMany(schedule.segments)
```
The `transaction()` wrapper means either ALL segments save or NONE do. This prevents partial schedules if something fails halfway through.

**loadTodaySchedule:**
```typescript
const today = new Date().toISOString().split('T')[0] // 'YYYY-MM-DD'
return db.prepare(
  'SELECT * FROM schedule WHERE date = ? ORDER BY segment_order'
).all(today)
```

---

### `src/main/main.ts`
Registers IPC handlers at the top level so they're available as soon as the app starts:

```typescript
ipcMain.handle('schedule:generate', (_event, categories) => {
  const schedule = generateSchedule(categories)
  saveSchedule(schedule)
  return schedule  // ← this becomes the resolved value of invoke() in the renderer
})
```

The `_event` parameter (with underscore) is the Electron event object — we don't need it so we prefix with `_` to tell TypeScript we're intentionally ignoring it.

---

### `src/main/preload.ts`
Exposes the IPC calls to the renderer safely:
```typescript
contextBridge.exposeInMainWorld('electronAPI', {
  version: process.versions.electron,
  generateSchedule: (categories: string[]) =>
    ipcRenderer.invoke('schedule:generate', categories),
  loadSchedule: () =>
    ipcRenderer.invoke('schedule:load'),
})
```

---

### `src/renderer/components/SchedulePanel.tsx`
The UI component. Key patterns used:

**useState with Set for multi-select:**
```typescript
const [selected, setSelected] = useState<Set<Category>>(new Set(['tech', 'news']))

const toggleCategory = (cat: Category) => {
  setSelected(prev => {
    const next = new Set(prev)       // copy the Set (never mutate state directly)
    next.has(cat) ? next.delete(cat) : next.add(cat)
    return next
  })
}
```
Why copy with `new Set(prev)`? React only re-renders if the state reference changes. Mutating the existing Set wouldn't trigger a re-render.

**Calling IPC from React:**
```typescript
const result: DailySchedule = await (window as any).electronAPI.generateSchedule(
  Array.from(selected)  // convert Set to Array for IPC transfer
)
```
`Array.from(selected)` converts the Set to a plain array because Sets can't be serialized over IPC.

---

## 5. Problems We Hit & How We Fixed Them

### TypeScript rootDir boundary errors
**Problem:** TypeScript's `rootDir` setting prevents importing files outside its declared root. Cross-package imports like `../../../packages/shared/src/types` violated this.

**Fix:** Copied shared types into `src/shared/types.ts` within the desktop app's own `src/` folder. Clean, simple, no monorepo tooling needed.

**Lesson:** For a single-app project, flat shared files beat complex monorepo configuration every time.

---

### Double-nested output directory
**Problem:** `tsconfig.main.json` had `rootDir: ./src` and `outDir: ./dist/main`, producing `dist/main/main/main.js` instead of `dist/main/main.js`.

**Fix:** Changed `outDir` to `./dist` so TypeScript mirrors the `src/` structure inside `dist/` correctly.

**Lesson:** `outDir` + `rootDir` work together. Output path = `outDir` + (file path relative to `rootDir`).

---

### IPC handler not found
**Problem:** `ipcMain.handle` calls were missing from `main.ts` — they were never added during an earlier edit.

**Fix:** Added handlers at the top level of `main.ts`, outside `createWindow()` and `app.whenReady()`.

**Lesson:** IPC handlers must be registered at module load time, not inside callbacks. If they're inside `whenReady()` they still work, but top-level is cleaner and more explicit.

---

### better-sqlite3 binding error
**Problem:** `better-sqlite3` is a native Node.js module (contains compiled C++ code). The prebuilt binary wasn't compatible with our Electron version.

**Fix:** `npx electron-rebuild -f -w better-sqlite3` recompiles the native module specifically for our Electron version.

**Lesson:** Any npm package with "native bindings" needs to be rebuilt when used with Electron. `electron-rebuild` handles this automatically.

---

## 6. Testing Checklist

```
□ Dashboard opens without errors
□ Category buttons render (Finance, Tech, Gaming, News, Niche)
□ Default categories pre-selected (Tech, News highlighted red)
□ Clicking inactive category turns it red
□ Clicking active category deselects it
□ Generate Schedule button is disabled when no categories selected
□ Clicking Generate produces a list of segments
□ Each segment shows: order number, category, topic, duration
□ "+X more segments" label appears when schedule exceeds 6 visible rows
□ Regenerating with different categories produces different topics
□ Terminal 2 shows "Database ready" on startup
□ SQLite file exists at AppData/Roaming/ai-radio-desktop/radio.db
```

---

## 7. Git Reference

```bash
# Sprint 1 commit
git add .
git commit -m "sprint-1: scheduler engine, category selector, IPC handlers, SQLite save"
git push

# To see what changed vs sprint 0
git diff HEAD~1 --stat
```

---

## 8. Key Patterns Established (Used Every Sprint)

This sprint established the patterns every future module will follow:

```
1. Types defined in src/shared/types.ts
2. Logic lives in src/main/<module>.ts
3. Database operations in src/main/database.ts
4. IPC handler registered in src/main/main.ts
5. preload.ts exposes the call to the renderer
6. React component calls window.electronAPI.<method>()
```

When in doubt in future sprints, refer back to how `schedule:generate` was wired up.

---

## 9. Sprint Summary & What's Next

### What Sprint 1 Accomplished
- ✅ Category selection UI with toggle state
- ✅ Dynamic 8-hour schedule generation algorithm
- ✅ Topic bank with deduplication across categories
- ✅ SQLite persistence with transaction safety
- ✅ Full IPC pipeline: UI → preload → main → logic → DB → UI
- ✅ Live schedule display in dashboard

### What Sprint 2 Will Build
**Data Fetchers** — real headlines and data pulled from the web to replace the static topic bank.

Instead of "Stock market morning briefing" as a topic, the scheduler will have access to actual current headlines like "Fed raises rates by 0.25% amid inflation concerns."

Modules being built:
- News fetcher (NewsAPI free tier)
- Finance data fetcher (Yahoo Finance)
- Data normalization into a standard format the Content Generator can use in Sprint 3