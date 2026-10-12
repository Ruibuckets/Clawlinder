'use strict';

const { app, BrowserWindow, globalShortcut, ipcMain, Menu, screen, Tray, Notification, powerMonitor } = require('electron');
const { ReminderService } = require('./reminders.cjs');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const entryFile = path.join(__dirname, '..', 'index.html');
const entryUrl = pathToFileURL(entryFile).href;
const shortcut = process.platform === 'darwin' ? 'Command+Shift+Space' : 'Control+Shift+Space';
let calendarWindow = null;
let tray = null;
let quitting = false;
let reminderService;
let reminderTimer;
let notificationError = '';
const activeNotifications = new Set();
const startHidden = process.argv.includes('--hidden');
const loginOptions = { path: process.execPath, args: ['--hidden'] };

function supportsStartup() {
  return process.platform === 'win32' && app.isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE;
}

function reminderStatus() {
  return {
    supported: Notification.isSupported(),
    startupSupported: supportsStartup(),
    startAtLogin: supportsStartup() && app.getLoginItemSettings(loginOptions).openAtLogin,
    error: notificationError || (reminderService && reminderService.error) || '',
  };
}

function sendNotification(options, finish = () => {}) {
  if (!Notification.isSupported()) { finish(false); return false; }
  let notification;
  try { notification = new Notification({ ...options, icon: path.join(__dirname, '..', 'icon-192.png') }); }
  catch { finish(false); return false; }
  activeNotifications.add(notification);
  let settled = false;
  const settle = (shown) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    finish(shown);
  };
  const timeout = setTimeout(() => { settle(false); activeNotifications.delete(notification); }, 15000);
  notification.once('show', () => { notificationError = ''; settle(true); });
  notification.once('failed', () => {
    notificationError = 'Windows could not show a notification. Check Settings → System → Notifications → Clawlinder.';
    settle(false);
    activeNotifications.delete(notification);
  });
  notification.on('click', showCalendar);
  notification.once('close', () => { settle(false); activeNotifications.delete(notification); });
  try { notification.show(); return true; }
  catch { settle(false); activeNotifications.delete(notification); return false; }
}

function deliverReminder(reminder, timeFormat, finish) {
  const { event, days, start, due } = reminder;
  const date = new Date(start).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const time = new Date(start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: timeFormat === '12' });
  const timing = Date.now() - due > 60000 ? 'Upcoming event' : `${days} day${days === 1 ? '' : 's'} to go`;
  sendNotification({
    title: `${event.priority[0].toUpperCase() + event.priority.slice(1)} · ${event.title}`,
    body: `${timing} — ${date}${event.allDay ? ' · All day' : ' at ' + time}`,
  }, finish);
}

function createTray() {
  try {
    tray = new Tray(path.join(__dirname, '..', 'icon-192.png'));
    tray.setToolTip('Clawlinder — reminders keep running');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Clawlinder', click: showCalendar },
      { label: 'Test notification', click: () => sendNotification({ title: 'Clawlinder', body: 'Reminders are ready. Your calendar can stay in the system tray.' }) },
      { type: 'separator' },
      { label: 'Quit Clawlinder', click: () => app.quit() },
    ]));
    tray.on('click', showCalendar);
    tray.on('double-click', showCalendar);
  } catch {
    if (tray) tray.destroy();
    tray = null;
    console.warn('System tray unavailable; closing Clawlinder will exit it.');
  }
}

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
  calendarWindow.once('ready-to-show', () => { if (!startHidden || !tray) showCalendar(); });
  calendarWindow.on('close', (event) => {
    if (!quitting && tray) { event.preventDefault(); calendarWindow.hide(); }
  });
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
    reminderService = new ReminderService({
      storePath: path.join(profilePath, 'reminders.json'), deliver: deliverReminder,
      onError: (message) => console.warn(message),
    });
    ipcMain.handle('calendar:sync-reminders', (event, snapshot) => {
      if (!isTrustedSender(event)) return false;
      try { reminderService.sync(snapshot); return reminderStatus(); }
      catch { return false; }
    });
    ipcMain.handle('calendar:reminder-status', (event) => isTrustedSender(event) ? reminderStatus() : false);
    ipcMain.handle('calendar:test-notification', (event) => {
      if (!isTrustedSender(event)) return false;
      return new Promise((resolve) => {
        sendNotification({ title: 'Clawlinder', body: 'Your reminder test is here! Closing the calendar window keeps reminders running in the system tray.' }, resolve);
      });
    });
    ipcMain.handle('calendar:set-start-at-login', (event, enabled) => {
      if (!isTrustedSender(event) || typeof enabled !== 'boolean' || !supportsStartup()) return false;
      try {
        app.setLoginItemSettings({ ...loginOptions, openAtLogin: enabled });
        return app.getLoginItemSettings(loginOptions).openAtLogin === enabled;
      } catch { return false; }
    });

    createTray();
    createCalendarWindow();
    if (typeof Notification.handleActivation === 'function') Notification.handleActivation(showCalendar);
    reminderTimer = setInterval(() => reminderService.check(), 30000);
    powerMonitor.on('resume', () => reminderService.check());
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

  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { if (!tray) app.quit(); });
  app.on('will-quit', () => {
    clearInterval(reminderTimer);
    globalShortcut.unregisterAll();
    if (tray) tray.destroy();
    activeNotifications.forEach((notification) => notification.close());
  });
}
