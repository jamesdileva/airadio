import React, { useState } from 'react'
import { SchedulePanel } from './components/SchedulePanel'
import { DataPanel } from './components/DataPanel'
import { Category } from '../shared/types'

const App: React.FC = () => {
  const [status, setStatus] = useState<'idle' | 'running' | 'stopped'>('idle')
  const [selectedCategories, setSelectedCategories] = useState<Category[]>(['tech', 'news'])

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>AI Radio Network</h1>
        <span className={`status-badge status-${status}`}>
          {status.toUpperCase()}
        </span>
      </header>

      <main className="app-main">
        <section className="dashboard-card">
          <h2>Stream Control</h2>
          <div className="button-group">
            <button
              className="btn btn-start"
              onClick={() => setStatus('running')}
              disabled={status === 'running'}
            >
              Start Stream
            </button>
            <button
              className="btn btn-stop"
              onClick={() => setStatus('stopped')}
              disabled={status !== 'running'}
            >
              Stop Stream
            </button>
          </div>
        </section>

        <section className="dashboard-card">
          <h2>Today's Schedule</h2>
          <SchedulePanel onCategoriesChange={setSelectedCategories} />
        </section>

        <section className="dashboard-card">
          <h2>Live Data</h2>
          <DataPanel selectedCategories={selectedCategories} />
        </section>

        <section className="dashboard-card">
          <h2>Current Segment</h2>
          <p className="placeholder-text">
            Now playing info will appear here after Sprint 3
          </p>
        </section>
      </main>
    </div>
  )
}

export default App