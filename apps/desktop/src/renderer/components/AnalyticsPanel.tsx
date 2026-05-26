import React, { useState, useEffect } from 'react'

interface StorageSummary {
  audioFileCount: number
  audioSizeMB:    number
  mixedFileCount: number
  mixedSizeMB:    number
  totalSizeMB:    number
  oldestFileDate: string | null
}

interface SessionSummary {
  id:              number
  startedAt:       string
  endedAt:         string | null
  platform:        string
  durationMinutes: number
  segmentsAired:   number
  chatMessages:    number
}

interface AnalyticsSummary {
  totalSessions:      number
  totalStreamMinutes: number
  totalSegments:      number
  totalChatMessages:  number
  totalScripts:       number
  recentSessions:     SessionSummary[]
  storage:            StorageSummary
}

export const AnalyticsPanel: React.FC = () => {
  const [summary,   setSummary]   = useState<AnalyticsSummary | null>(null)
  const [loading,   setLoading]   = useState(false)
  const [cleaning,  setCleaning]  = useState(false)
  const [cleanMsg,  setCleanMsg]  = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const data = await (window as any).electronAPI.analyticsGetSummary()
      setSummary(data)
    } catch (err) {
      console.error('Analytics load failed:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleCleanup = async () => {
    setCleaning(true)
    setCleanMsg('')
    try {
      const result = await (window as any).electronAPI.analyticsCleanup(30)
      setCleanMsg(
        result.filesDeleted > 0
          ? `Cleaned ${result.filesDeleted} files, freed ${result.mbFreed}MB`
          : 'No files old enough to clean'
      )
      await load()
    } catch (err) {
      setCleanMsg('Cleanup failed')
    } finally {
      setCleaning(false)
    }
  }

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    })

  const formatMinutes = (mins: number) => {
    if (mins < 60) return `${mins}m`
    return `${Math.floor(mins / 60)}h ${mins % 60}m`
  }

  if (loading) return <p className="placeholder-text">Loading analytics...</p>

  if (!summary) return (
    <div className="analytics-panel">
      <button className="btn btn-analytics-load" onClick={load}>
        Load Analytics
      </button>
    </div>
  )
  

  return (
    <div className="analytics-panel">

      {/* Overall Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-value">{summary.totalSessions}</span>
          <span className="stat-label">Sessions</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{formatMinutes(summary.totalStreamMinutes)}</span>
          <span className="stat-label">Streamed</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{summary.totalScripts}</span>
          <span className="stat-label">Scripts</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{summary.totalChatMessages}</span>
          <span className="stat-label">Chat Msgs</span>
        </div>
      </div>

      {/* Storage */}
      <div className="storage-section">
        <div className="storage-header">
          <span className="storage-title">Storage</span>
          <span className="storage-size">{summary.storage.totalSizeMB} MB total</span>
        </div>
        <div className="storage-bars">
          <div className="storage-row">
            <span className="storage-label">Voice files</span>
            <span className="storage-count">{summary.storage.audioFileCount} files</span>
            <span className="storage-mb">{summary.storage.audioSizeMB} MB</span>
          </div>
          <div className="storage-row">
            <span className="storage-label">Mixed files</span>
            <span className="storage-count">{summary.storage.mixedFileCount} files</span>
            <span className="storage-mb">{summary.storage.mixedSizeMB} MB</span>
          </div>
        </div>
        <div className="cleanup-row">
          <button
            className="btn btn-cleanup"
            onClick={handleCleanup}
            disabled={cleaning}
          >
            {cleaning ? 'Cleaning...' : '🗑 Clean Files 30d+'}
          </button>
          {cleanMsg && <span className="clean-msg">{cleanMsg}</span>}
        </div>
      </div>

      {/* Recent Sessions */}
      {summary.recentSessions.length > 0 && (
        <div className="sessions-section">
          <p className="section-label">Recent Sessions</p>
          <div className="session-list">
            {summary.recentSessions.map(s => (
              <div key={s.id} className="session-row">
                <span className="session-date">{formatDate(s.startedAt)}</span>
                <span className="session-duration">{formatMinutes(s.durationMinutes)}</span>
                <span className="session-segments">{s.segmentsAired} segs</span>
                <span className="session-chat">{s.chatMessages} msgs</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {summary.recentSessions.length === 0 && (
        <p className="placeholder-text">No stream sessions yet. Go live to start tracking!</p>
      )}

      <button className="btn btn-analytics-refresh" onClick={load}>
        ↻ Refresh
      </button>
    </div>
  )
}