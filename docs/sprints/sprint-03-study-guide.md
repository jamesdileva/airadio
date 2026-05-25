# Sprint 3 Study Guide: Content Generator

**Sprint Goal:** Connect real news articles to an AI language model to generate spoken radio scripts in the voice of host character "Al."

**Status:** Complete

**Builds toward:** Sprint 4 (Voice Engine) reads these scripts aloud using text-to-speech.

---

## 1. What We Built

A Content Generator pipeline that:

- Connects to a locally running Ollama LLM (Mistral model)
- Defines a persistent radio host character named Al
- Fetches news articles targeted to each specific schedule topic
- Generates one focused script per article (sub-segments)
- Saves all scripts to SQLite for the Voice Engine to use
- Displays scripts in the dashboard with Part 1, Part 2, Part 3, Part 4 tabs
- Filters out low-quality, irrelevant, and non-English articles
- Prevents common LLM failure modes (code output, hallucinated facts, cut-off sentences)

The full pipeline established in this sprint:

```
Schedule segment selected
        |
Topic-specific NewsAPI query
        |
Article quality filtering
        |
One Ollama prompt per article
        |
Script cleanup and validation
        |
SQLite sub_segments table
        |
Dashboard ScriptPanel display
```

---

## 2. Key Concepts Explained

### What is Ollama?

Ollama is a tool that lets you run large language models locally on your own computer. Instead of sending data to OpenAI's servers and paying per token, Ollama downloads a model file and runs inference entirely on your machine.

Commands used:

```
ollama pull mistral       downloads the Mistral model
ollama run mistral        opens an interactive chat
ollama list               shows downloaded models
```

Ollama exposes a local HTTP API at `http://localhost:11434`. Our app calls this API directly using axios, the same way we call NewsAPI.

### What is a Large Language Model?

A large language model (LLM) is a neural network trained on massive amounts of text. It learns statistical patterns in language and uses those patterns to predict what text should come next given a prompt. When we send a prompt describing Al's personality and the article to cover, the model predicts the radio script that would naturally follow.

Key parameters we control:

```
temperature   Controls randomness. 0 = deterministic/robotic, 1 = creative/unpredictable.
              We use 0.7 for a balance of creativity and coherence.

top_p         Nucleus sampling. Limits which tokens the model considers.
              0.9 means only tokens comprising the top 90% probability mass are sampled.

num_predict   Maximum number of tokens to generate.
              We use 800. One token is roughly 0.75 words, so 800 tokens is about 600 words.

stop          Sequences that immediately halt generation.
              We stop on code patterns like backticks and "def " to prevent code output.
```

### What is a System Prompt?

A system prompt is instructions given to the LLM before the user message. It defines the model's persona, rules, and constraints. Our system prompt in `hostCharacter.ts` tells the model:

- It is Al, host of AI Radio Network
- How to speak and what tone to use
- What format the output must follow
- What it must never do (make up facts, output code, use time-based greetings)

The system prompt is prepended to every single Ollama call, ensuring Al's voice is consistent across all 8 hours of content.

### What is a Sub-Segment?

Previously one schedule slot generated one script covering multiple articles loosely. This created unfocused scripts where the model rambled between topics.

The sub-segment architecture changes this:

```
Before:
  1 slot + 4 articles = 1 long unfocused script

After:
  1 slot + 4 articles = 4 focused scripts
  Each script covers exactly 1 article
  Scripts are stored as sub_segments in SQLite
  Voice Engine plays them sequentially
```

Benefits:
- Each script is focused and factually grounded
- If one script fails, others still generate
- Natural variety in segment length
- Easier to extend, skip, or replay individual pieces

### What is Token Prediction?

LLMs generate text one token at a time. Each token is predicted based on everything that came before it. This is why:

- Models can lose track of instructions given early in a long prompt
- Keeping prompts focused produces better output
- The `stop` parameter lets us halt generation when we detect unwanted patterns

### What is a Topic-to-Query Map?

NewsAPI takes a search query, not a topic title. "World news morning briefing" as a search query returns articles that literally contain those words, not actual world news.

The `TOPIC_QUERY_MAP` translates human-readable topic names into effective search queries:

```
"World news morning briefing"
    becomes
"world news" OR "international" OR war OR sanctions OR "foreign policy" OR diplomat
```

This maps all 40 topics in the scheduler to targeted queries that return relevant, high-quality articles.

### What is Cascade Deletion?

SQLite enforces referential integrity with foreign keys. A parent row cannot be deleted if child rows reference it. Our database has this hierarchy:

```
schedule (parent)
    |
    +-- segments (child)
    |       |
    |       +-- segment_analytics (grandchild)
    |
    +-- sub_segments (child)
```

When regenerating a schedule, we must delete in reverse order:

```
1. DELETE segment_analytics WHERE segment_id IN (segments for this schedule)
2. DELETE sub_segments WHERE schedule_id = ?
3. DELETE segments WHERE schedule_id = ?
4. DELETE schedule WHERE date = ?
5. INSERT new schedule rows
```

Skipping any step causes a FOREIGN KEY constraint failed error.

---

## 3. Architecture: How Sprint 3 Fits the Big Picture

```
Sprint 3 completed the content creation pipeline:

  External World        Main Process            Database
       |                     |                      |
  NewsAPI.org                |                      |
  (topic query)  <------  fetchArticlesForTopic()   |
       |                     |                      |
       |--------> articles[] |                      |
                             |                      |
                        generateSubSegments()        |
                             |                      |
                        callOllama() x4             |
                             |                      |
                        saveSubSegments() --------> sub_segments table
                             |                      |
                        return to renderer           |
                             |                      |

Sprint 4 reads from sub_segments and converts scripts to audio:

  sub_segments table --> Voice Engine --> .wav files --> Audio Mixer
```

---

## 4. File-by-File Walkthrough

### hostCharacter.ts

Defines the Al persona as a single exported constant. Every Ollama prompt prepends `HOST.systemPrompt`, making every generated script consistent in voice and format.

Key design decisions:

- Strict rules section prevents known failure modes
- No time-based greetings prevents "Good morning" on every segment
- No location mentions prevents hallucinated city references
- No previewing next story prevents the model inventing future segments
- English only prevents non-English output from slipping through

---

### contentGenerator.ts

**callOllama(prompt)**

Makes a POST request to the local Ollama API. Key points:

```typescript
stream: false    // We want the complete response, not a token stream
timeout: 120000  // 2 minutes. Mistral on CPU can be slow.
```

Returns the raw text response or throws if Ollama is unreachable.

**buildSingleArticlePrompt()**

Constructs the prompt for a single article. Uses position awareness:

```typescript
const isFirst = partNum === 1
const isLast  = partNum === totalParts

// First segment: introduce with "You're listening to AI Radio Network"
// Middle segments: jump straight in, no re-introduction
// Last segment: close with sign-off
// Middle segments: end with generic transition, never preview next story
```

**generateSubSegments()**

The main orchestrator. For each article:

1. Builds the prompt
2. Calls Ollama
3. Cleans the output (strips code lines)
4. Ensures the script ends on a complete sentence
5. Estimates spoken duration (150 words per minute average)
6. Pushes to results array
7. Falls back to a placeholder on failure

**Article cleaning pipeline:**

```typescript
// Step 1: Filter bad articles before sending to AI
const cleanArticles = articles.filter(a => {
  if (!a.title || !a.summary)        return false  // missing data
  if (a.title.includes('[Removed]')) return false  // deleted articles
  if (/[^\x00-\x7F]/.test(a.title)) return false  // non-English characters
  return true
})

// Step 2: Clean AI output after generation
const cleanScript = rawScript
  .split('\n')
  .filter(line => {
    // Remove lines that look like code
    if (line.trim().startsWith('```'))    return false
    if (line.trim().startsWith('def '))   return false
    if (line.includes('employee_id'))     return false
    return true
  })
  .join('\n')
  .trim()

// Step 3: Ensure complete ending
const finalScript = cleanScript.replace(/([^.!?])(\s*)$/, '$1.')
```

---

### dataFetcher.ts additions

**TOPIC_QUERY_MAP**

A 40-entry map translating every scheduler topic to an optimized NewsAPI query. This is the single biggest quality improvement of the sprint. Without it, "Streamer and content creator news" searches literally for that phrase and returns nothing relevant. With it, the query becomes "Twitch OR YouTube gaming OR streamer OR content creator OR livestream."

**fetchArticlesForTopic()**

Fetches articles for a specific topic rather than a broad category. Key improvements over the earlier category-based fetch:

- Uses `TOPIC_QUERY_MAP` for targeted queries
- Fetches `max + 3` articles to have buffer after filtering
- Applies sports URL filter to block BBC Sport articles from non-sports topics
- Falls back to category search if topic search returns nothing
- Slices back down to `max` after filtering

**Sports URL filter:**

```typescript
if (/sport\.bbc|bbc\.com\/sport/i.test(a.url))  return false
```

BBC publishes everything under `bbc.com` so domain filtering alone cannot distinguish BBC News from BBC Sport. URL pattern matching solves this.

---

### database.ts additions

**sub_segments table:**

```sql
CREATE TABLE IF NOT EXISTS sub_segments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id   INTEGER REFERENCES schedule(id),
  article_index INTEGER NOT NULL,
  category      TEXT NOT NULL,
  topic         TEXT NOT NULL,
  headline      TEXT NOT NULL,
  script        TEXT NOT NULL,
  duration_sec  INTEGER NOT NULL,
  generated_at  TEXT NOT NULL
);
```

**saveSubSegments()** uses a transaction to insert all sub-segments atomically. Returns the inserted rows with their database IDs populated.

**clearSubSegments()** deletes all sub-segments for a given schedule ID. Called before regenerating scripts to prevent duplicates.

---

### ScriptPanel.tsx

Displays up to 8 schedule segments as clickable buttons. When clicked:

1. Shows loading animation with pulsing dots
2. Calls `electronAPI.generateScript()` via IPC
3. Receives array of SubSegment objects
4. Renders Part 1, Part 2, Part 3, Part 4 tabs
5. Shows headline, script text, and estimated duration for active tab

The tab interface lets the user review each sub-segment individually before the Voice Engine reads them aloud.

---

## 5. Model Comparison

| Model | Size | Speed | Quality | Decision |
|---|---|---|---|---|
| phi3:mini-4k | 3.8B | Fast (~30s) | Moderate, code hallucinations | Replaced |
| mistral | 7B | Slower (~90s) | Good, fewer hallucinations | Current |

Mistral produces noticeably better scripts with less post-processing needed. The speed tradeoff is acceptable because scripts are generated before the segment airs, not in real time.

---

## 6. Problems We Hit and How We Fixed Them

### LLM outputting Python code mid-script

The model confused its training data (which contains code) with the output task. Fixed with three layers of defense: stop tokens that halt generation on code patterns, line-level filtering that removes code lines from output, and explicit system prompt rules forbidding programming syntax.

### Scripts ending mid-sentence

`num_predict: 300` was too low. The model ran out of tokens mid-sentence. Fixed by increasing to 800 tokens and adding a regex that appends a period if the last character is not a sentence-ender.

### "You're listening to AI Radio Network" repeated on every sub-segment

The intro instruction was not position-aware. Fixed by checking `isFirst` and only including the intro phrase in the first sub-segment's prompt. Subsequent segments are instructed to jump straight into the story.

### Model inventing the next story topic in transitions

The model hallucinated what the next segment would be about. Fixed by adding an explicit rule to the system prompt and outro instructions: never mention or preview what the next story is about, use only generic transition phrases.

### Foreign key constraint on schedule regeneration

Deleting schedule rows failed because child rows in segments and sub_segments still referenced them. Fixed by implementing cascade deletion in the correct order: grandchildren first, then children, then parents.

### Sports articles appearing in non-sports topics

BBC publishes sports content under bbc.com, so domain allowlisting did not filter it. Fixed by checking the article URL for sport.bbc and bbc.com/sport patterns and rejecting those regardless of domain.

### "World news morning briefing" returning irrelevant articles

Using the topic title as the NewsAPI query returned articles that literally contained those words rather than actual world news. Fixed by the TOPIC_QUERY_MAP which translates all 40 topics to targeted Boolean search queries.

---

## 7. Testing Checklist

```
[ ] Generate a schedule with 2-3 categories selected
[ ] Click Fetch Live Data to confirm articles are loading
[ ] Click a segment in the Current Segment panel
[ ] Terminal 2 shows topic query translation log
[ ] Terminal 2 shows "Generating sub-segment 1/4: [headline]"
[ ] Part 1, Part 2 tabs appear after generation (15-90 seconds)
[ ] First sub-segment opens with "You're listening to AI Radio Network"
[ ] Second and later sub-segments jump straight into the story
[ ] No sub-segment ends mid-sentence
[ ] No sub-segment mentions what the next story will be specifically
[ ] No code or programming syntax in any script
[ ] Finance segment includes market data (SPY, QQQ prices)
[ ] Regenerating schedule clears old sub-segments without error
[ ] Scripts saved to SQLite sub_segments table
```

---

## 8. Git Reference

```
git add .
git commit -m "sprint-3: content generator, Mistral/Ollama, sub-segments, topic query mapping, article filtering"
git push
```

Files added or modified this sprint:

```
src/main/hostCharacter.ts       (new) Al persona and system prompt
src/main/contentGenerator.ts    (new) Ollama integration and script generation
src/main/dataFetcher.ts         (modified) topic query map, quality filtering
src/main/database.ts            (modified) sub_segments table, cascade delete
src/main/main.ts                (modified) updated IPC handlers
src/main/preload.ts             (modified) exposed new IPC calls
src/renderer/components/ScriptPanel.tsx  (new) tabbed script display
src/shared/types.ts             (modified) SubSegment type added
```

---

## 9. Sprint Summary and What Is Next

### What Sprint 3 Accomplished

- Ollama + Mistral running locally, zero API costs for script generation
- Al host character defined with consistent voice across all content
- Sub-segment architecture: one focused script per article
- 40-topic query map producing relevant, targeted article searches
- Multi-layer article quality filtering
- LLM output cleanup preventing code and hallucinations
- Cascade deletion preventing foreign key errors on regeneration
- Dashboard ScriptPanel with tabbed sub-segment display

### What Sprint 4 Will Build

**The Voice Engine** using Kokoro TTS, which was installed back in Sprint 0.

Kokoro will take each generated script and convert it to a .wav audio file. By the end of Sprint 4, clicking a segment will generate scripts AND produce audio files ready for playback.

The pipeline becomes:

```
Article -> Script (Sprint 3) -> Audio file (Sprint 4) -> Mixed with music (Sprint 5) -> Live stream (Sprint 7)
```