'use strict';

const fs = require('node:fs');
const Core = require('../calendar-core.js');

const DAY = 24 * 60 * 60 * 1000;
const SCHEDULE = Object.freeze({
  low: Object.freeze([1]), normal: Object.freeze([2, 1]),
  high: Object.freeze([3, 2, 1]), urgent: Object.freeze([7, 4]),
});

function eventStart(event) {
  const date = Core.parseDate(event.date);
  const [hours, minutes] = (event.allDay ? '09:00' : event.time).split(':').map(Number);
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
}

function remindersFor(event) {
  const start = eventStart(event);
  return SCHEDULE[event.priority].map((days) => ({
    event, days, start, due: start - days * DAY,
    key: JSON.stringify([event.id, start, days]),
  }));
}

function validateSnapshot(input) {
  if (!input || typeof input.enabled !== 'boolean' || !['12', '24'].includes(input.timeFormat)) {
    throw new Error('Invalid reminder settings.');
  }
  const { events } = Core.validateBackup({ version: 1, events: input.events });
  return { enabled: input.enabled, timeFormat: input.timeFormat, events };
}

class ReminderService {
  constructor({ storePath, deliver, now = Date.now, fileSystem = fs, onError = () => {} }) {
    this.storePath = storePath;
    this.deliver = deliver;
    this.now = now;
    this.fs = fileSystem;
    this.onError = onError;
    this.snapshot = { enabled: true, timeFormat: '24', events: [] };
    this.sent = new Set();
    this.inFlight = new Set();
    this.synced = false;
    this.error = '';
    try {
      if (this.fs.existsSync(storePath)) {
        const saved = JSON.parse(this.fs.readFileSync(storePath, 'utf8'));
        this.snapshot = validateSnapshot(saved);
        if (!Array.isArray(saved.sent) || saved.sent.length > 50000 ||
            saved.sent.some((key) => typeof key !== 'string' || key.length > 250)) {
          throw new Error('Invalid reminder history.');
        }
        this.sent = new Set(saved.sent);
      }
    } catch {
      this.error = 'Reminder history could not be read. Save an event to rebuild it.';
    }
  }

  save() {
    try {
      this.fs.writeFileSync(this.storePath + '.tmp', JSON.stringify({ ...this.snapshot, sent: [...this.sent] }), 'utf8');
      this.fs.renameSync(this.storePath + '.tmp', this.storePath);
      this.error = '';
      return true;
    } catch {
      this.error = 'Reminder history could not be saved. Reminders may repeat after restarting.';
      this.onError(this.error);
      return false;
    }
  }

  sync(input) {
    const next = validateSnapshot(input);
    // Retain all delivered thresholds for unchanged events even after priority edits.
    const valid = new Set(next.events.filter((event) => eventStart(event) > this.now())
      .flatMap((event) => [1, 2, 3, 4, 7].map((days) => JSON.stringify([event.id, eventStart(event), days]))));
    this.sent = new Set([...this.sent].filter((key) => valid.has(key)));
    this.snapshot = next;
    this.synced = true;
    this.save();
    this.check();
  }

  check() {
    if (!this.synced || !this.snapshot.enabled) return;
    const now = this.now();
    for (const event of this.snapshot.events) {
      if (event.completed || eventStart(event) <= now) continue;
      const due = remindersFor(event).filter((reminder) => reminder.due <= now);
      if (!due.length) continue;
      // After sleep, downtime, or a late-created event, deliver only the latest milestone.
      const latest = due[due.length - 1];
      if (this.sent.has(latest.key) || this.inFlight.has(latest.key)) continue;
      this.inFlight.add(latest.key);
      const stillCurrent = () => this.snapshot.enabled && this.snapshot.events.some((item) =>
        item.id === event.id && !item.completed && eventStart(item) > this.now() &&
        remindersFor(item).some((reminder) => reminder.key === latest.key));
      let finished = false;
      const finish = (shown) => {
        if (finished) return;
        finished = true;
        this.inFlight.delete(latest.key);
        if (shown && stillCurrent()) {
          due.forEach((reminder) => this.sent.add(reminder.key));
          this.save();
        }
      };
      try { this.deliver(latest, this.snapshot.timeFormat, finish); }
      catch { finish(false); this.onError('Could not send a desktop reminder.'); }
    }
  }
}

module.exports = { DAY, SCHEDULE, eventStart, remindersFor, validateSnapshot, ReminderService };
