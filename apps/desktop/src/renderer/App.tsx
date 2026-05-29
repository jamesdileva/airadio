import React, { useState, useEffect } from 'react'
import { SchedulePanel }  from './components/SchedulePanel'
import { DataPanel }      from './components/DataPanel'
import { NowPlayingPanel }    from './components/NowPlayingPanel'
import { OBSPanel }       from './components/OBSPanel'
import { Category, ScheduleSegment } from '../shared/types'
import { ChatPanel } from './components/ChatPanel'
import { AnalyticsPanel } from './components/AnalyticsPanel'

type StreamState = 'idle' | 'starting' | 'live' | 'stopping' | 'error'

const App: React.FC = () => {
  const [streamState,  setStreamState]  = useState<StreamState>('idle')
  const [duration,     setDuration]     = useState<string>('00:00:00')
  const [streamError,  setStreamError]  = useState<string>('')
  const [selectedCategories, setSelectedCategories] = useState<Category[]>(['tech', 'news'])
  const [segments,     setSegments]     = useState<ScheduleSegment[]>([])
  const [orchState,   setOrchState]   = useState<string>('idle')
  const [orchStatus,  setOrchStatus]  = useState<any>(null)
  
  const [currentScene, setCurrentScene] = useState<string>('')
  const [orchCategories, setOrchCategories] = useState<Category[]>(
  ['finance', 'tech', 'gaming', 'news']
)

  const orchConfig = {
    categories:         orchCategories,  // ← dynamic now
    chatWindowInterval: 3,
    maxChatResponses:   2,
    voiceId:            'af_heart',
    targetHours:        8,
  }

  // Effect 1 — orchestrator status listener
  useEffect(() => {
    (window as any).electronAPI.onOrchestratorStatus((status: any) => {
      setOrchState(status.state)
      setOrchStatus(status)
    })
  }, [])

 // Scene changes
  useEffect(() => {
    (window as any).electronAPI.onSceneChanged((scene: string) => {
      setCurrentScene(scene)
    })
  }, [])

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




  const CATEGORY_OPTIONS: { id: Category; label: string; emoji: string }[] = [
  { id: 'finance', label: 'Finance', emoji: '📈' },
  { id: 'tech',    label: 'Tech',    emoji: '💻' },
  { id: 'gaming',  label: 'Gaming',  emoji: '🎮' },
  { id: 'news',    label: 'News',    emoji: '📰' },
  { id: 'niche',   label: 'Niche',   emoji: '🔭' },
  ]

  const toggleOrchCategory = (cat: Category) => {
    setOrchCategories(prev =>
      prev.includes(cat)
        ? prev.filter(c => c !== cat)
        : [...prev, cat]
    )
  }

  const stateColor: Record<string, string> = {
    idle:         '#888',
    initializing: '#f97316',
    generating:   '#f97316',
    live:         '#44cc44',
    segment:      '#22d3ee',
    chat_window:  '#a78bfa',
    stopping:     '#f97316',
    error:        '#ff4444',
  }

  const stateLabel: Record<string, string> = {
    idle:         'OFFLINE',
    initializing: 'INITIALIZING...',
    generating:   'GENERATING...',
    live:         'LIVE',
    segment:      'ON AIR',
    chat_window:  'CHAT',
    stopping:     'STOPPING...',
    error:        'ERROR',
  }

  const handleAutoStart = async () => {
    setStreamError('')
    // Start stream first
    const streamStatus = await (window as any).electronAPI.streamStart()
    if (!streamStatus.streaming && streamStatus.state !== 'live' && streamStatus.state !== 'starting') {
      setStreamError(streamStatus.error || 'Stream failed to start')
      return
    }
    // Then start orchestrator
    await (window as any).electronAPI.orchestratorStart(orchConfig)
  }

  const handleAutoStop = async () => {
    await (window as any).electronAPI.orchestratorStop()
    await (window as any).electronAPI.streamStop()
    // Force UI reset after 3 seconds if orchestrator doesn't report idle
    setTimeout(() => {
      setOrchState('idle')
      setOrchStatus(null)
      setStreamState('idle')
      setDuration('00:00:00')
    }, 3000)
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>WestWaveGem Radio</h1>
        <div className="header-status">
          {currentScene && orchState !== 'idle' && (
            <span className="scene-badge">📺 {currentScene}</span>
          )}
          {streamState === 'live' && (
            <span className="duration-badge">{duration}</span>
          )}
          <span
            className="status-badge"
            style={{ color: stateColor[orchState as any] ?? '#888' }}
          >
            ● {stateLabel[orchState as any] ?? orchState.toUpperCase()}
          </span>
        </div>
      </header>

      <div className="orch-category-selector">
        {CATEGORY_OPTIONS.map(cat => (
          <button
            key={cat.id}
            className={`cat-btn ${orchCategories.includes(cat.id) ? 'active' : ''}`}
            onClick={() => toggleOrchCategory(cat.id)}
            disabled={orchState !== 'idle'}
          >
            {cat.emoji} {cat.label}
          </button>
        ))}
      </div>

    <main className="app-main">
      <section className="dashboard-card">
        <h2>Stream Control</h2>
        <div className="stream-control">
          <div className="auto-controls">
            <div className="auto-status">
              <span className={`orch-state orch-${orchState}`}>
                {orchState === 'idle'         && '○ Idle'}
                {orchState === 'initializing' && '◌ Initializing...'}
                {orchState === 'generating'   && '◌ Generating schedule...'}
                {orchState === 'live'         && '● Broadcasting'}
                {orchState === 'segment'      && '● On Air'}
                {orchState === 'chat_window'  && '💬 Chat window'}
                {orchState === 'stopping'     && '◌ Stopping...'}
                {orchState === 'error'        && `✕ ${orchStatus?.error ?? 'Error'}`}
              </span>
              {orchStatus?.totalSegments > 0 && (
                <span className="orch-progress">
                  {orchStatus.segmentIndex}/{orchStatus.totalSegments} segments
                </span>
              )}
              {streamState === 'live' && (
                <span className="duration-badge">{duration}</span>
              )}
            </div>

            <div className="auto-buttons">
              <button
                className="btn btn-auto-start"
                onClick={handleAutoStart}
                disabled={orchState !== 'idle' && orchState !== 'error'}
              >
                ⚡ Start WestWaveGem Radio
              </button>
              <button
                className="btn btn-auto-stop"
                onClick={handleAutoStop}
                disabled={orchState === 'idle'}
              >
                ■ Stop
              </button>
            </div>
          </div>

          {streamError && <p className="stream-error">{streamError}</p>}
          <div className="obs-panel-wrapper">
            <OBSPanel />
          </div>
        </div>
      </section>



      <section className="dashboard-card">
        <h2>Analytics</h2>
        <AnalyticsPanel />
      </section>

      <section className="dashboard-card">
        <h2>Now Playing</h2>
        <NowPlayingPanel
          orchState={orchState}
          orchStatus={orchStatus}
        />
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