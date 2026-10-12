'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Keep the page independent of Node; each action has a specific IPC handler.
contextBridge.exposeInMainWorld('desktopCalendar', Object.freeze({
  setDockSide(side) {
    if (!['left', 'right'].includes(side)) return Promise.resolve(false);
    return ipcRenderer.invoke('calendar:set-dock-side', side);
  },
  setPinned(pinned) {
    if (typeof pinned !== 'boolean') return Promise.resolve(false);
    return ipcRenderer.invoke('calendar:set-pinned', pinned);
  },
  syncReminders(snapshot) {
    return ipcRenderer.invoke('calendar:sync-reminders', snapshot);
  },
  reminderStatus() {
    return ipcRenderer.invoke('calendar:reminder-status');
  },
  testNotification() {
    return ipcRenderer.invoke('calendar:test-notification');
  },
  setStartAtLogin(enabled) {
    if (typeof enabled !== 'boolean') return Promise.resolve(false);
    return ipcRenderer.invoke('calendar:set-start-at-login', enabled);
  },
}));
