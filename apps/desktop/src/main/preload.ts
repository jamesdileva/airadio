// Preload runs in a sandboxed context
// We will expose safe APIs to the renderer here in later sprints
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  version: process.versions.electron,
  generateSchedule: (categories: string[]) =>
    ipcRenderer.invoke('schedule:generate', categories),
  loadSchedule: () =>
    ipcRenderer.invoke('schedule:load'),
})