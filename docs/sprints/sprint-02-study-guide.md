# Sprint 2 Study Guide — Data Fetchers

> **Sprint Goal:** Pull real-world data into the app — live news headlines and finance prices — and display them in the dashboard.
> **Status:** Complete
> **Builds toward:** Sprint 3 (Content Generator) uses these articles as the raw material for AI script writing.

---

## 1. What We Built

A Data Fetcher module that:
- Pulls live news headlines from NewsAPI.org for any selected category
- Pulls live finance prices for SPY, QQQ, BTC-USD, ETH-USD, AAPL, NVDA
- Saves all fetched data to SQLite for Sprint 3 to use
- Displays finance tickers and interleaved headlines in the dashboard
- Gracefully handles missing API keys and network failures

---

## 2. Key Concepts Explained

### What is a REST API?
A REST API is a web service you talk to over HTTP — the same protocol your browser uses to load websites. You send a request to a URL with some parameters, and get back data (usually JSON).

```
You send:
  GET https://newsapi.org/v2/everything?q=technology&apiKey=abc123

You receive:
  {
    "articles": [
      { "title": "AI breakthrough announced", "description": "..." },
      ...
    ]
  }
```

NewsAPI is a REST API. You send a search query, it returns matching articles.

### What is axios?
`axios` is a Node.js library that makes HTTP requests simpler than the built-in `fetch`. Key advantages:
- Automatic JSON parsing
- Built-in timeout support
- Better error messages
- Works the same in Node.js and browser

```typescript
const response = await axios.get('https://api.example.com/data', {
  params: { key: 'value' },  // becomes ?key=value in the URL
  timeout: 8000,             // fail after 8 seconds
})
const data = response.data   // already parsed from JSON
```

### What is an .env file?
A `.env` file stores sensitive configuration like API keys that should never be committed to GitHub:

```
NEWS_API_KEY=abc123yourkeyhere
```

Rules:
- One key=value per line
- Never commit to git (add to .gitignore)
- Never hardcode keys directly in source files
- Share keys with teammates through a secure channel, not the repo

### Why doesn't Electron auto-load .env?
Libraries like `dotenv` work in regular Node.js by calling `require('dotenv').config()` which reads `.env` from `process.cwd()`. In Electron, `process.cwd()` points to wherever the electron binary is, not your project root. We solved this by searching multiple possible paths:

```typescript
const possiblePaths = [
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '../../../../.env'),
  path.join(__dirname, '../../../.env'),
  path.join(__dirname, '../../.env'),
]
```

The first path that exists wins.

### What is a Record type?
```typescript
const NEWS_CATEGORY_QUERIES: Record<Category, string> = {
  finance: 'finance OR stocks OR economy',
  tech:    'technology OR artificial intelligence',
  ...
}
```
`Record<Category, string>` guarantees every category has a query string. TypeScript errors if you add a new Category and forget to add a query for it.

### What is round-robin interleaving?
When you have multiple arrays and want to mix them evenly:

```
Category A articles: [A1, A2, A3]
Category B articles: [B1, B2, B3]
Category C articles: [C1, C2, C3]

Flat (bad):    [A1, A2, A3, B1, B2, B3, C1, C2, C3]
Interleaved:   [A1, B1, C1, A2, B2, C2, A3, B3, C3]
```

The algorithm:
```typescript
const maxLen = Math.max(...categoryArrays.map(a => a.length))
for (let i = 0; i < maxLen; i++) {
  for (const arr of categoryArrays) {
    if (arr[i]) allArticles.push(arr[i])
  }
}
```
Loop by index first, then by category. This ensures variety at the top of the list.

### What is Promise.all?
```typescript
const [dataResult, financeResult] = await Promise.all([
  api.fetchData(selectedCategories),
  api.fetchFinance(),
])
```
`Promise.all` runs multiple async operations **simultaneously** instead of one after another. Both fetches happen at the same time, cutting total wait time roughly in half.

Without it:
```
fetchData  ──────────► (3 seconds)
                                   fetchFinance ──► (2 seconds)
Total: 5 seconds
```

With Promise.all:
```
fetchData    ──────────► (3 seconds)
fetchFinance ──────────► (2 seconds)
Total: 3 seconds (the slower one)
```

---

## 3. Architecture: How Sprint 2 Fits The Big Picture

```
Sprint 2 added the Data Fetcher layer:

External World          Main Process            Database
     │                       │                      │
     │   NewsAPI.org          │                      │
     │ ◄─────────────────── axios.get()             │
     │ ──────────────────► articles[]               │
     │                       │                      │
     │   Yahoo Finance API    │                      │
     │ ◄─────────────────── axios.get()             │
     │ ──────────────────► prices[]                 │
     │                       │                      │
     │                  saveArticles() ────────────►│
     │                  saveFinanceData() ──────────►│
     │                       │                      │
     │              return to renderer               │
     │                       │                      │

Sprint 3 will read FROM the database to build scripts:
     │                       │                      │
     │              loadArticlesForCategory() ◄──────│
     │                  (AI script generator)        │
```

---

## 4. File-by-File Walkthrough

### `src/main/dataFetcher.ts`

**loadEnv()**
Reads the `.env` file manually since Electron does not auto-load it. Searches multiple directory paths to find it regardless of where Electron's working directory points.

**NEWS_CATEGORY_QUERIES**
Maps each category to a NewsAPI search query using OR operators:
```typescript
finance: 'finance OR stocks OR economy OR cryptocurrency'
```
NewsAPI supports boolean operators in queries. OR means any article matching any of those terms is returned.

**fetchNewsForCategory()**
```typescript
const response = await axios.get('https://newsapi.org/v2/everything', {
  params: {
    q: query,
    language: 'en',
    sortBy: 'publishedAt',  // newest first
    pageSize: maxArticles,
    apiKey,
  },
  timeout: 8000,
})
```
Key decisions:
- `sortBy: 'publishedAt'` ensures we always get the freshest news
- `language: 'en'` filters to English only
- `timeout: 8000` prevents hanging forever if NewsAPI is slow
- Returns empty array on failure (graceful degradation)

**fetchFinanceData()**
Uses Yahoo Finance's unofficial chart endpoint directly via axios instead of a library. This is more stable because libraries can break when Yahoo changes their API:
```
https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&range=1d
```
The response contains `meta.regularMarketPrice` and `meta.chartPreviousClose` which we use to calculate change and percentage.

**fetchDataForSchedule()**
Loops through selected categories with a 300ms delay between each request:
```typescript
await new Promise(resolve => setTimeout(resolve, 300))
```
This rate limiting prevents hitting NewsAPI too fast and getting throttled or banned. Free tier allows 100 requests per day.

---

### `src/main/database.ts` additions

**saveArticles() and saveFinanceData()**
Both use the transaction pattern from Sprint 1 — all rows saved atomically or none at all.

**loadArticlesForCategory()**
```typescript
WHERE category = ? AND date(fetched_at) = ?
```
The `date()` SQLite function extracts just the date portion of an ISO timestamp. This ensures we only load today's articles, not stale data from previous sessions.

---

### `src/renderer/components/DataPanel.tsx`

**Props pattern:**
```typescript
interface DataPanelProps {
  selectedCategories: string[]
}
```
The component doesn't own the category state — it receives it from `App.tsx`. This is called "lifting state up" — when two components need the same data, the parent owns it and passes it down.

**Finance ticker display:**
```typescript
const formatChange = (change: number, pct: number) => {
  const sign = change >= 0 ? '+' : ''
  return `${sign}${change.toFixed(2)} (${sign}${pct.toFixed(2)}%)`
}
```
Numbers are formatted to 2 decimal places. Positive changes get a `+` prefix, negative changes naturally show `-`.

---

### `src/renderer/components/SchedulePanel.tsx` update

Added `useEffect` to notify the parent of the initial category selection on mount:
```typescript
React.useEffect(() => {
  onCategoriesChange?.(Array.from(selected))
}, [])
```
The empty dependency array `[]` means this runs once when the component mounts. Without this, `DataPanel` wouldn't know the initial categories until the user manually toggles one.

---

## 5. Problems We Hit and How We Fixed Them

### yahoo-finance2 library breaking
**Problem:** The `yahoo-finance2` npm library changed its API and required instantiation with `new YahooFinance()`. Both `require()` and dynamic `import()` approaches failed.

**Fix:** Removed the library entirely. Called Yahoo Finance's HTTP endpoint directly with axios. Direct HTTP calls are more stable than libraries for unofficial APIs since they don't depend on the library author keeping up with Yahoo's changes.

**Lesson:** For unofficial/scraping APIs, direct HTTP is often more reliable than wrapper libraries.

### .env file not found in Electron
**Problem:** `process.cwd()` in Electron points to the electron binary location, not the project root. The `.env` file was never found.

**Fix:** Search multiple relative paths using `__dirname` (which is reliable in compiled JS) to locate the `.env` file wherever it might be.

**Lesson:** Never assume `process.cwd()` in Electron. Use `__dirname` or `app.getPath()` for reliable paths.

### News only showing one category
**Problem:** All fetched articles were flattened with `Object.values(dataResult).flat()` which puts all of category A before category B. The `slice(0, 5)` then only showed the first category.

**Fix:** Round-robin interleaving loops by index first, then by category, mixing articles evenly across categories before slicing.

**Lesson:** When displaying mixed data, interleave by index rather than concatenating arrays.

### useEffect firing twice in development
**Problem:** Console showed each category being fetched twice.

**Fix:** Not a bug. React 18 intentionally runs effects twice in development (Strict Mode) to help catch side effects. In production builds this does not happen.

**Lesson:** Double console logs in dev with React 18 Strict Mode are expected and harmless.

---

## 6. Testing Checklist

```
□ Dashboard opens cleanly
□ Live Data panel shows green Fetch button
□ Terminal 2 shows "Found .env at: ..." on startup
□ Clicking Fetch Live Data triggers console logs per category
□ Finance tickers appear (SPY, QQQ, BTC-USD, AAPL)
□ Tickers show price, change amount, and change percentage
□ Positive changes show green, negative show red
□ News headlines appear below tickers
□ Headlines are interleaved across categories (not grouped)
□ Selecting different categories and fetching returns different topics
□ Last fetch timestamp updates on each fetch
□ No crashes when NewsAPI key is missing (graceful fallback)
```

---

## 7. Git Reference

```bash
git add .
git commit -m "sprint-2: data fetchers, NewsAPI integration, Yahoo Finance, live dashboard panel"
git push

# See all files changed this sprint
git diff HEAD~1 --name-only
```

---

## 8. API Reference

### NewsAPI
- Docs: https://newsapi.org/docs
- Free tier: 100 requests per day, developer use only
- Endpoint used: `GET /v2/everything`
- Key params: `q` (query), `language`, `sortBy`, `pageSize`

### Yahoo Finance (unofficial)
- No key required
- Endpoint: `https://query1.finance.yahoo.com/v8/finance/chart/{SYMBOL}`
- Params: `interval=1d&range=1d`
- Note: Unofficial endpoint, may change without notice

---

## 9. Sprint Summary and What is Next

### What Sprint 2 Accomplished
- Live news headlines fetched by category from NewsAPI
- Live finance prices fetched without any API key
- All data saved to SQLite for downstream use
- Dashboard Live Data panel with tickers and interleaved headlines
- Graceful error handling throughout
- Category selection synced between Schedule and Data panels

### What Sprint 3 Will Build
**The Content Generator** — this is where Ollama and Phi-3 Mini come in.

Sprint 3 takes the raw articles fetched in Sprint 2 and turns them into actual radio scripts. The AI host character is defined here. By the end, clicking a segment in the schedule will generate a full spoken script like:

"Welcome back to AI Radio, I am your host [Name]. Breaking news in the tech world today — researchers have announced a new breakthrough in quantum computing that could reshape the industry. Let me break down what this means for you..."

This is the most exciting sprint so far.