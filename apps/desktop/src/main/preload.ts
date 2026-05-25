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
})