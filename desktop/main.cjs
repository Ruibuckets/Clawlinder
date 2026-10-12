'use strict';

const { app, BrowserWindow, globalShortcut, ipcMain, Menu, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const entryFile = path.join(__dirname, '..', 'index.html');
const entryUrl = pathToFileURL(entryFile).href;
const shortcut = process.platform === 'darwin' ? 'Command+Shift+Space' : 'Control+Shift+Space';
let calendarWindow = null;

// Keep existing plans when the app's display/package name changes.
const appData = app.getPath('appData');
const previousProfiles = ['sidebook-calendar', 'Sidebook Calendar'].map((name) => path.join(appData, name));
const profilePath = previousProfiles.find((directory) => fs.existsSync(directory)) || path.join(appData, 'Clawlinder');
fs.mkdirSync(profilePath, { recursive: true });
app.setPath('userData', profilePath);
app.setPath('sessionData', profilePath);

function showCalendar() {
  if (!calendarWindow || calendarWindow.isDestroyed()) return;
  if (calendarWindow.isMinimized()) calendarWindow.restore();
  calendarWindow.show();
  calendarWindow.focus();
}

function isCalendarUrl(value) {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.href === entryUrl;
  } catch {
    return false;
  }
}

function isTrustedSender(event) {
  return Boolean(calendarWindow && !calendarWindow.isDestroyed() &&
    event.sender === calendarWindow.webContents &&
    event.senderFrame === calendarWindow.webContents.mainFrame &&
    isCalendarUrl(event.senderFrame.url));
}

function dockCalendar(side) {
  const bounds = calendarWindow.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  const y = Math.max(area.y, Math.min(bounds.y, area.y + area.height - height));
  calendarWindow.setBounds({
    x: side === 'left' ? area.x : area.x + area.width - width,
    y, width, height,
  });
}

function createCalendarWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(410, area.width);
  calendarWindow = new BrowserWindow({
    title: 'Clawlinder',
    width,
    height: Math.min(area.height, 950),
    x: area.x + area.width - width,
    y: area.y,
    minWidth: Math.min(340, area.width),
    minHeight: Math.min(500, area.height),
    show: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    autoHideMenuBar: true,
    backgroundColor: '#f7f8f4',
    icon: path.join(__dirname, '..', 'icon-192.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Only the bundled calendar can run in this privileged desktop window.
  calendarWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  calendarWindow.webContents.on('will-navigate', (event, url) => {
    if (!isCalendarUrl(url)) event.preventDefault();
  });
  calendarWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  calendarWindow.on('page-title-updated', (event) => event.preventDefault());
  calendarWindow.once('ready-to-show', showCalendar);
  calendarWindow.on('closed', () => { calendarWindow = null; });
  calendarWindow.loadFile(entryFile, { query: { view: 'sidebar' } }).catch((error) => {
    console.error('Could not open the bundled calendar:', error.message);
    app.quit();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showCalendar);
  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.clawlinder.calendar');
    Menu.setApplicationMenu(null);

    ipcMain.handle('calendar:set-dock-side', (event, side) => {
      if (!isTrustedSender(event) || !['left', 'right'].includes(side)) return false;
      dockCalendar(side);
      return true;
    });
    ipcMain.handle('calendar:set-pinned', (event, pinned) => {
      if (!isTrustedSender(event) || typeof pinned !== 'boolean') return false;
      calendarWindow.setAlwaysOnTop(pinned);
      return true;
    });

    createCalendarWindow();
    const registered = globalShortcut.register(shortcut, () => {
      if (!calendarWindow || calendarWindow.isDestroyed()) return;
      if (calendarWindow.isVisible() && !calendarWindow.isMinimized()) calendarWindow.hide();
      else showCalendar();
    });
    if (!registered) console.warn('The calendar shortcut is in use by another application.');
  }).catch((error) => {
    console.error('Could not start the desktop calendar:', error.message);
    app.quit();
  });

  // Closing the window fully exits; hiding with the shortcut keeps it running.
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
