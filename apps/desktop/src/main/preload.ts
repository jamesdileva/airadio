// Preload runs in a sandboxed context
// We will expose safe APIs to the renderer here in later sprints
import { contextBridge, ipcRenderer } from 'electron'


contextBridge.exposeInMainWorld('electronAPI', {
  version:            process.versions.electron,
  generateSchedule:   (categories: string[]) =>
    ipcRenderer.invoke('schedule:generate', categories),
  loadSchedule:       () =>
    ipcRenderer.invoke('schedule:load'),
  fetchData:          (categories: string[]) =>
    ipcRenderer.invoke('data:fetchForSchedule', categories),
  fetchFinance:       () =>
    ipcRenderer.invoke('data:fetchFinance'),
  loadArticles:       (category: string) =>
    ipcRenderer.invoke('data:loadArticles', category),
  loadFinance:        () =>
    ipcRenderer.invoke('data:loadFinance'),
  generateScript:     (payload: {
    scheduleId: number
    category:   string
    topic:      string
  }) => ipcRenderer.invoke('script:generate', payload),
  loadSubSegments:    (scheduleId: number) =>
    ipcRenderer.invoke('script:loadSubSegments', scheduleId),
  generateAudio:      (payload: {
    subSegmentId: number
    script:       string
    voice?:       string
  }) => ipcRenderer.invoke('tts:generate', payload),
  generateAudioBatch: (payload: {
    subSegments: { id: number; script: string }[]
    voice?:      string
  }) => ipcRenderer.invoke('tts:generateBatch', payload),
  getAudioPath:       (subSegmentId: number) =>
    ipcRenderer.invoke('tts:getPath', subSegmentId),
  getAudioData:       (filePath: string) =>
    ipcRenderer.invoke('tts:getAudioData', filePath),
  mixAudio:           (payload: {
    subSegmentId: number
    audioPath:    string
    musicPath?:   string
  }) => ipcRenderer.invoke('mixer:mix', payload),
  mixAllAudio:        (payload: {
    subSegments: { id: number; audioPath: string }[]
  }) => ipcRenderer.invoke('mixer:mixAll', payload),
  getTracks:          () =>
    ipcRenderer.invoke('mixer:getTracks'),
  getMixedAudioData:  (filePath: string) =>
    ipcRenderer.invoke('mixer:getAudioData', filePath),
  
  obsConnect:       (config: { host: string; port: number; password: string }) =>
  ipcRenderer.invoke('obs:connect', config),
obsDisconnect:    () =>
  ipcRenderer.invoke('obs:disconnect'),
obsSwitchScene:   (sceneName: string) =>
  ipcRenderer.invoke('obs:switchScene', sceneName),
obsGetScenes:     () =>
  ipcRenderer.invoke('obs:getScenes'),
obsStartStream:   () =>
  ipcRenderer.invoke('obs:startStream'),
obsStopStream:    () =>
  ipcRenderer.invoke('obs:stopStream'),
obsGetStatus:     () =>
  ipcRenderer.invoke('obs:getStatus'),
obsGetStreamStatus: () =>
  ipcRenderer.invoke('obs:getStreamStatus'),

streamStart:      () =>
    ipcRenderer.invoke('stream:start'),
  streamStop:       () =>
    ipcRenderer.invoke('stream:stop'),
  streamGetStatus:  () =>
    ipcRenderer.invoke('stream:getStatus'),
  streamGetDuration: () =>
    ipcRenderer.invoke('stream:getDuration'),
  onStreamStatus: (cb: (status: any) => void) => {
    ipcRenderer.removeAllListeners('stream:statusUpdate')
    ipcRenderer.on('stream:statusUpdate', (_event, status) => cb(status))
  },
  obsGetConfig: () => ipcRenderer.invoke('obs:getConfig'),

  chatConnect:      () =>
    ipcRenderer.invoke('chat:connect'),
  chatDisconnect:   () =>
    ipcRenderer.invoke('chat:disconnect'),
  chatGetQueue:     () =>
    ipcRenderer.invoke('chat:getQueue'),
  chatGetStatus:    () =>
    ipcRenderer.invoke('chat:getStatus'),
  chatProcessWindow: (maxResponses?: number) =>
    ipcRenderer.invoke('chat:processWindow', maxResponses),
  chatGetLog:       () =>
    ipcRenderer.invoke('chat:getLog'),

  analyticsGetSummary:  () =>
    ipcRenderer.invoke('analytics:getSummary'),
  analyticsGetSessions: (limit?: number) =>
    ipcRenderer.invoke('analytics:getSessions', limit),
  analyticsCleanup:     (daysOld?: number) =>
    ipcRenderer.invoke('analytics:cleanup', daysOld),

})