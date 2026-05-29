# Sprint 9 Study Guide: Analytics and Logging

**Sprint Goal:** Build an analytics dashboard showing stream history, script counts, chat activity, and storage usage. Add automatic audio file cleanup to prevent disk accumulation.

**Status:** Complete

**Builds toward:** Sprint 10 (Full Integration) uses session tracking to log what the Orchestrator does during automated 8-hour streams.

---

## 1. What We Built

An Analytics Engine and dashboard panel that:

- Shows overall stats: total sessions, total stream time, scripts generated, chat messages
- Displays recent session history with duration, segments aired, and chat activity
- Tracks audio storage usage broken down by voice files and mixed files
- Cleans up audio files older than 30 days automatically on startup
- Provides a manual cleanup button in the dashboard
- Updates in real time via a Refresh button
- Persists all data in the existing SQLite tables from Sprint 0

Everything was designed in Sprint 0 — the five database tables have been collecting data since Sprint 3. Sprint 9 just reads and displays it.

---

## 2. Key Concepts Explained

### Why Track Analytics?

For an 8-hour automated stream running unattended, analytics answer critical questions:

- Did the stream actually run? How long?
- How many segments aired vs were scheduled?
- Was chat active? Did viewers engage?
- How much disk space are audio files using?
- Is the system getting slower over time?

Without analytics you are flying blind. With them you can see exactly what happened during any session even if you were not watching.

### What is a JOIN in SQL?

Our session summary query joins two tables to combine related data:

```sql
SELECT ss.id, ss.started_at, COUNT(cl.id) as chat_count
FROM stream_sessions ss
LEFT JOIN chat_log cl ON date(cl.responded_at) = date(ss.started_at)
GROUP BY ss.id
```

This finds each stream session and counts how many chat messages were logged on the same day. Without the JOIN you would need two separate queries and manual matching in TypeScript.

LEFT JOIN means: return all stream sessions even if there are zero matching chat_log rows. A regular JOIN would exclude sessions with no chat activity.

### What is GROUP BY?

When you JOIN tables you can get multiple rows per session (one per chat message). GROUP BY collapses them back to one row per session and lets you use aggregate functions like COUNT and SUM:

```sql
GROUP BY ss.id    -- one result row per session ID
COUNT(cl.id)      -- count of chat rows in that group
```

### What is julianday()?

SQLite does not have a native duration function. To calculate minutes between two timestamps we use julianday() which converts a date to a decimal number of days since noon on November 24, 4714 BC:

```sql
(julianday(ended_at) - julianday(started_at)) * 1440
```

Subtracting two julianday values gives the difference in days. Multiplying by 1440 (minutes per day) gives the duration in minutes. CAST to INTEGER removes the decimal.

### What is File System Stats?

Node.js `fs.statSync()` returns metadata about a file without reading its contents:

```typescript
const stats = fs.statSync(filePath)
stats.size   // file size in bytes
stats.mtime  // last modified time (Date object)
stats.atime  // last accessed time
stats.ctime  // last status change time
```

We use `mtime` (modified time) to determine file age. Audio files are written once and never modified so mtime equals creation time for our purposes.

### What is Automatic Cleanup?

Audio files accumulate fast. A 90-second script generates roughly a 15MB WAV file. After a week of testing you could have gigabytes of files that are no longer needed.

The cleanup function runs every time the app starts:

```typescript
const cutoff = new Date()
cutoff.setDate(cutoff.getDate() - daysOld)  // 30 days ago

for (const file of wavFiles) {
  if (stats.mtime < cutoff) {
    fs.unlinkSync(filePath)  // delete it
  }
}
```

This keeps the `data/audio-output/` folder from growing indefinitely without manual intervention.

### What is min-height: 0 in CSS?

This is one of the most confusing CSS flexbox behaviors. When a flex child contains content that overflows, the browser by default does not shrink the child below its content size. This means `overflow-y: auto` on the child has no effect because the child is always tall enough to show all its content.

Setting `min-height: 0` tells the browser the child can shrink below its content size, which allows the `overflow-y: auto` to activate and show a scrollbar instead of pushing content out of the grid.

```css
.dashboard-card {
  overflow-y: auto;   /* enable scrolling */
  min-height: 0;      /* allow shrinking so scrolling actually works */
}
```

This is the standard fix for scrollable flex children.

---

## 3. Architecture: How Sprint 9 Fits the Big Picture

```
SQLite Database (set up Sprint 0)
    |
    +-- stream_sessions      (populated Sprint 7)
    +-- chat_log             (populated Sprint 8)
    +-- sub_segments         (populated Sprint 3)
    +-- segments             (populated Sprint 3)
    +-- schedule             (populated Sprint 1)
    |
analytics.ts reads all tables
    |
    +-- getOverallStats()    -- aggregate counts and totals
    +-- getSessionSummaries() -- recent session history
    +-- getStorageSummary()  -- file system scan
    +-- cleanupOldAudio()    -- delete files older than N days
    |
IPC handlers expose functions to renderer
    |
AnalyticsPanel.tsx displays everything
    |
Auto-cleanup runs on every app startup
```

---

## 4. File-by-File Walkthrough

### analytics.ts

**getOverallStats()**

Three separate SQLite queries aggregated into one return object:

- Sessions query: COUNT of all sessions, SUM of duration in minutes using julianday arithmetic, SUM of segments aired
- Chat query: COUNT of all chat_log rows
- Scripts query: COUNT of all sub_segments rows

All values default to 0 if tables are empty.

**getSessionSummaries(limit)**

Joins stream_sessions with chat_log on date matching. Groups by session ID. Maps raw database rows to a clean TypeScript interface with calculated duration in minutes.

**getDirectoryStats(dirPath)**

Scans a directory for WAV files using `fs.readdirSync`. For each file calls `fs.statSync` to get size and modification time. Returns count, total size in MB (rounded to 1 decimal), and the modification time of the oldest file.

**getStorageSummary()**

Calls getDirectoryStats on both the voice output directory and the mixed output subdirectory. Combines results into a single summary object.

**cleanupOldAudio(daysOld)**

Calculates a cutoff date by subtracting daysOld from today. Scans both audio directories. Deletes any WAV file whose modification time is before the cutoff. Returns a result object with count deleted, MB freed, and error count.

Called automatically on app startup and available manually via IPC.

**updateSessionSegmentCount() and updateSessionPeakViewers()**

Helper functions for Sprint 10. The Orchestrator will call these during the stream to keep session stats current as segments play and viewer counts change.

---

### AnalyticsPanel.tsx

**Stats grid**
Four stat cards in a row: Sessions, Streamed time, Scripts, Chat messages. Uses the teal accent color for values.

**Storage section**
Shows voice file count and size, mixed file count and size, and total. The cleanup button triggers `analyticsCleanup(30)` and shows a success or informational message.

**Recent sessions**
Grid layout showing date, duration, segment count, and chat message count per session. Sessions ordered newest first. Empty state message when no sessions exist yet.

**Auto-load on mount**
`useEffect(() => { load() }, [])` fires once when the component mounts, loading analytics immediately when the dashboard opens.

**Refresh button**
Manual refresh for when you want updated stats mid-session.

---

## 5. Database Tables Used

All five tables were defined in Sprint 0. Sprint 9 reads from four of them:

```
stream_sessions
  id, started_at, ended_at, platform, peak_viewers, segments_aired
  Written by: Sprint 7 (streamingManager.ts)
  Read by: Sprint 9 (analytics.ts)

chat_log
  id, platform, username, message, response, responded_at
  Written by: Sprint 8 (chatEngine.ts)
  Read by: Sprint 9 (analytics.ts)

sub_segments
  id, schedule_id, script, audio_file_path, mixed_audio_path, duration_sec
  Written by: Sprint 3 (contentGenerator.ts)
  Read by: Sprint 9 (analytics.ts)

schedule
  id, date, segment_order, category, topic, status
  Written by: Sprint 1 (scheduler.ts)
  Read by: Sprint 9 (indirectly via sub_segments)
```

The segment_analytics table (also from Sprint 0) is reserved for Sprint 10 when the Orchestrator tracks per-segment viewer counts during the stream.

---

## 6. Storage Growth Estimates

Reference numbers for planning:

```
One 90-second script:
  Voice WAV:  ~15 MB  (24kHz mono, uncompressed)
  Mixed WAV:  ~22 MB  (44.1kHz stereo, uncompressed)
  Total:      ~37 MB per sub-segment

One full 8-hour stream:
  ~40 schedule segments × 3 sub-segments avg = 120 sub-segments
  120 × 37 MB = ~4.4 GB per stream

With 30-day cleanup:
  Maximum accumulation ≈ 4.4 GB × 30 = ~130 GB worst case
  In practice much less since not all segments generate audio
```

Future improvement: convert WAV to MP3 after mixing to reduce storage by 90%. Sprint 10 polish item.

---

## 7. Testing Checklist

```
[ ] App starts and auto-cleanup log appears in Terminal 2
[ ] Analytics panel loads showing stat cards
[ ] Sessions count matches how many times you went live
[ ] Chat messages count matches chat activity
[ ] Storage section shows voice and mixed file counts
[ ] Storage MB numbers are reasonable
[ ] Clean Files button shows appropriate message
[ ] Refresh button updates stats after generating new content
[ ] Go live and stop -- new session appears after Refresh
[ ] min-height: 0 on dashboard-card prevents overflow
[ ] Each dashboard card scrolls independently when content overflows
```

---

## 8. Git Reference

```
git add .
git commit -m "sprint-9: analytics engine, storage tracking, auto-cleanup, session history"
git push
```

Files added or modified:

```
apps/desktop/src/main/analytics.ts                    (new) analytics engine
apps/desktop/src/main/main.ts                         (modified) analytics IPC handlers + startup cleanup
apps/desktop/src/main/preload.ts                      (modified) exposed analytics IPC
apps/desktop/src/renderer/components/AnalyticsPanel.tsx (new) analytics dashboard panel
apps/desktop/src/renderer/App.tsx                     (modified) added Analytics panel, 2x3 grid
apps/desktop/src/styles/global.css                    (modified) analytics styles, card overflow fix
```

---

## 9. Sprint Summary and What Is Next

### What Sprint 9 Accomplished

- Analytics engine reading all five Sprint 0 database tables
- Overall stats: sessions, stream time, scripts, chat messages
- Session history with duration, segments, and chat activity
- Storage tracking with file counts and MB per directory
- Automatic 30-day audio cleanup on every startup
- Manual cleanup button in dashboard
- Dashboard reorganized to clean 2x3 grid
- Card-level overflow with proper min-height fix

### What Sprint 10 Will Build

**Full Integration and Packaging** — the final sprint.

Sprint 10 wires everything together so the stream runs completely automatically for 8 hours. Key work:

- The Orchestrator coordinates all modules in sequence
- Schedule generates, data fetches, scripts write, audio produces, stream starts, segments play, chat responds, stream ends
- Chat responses converted to audio and played during dedicated windows
- Dynamic lower third updates in Streamlabs showing current topic
- VB-Audio virtual cable for silent desktop audio
- Reddit and Google News as additional data sources
- Ready Player Me avatar in the widget zone
- electron-builder packages the app as a Windows .exe
- Final polish pass on all modules
- Complete test run of a full 8-hour stream