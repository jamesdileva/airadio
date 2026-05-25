import React, { useState } from 'react'
import { Category, ScheduleSegment, DailySchedule } from '../../shared/types'

const CATEGORIES: { id: Category; label: string; emoji: string }[] = [
  { id: 'finance', label: 'Finance', emoji: '📈' },
  { id: 'tech',    label: 'Tech',    emoji: '💻' },
  { id: 'gaming',  label: 'Gaming',  emoji: '🎮' },
  { id: 'news',    label: 'News',    emoji: '📰' },
  { id: 'niche',   label: 'Niche',   emoji: '🔭' },
]

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

interface SchedulePanelProps {
  onCategoriesChange?:  (categories: Category[]) => void
  onScheduleGenerated?: (segments: ScheduleSegment[]) => void
}

export const SchedulePanel: React.FC<SchedulePanelProps> = ({
  onCategoriesChange,
  onScheduleGenerated,
}) => {
  const [selected, setSelected] = useState<Set<Category>>(new Set(['tech', 'news']))
  const [schedule, setSchedule] = useState<ScheduleSegment[]>([])
  const [loading, setLoading]   = useState(false)

  React.useEffect(() => {
    onCategoriesChange?.(Array.from(selected))
  }, [])

  const toggleCategory = (cat: Category) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(cat) ? next.delete(cat) : next.add(cat)
      onCategoriesChange?.(Array.from(next))
      return next
    })
  }

  const handleGenerate = async () => {
    if (selected.size === 0) return
    setLoading(true)
    try {
      const result: DailySchedule = await (window as any).electronAPI.generateSchedule(
        Array.from(selected)
      )
      setSchedule(result.segments)
      onScheduleGenerated?.(result.segments)
    } catch (err) {
      console.error('Schedule generation failed:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="schedule-panel">
      <div className="category-selector">
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            className={`cat-btn ${selected.has(cat.id) ? 'active' : ''}`}
            onClick={() => toggleCategory(cat.id)}
          >
            {cat.emoji} {cat.label}
          </button>
        ))}
      </div>

      <button
        className="btn btn-generate"
        onClick={handleGenerate}
        disabled={loading || selected.size === 0}
      >
        {loading ? 'Generating...' : '⚡ Generate Schedule'}
      </button>

      {schedule.length > 0 && (
        <div className="segment-list">
          {schedule.slice(0, 6).map((seg, i) => (
            <div key={i} className="segment-row">
              <span className="seg-order">#{seg.segmentOrder}</span>
              <span className="seg-category">{seg.category}</span>
              <span className="seg-topic">{seg.topic}</span>
              <span className="seg-duration">{formatDuration(seg.durationSeconds)}</span>
            </div>
          ))}
          {schedule.length > 6 && (
            <p className="more-label">+{schedule.length - 6} more segments</p>
          )}
        </div>
      )}
    </div>
  )
}