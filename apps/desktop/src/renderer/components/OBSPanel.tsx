import React, { useState, useEffect } from 'react'

interface OBSStatus {
  connected:    boolean
  currentScene: string | null
  streaming:    boolean
  error?:       string
}



export const OBSPanel: React.FC = () => {
  const [status,    setStatus]    = useState<OBSStatus>({
    connected: false, currentScene: null, streaming: false
  })


  useEffect(() => {
    (window as any).electronAPI.obsGetConfig().then((cfg: any) => {
      if (cfg.password) setConfig(cfg)
    })
  }, [])

  useEffect(() => {
  (window as any).electronAPI.onSceneChanged((scene: string) => {
    setStatus(prev => ({ ...prev, currentScene: scene }))
  })
}, [])


  const [scenes,    setScenes]    = useState<string[]>([])
  const [config,    setConfig]    = useState({
    host:     'localhost',
    port:     59650,
    password: '',
  })
  const [connecting, setConnecting] = useState(false)
  const [error,      setError]      = useState<string>('')

  const handleConnect = async () => {
    setConnecting(true)
    setError('')
    try {
      const result = await (window as any).electronAPI.obsConnect(config)
      setStatus(result)
      if (result.connected) {
        const sceneList = await (window as any).electronAPI.obsGetScenes()
        setScenes(sceneList)
      } else {
        setError(result.error || 'Connection failed')
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    await (window as any).electronAPI.obsDisconnect()
    setStatus({ connected: false, currentScene: null, streaming: false })
    setScenes([])
  }

  const handleSceneSwitch = async (sceneName: string) => {
    const result = await (window as any).electronAPI.obsSwitchScene(sceneName)
    if (result.success) {
      setStatus(prev => ({ ...prev, currentScene: sceneName }))
    }
  }


  return (
    <div className="obs-panel">
      {!status.connected ? (
        <div className="obs-connect-form">
          <div className="obs-field">
            <label>Host</label>
            <input
              type="text"
              value={config.host}
              onChange={e => setConfig(p => ({ ...p, host: e.target.value }))}
              className="obs-input"
            />
          </div>
          <div className="obs-field">
            <label>Port</label>
            <input
              type="number"
              value={config.port}
              onChange={e => setConfig(p => ({ ...p, port: parseInt(e.target.value) }))}
              className="obs-input"
            />
          </div>
          <div className="obs-field">
            <label>API Token</label>
            <input
                type="password"
                value={config.password}
                onChange={e => setConfig(p => ({ ...p, password: e.target.value }))}
                className="obs-input"
                placeholder="Paste API token from Streamlabs"
            />
            </div>
          {error && <p className="obs-error">{error}</p>}
          <button
            className="btn btn-obs-connect"
            onClick={handleConnect}
            disabled={connecting}
          >
            {connecting ? 'Connecting...' : '🔌 Connect to Streamlabs'}
          </button>
        </div>
      ) : (
        <div className="obs-controls">
          <div className="obs-status-row">
            <span className="obs-connected-badge">● Connected</span>
            <span className="obs-scene-label">
              Scene: {status.currentScene ?? 'Unknown'}
            </span>
            <button
              className="btn btn-obs-disconnect"
              onClick={handleDisconnect}
            >
              Disconnect
            </button>
          </div>

          <div className="scene-buttons">
            <p className="picker-label">Switch Scene:</p>
            {scenes.map(scene => (
              <button
                key={scene}
                className={`scene-btn ${status.currentScene === scene ? 'active' : ''}`}
                onClick={() => handleSceneSwitch(scene)}
              >
                {scene}
              </button>
            ))}
          </div>

          {scenes.length === 0 && (
            <p className="placeholder-text">
              No scenes found. Create scenes in Streamlabs first.
            </p>
          )}
        </div>
      )}
    </div>
  )
}