import React, { useState, useRef } from 'react'
import { ScheduleSegment, SubSegment }  from '../../shared/types'

interface ScriptPanelProps {
  segments: ScheduleSegment[]
}

export const ScriptPanel: React.FC<ScriptPanelProps> = ({ segments }) => {
  const [subSegments,  setSubSegments]  = useState<SubSegment[]>([])
  const [activeIdx,    setActiveIdx]    = useState<number>(0)
  const [loading,      setLoading]      = useState(false)
  const [selectedSeg,  setSelectedSeg]  = useState<number | null>(null)
  const [progress,     setProgress]     = useState<string>('')
  const [audioLoading, setAudioLoading] = useState(false)
  const [audioStatus,  setAudioStatus]  = useState<Record<number, 'ready' | 'generating' | 'error'>>({})
  const audioRef = useRef<HTMLAudioElement>(null)
  const [audioPaths, setAudioPaths] = useState<Record<number, string>>({})
  const [mixStatus,  setMixStatus]  = useState<Record<number, 'ready' | 'mixing' | 'error'>>({})
  const [mixPaths,   setMixPaths]   = useState<Record<number, string>>({})
  const [mixLoading, setMixLoading] = useState(false)
  const handleGenerate = async (seg: ScheduleSegment, idx: number) => {
    if (!seg.id) return
    setLoading(true)
    setSelectedSeg(idx)
    setSubSegments([])
    setActiveIdx(0)
    setAudioStatus({})
    setProgress('Fetching articles...')

    try {
      setProgress('Al is writing scripts...')
      const result: SubSegment[] = await (window as any).electronAPI.generateScript({
        scheduleId: seg.id,
        category:   seg.category,
        topic:      seg.topic,
      })
      setSubSegments(result)
      setProgress('')
    } catch (err) {
      console.error('Script generation failed:', err)
      setProgress('Generation failed. Is Ollama running?')
    } finally {
      setLoading(false)
    }
  }

  const handleGenerateAudio = async (sub: SubSegment) => {
  if (!sub.id) return
  setAudioLoading(true)
  setAudioStatus(prev => ({ ...prev, [sub.id!]: 'generating' }))

  try {
    const result = await (window as any).electronAPI.generateAudio({
      subSegmentId: sub.id,
      script:       sub.script,
      voice:        'af_heart',
    })

    if (result.success && result.audioPath) {
      setAudioStatus(prev => ({ ...prev, [sub.id!]: 'ready' }))
      setAudioPaths(prev => ({ ...prev, [sub.id!]: result.audioPath }))
      // Play immediately
      playAudio(result.audioPath)
    } else {
      setAudioStatus(prev => ({ ...prev, [sub.id!]: 'error' }))
    }
  } catch (err) {
    setAudioStatus(prev => ({ ...prev, [sub.id!]: 'error' }))
  } finally {
    setAudioLoading(false)
  }
}

// Update handleGenerateAllAudio to store paths
const handleGenerateAllAudio = async () => {
  if (subSegments.length === 0) return
  setAudioLoading(true)

  try {
    const payload = subSegments
      .filter(s => s.id)
      .map(s => ({ id: s.id!, script: s.script }))

    const results = await (window as any).electronAPI.generateAudioBatch({
      subSegments: payload,
      voice:       'af_heart',
    })

    const newStatus: Record<number, 'ready' | 'generating' | 'error'> = {}
    const newPaths:  Record<number, string> = {}
    for (const r of results) {
      newStatus[r.subSegmentId] = 'ready'
      newPaths[r.subSegmentId]  = r.audioPath
    }
    setAudioStatus(newStatus)
    setAudioPaths(newPaths)
  } catch (err) {
    console.error('Batch audio failed:', err)
  } finally {
    setAudioLoading(false)
  }
}

// Add this helper function inside the component
const playAudio = async (filePath: string) => {
  if (!audioRef.current) return
  try {
    console.log('Loading audio from:', filePath)
    const base64 = await (window as any).electronAPI.getAudioData(filePath)
    if (!base64) {
      console.error('No audio data returned')
      return
    }
    const blob = new Blob(
      [Uint8Array.from(atob(base64), c => c.charCodeAt(0))],
      { type: 'audio/wav' }
    )
    const url = URL.createObjectURL(blob)
    audioRef.current.src = url
    audioRef.current.load()
    audioRef.current.play()
      .then(() => console.log('Playback started!'))
      .catch(err => console.error('Playback failed:', err.message))
  } catch (err) {
    console.error('Audio load failed:', err)
  }
}

const handleMix = async (sub: SubSegment) => {
  if (!sub.id || !audioPaths[sub.id]) return
  setMixLoading(true)
  setMixStatus(prev => ({ ...prev, [sub.id!]: 'mixing' }))

  try {
    const result = await (window as any).electronAPI.mixAudio({
      subSegmentId: sub.id,
      audioPath:    audioPaths[sub.id],
    })

    if (result.success && result.outputPath) {
      setMixStatus(prev => ({ ...prev, [sub.id!]: 'ready' }))
      setMixPaths(prev =>  ({ ...prev, [sub.id!]: result.outputPath }))
      playMixedAudio(result.outputPath)
    } else {
      setMixStatus(prev => ({ ...prev, [sub.id!]: 'error' }))
    }
  } catch (err) {
    console.error('Mix failed:', err)
    setMixStatus(prev => ({ ...prev, [sub.id!]: 'error' }))
  } finally {
    setMixLoading(false)
  }
}

const handleMixAll = async () => {
  if (subSegments.length === 0) return
  setMixLoading(true)

  try {
    const payload = subSegments
      .filter(s => s.id && audioPaths[s.id])
      .map(s => ({ id: s.id!, audioPath: audioPaths[s.id!] }))

    const results = await (window as any).electronAPI.mixAllAudio({ subSegments: payload })

    const newStatus: Record<number, 'ready' | 'mixing' | 'error'> = {}
    const newPaths:  Record<number, string> = {}
    for (const r of results) {
      newStatus[r.id] = 'ready'
      newPaths[r.id]  = r.mixedPath
    }
    setMixStatus(newStatus)
    setMixPaths(newPaths)
  } catch (err) {
    console.error('Mix all failed:', err)
  } finally {
    setMixLoading(false)
  }
}

const playMixedAudio = async (filePath: string) => {
  if (!audioRef.current) return
  try {
    const base64 = await (window as any).electronAPI.getMixedAudioData(filePath)
    if (!base64) return
    const blob = new Blob(
      [Uint8Array.from(atob(base64), c => c.charCodeAt(0))],
      { type: 'audio/wav' }
    )
    const url = URL.createObjectURL(blob)
    audioRef.current.src = url
    audioRef.current.load()
    audioRef.current.play()
  } catch (err) {
    console.error('Mixed playback failed:', err)
  }
}


  const currentSub = subSegments[activeIdx]

  return (
    <div className="script-panel">
      {segments.length === 0 ? (
        <p className="placeholder-text">
          Generate a schedule first, then click a segment to write its scripts
        </p>
      ) : (
        <>
          <div className="segment-picker">
            <p className="picker-label">Click a segment to generate scripts:</p>
            <div className="picker-list">
              {segments.slice(0, 8).map((seg, i) => (
                <button
                  key={i}
                  className={`picker-btn ${selectedSeg === i ? 'active' : ''}`}
                  onClick={() => handleGenerate(seg, i)}
                  disabled={loading}
                >
                  <span className="picker-cat">{seg.category}</span>
                  <span className="picker-topic">{seg.topic}</span>
                </button>
              ))}
            </div>
          </div>

          {loading && (
            <div className="script-loading">
              <span className="loading-dot">●</span>
              <span className="loading-dot">●</span>
              <span className="loading-dot">●</span>
              <span>{progress}</span>
            </div>
          )}

          {subSegments.length > 0 && !loading && (
            <div className="subsegment-container">
              <div className="subsegment-header">
                <div className="subsegment-tabs">
                  {subSegments.map((sub, i) => (
                    <button
                      key={i}
                      className={`tab-btn ${activeIdx === i ? 'active' : ''}`}
                      onClick={() => setActiveIdx(i)}
                    >
                      Part {i + 1}
                      {sub.id && audioStatus[sub.id] === 'ready' && (
                        <span className="audio-dot">♪</span>
                      )}
                    </button>
                  ))}
                </div>

                <button
                  className="btn btn-audio-all"
                  onClick={handleGenerateAllAudio}
                  disabled={audioLoading}
                >
                  {audioLoading ? 'Generating...' : '🎙 Generate All Audio'}
                </button>
              </div>

              {currentSub && (
                <div className="script-output">
                  <div className="script-meta">
                    <span className="script-cat">{currentSub.category}</span>
                    <span className="script-topic">{currentSub.headline}</span>
                  </div>

                  <div className="script-text">{currentSub.script}</div>

                  <div className="script-footer">
                    <span className="script-duration">
                      ~{currentSub.durationSec}s spoken
                    </span>

                    <div className="audio-controls">
                      {currentSub.id && audioStatus[currentSub.id] === 'ready' ? (
                    <button
                        className="btn btn-play"
                        onClick={() => {
                        const p = audioPaths[currentSub.id!]
                        if (p) playAudio(p)
                        }}
                    >
                        ▶ Play
                    </button>
                    ) : (
                    <button
                        className="btn btn-tts"
                        onClick={() => handleGenerateAudio(currentSub)}
                        disabled={audioLoading || (currentSub.id ? audioStatus[currentSub.id] === 'generating' : false)}
                    >
                        {currentSub.id && audioStatus[currentSub.id] === 'generating'
                        ? 'Generating...'
                        : '🎙 Generate Audio'}
                    </button>
                    
                    )}
                    <div className="mix-controls">
                      {currentSub?.id && mixStatus[currentSub.id] === 'ready' ? (
                        <button
                          className="btn btn-play-mixed"
                          onClick={() => {
                            const p = mixPaths[currentSub.id!]
                            if (p) playMixedAudio(p)
                          }}
                        >
                          ♪ Play With Music
                        </button>
                      ) : (
                        currentSub?.id && audioStatus[currentSub.id] === 'ready' && (
                          <button
                            className="btn btn-mix"
                            onClick={() => handleMix(currentSub)}
                            disabled={mixLoading || mixStatus[currentSub.id] === 'mixing'}
                          >
                            {mixStatus[currentSub.id] === 'mixing' ? 'Mixing...' : '🎵 Mix With Music'}
                          </button>
                        )
                      )}

                      {subSegments.some(s => s.id && audioStatus[s.id] === 'ready') && (
                        <button
                          className="btn btn-mix-all"
                          onClick={handleMixAll}
                          disabled={mixLoading}
                        >
                          {mixLoading ? 'Mixing...' : '🎵 Mix All'}
                        </button>
                      )}
                    </div>
                    </div>
                  </div>
                </div>
              )}

              <audio ref={audioRef} controls className="audio-player" />
            </div>
          )}
        </>
      )}
    </div>
  )
}