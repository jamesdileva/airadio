# Sprint 0 Study Guide — Project Foundation

> **Sprint Goal:** Set up the entire project foundation so every future sprint has a clean, working base to build on.  
> **Status:** ✅ Complete  
> **Builds toward:** Everything — this sprint is the skeleton all other sprints attach to.

---

## 1. What We Built

A working **Electron desktop application** with a React dashboard UI, a configured TypeScript build pipeline, and an initialized SQLite database with the full schema pre-built.

At the end of this sprint you can:
- Launch the app with `npx vite` + `npx electron .`
- See a dark-themed dashboard with four panels (Stream Control, Schedule, Current Segment, Analytics)
- Click Start/Stop buttons that update the status badge
- Have a fully structured repository ready for 10 more sprints

Nothing talks to AI yet. Nothing streams yet. This sprint is purely infrastructure — but without it, nothing else can be built.

---

## 2. Key Concepts Explained

### What is Electron?
Electron lets you build desktop applications using web technologies (HTML, CSS, JavaScript). It bundles a **Chromium browser** (for the UI) and **Node.js** (for system access) into one package. This means:
- Your UI is just React running in a browser window
- Your backend logic is just Node.js with full file system, network, and OS access
- You write one codebase and it runs as a real Windows `.exe`

**Analogy:** Electron is like taking a website and wrapping it in a box that makes it behave like a desktop app.

### What is the Main Process vs Renderer Process?
Electron has two separate environments:

| | Main Process | Renderer Process |
|---|---|---|
| File | `src/main/main.ts` | `src/renderer/main.tsx` |
| Runtime | Node.js | Chromium (browser) |
| Can access | File system, OS, database | DOM, React, UI |
| Talks to other via | `ipcMain` / `ipcRenderer` | same |

**Why separate?** Security. The UI (renderer) shouldn't have direct file system access. The main process acts as a gatekeeper.

### What is the Preload Script?
`preload.ts` runs in a special in-between context. It can access both Node.js AND the browser window. We use `contextBridge` to safely expose specific functions to the React UI — like a controlled window between the two worlds.

In Sprint 0 we only exposed `version` as a placeholder. In later sprints we'll expose things like `startStream()`, `getSchedule()`, etc.

### What is Vite?
Vite is a build tool and dev server for the React (renderer) side of the app. It:
- Compiles TypeScript + React JSX into browser-compatible JavaScript
- Provides hot module replacement (changes appear instantly without full reload)
- Produces an optimized `dist/renderer/` bundle for production

### What is TypeScript?
TypeScript is JavaScript with **type annotations**. Instead of:
```javascript
function greet(name) { return 'Hello ' + name }
```
You write:
```typescript
function greet(name: string): string { return 'Hello ' + name }
```
The TypeScript compiler catches mistakes before they become runtime bugs. It's especially valuable in a project this size where many modules talk to each other.

### What is SQLite?
SQLite is a database that lives in a **single file** on disk. Unlike PostgreSQL or MySQL:
- No server to install or run
- No connection strings or credentials
- Just a `.db` file that your app reads and writes directly

`better-sqlite3` is the Node.js library that lets us talk to SQLite. It's synchronous (no callbacks needed) which makes it simple to use.

### What is WAL mode?
WAL stands for Write-Ahead Logging. It's a SQLite setting that makes reads and writes faster and safer. We enable it with:
```typescript
db.pragma('journal_mode = WAL')
```
Without WAL, SQLite locks the whole file during writes. With WAL, reads and writes can happen simultaneously — important when the orchestrator is writing logs while the UI is reading analytics.

---

## 3. Architecture: How Sprint 0 Fits The Big Picture

```
Sprint 0 built the outer shell:

┌─────────────────────────────────────────┐
│  Electron App  ◄── Sprint 0 built this │
│                                         │
│  ┌──────────┐    ┌───────────────────┐  │
│  │  React   │    │   SQLite Database │  │
│  │ Dashboard│    │   (schema ready)  │  │
│  └──────────┘    └───────────────────┘  │
│                                         │
│  [ Everything else plugs in here ]      │
└─────────────────────────────────────────┘
```

Every future sprint adds a module that the Orchestrator (Sprint 1 foundation) will wire together. Sprint 0 makes sure the container exists and is healthy.

---

## 4. File-by-File Walkthrough

### `apps/desktop/src/main/main.ts`
The entry point for the Electron main process.

```typescript
// Creates the browser window with specific dimensions and security settings
const win = new BrowserWindow({
  width: 1280,
  height: 800,
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,    // ← Security: keeps main/renderer separate
    nodeIntegration: false     // ← Security: renderer can't use Node directly
  }
})

// In dev, load from Vite's local server (hot reload)
// In prod, load from the built dist/ files
if (process.env.NODE_ENV === 'development') {
  win.loadURL('http://localhost:5173')
} else {
  win.loadFile(path.join(__dirname, '../renderer/index.html'))
}
```

**Why `contextIsolation: true`?** Prevents malicious web content from accessing Electron internals. Best practice for all Electron apps.

---

### `apps/desktop/src/main/preload.ts`
The bridge between main and renderer.

```typescript
contextBridge.exposeInMainWorld('electronAPI', {
  version: process.versions.electron
})
```

Currently just exposes the Electron version as a placeholder. In future sprints this will expose functions like `startStream()`, `fetchSchedule()`, `getAnalytics()` — all safely bridged from the main process.

---

### `apps/desktop/src/main/database.ts`
Initializes SQLite and creates all tables.

```typescript
// Stores the DB in the user's AppData folder
// e.g. C:\Users\YourName\AppData\Roaming\ai-radio-desktop\radio.db
const dbPath = path.join(app.getPath('userData'), 'radio.db')
```

**Why `userData`?** It's the correct Windows location for app data. It persists between app updates and doesn't require admin permissions.

The `createTables()` function uses `CREATE TABLE IF NOT EXISTS` — meaning it's safe to run on every startup. If tables exist, nothing changes. If they don't exist (first launch), they get created.

---

### `apps/desktop/src/renderer/App.tsx`
The React dashboard component.

```typescript
const [status, setStatus] = useState<'idle' | 'running' | 'stopped'>('idle')
```

Uses a **union type** for status — TypeScript will error if you try to set it to anything other than those three strings. This pattern will expand in Sprint 7 when the streaming manager reports real status.

The four dashboard panels are placeholders now. Each sprint fills one in:
- **Stream Control** → Sprint 7 (real start/stop)
- **Today's Schedule** → Sprint 1
- **Current Segment** → Sprint 3
- **Analytics** → Sprint 9

---

### `apps/desktop/src/renderer/declarations.d.ts`
```typescript
declare module '*.css'
declare module '*.svg'
declare module '*.png'
```
Tells TypeScript to stop complaining about non-TypeScript file imports. Without this, importing a CSS file would cause a type error even though Vite handles it fine at runtime.

---

### `apps/desktop/tsconfig.json` vs `tsconfig.main.json`
We have **two** TypeScript configs because the renderer and main process have different requirements:

| | `tsconfig.json` | `tsconfig.main.json` |
|---|---|---|
| Target | Renderer (browser) | Main process (Node.js) |
| Module system | `ESNext` | `CommonJS` |
| Module resolution | `bundler` | `node10` |
| Output | Handled by Vite | `dist/main/` |

**Why CommonJS for main?** Electron's main process runs in Node.js which historically uses CommonJS (`require()`). The renderer uses modern ES modules because Vite handles the bundling.

---

## 5. Build Pipeline Explained

```
Development flow:
  src/renderer/ ──► Vite dev server ──► http://localhost:5173
  src/main/     ──► tsc (manual)    ──► dist/main/main.js
                                              │
                                        electron . loads this

Production flow:
  src/renderer/ ──► vite build ──► dist/renderer/index.html
  src/main/     ──► tsc        ──► dist/main/main.js
                                        │
                               electron-builder packages both
                                        │
                               Windows .exe installer
```

---

## 6. Windows-Specific Notes

### PowerShell Execution Policy
Windows blocks running scripts by default. We fixed this with:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```
`RemoteSigned` means: locally created scripts can run freely; downloaded scripts need a trusted signature.

### better-sqlite3 Native Module
`better-sqlite3` is a **native Node module** — it contains C++ code that must be compiled for your specific OS and Node version. On Windows this requires Visual Studio Build Tools.

We installed it with `--ignore-scripts` to use pre-built binaries instead of compiling from source, avoiding the need for the full C++ toolchain.

### npm Deprecation Warnings
The `npm warn deprecated` messages during install are from sub-dependencies of Electron and electron-builder. They're internal to those packages and don't affect our code. Safe to ignore entirely.

---

## 7. Common Errors & Fixes

| Error | Cause | Fix |
|---|---|---|
| `cannot be loaded because running scripts is disabled` | PowerShell execution policy | `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` |
| `msvs_version is not a valid npm option` | Outdated config flag | Ignore it, not needed |
| `model requires more system memory` | Wrong Ollama model variant | Use `phi3:mini-4k` instead of `phi3:mini` |
| `moduleResolution: node` error | Deprecated TypeScript value | Change to `node10` |
| Cannot find module `./App` or `*.css` | Missing type declarations | Add `declarations.d.ts` with `declare module '*.css'` |
| `EPERM: operation not permitted` during npm install | Windows file lock on temp file | Harmless warning, install still succeeded |
| `package.json has no valid main entrance` | dist/main/main.js doesn't exist yet | Run `npx tsc -p tsconfig.main.json` first |

---

## 8. Testing Checklist

Verify Sprint 0 is fully working:

```
□ ollama run phi3:mini-4k "say hello" returns a response
□ npx vite starts without errors (Terminal 1)
□ npx electron . opens the dashboard window (Terminal 2)
□ Dashboard shows: IDLE badge, 4 panels, Start/Stop buttons
□ Clicking Start changes badge to RUNNING (green)
□ Clicking Stop changes badge to STOPPED (red)
□ npx tsc --noEmit reports 0 errors
□ git log shows the sprint-0 commit
```

---

## 9. Git Reference

```bash
# Sprint 0 commit
git add .
git commit -m "sprint-0: electron+react dashboard, sqlite schema, project structure"

# Useful commands going forward
git status              # see what's changed
git log --oneline       # see commit history
git diff                # see unstaged changes
```

**Recommended branch strategy:**
```
main          ← stable, working code only
feat/sprint-1 ← work in progress
# merge to main at end of each sprint
```

---

## 10. Sprint Summary & What's Next

### What Sprint 0 Accomplished
- ✅ Full monorepo folder structure created
- ✅ Electron + React + TypeScript wired together and running
- ✅ Dark-themed dashboard UI with status system
- ✅ SQLite database initialized with complete 5-table schema
- ✅ Two TypeScript configs (renderer + main process)
- ✅ Vite build pipeline configured
- ✅ Ollama installed with Phi-3 Mini 4K model
- ✅ Kokoro TTS installed (Python)
- ✅ Windows environment issues resolved
- ✅ First git commit made

### What Sprint 1 Will Build
**The Scheduler Engine** — the module that generates a dynamic 8-hour daily programming schedule.

You'll be able to:
- Select content categories (Finance, Tech, Gaming, News, Niche)
- Click "Generate Schedule" and see a full day of timed segments
- See the schedule appear in the "Today's Schedule" dashboard panel
- Have that schedule saved to the SQLite `schedule` table

The Scheduler is the first real logic module — it sets the pattern that all other modules will follow.
