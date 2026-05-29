import React, { useState, useEffect, useRef } from 'react'

interface ChatMsg {
  id:         string
  username:   string
  message:    string
  receivedAt: string
  responded:  boolean
  response?:  string
}

export const ChatPanel: React.FC = () => {
  const [connected,  setConnected]  = useState(false)
  const [queue,      setQueue]      = useState<ChatMsg[]>([])
  const [responses,  setResponses]  = useState<ChatMsg[]>([])
  const queueRef = useRef<HTMLDivElement>(null)

  // Poll queue every 3 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const status = await (window as any).electronAPI.chatGetStatus()
        setConnected(status.connected)

        if (status.connected) {
          const q = await (window as any).electronAPI.chatGetQueue()
          setQueue(q.slice(-20))
          // Separate responded messages for display
          setResponses(q.filter((m: ChatMsg) => m.responded && m.response).slice(-5))
        }
      } catch (err) {
        console.error('Chat poll failed:', err)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  // Auto-scroll queue
  useEffect(() => {
    if (queueRef.current) {
      queueRef.current.scrollTop = queueRef.current.scrollHeight
    }
  }, [queue])

  return (
    <div className="chat-panel">
      {/* Status bar */}
      <div className="chat-status-bar">
        <span className={connected ? 'chat-connected' : 'chat-disconnected'}>
          {connected ? '● Chat Live' : '○ Chat Offline'}
        </span>
        {connected && (
          <span className="chat-count">
            {queue.filter(m => !m.responded).length} unread
          </span>
        )}
      </div>

      {!connected && (
        <p className="placeholder-text">
          Chat connects automatically when stream starts
        </p>
      )}

      {connected && (
        <>
          {/* Live chat queue */}
          <div className="chat-queue" ref={queueRef}>
            {queue.length === 0 ? (
              <p className="placeholder-text">Waiting for chat messages...</p>
            ) : (
              queue.map(msg => (
                <div
                  key={msg.id}
                  className={`chat-msg ${msg.responded ? 'responded' : ''}`}
                >
                  <span className="chat-username">{msg.username}</span>
                  <span className="chat-text">{msg.message}</span>
                  {msg.responded && <span className="chat-tick">✓</span>}
                </div>
              ))
            )}
          </div>

          {/* Al's responses */}
          {responses.length > 0 && (
            <div className="chat-responses">
              <p className="responses-label">Al Responded</p>
              {responses.map((msg, i) => (
                <div key={i} className="response-card">
                  <div className="response-question">
                    <span className="response-user">{msg.username}:</span>
                    {msg.message}
                  </div>
                  <div className="response-text">{msg.response}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}