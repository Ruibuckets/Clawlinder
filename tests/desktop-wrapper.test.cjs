'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');

const project = path.resolve(__dirname, '..');
const desktop = path.join(project, 'desktop');

async function loadDesktop({ singleInstance = true, existingProfiles = [], hidden = false, notificationFails = false, packaged = true } = {}) {
  const windows = [];
  const handlers = new Map();
  const shortcuts = new Map();
  const app = new EventEmitter();
  app.isPackaged = packaged;
  let login = false;
  app.setLoginItemSettings = (options) => { login = options.openAtLogin; };
  app.getLoginItemSettings = () => ({ openAtLogin: login });
  const files = new Map();
  const fileSystem = { existsSync: (file) => files.has(file), readFileSync: (file) => files.get(file),
    writeFileSync: (file, text) => files.set(file, text),
    renameSync: (from, to) => { files.set(to, files.get(from)); files.delete(from); } };
  const trays = [];
  class FakeTray extends EventEmitter {
    constructor() { super(); trays.push(this); }
    setToolTip(value) { this.tooltip = value; }
    setContextMenu(menu) { this.menu = menu; }
    destroy() { this.destroyed = true; }
  }
  const notifications = [];
  class FakeNotification extends EventEmitter {
    static isSupported() { return true; }
    constructor(options) { super(); this.options = options; notifications.push(this); }
    show() { this.emit(notificationFails ? 'failed' : 'show'); }
    close() { this.emit('close'); }
  }
  const intervals = new Map();
  const timeouts = new Map();
  const power = new EventEmitter();
  const dataPaths = new Map();
  const startupOrder = [];
  const createdDirectories = [];
  const appData = path.join(project, 'mock-app-data');
  app.getPath = (name) => name === 'appData' ? appData : dataPaths.get(name);
  app.setPath = (name, directory) => { dataPaths.set(name, directory); startupOrder.push(name); };
  app.quits = 0;
  app.quit = () => { app.quits += 1; };
  app.requestSingleInstanceLock = () => { startupOrder.push('lock'); return singleInstance; };
  app.whenReady = async () => { startupOrder.push('ready'); };
  app.setAppUserModelId = () => {};
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      this.visible = false;
      this.minimized = false;
      this.pinned = options.alwaysOnTop;
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = { url: '' };
      this.webContents.setWindowOpenHandler = (handler) => { this.popupHandler = handler; };
      windows.push(this);
    }
    loadFile(file, options) {
      this.loadedFile = file;
      this.loadOptions = options;
      this.webContents.mainFrame.url = pathToFileURL(file).href + '?view=sidebar';
      return Promise.resolve();
    }
    isDestroyed() { return false; }
    isVisible() { return this.visible; }
    isMinimized() { return this.minimized; }
    restore() { this.minimized = false; }
    show() { this.visible = true; }
    hide() { this.visible = false; }
    focus() { this.focused = true; }
    getBounds() { return { ...this.bounds }; }
    setBounds(bounds) { this.bounds = { ...bounds }; }
    setAlwaysOnTop(value) { this.pinned = value; }
  }
  const area = { x: 80, y: 30, width: 1280, height: 900 };
  const electron = {
    app, BrowserWindow: FakeWindow, Tray: FakeTray, Notification: FakeNotification, powerMonitor: power,
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    globalShortcut: {
      register: (key, callback) => { shortcuts.set(key, callback); return true; },
      unregisterAll: () => { shortcuts.clear(); },
    },
    Menu: { setApplicationMenu: () => {}, buildFromTemplate: (template) => template },
    screen: {
      getPrimaryDisplay: () => ({ workArea: area }),
      getDisplayMatching: () => ({ workArea: area }),
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(desktop, 'main.cjs'), 'utf8'), {
    require: (name) => {
      if (name === 'electron') return electron;
      if (name === './reminders.cjs') return { ReminderService: class extends require('../desktop/reminders.cjs').ReminderService {
        constructor(options) { super({ ...options, fileSystem }); }
      } };
      if (name === 'node:fs') return {
        existsSync: (directory) => existingProfiles.includes(path.basename(directory)),
        mkdirSync: (directory) => { createdDirectories.push(directory); },
      };
      return require(name);
    },
    __dirname: desktop, process: { platform: 'win32', argv: hidden ? ['--hidden'] : [], env: {}, execPath: 'Clawlinder.exe' }, console, URL,
    setInterval: (fn) => { const id = {}; intervals.set(id, fn); return id; },
    clearInterval: (id) => intervals.delete(id),
    setTimeout: (fn) => { const id = {}; timeouts.set(id, fn); return id; },
    clearTimeout: (id) => timeouts.delete(id),
  });
  await new Promise((resolve) => setImmediate(resolve));
  return { app, windows, handlers, shortcuts, area, dataPaths, startupOrder, createdDirectories, appData,
    trays, notifications, intervals, timeouts, power, files };
}

test('renaming Clawlinder keeps existing desktop plans in their original profile', async () => {
  for (const previousName of ['sidebook-calendar', 'Sidebook Calendar', null]) {
    const desktopApp = await loadDesktop({ existingProfiles: previousName ? [previousName] : [] });
    const expected = path.join(desktopApp.appData, previousName || 'Clawlinder');
    assert.equal(desktopApp.dataPaths.get('userData'), expected);
    assert.equal(desktopApp.dataPaths.get('sessionData'), expected);
    assert.deepEqual(desktopApp.createdDirectories, [expected]);
    assert.deepEqual(desktopApp.startupOrder.slice(0, 3), ['userData', 'sessionData', 'lock']);
    assert.equal(desktopApp.windows[0].options.title, 'Clawlinder');
  }
});

test('desktop starts a pinned edge window with a sandboxed local renderer', async () => {
  const { windows, area } = await loadDesktop();
  const win = windows[0];
  assert.equal(win.options.width, 410);
  assert.equal(win.options.height, 900);
  assert.equal(win.options.x, area.x + area.width - 410);
  assert.equal(win.options.alwaysOnTop, true);
  assert.equal(win.options.webPreferences.contextIsolation, true);
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.equal(win.options.webPreferences.sandbox, true);
  assert.equal(win.loadedFile, path.join(project, 'index.html'));
  assert.equal(win.loadOptions.query.view, 'sidebar');
  assert.equal(win.popupHandler().action, 'deny');
  let blocked = false;
  win.webContents.emit('will-navigate', { preventDefault() { blocked = true; } }, 'https://example.org/');
  assert.equal(blocked, true);
});

test('IPC rejects foreign windows, subframes, remote pages, and invalid values', async () => {
  const { windows, handlers } = await loadDesktop();
  const win = windows[0];
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  const dock = handlers.get('calendar:set-dock-side');
  const pin = handlers.get('calendar:set-pinned');
  const before = { ...win.bounds };
  assert.equal(dock({ ...event, sender: {} }, 'left'), false);
  assert.equal(dock({ ...event, senderFrame: { url: event.senderFrame.url } }, 'left'), false);
  assert.equal(dock(event, 'top'), false);
  assert.equal(pin(event, 'false'), false);
  assert.deepEqual(win.bounds, before);
  assert.equal(win.pinned, true);
  event.senderFrame.url = 'https://example.org/';
  assert.equal(pin(event, false), false);
  assert.equal(win.pinned, true);
});

test('valid UI calls dock to either edge and unpin the native window', async () => {
  const { windows, handlers, area } = await loadDesktop();
  const win = windows[0];
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  assert.equal(handlers.get('calendar:set-dock-side')(event, 'left'), true);
  assert.equal(win.bounds.x, area.x);
  assert.equal(handlers.get('calendar:set-dock-side')(event, 'right'), true);
  assert.equal(win.bounds.x, area.x + area.width - win.bounds.width);
  assert.equal(handlers.get('calendar:set-pinned')(event, false), true);
  assert.equal(win.pinned, false);
});

test('shortcut toggles visibility and a second launch restores the running window', async () => {
  const { app, windows, shortcuts } = await loadDesktop();
  const win = windows[0];
  win.emit('ready-to-show');
  assert.equal(win.visible, true);
  shortcuts.get('Control+Shift+Space')();
  assert.equal(win.visible, false);
  shortcuts.get('Control+Shift+Space')();
  assert.equal(win.visible, true);
  win.minimized = true;
  app.emit('second-instance');
  assert.equal(win.minimized, false);
  assert.equal(win.focused, true);
  app.emit('window-all-closed');
  assert.equal(app.quits, 0);
  app.emit('will-quit');
  assert.equal(shortcuts.size, 0);
});

test('another process with the instance lock causes immediate exit', async () => {
  const { app, windows, handlers } = await loadDesktop({ singleInstance: false });
  assert.equal(app.quits, 1);
  assert.equal(windows.length, 0);
  assert.equal(handlers.size, 0);
});

test('preload exposes only specific calendar actions and no raw IPC', async () => {
  let bridge;
  const calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(desktop, 'preload.cjs'), 'utf8'), {
    require: (name) => {
      assert.equal(name, 'electron');
      return {
        contextBridge: { exposeInMainWorld: (name, api) => { assert.equal(name, 'desktopCalendar'); bridge = api; } },
        ipcRenderer: { invoke: async (...args) => { calls.push(args); return true; } },
      };
    },
  });
  assert.deepEqual(Object.keys(bridge).sort(), ['reminderStatus', 'setDockSide', 'setPinned', 'setStartAtLogin', 'syncReminders', 'testNotification']);
  assert.equal(await bridge.setDockSide('top'), false);
  assert.equal(await bridge.setPinned('yes'), false);
  assert.equal(await bridge.setStartAtLogin('yes'), false);
  assert.equal(calls.length, 0);
  assert.equal(await bridge.setDockSide('left'), true);
  assert.equal(await bridge.setPinned(false), true);
  assert.deepEqual(calls, [['calendar:set-dock-side', 'left'], ['calendar:set-pinned', false]]);
});

test('close hides to the tray; tray opens, quits, and clears background timers', async () => {
  const { app, windows, trays, intervals } = await loadDesktop();
  const win = windows[0];
  win.emit('ready-to-show');
  let prevented = false;
  win.emit('close', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(win.visible, false);
  trays[0].emit('click');
  assert.equal(win.visible, true);
  trays[0].menu.find((item) => item.label === 'Quit Clawlinder').click();
  assert.equal(app.quits, 1);
  app.emit('before-quit');
  prevented = false;
  win.emit('close', { preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  app.emit('will-quit');
  assert.equal(intervals.size, 0);
  assert.equal(trays[0].destroyed, true);
});

test('login launches quietly; startup is opt-in and unavailable for source runs', async () => {
  const { windows, handlers } = await loadDesktop({ hidden: true });
  const win = windows[0];
  win.emit('ready-to-show');
  assert.equal(win.visible, false);
  const sender = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  const status = handlers.get('calendar:reminder-status');
  const startup = handlers.get('calendar:set-start-at-login');
  assert.equal(status(sender).startAtLogin, false);
  assert.equal(startup(sender, 'true'), false);
  assert.equal(startup({ ...sender, sender: {} }, true), false);
  assert.equal(startup(sender, true), true);
  assert.equal(status(sender).startAtLogin, true);
  assert.equal(startup(sender, false), true);
  const sourceApp = await loadDesktop({ packaged: false });
  const sourceWin = sourceApp.windows[0];
  assert.equal(sourceApp.handlers.get('calendar:set-start-at-login')({ sender: sourceWin.webContents, senderFrame: sourceWin.webContents.mainFrame }, true), false);
});

test('reminder IPC validates snapshots, sends once, handles clicks and notification failure', async () => {
  const desktopApp = await loadDesktop();
  const { windows, handlers, notifications, power } = desktopApp;
  const win = windows[0];
  const sender = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  const sync = handlers.get('calendar:sync-reminders');
  const date = new Date(Date.now() + 12 * 60 * 60 * 1000);
  const Core = require('../calendar-core.js');
  const snapshot = { enabled: true, timeFormat: '12', events: [Core.normalizeEvent({ id: 'study', title: 'Study SAT',
    date: Core.dateKey(date), time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`, priority: 'normal' })] };
  assert.equal(sync({ ...sender, sender: {} }, snapshot), false);
  assert.equal(sync(sender, { ...snapshot, enabled: 'yes' }), false);
  assert.equal(sync(sender, { ...snapshot, events: [{ title: 'invalid' }] }), false);
  assert.equal(sync(sender, snapshot).supported, true);
  assert.equal(notifications.length, 1);
  assert.match(notifications[0].options.title, /Normal.*Study SAT/);
  assert.match(notifications[0].options.body, /Upcoming event/);
  sync(sender, snapshot);
  power.emit('resume');
  assert.equal(notifications.length, 1);
  win.hide();
  notifications[0].emit('click');
  assert.equal(win.visible, true);
  assert.equal(await handlers.get('calendar:test-notification')(sender), true);
  assert.equal(await handlers.get('calendar:test-notification')({ ...sender, sender: {} }), false);
  const failedApp = await loadDesktop({ notificationFails: true });
  const failedWin = failedApp.windows[0];
  const failedSender = { sender: failedWin.webContents, senderFrame: failedWin.webContents.mainFrame };
  assert.equal(await failedApp.handlers.get('calendar:test-notification')(failedSender), false);
  assert.match(failedApp.handlers.get('calendar:reminder-status')(failedSender).error, /Windows could not show/);
});

test('package whitelists app resources and pins desktop dependencies', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'));
  assert.equal(pkg.main, 'desktop/main.cjs');
  assert.equal(pkg.devDependencies.electron, '44.7.0');
  assert.equal(pkg.devDependencies['electron-builder'], '26.15.3');
  assert.deepEqual(pkg.build.win.target, ['nsis', 'portable']);
  assert.equal(pkg.build.nsis.perMachine, false);
  assert.equal(pkg.build.nsis.createDesktopShortcut, true);
  assert.equal(pkg.build.nsis.createStartMenuShortcut, true);
  assert.equal(pkg.build.files.includes('tests/**/*'), false);
  assert.equal(pkg.build.files.includes('backups/**/*'), false);
  assert.equal(pkg.build.files.includes('desktop/**/*'), true);
});
