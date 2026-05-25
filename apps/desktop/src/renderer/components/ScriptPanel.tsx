import React, { useState } from 'react'
import { ScheduleSegment, SubSegment } from '../../shared/types'

interface ScriptPanelProps {
  segments: ScheduleSegment[]
}

export const ScriptPanel: React.FC<ScriptPanelProps> = ({ segments }) => {
  const [subSegments,  setSubSegments]  = useState<SubSegment[]>([])
  const [activeIdx,    setActiveIdx]    = useState<number>(0)
  const [loading,      setLoading]      = useState(false)
  const [selectedSeg,  setSelectedSeg]  = useState<number | null>(null)
  const [progress,     setProgress]     = useState<string>('')

  const handleGenerate = async (seg: ScheduleSegment, idx: number) => {
    console.log('=== SEGMENT CLICKED ===')
    console.log('Segment:', seg)

    if (!seg.id) {
      console.warn('Segment has no ID!')
      return
    }

    setLoading(true)
    setSelectedSeg(idx)
    setSubSegments([])
    setActiveIdx(0)
    setProgress('Fetching articles...')

    try {
      setProgress('Al is writing scripts...')
      const result: SubSegment[] = await (window as any).electronAPI.generateScript({
        scheduleId: seg.id,
        category:   seg.category,
        topic:      seg.topic,
      })

      console.log('Sub-segments received:', result.length)
      setSubSegments(result)
      setProgress('')
    } catch (err) {
      console.error('Script generation failed:', err)
      setProgress('Generation failed. Is Ollama running?')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="script-panel">
      {segments.length === 0 ? (
        <p className="placeholder-text">
          Generate a schedule first, then click a segment to write its scripts
        </p>
      ) : (
        <>
          <div className="segment-picker">
            <p className="picker-label">
              Click a segment to generate scripts:
            </p>
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
              <div className="subsegment-tabs">
                {subSegments.map((sub, i) => (
                  <button
                    key={i}
                    className={`tab-btn ${activeIdx === i ? 'active' : ''}`}
                    onClick={() => setActiveIdx(i)}
                  >
                    Part {i + 1}
                  </button>
                ))}
              </div>

              <div className="script-output">
                <div className="script-meta">
                  <span className="script-cat">
                    {subSegments[activeIdx]?.category}
                  </span>
                  <span className="script-topic">
                    {subSegments[activeIdx]?.headline}
                  </span>
                </div>
                <div className="script-text">
                  {subSegments[activeIdx]?.script}
                </div>
                <div className="script-duration">
                  ~{subSegments[activeIdx]?.durationSec}s spoken
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}