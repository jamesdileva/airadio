# Sprint 5 Study Guide: Audio Mixer

**Sprint Goal:** Use FFmpeg to blend Al's voice with royalty-free background music, producing mixed audio files that sound like a real radio broadcast.

**Status:** Complete

**Builds toward:** Sprint 6 (OBS Controller) plays these mixed files through OBS scenes during the live stream.

---

## 1. What We Built

An Audio Mixer module that:

- Takes Al's generated voice .wav files (Sprint 4)
- Blends them with royalty-free background music tracks
- Produces finished mixed .wav files ready for streaming
- Keeps music at a subtle volume underneath Al's voice
- Caches mixed files so the same segment is never processed twice
- Supports single segment mixing and batch mixing
- Plays mixed audio back in the dashboard for preview
- Picks one consistent music track per batch for a cohesive sound

The result sounds like real radio — music playing underneath, Al's voice clear and prominent on top.

---

## 2. Key Concepts Explained

### What is FFmpeg?

FFmpeg is a free, open-source command-line tool for processing audio and video. It is one of the most widely used multimedia tools in the world, used by YouTube, VLC, and thousands of other applications under the hood.

FFmpeg can:
- Convert between audio and video formats
- Mix multiple audio streams together
- Apply filters like volume adjustment and fade effects
- Extract audio from video files
- Stream audio and video to destinations like Twitch

We use FFmpeg for audio mixing because it is extremely powerful, handles any audio format, and can be called from Node.js the same way we call Python for TTS — as a child process.

### What is Audio Mixing?

Audio mixing combines multiple audio streams into one. In radio production:

- The voice track carries the content (Al speaking)
- The music track provides atmosphere and fills silence
- The mixed output balances both so the voice is always clear

The challenge is volume balancing. If music is too loud it drowns out the voice. If it is too quiet it feels absent. We use 12% music volume (0.12) which sits underneath the voice without competing with it.

### What is the amix Filter?

FFmpeg uses a filter system to process audio. The `amix` filter mixes multiple audio inputs into one output stream.

Our FFmpeg command explained line by line:

```
ffmpeg
  -i voice.wav              input 1: Al's voice file
  -i music.mp3              input 2: background music file
  -filter_complex           start of audio processing chain
    [1:a]volume=0.12[music] take input 2 audio, reduce to 12% volume, label it "music"
    [0:a][music]            take input 1 audio (full volume) and the "music" stream
    amix=inputs=2           mix these two streams together
    duration=first          stop when the first input (voice) ends
    dropout_transition=2    fade out smoothly over 2 seconds at the end
  -ac 2                     output stereo (2 channels)
  -ar 44100                 output at 44,100 Hz sample rate (CD quality)
  output.wav                save to this file
```

The key insight is `duration=first` — the mixed file is exactly as long as Al's voice. The music fades out when Al finishes speaking, not when the music track ends.

### What is Sample Rate?

Sample rate is how many audio samples are captured per second. Higher sample rates capture more detail.

```
8,000 Hz   -- telephone quality
24,000 Hz  -- Kokoro TTS output quality
44,100 Hz  -- CD quality (our output)
48,000 Hz  -- professional broadcast standard
```

Our voice files come out at 24,000 Hz (Kokoro's native rate). We upsample to 44,100 Hz for the mixed output because that is the standard expected by streaming platforms and audio players.

### What is a Filter Graph?

FFmpeg's `-filter_complex` argument accepts a filter graph — a description of how audio streams flow through processing steps. Think of it like a flowchart for audio:

```
Input 0 (voice) -----> [0:a] ---------> amix --> output
                                          |
Input 1 (music) --> [1:a] --> volume --> [music]
```

Each step in brackets is a filter node. Streams flow between nodes. The final node produces the output.

### What is Audio Caching?

Same concept as Sprint 4's TTS caching. Mixed files take time to produce (FFmpeg is fast but the files are large). We never process the same segment twice.

```
Request to mix sub-segment 61
    |
    Does mixed/mixed_61.wav exist?
    |
    YES --> return existing path immediately (cached)
    NO  --> run FFmpeg, produce the file, return the path
```

This means clicking Mix All after manually mixing one segment skips that segment and only processes the remaining ones.

### What is Royalty-Free Music?

Royalty-free music is music you can use without paying ongoing royalties (fees per play). For streaming on Twitch, music licensing is critical — Twitch will mute or remove VODs that contain copyrighted music.

Royalty-free does not always mean free to download. It means no per-use fees. The sources we used:

```
incompetech.com (now ende.app)
  Kevin MacLeod's library -- thousands of tracks
  Free to use with attribution
  Many genres: lo-fi, ambient, jazz, classical, electronic

freemusicarchive.org
  CC0 license tracks -- completely unrestricted
  Community uploaded music

pixabay.com/music
  Free for commercial and streaming use
  No attribution required
```

For radio background music, lo-fi and ambient tracks work best because they have no lyrics and maintain a consistent energy level that does not compete with speech.

---

## 3. Architecture: How Sprint 5 Fits the Big Picture

```
Sprint 5 completed the audio production pipeline:

Voice files (Sprint 4)          Music library
data/audio-output/              data/music/
segment_58.wav                  lofi-track.mp3
segment_59.wav                  ambient-track.mp3
        |                              |
        +--------- audioMixer.ts ------+
                        |
                   FFmpeg process
                        |
              data/audio-output/mixed/
              mixed_58.wav
              mixed_59.wav
                        |
              Dashboard preview (Play With Music button)
                        |
              Sprint 6: OBS plays these files during stream
```

---

## 4. File-by-File Walkthrough

### apps/desktop/src/main/audioMixer.ts

**getAvailableTracks()**

Scans the `data/music/` directory and returns all audio files (.mp3, .wav, .ogg, .flac). Creates the directory if it does not exist. This is called when the app needs to know what music is available.

**getRandomTrack()**

Returns one randomly selected track from the available library. Called at the start of a batch mix so all sub-segments in one session use the same track for a cohesive sound.

**runFFmpeg(args)**

The core FFmpeg wrapper. Spawns FFmpeg as a child process, collects stderr output (FFmpeg logs to stderr by default), and returns success or failure when the process exits. Note that FFmpeg outputs progress information to stderr even on success, so we only check the exit code to determine if it worked.

**mixVoiceWithMusic(voicePath, subSegmentId, musicPath)**

The main mixing function:

1. Creates output directories if needed
2. Selects music track (provided or random)
3. Builds the FFmpeg argument array
4. Calls runFFmpeg
5. Returns the path to the mixed file

If no music tracks are available in `data/music/`, it gracefully falls back to returning the voice-only file path. The stream continues even without music.

**mixAllSubSegments(subSegments, onProgress, forcedTrack)**

Batch processor. Picks one random track for consistency across the batch, then loops through all sub-segments calling `mixVoiceWithMusic` for each. Accepts an `onProgress` callback for logging.

**mixedAudioExists(subSegmentId)**

Checks if `data/audio-output/mixed/mixed_{id}.wav` exists. Used by the IPC handler for caching.

---

### IPC handlers in main.ts

**mixer:mix**

Single segment mixer. Checks cache first. If cached, returns the existing path immediately. Otherwise calls `mixVoiceWithMusic` and saves the result path to SQLite.

**mixer:mixAll**

Batch mixer. Separates the input into already-cached and needs-mixing groups. Only processes the needs-mixing group. Merges both groups in the response so the UI gets complete information.

**mixer:getAudioData**

Reads a mixed WAV file and returns it as Base64 for the renderer to play. Same approach as Sprint 4's audio playback.

---

### ScriptPanel.tsx additions

New state:

```typescript
mixStatus  -- tracks 'ready' | 'mixing' | 'error' per sub-segment ID
mixPaths   -- maps sub-segment ID to mixed file path
mixLoading -- true when any mix operation is in progress
```

New buttons appear in a logical sequence:

```
Step 1: Generate Audio button  (Sprint 4)
        -- generates voice .wav via Kokoro TTS
        -- becomes Play button when done

Step 2: Mix With Music button  (Sprint 5)
        -- only appears after audio is generated
        -- runs FFmpeg to blend voice with music
        -- becomes Play With Music button when done

Mix All button
        -- generates all remaining mixes at once
        -- skips already-mixed segments
```

**playMixedAudio(filePath)**

Same Base64 approach as Sprint 4. Reads the mixed WAV via IPC, creates a Blob URL, plays through the audio element.

---

## 5. Music Track Strategy

### Current behavior

- Manually mixing one segment picks a random track from the library
- Mix All picks one random track and uses it for the entire batch
- This means parts 1, 2, 3, 4 of one topic all share the same music

### Why this is the right approach

Real radio programs maintain a consistent musical bed throughout a segment. Switching music mid-topic would feel jarring and unprofessional. The music changes when the topic changes, not when the article changes.

### Planned behavior (Sprint 10 integration)

When the Orchestrator controls full playback:

```
Segment 1: World news briefing  --> picks track A --> all 4 sub-segments use track A
Segment 2: Gaming corner        --> picks track B --> all 3 sub-segments use track B
Segment 3: Finance update       --> picks track C --> all 4 sub-segments use track C
```

The Orchestrator will pass the chosen track through the mixing pipeline so manual and batch mixing are always consistent.

---

## 6. Volume Calibration

The music volume of 0.12 (12%) was chosen through testing. Reference values:

```
0.05  -- barely audible, too subtle
0.12  -- clearly present but not competing (our choice)
0.20  -- noticeable, may compete in quiet speech sections
0.30  -- too loud, distracts from voice
```

To adjust, change `MUSIC_VOLUME` in `audioMixer.ts`:

```typescript
const MUSIC_VOLUME = 0.12  // change this value
```

---

## 7. Problems We Hit and How We Fixed Them

### FFmpeg PATH not found

FFmpeg installed to a non-standard location and was not automatically added to Windows PATH.

Fix: Manually added `C:\Program Files\ffmpeg-master-latest-win64-gpl-shared\bin` to the Windows PATH environment variable through System Properties. Verified with `ffmpeg -version` in a new terminal.

Lesson: Always verify external tools with a version check before writing code that depends on them.

### Voice file is mono, music is stereo

Kokoro outputs mono audio (one channel) at 24,000 Hz. Background music is typically stereo (two channels) at 44,100 or 48,000 Hz. FFmpeg handles the conversion automatically through the filter graph and the `-ac 2 -ar 44100` output flags.

The `-ac 2` flag upmixes mono voice to stereo. The `-ar 44100` flag resamples all inputs to a consistent sample rate before mixing.

### Mixed file plays as voice-only in some players

Some audio players do not handle WAV files with unusual sample rates. Fixed by explicitly setting output to 44,100 Hz which is universally supported.

---

## 8. Testing Checklist

```
[ ] ffmpeg -version shows version info in terminal
[ ] At least one .mp3 file exists in data/music/
[ ] Standalone FFmpeg test produces test_mixed.wav
[ ] test_mixed.wav plays with voice and music together
[ ] App builds with zero TypeScript errors
[ ] Generate schedule works
[ ] Click segment, generate scripts works
[ ] Generate audio (Sprint 4) works
[ ] Mix With Music button appears after audio generated
[ ] Clicking Mix With Music triggers FFmpeg in Terminal 2
[ ] Play With Music button appears after mixing
[ ] Clicking Play With Music plays mixed audio in dashboard
[ ] Music is audible but clearly behind Al's voice
[ ] Mix All mixes remaining segments
[ ] Already mixed segments are skipped (cached)
[ ] Different music tracks can be heard across different sessions
```

---

## 9. Git Reference

```
git add .
git commit -m "sprint-5: audio mixer, FFmpeg voice+music blending, mixed playback"
git push
```

Files added or modified this sprint:

```
apps/desktop/src/main/audioMixer.ts     (new) FFmpeg mixing module
apps/desktop/src/main/main.ts           (modified) three new IPC handlers
apps/desktop/src/main/preload.ts        (modified) exposed mixer IPC calls
apps/desktop/src/main/database.ts       (modified) mixed audio path storage
apps/desktop/src/renderer/components/ScriptPanel.tsx  (modified) mix UI
apps/desktop/src/styles/global.css      (modified) mix button styles
data/music/                             (new) royalty-free music library
```

---

## 10. Future Improvements (Sprint 10 Polish)

### Better news sources

NewsAPI free tier has quality limitations. Planned alternatives:

- Google News RSS feeds -- free, high quality, no API key needed
- Reddit API -- community content, perfect for niche topics like obscure world records
- Direct RSS from BBC, Reuters, AP News -- most reliable source of factual reporting

### Music variation by segment

The Orchestrator in Sprint 10 will assign one music track per schedule segment (not per sub-segment), ensuring consistent music within a topic while varying between topics.

### Audio cleanup

Sprint 9 will add automatic cleanup of audio files older than 30 days to prevent unlimited disk accumulation.

---

## 11. Sprint Summary and What Is Next

### What Sprint 5 Accomplished

- FFmpeg integrated for professional audio mixing
- Voice and music blended with calibrated volume levels
- Mixed audio cached to avoid reprocessing
- Batch mixing with progress tracking and cache awareness
- Play With Music preview in the dashboard
- Royalty-free music library established in data/music/

### What Sprint 6 Will Build

**The OBS Controller** using Streamlabs WebSocket.

Sprint 6 connects to your running Streamlabs instance and controls it programmatically -- switching scenes, triggering sources, and preparing the visual side of the stream.

By the end of Sprint 6, the app will be able to tell Streamlabs to switch to the "On Air" scene when a segment starts and switch to the "Break" scene between segments.

The pipeline becomes:

```
Mixed audio ready (Sprint 5)
        |
OBS Controller switches to On Air scene (Sprint 6)
        |
Audio plays through OBS audio source
        |
Stream goes live (Sprint 7)
```