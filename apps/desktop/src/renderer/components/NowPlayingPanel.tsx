// New component: NowPlayingPanel.tsx
import React, { useState, useEffect } from 'react'

interface NowPlayingProps {
  orchState:  string
  orchStatus: any
}

interface ScheduleSegment {
  id?:             number
  segmentOrder:    number
  category:        string
  topic:           string
  durationSeconds: number
  status:          string
}

interface NowPlayingProps {
  orchState:  string
  orchStatus: any
}

export const NowPlayingPanel: React.FC<NowPlayingProps> = ({
  orchState,
  orchStatus,
}) => {
  const [schedule, setSchedule] = useState<ScheduleSegment[]>([])
  useEffect(() => {
    // Load schedule as soon as we know how many segments there are
    if (orchStatus?.totalSegments > 0 && schedule.length === 0) {
      loadSchedule()
    }
  }, [orchStatus?.totalSegments])


  const loadSchedule = async () => {
    try {
      const segs = await (window as any).electronAPI.loadSchedule()
      if (segs?.length > 0) setSchedule(segs)
    } catch (err) {
      console.error('Schedule load failed:', err)
    }
  }

  const formatDuration = (seg: any) => {
    const seconds = seg.durationSeconds ?? seg.duration_seconds ?? 0
    const m = Math.floor(seconds / 60)
    return m > 0 ? `${m}m` : '?'
  }

  const isActive = orchState !== 'idle' && orchState !== 'error'

  return (
    <div className="now-playing-panel">
      {/* Status row */}
      <div className="now-playing-state">
      <span className={`orch-state orch-${orchState}`}>
        {orchState === 'idle'         && '○ Idle'}
        {orchState === 'initializing' && '◌ Connecting...'}
        {orchState === 'generating'   && orchStatus?.totalSegments > 0
          ? '◌ Generating first segment...'
          : '◌ Generating schedule...'}
        {orchState === 'live'         && '● Broadcasting'}
        {orchState === 'segment'      && '● On Air'}
        {orchState === 'chat_window'  && '💬 Chat window'}
        {orchState === 'stopping'     && '◌ Stopping'}
        {orchState === 'error'        && '✕ Error'}
      </span>
        {orchStatus?.totalSegments > 0 && (
          <span className="orch-progress">
            {orchStatus.segmentIndex}/{orchStatus.totalSegments}
          </span>
        )}
      </div>

      {/* Current topic */}
      {orchStatus?.currentTopic && (
        <div className="now-playing-topic">
          <span className="topic-label">
            {orchState === 'chat_window' ? 'CHAT WINDOW' : 'NOW PLAYING'}
          </span>
          <span className="topic-category">
            {orchStatus.currentSegment?.toUpperCase()}
          </span>
          <span className="topic-title">{orchStatus.currentTopic}</span>
          {orchStatus?.currentScript && (
            <span className="script-progress">{orchStatus.currentScript}</span>
          )}
        </div>
      )}

      {/* Progress bar */}
      {orchStatus?.totalSegments > 0 && (
        <div className="progress-bar-wrap">
          <div
            className="progress-bar-fill"
            style={{
              width: `${(orchStatus.segmentIndex / orchStatus.totalSegments) * 100}%`
            }}
          />
        </div>
      )}

      {/* Schedule list */}
      {schedule.length > 0 && (
        <div className="schedule-scroll">
          <p className="schedule-list-label">Today's Schedule</p>
          <div className="schedule-mini-list">
            {schedule.map((seg, i) => {
              const isCurrentSeg = orchStatus?.segmentIndex === i + 1
              const isPast       = (orchStatus?.segmentIndex ?? 0) > i + 1
              return (
                <div
                  key={seg.id ?? i}
                  className={`schedule-mini-row 
                    ${isCurrentSeg ? 'current' : ''} 
                    ${isPast       ? 'past'    : ''}`}
                >
                  <span className="mini-order">{seg.segmentOrder}</span>
                  <span className="mini-cat">{seg.category}</span>
                  <span className="mini-topic">{seg.topic}</span>
                  <span className="mini-dur">{formatDuration(seg)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {!isActive && (
        <p className="placeholder-text">
          Start WestWaveGem Radio to see the schedule
        </p>
      )}
    </div>
  )
}