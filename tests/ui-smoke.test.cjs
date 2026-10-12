// Logic smoke tests for the actual app event handlers, using a small fake DOM.
// This does not replace checking layout and browser behavior in a real browser.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const project = path.resolve(__dirname, '..');
const storageKey = 'personal-calendar.v1';

function attributes(text) {
  const result = {};
  for (const match of text.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) result[match[1]] = match[2] ?? '';
  return result;
}

class Node {
  constructor(tagName, attrs = {}) {
    this.tagName = tagName.toLowerCase();
    this.id = attrs.id;
    this.children = [];
    this.dataset = {};
    this.attributes = { ...attrs };
    this._text = '';
    this._value = attrs.value ?? '';
    this.defaultValue = this._value;
    this.checked = Object.hasOwn(attrs, 'checked');
    this.defaultChecked = this.checked;
    this.hidden = Object.hasOwn(attrs, 'hidden');
    this.open = false;
    this.listeners = new Map();
    this.styles = new Map();
    this.style = {
      setProperty: (key, value) => this.styles.set(key, value),
      getPropertyValue: (key) => this.styles.get(key) ?? '',
    };
    const classes = this.classes = new Set((attrs.class ?? '').split(/\s+/).filter(Boolean));
    this.classList = {
      add: (...values) => values.forEach(value => classes.add(value)),
      remove: (...values) => values.forEach(value => classes.delete(value)),
      contains: value => classes.has(value),
      toggle: (value, force) => {
        const enabled = force === undefined ? !classes.has(value) : force;
        enabled ? classes.add(value) : classes.delete(value);
        return enabled;
      },
    };
  }
  get className() { return [...this.classes].join(' '); }
  set className(value) { this.classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach(item => this.classes.add(item)); }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get value() { return this._value; }
  set value(value) {
    value = String(value);
    this._value = this.tagName === 'select' && !this.options.some(option => option.value === value) ? '' : value;
  }
  get options() { return this.children.filter(node => node.tagName === 'option'); }
  append(...nodes) {
    nodes.forEach(node => { node.parent = this; this.children.push(node); });
    if (this.tagName === 'select' && !this._value && this.options.length) this._value = this.options[0].value;
  }
  replaceChildren(...nodes) { this.children = []; this._text = ''; this._value = this.tagName === 'select' ? '' : this._value; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  async emit(type, details = {}) {
    const event = { target: this, preventDefault() {}, ...details };
    for (const handler of this.listeners.get(type) ?? []) await handler(event);
  }
  click() {
    if (this.tagName === 'a' && this.download) this.ownerDocument?.recordDownload(this);
    return this.emit('click');
  }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  async blur() {
    if (this.ownerDocument?.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body;
    await this.emit('blur');
  }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  querySelector(selector) {
    const date = selector.match(/^\[data-date="([^"]+)"\]$/)?.[1];
    return find(this, node => date !== undefined ? node.dataset.date === date
      : selector.startsWith('.') ? node.classList.contains(selector.slice(1))
      : selector.startsWith('#') ? node.id === selector.slice(1)
      : node.tagName === selector.toLowerCase());
  }
  reset() {
    for (const control of this.controls ?? []) {
      control.value = control.defaultValue || (control.tagName === 'select' ? control.options[0]?.value ?? '' : '');
      control.checked = control.defaultChecked;
    }
  }
}

function find(root, predicate) {
  for (const child of root.children) {
    if (predicate(child)) return child;
    const found = find(child, predicate);
    if (found) return found;
  }
  return null;
}

function launch(storage = new Map(), dark = false, options = {}) {
  const html = fs.readFileSync(path.join(project, 'index.html'), 'utf8');
  const nodes = new Map();
  for (const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="[^"]+"[^>]*)>/gi)) {
    const attrs = attributes(match[2]);
    nodes.set(attrs.id, new Node(match[1], attrs));
  }
  for (const match of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const select = nodes.get(attributes(match[1]).id);
    if (!select) continue;
    for (const optionMatch of match[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)) {
      const attrs = attributes(optionMatch[1]);
      const option = new Node('option', attrs);
      option.textContent = optionMatch[2];
      select.append(option);
      if (Object.hasOwn(attrs, 'selected')) select.value = option.value;
    }
    select.defaultValue = select.value;
  }
  for (const match of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const form = nodes.get(attributes(match[1]).id);
    if (form) form.controls = [...match[2].matchAll(/\bid="([^"]+)"/g)].map(item => nodes.get(item[1])).filter(Boolean);
  }
  const document = {
    getElementById(id) {
      const node = nodes.get(id) ?? [...nodes.values()].map(root => find(root, child => child.id === id)).find(Boolean);
      assert.ok(node, `the document must provide #${id}`);
      return node;
    },
    createElement(tag) { const node = new Node(tag); node.ownerDocument = document; return node; },
    documentElement: new Node('html'), body: new Node('body'),
  };
  [...nodes.values(), document.documentElement, document.body].forEach(node => { node.ownerDocument = document; });
  document.activeElement = document.body;
  const media = new Node('media');
  media.matches = dark;
  const window = new Node('window');
  if (options.desktop) window.desktopCalendar = options.desktop;
  let confirmations = 0;
  window.matchMedia = () => media;
  window.confirm = () => { confirmations += 1; return true; };
  const location = { protocol: 'file:', href: 'file:///personal-calendar/index.html' };
  const blobs = new Map();
  const downloads = [];
  document.recordDownload = anchor => downloads.push({ filename: anchor.download, blob: blobs.get(anchor.href) });
  class BrowserURL extends URL {
    static createObjectURL(blob) { const url = `blob:test/${blobs.size}`; blobs.set(url, blob); return url; }
    static revokeObjectURL(url) { blobs.delete(url); }
  }
  let currentTime = options.at ? new Date(options.at).getTime() : Date.now();
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [currentTime])); }
    static now() { return currentTime; }
  }
  const intervals = [];
  const context = vm.createContext({
    document, window, navigator: {}, location,
    history: { replaceState: (_state, _title, url) => { location.href = String(url); } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    setTimeout: () => 1, clearTimeout() {}, setInterval: handler => { intervals.push(handler); return intervals.length; },
    Blob, URL: BrowserURL, Date: ClockDate,
  });
  vm.runInContext(fs.readFileSync(path.join(project, 'calendar-core.js'), 'utf8'), context, { filename: 'calendar-core.js' });
  vm.runInContext(fs.readFileSync(path.join(project, 'app.js'), 'utf8'), context, { filename: 'app.js' });
  return {
    $, document, window, media, storage, downloads,
    saved: () => JSON.parse(storage.get(storageKey)),
    confirmations: () => confirmations,
    async advanceClock(at) { currentTime = new Date(at).getTime(); for (const handler of intervals) await handler(); },
    async import(data) {
      const content = typeof data === 'string' ? data : JSON.stringify(data);
      $('importInput').files = [{ size: Buffer.byteLength(content), text: async () => content }];
      await $('importInput').emit('change');
    },
  };
  function $(id) { return document.getElementById(id); }
}

test('desktop UI syncs events and notification preferences, while free text stays outside reminders', async () => {
  const calls = [];
  const startup = [];
  let atLogin = false;
  const status = () => ({ supported: true, startupSupported: true, startAtLogin: atLogin, error: '' });
  const desktop = {
    setDockSide: async () => true, setPinned: async () => true,
    syncReminders: async (snapshot) => { calls.push(JSON.parse(JSON.stringify(snapshot))); return status(); },
    reminderStatus: async () => status(),
    testNotification: async () => true,
    setStartAtLogin: async (value) => { startup.push(value); atLogin = value; return true; },
  };
  const app = launch(new Map(), false, { desktop });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.$('desktopReminderSettings').hidden, false);
  assert.equal(app.$('browserReminderHelp').hidden, true);
  assert.equal(calls[0].enabled, true);
  const writing = find(app.$('weeklyDays'), (node) => node.tagName === 'textarea');
  writing.value = '7 PM study SAT';
  await writing.emit('input');
  assert.equal(calls.length, 1);
  await app.$('newEventButton').click();
  app.$('eventTitle').value = 'Study SAT';
  app.$('eventPriority').value = 'urgent';
  await app.$('eventPriority').emit('change');
  assert.match(app.$('eventReminders').textContent, /7 days and 4 days/);
  await app.$('eventForm').emit('submit');
  assert.equal(calls.at(-1).events[0].priority, 'urgent');
  await app.$('settingsButton').click();
  await new Promise((resolve) => setImmediate(resolve));
  app.$('settingNotifications').checked = false;
  app.$('settingStartAtLogin').checked = true;
  await app.$('settingsForm').emit('submit');
  assert.equal(app.saved().settings.notifications, false);
  assert.equal(calls.at(-1).enabled, false);
  assert.deepEqual(startup, [true]);
  await app.$('testNotificationButton').click();
  assert.match(app.$('toast').textContent, /Test notification sent/);
});

test('app adds, marks done, edits, reloads, and deletes a persisted event', async () => {
  let app = launch();
  assert.equal(app.$('calendarGrid').children.length, 42);
  await app.$('newEventButton').click();
  assert.equal(app.$('eventDialog').open, true);
  app.$('eventTitle').value = 'Plan <script> is plain text';
  app.$('eventAllDay').checked = false;
  app.$('eventTime').value = '15:00';
  app.$('eventEndTime').value = '16:00';
  app.$('eventPriority').value = 'urgent';
  app.$('eventCategory').value = 'Work';
  app.$('eventColor').value = '#ab1234';
  app.$('eventNotes').value = 'Prepare the agenda.';
  await app.$('eventAllDay').emit('change');
  assert.equal(app.$('eventTime').required, true);
  await app.$('eventForm').emit('submit');
  assert.equal(app.saved().events.length, 1);
  assert.equal(app.saved().events[0].priority, 'urgent');
  assert.equal(app.$('eventDialog').open, false);
  assert.ok(app.$('dayEvents').textContent.includes('Plan <script> is plain text'));
  await find(app.$('dayEvents'), node => node.getAttribute('aria-label')?.startsWith('Mark done:')).click();
  assert.equal(app.saved().events[0].completed, true);
  await find(app.$('dayEvents'), node => node.getAttribute('aria-label')?.startsWith('Edit ')).click();
  app.$('eventTitle').value = 'Updated plan';
  await app.$('eventForm').emit('submit');
  assert.equal(app.saved().events.length, 1);
  assert.equal(app.saved().events[0].title, 'Updated plan');
  app = launch(app.storage);
  assert.ok(app.$('dayEvents').textContent.includes('Updated plan'));
  await find(app.$('dayEvents'), node => node.getAttribute('aria-label')?.startsWith('Edit ')).click();
  await app.$('deleteEventButton').click();
  assert.equal(app.saved().events.length, 0);
});

test('settings persist system appearance, custom categories, and sidebar position', async () => {
  let app = launch();
  await app.$('settingsButton').click();
  app.$('settingName').value = 'My desk';
  app.$('settingTheme').value = 'system';
  app.$('settingAccent').value = '#ffffff';
  app.$('settingWeekStart').value = '0';
  app.$('settingTimeFormat').value = '12';
  app.$('settingDensity').value = 'compact';
  app.$('settingCategories').value = 'Writing, Fitness';
  app.$('settingDockSide').value = 'left';
  await app.$('settingsForm').emit('submit');
  assert.equal(app.saved().settings.theme, 'system');
  assert.equal(app.saved().settings.dockSide, 'left');
  assert.deepEqual(app.saved().settings.categories, ['Writing', 'Fitness']);
  assert.equal(app.document.documentElement.dataset.theme, 'light');
  assert.equal(app.document.documentElement.style.getPropertyValue('--accent-ink'), '#17231a');
  app = launch(app.storage, true);
  assert.equal(app.$('calendarName').textContent, 'My desk');
  assert.equal(app.document.documentElement.dataset.theme, 'dark');
  assert.equal(app.document.documentElement.dataset.dock, 'left');
});

test('invalid imports preserve saved data; valid imports replace it after confirmation', async () => {
  const app = launch();
  const valid = { version: 1, events: [{ id: 'imported', title: 'Imported plan', date: '2026-10-12', allDay: true }], settings: {} };
  await app.import(valid);
  const before = app.storage.get(storageKey);
  assert.equal(app.saved().events[0].id, 'imported');
  assert.equal(app.confirmations(), 1);
  await app.import({ ...valid, events: [{ ...valid.events[0], date: '2026-02-29' }] });
  assert.equal(app.storage.get(storageKey), before);
  assert.equal(app.confirmations(), 1);
  assert.match(app.$('toast').textContent, /Import failed/);
});

test('malformed stored data survives startup and is repaired only by valid import', async () => {
  const storage = new Map([[storageKey, '{ broken json']]);
  const app = launch(storage);
  assert.equal(storage.get(storageKey), '{ broken json');
  assert.match(app.$('storageStatus').textContent, /recovery/);
  await app.import({ version: 1, events: [], settings: { theme: 'system' } });
  assert.equal(app.saved().events.length, 0);
  assert.equal(app.saved().settings.theme, 'system');
  assert.match(app.$('storageStatus').textContent, /Saved in this browser/);
});

test('invalid form submissions keep editors open and display inline errors', async () => {
  const app = launch();
  await app.$('newEventButton').click();
  app.$('eventTitle').value = 'Invalid time';
  app.$('eventAllDay').checked = false;
  app.$('eventTime').value = '16:00';
  app.$('eventEndTime').value = '15:00';
  await app.$('eventForm').emit('submit');
  assert.equal(app.$('eventDialog').open, true);
  assert.equal(app.$('eventError').hidden, false);
  assert.match(app.$('eventError').textContent, /End time/);
  assert.equal(app.storage.has(storageKey), false);
  await app.$('eventCancel').click();
  await app.$('settingsButton').click();
  app.$('settingCategories').value = 'Work, work';
  await app.$('settingsForm').emit('submit');
  assert.equal(app.$('settingsDialog').open, true);
  assert.equal(app.$('settingsError').hidden, false);
  assert.match(app.$('settingsError').textContent, /unique/);
  assert.equal(app.storage.has(storageKey), false);
});

test('sidebar and full calendar controls switch the layout through actual handlers', async () => {
  const app = launch();
  assert.equal(app.document.documentElement.dataset.layout, 'sidebar');
  await app.$('fullPageButton').click();
  assert.equal(app.document.documentElement.dataset.layout, 'full');
  await app.$('sidebarViewButton').click();
  assert.equal(app.document.documentElement.dataset.layout, 'sidebar');
  await app.$('expandCalendarButton').click();
  assert.equal(app.document.documentElement.dataset.layout, 'full');
});

test('cross-window updates preserve the open draft and saving keeps incoming events', async () => {
  const app = launch();
  await app.import({ version: 1, events: [], settings: { categories: ['Writing'] } });
  await app.$('newEventButton').click();
  const date = app.$('eventDate').value;
  app.$('eventTitle').value = 'Draft in progress';
  app.$('eventPriority').value = 'urgent';
  assert.equal(app.$('eventCategory').value, 'Writing');
  const incoming = JSON.stringify({
    version: 1,
    events: [{ id: 'other-window', title: 'Incoming event', date, allDay: true, category: 'Other' }],
    settings: { categories: ['Other'] },
  });
  app.storage.set(storageKey, incoming);
  await app.window.emit('storage', { key: storageKey, newValue: incoming });
  assert.equal(app.$('eventDialog').open, true);
  assert.equal(app.$('eventTitle').value, 'Draft in progress');
  assert.equal(app.$('eventPriority').value, 'urgent');
  assert.equal(app.$('eventCategory').value, 'Writing');
  assert.match(app.$('eventError').textContent, /another window/);
  await app.$('eventForm').emit('submit');
  assert.equal(app.saved().events.length, 2);
  assert.equal(app.saved().events.find(event => event.id === 'other-window').title, 'Incoming event');
  assert.equal(app.saved().events.find(event => event.title === 'Draft in progress').category, 'Writing');
});

test('a custom category named all is distinct from the all-categories filter', async () => {
  const app = launch();
  await app.$('newEventButton').click();
  const date = app.$('eventDate').value;
  await app.$('eventCancel').click();
  await app.import({
    version: 1,
    events: [
      { id: 'literal-all', title: 'Literal all category', date, allDay: true, category: 'all' },
      { id: 'personal', title: 'Personal category event', date, allDay: true, category: 'Personal' },
    ],
    settings: { categories: ['all', 'Personal'] },
  });
  assert.equal(app.$('categoryFilter').value, '');
  assert.ok(app.$('dayEvents').textContent.includes('Literal all category'));
  assert.ok(app.$('dayEvents').textContent.includes('Personal category event'));
  app.$('categoryFilter').value = 'all';
  await app.$('categoryFilter').emit('change');
  assert.ok(app.$('dayEvents').textContent.includes('Literal all category'));
  assert.equal(app.$('dayEvents').textContent.includes('Personal category event'), false);
});

test('the default planner has seven blank days starting today, including Sunday through Saturday', () => {
  const app = launch(new Map(), false, { at: new Date(2026, 9, 11, 12) });
  assert.equal(app.$('weekView').hidden, false);
  assert.equal(app.$('monthView').hidden, true);
  assert.equal(app.$('agendaView').hidden, true);
  assert.equal(app.$('viewWeek').getAttribute('aria-pressed'), 'true');
  assert.equal(app.$('weeklyDays').children.length, 7);
  for (let day = 11; day <= 17; day += 1) {
    const key = `2026-10-${day}`;
    const input = app.$(`plan-${key}`);
    assert.equal(input.tagName, 'textarea');
    assert.equal(input.dataset.date, key);
    assert.equal(input.value, '');
  }
  assert.equal(app.storage.has(storageKey), false);
});

test('typing a free-form daily plan saves without replacing its focused editor, and clearing removes it', async () => {
  const options = { at: new Date(2026, 9, 11, 12) };
  let app = launch(new Map(), false, options);
  const input = app.$('plan-2026-10-11');
  input.focus();
  input.value = '7:00pm- 9:00pm, study SAT\nThen pack my bag.';
  input.setSelectionRange(18, 18);
  await input.emit('input');
  assert.equal(app.saved().plans['2026-10-11'], input.value);
  assert.equal(app.$('plan-2026-10-11'), input);
  assert.equal(app.document.activeElement, input);
  assert.equal(input.selectionStart, 18);
  assert.equal(input.selectionEnd, 18);
  await input.blur();
  app = launch(app.storage, false, options);
  assert.equal(app.$('plan-2026-10-11').value, '7:00pm- 9:00pm, study SAT\nThen pack my bag.');
  app.$('plan-2026-10-11').value = '';
  await app.$('plan-2026-10-11').emit('input');
  assert.equal(Object.hasOwn(app.saved().plans, '2026-10-11'), false);
  app = launch(app.storage, false, options);
  assert.equal(app.$('plan-2026-10-11').value, '');
});

test('JSON backups round-trip free-form plans; old backups remain compatible and ICS exports only events', async () => {
  const app = launch(new Map(), false, { at: new Date(2026, 9, 11, 12) });
  const oldBackup = { version: 1, events: [{ id: 'imported', title: 'Appointment', date: '2026-10-11', allDay: true }], settings: {} };
  await app.import(oldBackup);
  assert.deepEqual(app.saved().plans, {});
  app.$('plan-2026-10-11').value = '7:00pm- 9:00pm, study SAT';
  await app.$('plan-2026-10-11').emit('input');
  await app.$('exportButton').click();
  const exported = JSON.parse(await app.downloads.at(-1).blob.text());
  assert.equal(exported.plans['2026-10-11'], '7:00pm- 9:00pm, study SAT');
  await app.$('exportICSButton').click();
  const ics = await app.downloads.at(-1).blob.text();
  assert.match(ics, /SUMMARY:Appointment/);
  assert.equal(ics.includes('study SAT'), false);
  await app.import(oldBackup);
  assert.equal(app.$('plan-2026-10-11').value, '');
  await app.import(exported);
  assert.equal(app.$('plan-2026-10-11').value, '7:00pm- 9:00pm, study SAT');
  const before = app.storage.get(storageKey);
  await app.import({ ...exported, plans: { '2026-02-29': 'Impossible date' } });
  assert.equal(app.storage.get(storageKey), before);
  assert.match(app.$('toast').textContent, /Import failed/);
});

test('the seven days roll forward at midnight while keeping saved past plans and a retained editor focus', async () => {
  const app = launch(new Map(), false, { at: new Date(2026, 9, 11, 23, 59) });
  const sunday = app.$('plan-2026-10-11');
  sunday.value = 'Sunday evening plan';
  await sunday.emit('input');
  const monday = app.$('plan-2026-10-12');
  monday.value = '7:00pm- 9:00pm, study SAT';
  monday.focus();
  monday.setSelectionRange(9, 9);
  await monday.emit('input');
  await app.advanceClock(new Date(2026, 9, 12, 0, 1));
  const dates = app.$('weeklyDays').children.map(card => find(card, node => node.tagName === 'textarea').dataset.date);
  assert.deepEqual(dates, ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
  assert.equal(app.$('plan-2026-10-12'), monday);
  assert.equal(app.document.activeElement, monday);
  assert.equal(monday.selectionStart, 9);
  assert.equal(monday.selectionEnd, 9);
  assert.equal(app.$('plan-2026-10-18').value, '');
  assert.equal(app.saved().plans['2026-10-11'], 'Sunday evening plan');
  assert.equal(app.saved().plans['2026-10-12'], '7:00pm- 9:00pm, study SAT');
});

