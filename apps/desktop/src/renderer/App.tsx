import React, { useState, useEffect } from 'react'
import { SchedulePanel }  from './components/SchedulePanel'
import { DataPanel }      from './components/DataPanel'
import { ScriptPanel }    from './components/ScriptPanel'
import { OBSPanel }       from './components/OBSPanel'
import { Category, ScheduleSegment } from '../shared/types'
import { ChatPanel } from './components/ChatPanel'

type StreamState = 'idle' | 'starting' | 'live' | 'stopping' | 'error'

const App: React.FC = () => {
  const [streamState,  setStreamState]  = useState<StreamState>('idle')
  const [duration,     setDuration]     = useState<string>('00:00:00')
  const [streamError,  setStreamError]  = useState<string>('')
  const [selectedCategories, setSelectedCategories] = useState<Category[]>(['tech', 'news'])
  const [segments,     setSegments]     = useState<ScheduleSegment[]>([])

  // Listen for stream status updates pushed from main process
  useEffect(() => {
    (window as any).electronAPI.onStreamStatus((status: any) => {
      setStreamState(status.state)
      if (status.error) setStreamError(status.error)
    })
  }, [])

  // Update duration every second while live
  useEffect(() => {
    if (streamState !== 'live') return
    const interval = setInterval(async () => {
      const d = await (window as any).electronAPI.streamGetDuration()
      if (d) setDuration(d)
    }, 1000)
    return () => clearInterval(interval)
  }, [streamState])

  const handleStart = async () => {
    setStreamError('')
    setStreamState('starting')
    const status = await (window as any).electronAPI.streamStart()
    setStreamState(status.state)
    if (status.error) setStreamError(status.error)
  }

  const handleStop = async () => {
    setStreamState('stopping')
    const status = await (window as any).electronAPI.streamStop()
    setStreamState(status.state)
    setDuration('00:00:00')
  }

  const stateColor: Record<StreamState, string> = {
    idle:     '#888',
    starting: '#f97316',
    live:     '#44cc44',
    stopping: '#f97316',
    error:    '#ff4444',
  }

  const stateLabel: Record<StreamState, string> = {
    idle:     'OFFLINE',
    starting: 'STARTING...',
    live:     'LIVE',
    stopping: 'STOPPING...',
    error:    'ERROR',
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>WestWaveGem Radio</h1>
        <div className="header-status">
          {streamState === 'live' && (
            <span className="duration-badge">{duration}</span>
          )}
          <span
            className="status-badge"
            style={{ color: stateColor[streamState] }}
          >
            ● {stateLabel[streamState]}
          </span>
        </div>
      </header>

      <main className="app-main">
        <section className="dashboard-card">
          <h2>Stream Control</h2>
          <div className="stream-control">
            <div className="stream-buttons">
              <button
                className="btn btn-start"
                onClick={handleStart}
                disabled={streamState !== 'idle' && streamState !== 'error'}
              >
                ▶ Go Live
              </button>
              <button
                className="btn btn-stop"
                onClick={handleStop}
                disabled={streamState !== 'live'}
              >
                ■ End Stream
              </button>
            </div>
            {streamError && (
              <p className="stream-error">{streamError}</p>
            )}
            <div className="obs-panel-wrapper">
              <OBSPanel />
            </div>
          </div>
        </section>

        <section className="dashboard-card">
          <h2>Today's Schedule</h2>
          <SchedulePanel
            onCategoriesChange={setSelectedCategories}
            onScheduleGenerated={setSegments}
          />
        </section>

        <section className="dashboard-card">
          <h2>Live Data</h2>
          <DataPanel selectedCategories={selectedCategories} />
        </section>

        <section className="dashboard-card">
          <h2>Current Segment</h2>
          <ScriptPanel segments={segments} />
        </section>

        <section className="dashboard-card">
          <h2>Chat</h2>
          <ChatPanel />
        </section>

        
      </main>
    </div>
  )
}

export default App