import React, { useState, useEffect, useRef } from 'react'

interface ChatMsg {
  id:         string
  username:   string
  message:    string
  receivedAt: string
  responded:  boolean
}

interface ChatResponse {
  username:  string
  question:  string
  response:  string
}

export const ChatPanel: React.FC = () => {
  const [connected,   setConnected]   = useState(false)
  const [connecting,  setConnecting]  = useState(false)
  const [queue,       setQueue]       = useState<ChatMsg[]>([])
  const [responses,   setResponses]   = useState<ChatResponse[]>([])
  const [processing,  setProcessing]  = useState(false)
  const [error,       setError]       = useState('')
  const queueRef = useRef<HTMLDivElement>(null)

  // Poll queue every 3 seconds when connected
  useEffect(() => {
    if (!connected) return
    const interval = setInterval(async () => {
      const q = await (window as any).electronAPI.chatGetQueue()
      setQueue(q.slice(-20))  // show last 20
    }, 3000)
    return () => clearInterval(interval)
  }, [connected])

  // Auto-scroll queue
  useEffect(() => {
    if (queueRef.current) {
      queueRef.current.scrollTop = queueRef.current.scrollHeight
    }
  }, [queue])

  const handleConnect = async () => {
    setConnecting(true)
    setError('')
    const result = await (window as any).electronAPI.chatConnect()
    setConnecting(false)
    if (result.success) {
      setConnected(true)
    } else {
      setError(result.error || 'Connection failed')
    }
  }

  const handleDisconnect = async () => {
    await (window as any).electronAPI.chatDisconnect()
    setConnected(false)
    setQueue([])
  }

  const handleProcessWindow = async () => {
    setProcessing(true)
    try {
      const results = await (window as any).electronAPI.chatProcessWindow(3)
      setResponses(results)
      // Refresh queue to show responded status
      const q = await (window as any).electronAPI.chatGetQueue()
      setQueue(q.slice(-20))
    } catch (err) {
      console.error('Process window failed:', err)
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="chat-panel">
      <div className="chat-controls">
        {!connected ? (
          <button
            className="btn btn-chat-connect"
            onClick={handleConnect}
            disabled={connecting}
          >
            {connecting ? 'Connecting...' : '💬 Connect to Twitch Chat'}
          </button>
        ) : (
          <div className="chat-header">
            <span className="chat-connected">● Chat Connected</span>
            <span className="chat-count">{queue.filter(m => !m.responded).length} unread</span>
            <button className="btn btn-chat-disconnect" onClick={handleDisconnect}>
              Disconnect
            </button>
          </div>
        )}
        {error && <p className="chat-error">{error}</p>}
      </div>

      {connected && (
        <>
          <div className="chat-queue" ref={queueRef}>
            {queue.length === 0 ? (
              <p className="placeholder-text">Waiting for chat messages...</p>
            ) : (
              queue.map(msg => (
                <div key={msg.id} className={`chat-msg ${msg.responded ? 'responded' : ''}`}>
                  <span className="chat-username">{msg.username}</span>
                  <span className="chat-text">{msg.message}</span>
                  {msg.responded && <span className="chat-tick">✓</span>}
                </div>
              ))
            )}
          </div>

          <button
            className="btn btn-process-chat"
            onClick={handleProcessWindow}
            disabled={processing || queue.filter(m => !m.responded).length === 0}
          >
            {processing ? 'Al is responding...' : '🎙 Al Responds To Chat'}
          </button>

          {responses.length > 0 && (
            <div className="chat-responses">
              <p className="responses-label">Latest Responses</p>
              {responses.map((r, i) => (
                <div key={i} className="response-card">
                  <div className="response-question">
                    <span className="response-user">{r.username}:</span> {r.question}
                  </div>
                  <div className="response-text">{r.response}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}