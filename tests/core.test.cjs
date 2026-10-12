const assert = require('node:assert/strict');
const test = require('node:test');
// Exercise calendar arithmetic in the user's time zone, including DST changes.
process.env.TZ = 'America/Toronto';
const Core = require('../calendar-core.js');

function event(overrides = {}) {
  return {
    id: 'test-event', title: 'Study session', date: '2026-10-12',
    time: '09:30', endTime: '10:30', ...overrides
  };
}

test('date helpers use local components and validate leap days', () => {
  const localDate = new Date(2026, 9, 12, 23, 59);
  assert.equal(Core.dateKey(localDate), '2026-10-12');
  assert.equal(Core.parseDate('2024-02-29').getDate(), 29);
  assert.equal(Core.parseDate('0099-01-02').getFullYear(), 99);
  assert.equal(Core.dateKey(Core.parseDate('2026-03-08')), '2026-03-08');
  for (const badDate of ['2026-02-29', '2024-02-30', '2026-13-01', '2026-00-01', '0000-01-01', '2026-1-02']) {
    assert.throws(() => Core.parseDate(badDate));
  }
  assert.throws(() => Core.dateKey(new Date('invalid')));
});

test('month grids have 42 consecutive local dates and the chosen start day', () => {
  const mondayGrid = Core.monthDays(2026, 9, 1);
  assert.equal(mondayGrid.length, 42);
  assert.equal(mondayGrid[0], '2026-09-28');
  assert.equal(mondayGrid[41], '2026-11-08');
  const sundayGrid = Core.monthDays(2026, 9, 0);
  assert.equal(sundayGrid[0], '2026-09-27');
  const daylightGrid = Core.monthDays(2026, 2, 1);
  for (let index = 1; index < daylightGrid.length; index += 1) {
    const expected = Core.parseDate(daylightGrid[index - 1]);
    expected.setDate(expected.getDate() + 1);
    assert.equal(daylightGrid[index], Core.dateKey(expected));
  }
  assert.throws(() => Core.monthDays(2026, 12, 1));
});

test('seven-day plans start with today and include Sunday through Saturday', () => {
  const days = Core.nextSevenDays('2026-10-11');
  assert.deepEqual(days, [
    '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14',
    '2026-10-15', '2026-10-16', '2026-10-17'
  ]);
  assert.deepEqual(days.map(key => Core.parseDate(key).getDay()), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(Core.nextSevenDays('2026-10-12')[0], '2026-10-12');
});

test('seven-day plans cross month, leap day, and year boundaries', () => {
  assert.deepEqual(Core.nextSevenDays('2024-02-27'), [
    '2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01',
    '2024-03-02', '2024-03-03', '2024-03-04'
  ]);
  assert.deepEqual(Core.nextSevenDays('2026-12-29'), [
    '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01',
    '2027-01-02', '2027-01-03', '2027-01-04'
  ]);
  assert.throws(() => Core.nextSevenDays('2026-02-29'));
  assert.throws(() => Core.nextSevenDays('9999-12-31'));
});

test('seven-day plans stay consecutive across Toronto daylight saving changes', () => {
  const spring = Core.nextSevenDays('2026-03-06');
  const fall = Core.nextSevenDays('2026-10-30');
  assert.deepEqual(spring, [
    '2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09',
    '2026-03-10', '2026-03-11', '2026-03-12'
  ]);
  assert.deepEqual(fall, [
    '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02',
    '2026-11-03', '2026-11-04', '2026-11-05'
  ]);
  assert.equal(Core.parseDate('2026-03-09') - Core.parseDate('2026-03-08'), 23 * 60 * 60 * 1000);
  assert.equal(Core.parseDate('2026-11-02') - Core.parseDate('2026-11-01'), 25 * 60 * 60 * 1000);
});

test('daily plan text preserves whitespace and line breaks without mutating input', () => {
  const input = { '2026-10-12': '\n  7:00pm-  9:00pm, study sAT\n\n', '2026-10-13': '  \n\t', '2026-10-14': '' };
  const plans = Core.normalizePlans(input);
  assert.deepEqual(plans, { '2026-10-12': input['2026-10-12'], '2026-10-13': input['2026-10-13'] });
  assert.notEqual(plans, input);
  assert.equal(input['2026-10-14'], '');
  assert.deepEqual(Core.normalizePlans(), {});
  assert.equal(Core.normalizePlans({ '2026-10-12': 'a'.repeat(10000) })['2026-10-12'].length, 10000);
});

test('daily plans reject invalid dates, text, control characters, and excessive entries', () => {
  for (const input of [
    null, [], new Date(), 'notes', { '2026-02-29': 'Study' }, { '2026-1-02': 'Study' },
    { '2026-10-12': 7 }, { '2026-10-12': null }, { '2026-10-12': 'a'.repeat(10001) },
    { '2026-10-12': '\u0000' }, { '2026-10-12': '\u000b' }, { '2026-10-12': '\u007f' },
    JSON.parse('{"__proto__":"Study"}')
  ]) assert.throws(() => Core.normalizePlans(input));
  const tooMany = Object.fromEntries(Array.from({ length: 10001 }, (_, index) => [
    Core.dateKey(new Date(2026, 0, index + 1)), 'Plan'
  ]));
  assert.throws(() => Core.normalizePlans(tooMany), /10,000 daily plans/);
});

test('events normalize defaults without mutating the input', () => {
  const input = event({ title: '  Read chapter 2  ' });
  const normalized = Core.normalizeEvent(input);
  assert.equal(normalized.title, 'Read chapter 2');
  assert.equal(input.title, '  Read chapter 2  ');
  assert.equal(normalized.priority, 'normal');
  assert.equal(normalized.category, 'Personal');
  assert.equal(normalized.color, '#496b4b');
  assert.equal(normalized.completed, false);
  const allDay = Core.normalizeEvent(event({ allDay: true, time: '', endTime: '' }));
  assert.equal(allDay.time, '');
  const generated = event();
  delete generated.id;
  assert.ok(Core.normalizeEvent(generated).id);
});

test('malformed event fields are rejected', () => {
  for (const overrides of [
    { title: '' }, { title: 'a'.repeat(121) }, { date: '2026-02-29' },
    { time: '24:00' }, { time: '' }, { endTime: '08:30' },
    { priority: 'extreme' }, { color: 'red' }, { completed: 'false' },
    { allDay: 1 }, { notes: 'a'.repeat(10001) }, { id: 'bad\nUID' },
    { category: '' }
  ]) assert.throws(() => Core.normalizeEvent(event(overrides)), JSON.stringify(overrides));
  assert.doesNotThrow(() => Core.normalizeEvent(event({ endTime: '09:30' })));
});

test('backup imports reject the entire malformed collection and duplicate IDs', () => {
  const backup = { version: 1, events: [event()], settings: { theme: 'dark' } };
  const imported = Core.validateBackup(backup);
  assert.equal(imported.settings.theme, 'dark');
  assert.deepEqual(imported.plans, {});
  assert.deepEqual(imported.settings.categories, ['Personal', 'Work', 'Study', 'Health']);
  assert.notEqual(imported.events[0], backup.events[0]);
  assert.throws(() => Core.validateBackup({ ...backup, version: 2 }));
  assert.throws(() => Core.validateBackup({ ...backup, events: [event(), event({ id: 'broken', date: 'x' })] }), /Event 2/);
  assert.throws(() => Core.validateBackup({ ...backup, events: [event(), event()] }), /duplicate/);
  assert.throws(() => Core.validateBackup({ ...backup, events: [null] }));
  assert.throws(() => Core.validateBackup({ ...backup, events: Array(10001).fill(event()) }));
  assert.throws(() => Core.validateBackup({ ...backup, settings: { accent: 'url(bad)' } }));
});

test('backups round-trip exact daily plans and reject a malformed plan collection', () => {
  const backup = {
    version: 1, events: [event()],
    plans: { '2026-10-12': '7:00pm-  9:00pm, study sAT\n\n  Read', '2026-10-13': '\n' }
  };
  const imported = Core.validateBackup(JSON.parse(JSON.stringify(backup)));
  assert.deepEqual(imported.plans, backup.plans);
  assert.notEqual(imported.plans, backup.plans);
  for (const plans of [
    { '2026-02-29': 'Study' }, { '2026-10-12': false },
    { '2026-10-12': 'a'.repeat(10001) }, null, []
  ]) assert.throws(() => Core.validateBackup({ ...backup, plans }));
  assert.deepEqual(Core.validateBackup({ version: 1, events: [] }).plans, {});
});

test('settings return independent safe values and validate customization', () => {
  const settings = Core.sanitizeSettings({ name: '  Desk calendar ', categories: ['Writing', 'Fitness'], weekStart: 0 });
  assert.equal(settings.name, 'Desk calendar');
  assert.equal(settings.weekStart, 0);
  assert.equal(settings.timeFormat, '24');
  assert.equal(Core.sanitizeSettings({ theme: 'system' }).theme, 'system');
  assert.equal(Core.sanitizeSettings().dockSide, 'right');
  assert.equal(Core.sanitizeSettings({ dockSide: 'left' }).dockSide, 'left');
  assert.throws(() => Core.sanitizeSettings({ dockSide: 'bottom' }));
  settings.categories.push('Travel');
  assert.equal(Core.DEFAULT_SETTINGS.categories.length, 4);
  assert.throws(() => Core.sanitizeSettings({ categories: ['Work', 'work'] }));
  assert.throws(() => Core.sanitizeSettings({ categories: [] }));
  assert.throws(() => Core.sanitizeSettings({ theme: 'unknown' }));
  assert.throws(() => Core.sanitizeSettings({ weekStart: '1' }));
});

test('sorting orders days, all-day events, times, and importance without mutation', () => {
  const events = [
    Core.normalizeEvent(event({ id: 'low', priority: 'low' })),
    Core.normalizeEvent(event({ id: 'later', date: '2026-10-13' })),
    Core.normalizeEvent(event({ id: 'urgent', priority: 'urgent' })),
    Core.normalizeEvent(event({ id: 'all', allDay: true, time: '', endTime: '' }))
  ];
  assert.deepEqual(Core.sortEvents(events).map(item => item.id), ['all', 'urgent', 'low', 'later']);
  assert.equal(events[0].id, 'low');
});

test('ICS exports escaped text, floating times, and exclusive all-day end dates', () => {
  const ics = Core.toICS([
    event({ title: 'Read, write; repeat\\', notes: 'One line\nAnother line; with, punctuation\\' }),
    event({ id: 'new-year', date: '2026-12-31', allDay: true, time: '', endTime: '' })
  ]);
  assert.ok(ics.includes('DTSTART:20261012T093000\r\n'));
  assert.ok(ics.includes('DTEND:20261012T103000\r\n'));
  assert.ok(ics.includes('SUMMARY:Read\\, write\\; repeat\\\\\r\n'));
  assert.ok(ics.includes('DESCRIPTION:One line\\nAnother line\\; with\\, punctuation\\\\\r\n'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261231\r\n'));
  assert.ok(ics.includes('DTEND;VALUE=DATE:20270101\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.match(ics, /DTSTAMP:\d{8}T\d{6}Z/);
});

test('ICS lines are folded at 75 UTF-8 octets without breaking Unicode', () => {
  const ics = Core.toICS([event({ title: '📅'.repeat(50), notes: 'é'.repeat(100) })]);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('SUMMARY:' + '📅'.repeat(50)));
  assert.ok(unfolded.includes('DESCRIPTION:' + 'é'.repeat(100)));
});

