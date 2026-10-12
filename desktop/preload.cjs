'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Keep the browser page independent of Node and expose two specific actions.
contextBridge.exposeInMainWorld('desktopCalendar', Object.freeze({
  setDockSide(side) {
    if (!['left', 'right'].includes(side)) return Promise.resolve(false);
    return ipcRenderer.invoke('calendar:set-dock-side', side);
  },
  setPinned(pinned) {
    if (typeof pinned !== 'boolean') return Promise.resolve(false);
    return ipcRenderer.invoke('calendar:set-pinned', pinned);
  },
}));
