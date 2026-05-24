import { app, BrowserWindow, ipcMain } from 'electron'
import { initDatabase, saveSchedule, loadTodaySchedule } from './database'
import { generateSchedule } from './scheduler'
import path from 'path'

// ── IPC Handlers ──────────────────────────────────────────────────
ipcMain.handle('schedule:generate', (_event, categories) => {
  try {
    const schedule = generateSchedule(categories)
    saveSchedule(schedule)
    return schedule
  } catch (err) {
    console.error('Schedule generation error:', err)
    throw err
  }
})

ipcMain.handle('schedule:load', () => {
  try {
    return loadTodaySchedule()
  } catch (err) {
    console.error('Schedule load error:', err)
    throw err
  }
})

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    title: 'AI Radio Network',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // In dev, load from Vite dev server
  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  try {
    initDatabase()
    console.log('Database ready')
  } catch (err) {
    console.error('Database init failed:', err)
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})