// Preload runs in a sandboxed context
// We will expose safe APIs to the renderer here in later sprints
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  version: process.versions.electron
})