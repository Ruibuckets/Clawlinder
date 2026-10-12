'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../calendar-core.js');
const { DAY, SCHEDULE, eventStart, remindersFor, ReminderService } = require('../desktop/reminders.cjs');

const makeEvent = (changes = {}) => Core.normalizeEvent({ id: 'sat', title: 'Study SAT', date: '2026-11-10',
  time: '19:00', priority: 'high', ...changes });

function setup(event = makeEvent(), files = new Map()) {
  let clock = eventStart(event) - 10 * DAY;
  const delivered = [];
  const fileSystem = {
    existsSync: (file) => files.has(file), readFileSync: (file) => files.get(file),
    writeFileSync: (file, text) => files.set(file, text),
    renameSync: (from, to) => { files.set(to, files.get(from)); files.delete(from); },
  };
  const service = new ReminderService({ storePath: 'reminders.json', fileSystem, now: () => clock,
    deliver: (reminder, format, finish) => { delivered.push({ reminder, format }); finish(true); } });
  const sync = (events = [event], enabled = true) => service.sync({ events, enabled, timeFormat: '12' });
  return { service, sync, files, delivered, setNow: (value) => { clock = value; } };
}

test('the four priorities use the confirmed milestones at exact 24-hour intervals', () => {
  const expected = { low: [1], normal: [2, 1], high: [3, 2, 1], urgent: [7, 4] };
  assert.deepEqual(SCHEDULE, expected);
  for (const [priority, days] of Object.entries(expected)) {
    const event = makeEvent({ priority });
    const reminders = remindersFor(event);
    assert.deepEqual(reminders.map((item) => item.days), days);
    reminders.forEach((item) => assert.equal(eventStart(event) - item.due, item.days * DAY));
  }
});

test('timed events use the local start time; all-day events use 9 AM, including DST', () => {
  const oldTimezone = process.env.TZ;
  process.env.TZ = 'America/Toronto';
  try {
    const event = makeEvent({ date: '2026-11-02', time: '19:00', priority: 'urgent' });
    assert.equal(new Date(eventStart(event)).getHours(), 19);
    const sevenDaysBefore = new Date(remindersFor(event)[0].due);
    assert.equal(Core.dateKey(sevenDaysBefore), '2026-10-26');
    assert.equal(sevenDaysBefore.getHours(), 20); // Exact 168 hours across the fall-back transition.
    const allDay = makeEvent({ allDay: true });
    assert.equal(new Date(eventStart(allDay)).getHours(), 9);
  } finally {
    if (oldTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = oldTimezone;
  }
});

test('each milestone sends once, with no early delivery or urgent extra milestones', () => {
  for (const priority of Object.keys(SCHEDULE)) {
    const event = makeEvent({ priority });
    const app = setup(event);
    app.sync();
    for (const reminder of remindersFor(event)) {
      app.setNow(reminder.due - 1);
      app.service.check();
      const count = app.delivered.length;
      app.setNow(reminder.due);
      app.service.check();
      assert.equal(app.delivered.length, count + 1);
      app.service.check();
      app.sync();
      assert.equal(app.delivered.length, count + 1);
    }
    app.setNow(eventStart(event) - 1);
    app.service.check();
    assert.deepEqual(app.delivered.map((item) => item.reminder.days), SCHEDULE[priority]);
  }
});

test('after downtime, only the latest missed milestone is sent for a future event', () => {
  const event = makeEvent();
  const app = setup(event);
  app.sync();
  app.setNow(eventStart(event) - DAY / 2);
  app.service.check();
  assert.deepEqual(app.delivered.map((item) => item.reminder.days), [1]);
  app.service.check();
  assert.equal(app.delivered.length, 1);
  assert.equal(app.service.sent.size, 3);
});

test('restart preserves delivery history and waits for the current calendar before sending', () => {
  const event = makeEvent();
  const first = setup(event);
  first.setNow(eventStart(event) - 3 * DAY);
  first.sync();
  assert.equal(first.delivered.length, 1);
  const second = setup(event, first.files);
  second.setNow(eventStart(event) - 2 * DAY);
  second.service.check();
  assert.equal(second.delivered.length, 0);
  second.sync();
  assert.deepEqual(second.delivered.map((item) => item.reminder.days), [2]);
  second.service.check();
  assert.equal(second.delivered.length, 1);
});

test('completion, deletion, disabled reminders and events already started cancel pending delivery', () => {
  for (const scenario of ['completed', 'deleted', 'disabled', 'started']) {
    const event = makeEvent();
    const app = setup(event);
    app.sync();
    app.setNow(eventStart(event) - 3 * DAY);
    if (scenario === 'completed') app.sync([{ ...event, completed: true }]);
    if (scenario === 'deleted') app.sync([]);
    if (scenario === 'disabled') app.sync([event], false);
    if (scenario === 'started') app.setNow(eventStart(event));
    app.service.check();
    assert.equal(app.delivered.length, 0, scenario);
  }
});

test('editing priority preserves sent milestones; rescheduling starts a fresh schedule', () => {
  const event = makeEvent({ priority: 'normal' });
  const app = setup(event);
  app.setNow(eventStart(event) - 2 * DAY);
  app.sync();
  app.sync([{ ...event, priority: 'high' }]);
  assert.equal(app.delivered.length, 1);
  const moved = { ...event, time: '19:01' };
  app.setNow(eventStart(moved) - 2 * DAY);
  app.sync([moved]);
  assert.equal(app.delivered.length, 2);
});

test('pending native notifications do not duplicate; failed delivery can retry', () => {
  const event = makeEvent();
  const app = setup(event);
  let callback;
  let attempts = 0;
  app.service.deliver = (reminder, format, finish) => { attempts += 1; callback = finish; };
  app.setNow(eventStart(event) - 3 * DAY);
  app.sync();
  app.service.check();
  assert.equal(attempts, 1);
  callback(false);
  app.service.check();
  assert.equal(attempts, 2);
  callback(true);
  app.service.check();
  assert.equal(attempts, 2);
});

test('malformed IPC snapshots cannot replace the schedule; corrupt history is recoverable', () => {
  const app = setup();
  app.sync();
  for (const snapshot of [{ enabled: 'yes', events: [], timeFormat: '12' },
    { enabled: true, events: [{ title: 'bad' }], timeFormat: '12' },
    { enabled: true, events: [makeEvent(), makeEvent()], timeFormat: '12' }]) {
    assert.throws(() => app.service.sync(snapshot));
    assert.equal(app.service.snapshot.events.length, 1);
  }
  const recovered = setup(makeEvent(), new Map([['reminders.json', '{bad json']]));
  assert.match(recovered.service.error, /could not be read/);
  recovered.sync();
  assert.equal(recovered.service.error, '');
});

test('backup settings accept older files and preserve an explicit notification opt-out', () => {
  assert.equal(Core.validateBackup({ version: 1, events: [] }).settings.notifications, true);
  assert.equal(Core.sanitizeSettings({ notifications: false }).notifications, false);
  assert.throws(() => Core.sanitizeSettings({ notifications: 'yes' }));
});
