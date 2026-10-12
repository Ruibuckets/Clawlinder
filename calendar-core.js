/*
 * Calendar data helpers. This file does not touch the page or localStorage,
 * so the same helpers can also be tested with Node.js.
 */
(function (root) {
  'use strict';

  const PRIORITIES = Object.freeze([
    Object.freeze({ id: 'low', label: 'Low' }),
    Object.freeze({ id: 'normal', label: 'Normal' }),
    Object.freeze({ id: 'high', label: 'High' }),
    Object.freeze({ id: 'urgent', label: 'Urgent' })
  ]);

  const DEFAULT_SETTINGS = Object.freeze({
    name: 'My calendar',
    theme: 'light',
    accent: '#496b4b',
    weekStart: 1,
    timeFormat: '24',
    density: 'comfortable',
    dockSide: 'right',
    categories: Object.freeze(['Personal', 'Work', 'Study', 'Health'])
  });

  const priorityRank = { urgent: 0, high: 1, normal: 2, low: 3 };
  const priorityNumber = { urgent: 1, high: 3, normal: 5, low: 9 };
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const pad = (value, width = 2) => String(value).padStart(width, '0');

  function requireRecord(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(label + ' must be an object.');
    }
  }

  function boundedString(value, label, maximum, allowEmpty = false) {
    if (typeof value !== 'string') throw new Error(label + ' must be text.');
    const result = value.trim();
    if (!allowEmpty && !result) throw new Error(label + ' cannot be empty.');
    if (result.length > maximum) {
      throw new Error(label + ' must be at most ' + maximum + ' characters.');
    }
    // Tabs and line breaks are useful in notes; other control characters are not.
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) {
      throw new Error(label + ' contains an unsupported control character.');
    }
    return result;
  }

  function validColor(value) {
    if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
      throw new Error('Color must use six hexadecimal digits, for example #496b4b.');
    }
    return value.toLowerCase();
  }

  function validTime(value, label, allowEmpty = false) {
    if (allowEmpty && value === '') return '';
    if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      throw new Error(label + ' must be a valid time in HH:MM format.');
    }
    return value;
  }

  function validBoolean(value, label) {
    if (typeof value !== 'boolean') throw new Error(label + ' must be true or false.');
    return value;
  }

  function dateKey(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      throw new Error('A valid Date is required.');
    }
    return pad(date.getFullYear(), 4) + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function parseDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error('Date must use YYYY-MM-DD format.');
    }
    const [year, month, day] = value.split('-').map(Number);
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) {
      throw new Error('Date is not a real calendar date.');
    }
    // setFullYear avoids JavaScript's special handling of years 00 through 99.
    const date = new Date(0);
    date.setHours(0, 0, 0, 0);
    date.setFullYear(year, month - 1, day);
    if (dateKey(date) !== value) throw new Error('Date is not a real calendar date.');
    return date;
  }

  function monthDays(year, monthZero, weekStart = 1) {
    if (!Number.isInteger(year) || year < 1 || year > 9999 ||
        !Number.isInteger(monthZero) || monthZero < 0 || monthZero > 11 ||
        !Number.isInteger(weekStart) || weekStart < 0 || weekStart > 6) {
      throw new Error('Month grid needs a valid year, month (0–11), and week start (0–6).');
    }
    const cursor = parseDate(pad(year, 4) + '-' + pad(monthZero + 1) + '-01');
    const precedingDays = (cursor.getDay() - weekStart + 7) % 7;
    cursor.setDate(cursor.getDate() - precedingDays);
    const days = [];
    for (let index = 0; index < 42; index += 1) {
      days.push(dateKey(cursor));
      // Calendar arithmetic follows daylight saving changes, unlike adding 24 hours.
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }

  function nextSevenDays(startKey) {
    const cursor = parseDate(startKey);
    const days = [];
    for (let index = 0; index < 7; index += 1) {
      if (cursor.getFullYear() > 9999) throw new Error('The seven days must fit within years 0001–9999.');
      days.push(dateKey(cursor));
      // Move by calendar date so a daylight saving change cannot skip or repeat a day.
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }

  function normalizePlans(input) {
    if (input === undefined) return {};
    requireRecord(input, 'Daily plans');
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('Daily plans must be an object containing dates and text.');
    }
    const entries = Object.entries(input);
    if (entries.length > 10000) throw new Error('Use at most 10,000 daily plans.');
    const plans = {};
    for (const [key, value] of entries) {
      parseDate(key);
      if (typeof value !== 'string') throw new Error('Daily plan for ' + key + ' must be text.');
      if (value.length > 10000) throw new Error('Daily plan for ' + key + ' must be at most 10,000 characters.');
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
        throw new Error('Daily plan for ' + key + ' contains an unsupported control character.');
      }
      // Keep the writer's spacing and line breaks exactly as entered.
      if (value !== '') plans[key] = value;
    }
    return plans;
  }

  function newId() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') {
      return root.crypto.randomUUID();
    }
    return 'event-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  function normalizeEvent(input) {
    requireRecord(input, 'Event');
    const title = boundedString(input.title, 'Title', 120);
    parseDate(input.date);
    const id = has(input, 'id') ? boundedString(input.id, 'Event ID', 128) : newId();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) {
      throw new Error('Event ID may contain letters, numbers, dots, underscores, colons, and hyphens.');
    }
    const allDay = has(input, 'allDay') ? validBoolean(input.allDay, 'All-day flag') : false;
    const suppliedTime = has(input, 'time') ? input.time : '';
    const suppliedEnd = has(input, 'endTime') ? input.endTime : '';
    const time = validTime(suppliedTime, 'Start time', allDay);
    const endTime = validTime(suppliedEnd, 'End time', true);
    if (!allDay && endTime && endTime < time) {
      throw new Error('End time must be the same as or later than start time.');
    }
    const priority = has(input, 'priority') ? input.priority : 'normal';
    if (!PRIORITIES.some(item => item.id === priority)) throw new Error('Choose a valid importance level.');
    return {
      id,
      title,
      date: input.date,
      time: allDay ? '' : time,
      endTime: allDay ? '' : endTime,
      allDay,
      priority,
      category: has(input, 'category') ? boundedString(input.category, 'Category', 80) : 'Personal',
      color: has(input, 'color') ? validColor(input.color) : DEFAULT_SETTINGS.accent,
      notes: has(input, 'notes') ? boundedString(input.notes, 'Notes', 10000, true) : '',
      completed: has(input, 'completed') ? validBoolean(input.completed, 'Completed flag') : false
    };
  }

  function sanitizeSettings(input) {
    if (input === undefined) input = {};
    requireRecord(input, 'Settings');
    const settings = { ...DEFAULT_SETTINGS, categories: [...DEFAULT_SETTINGS.categories] };
    if (has(input, 'name')) settings.name = boundedString(input.name, 'Calendar name', 60);
    if (has(input, 'accent')) settings.accent = validColor(input.accent);
    if (has(input, 'theme')) {
      if (!['light', 'dark', 'system'].includes(input.theme)) throw new Error('Theme must be light, dark, or system.');
      settings.theme = input.theme;
    }
    if (has(input, 'weekStart')) {
      if (!Number.isInteger(input.weekStart) || input.weekStart < 0 || input.weekStart > 6) {
        throw new Error('Week start must be a number from 0 (Sunday) to 6 (Saturday).');
      }
      settings.weekStart = input.weekStart;
    }
    if (has(input, 'timeFormat')) {
      if (!['12', '24'].includes(input.timeFormat)) throw new Error('Time format must be 12 or 24.');
      settings.timeFormat = input.timeFormat;
    }
    if (has(input, 'density')) {
      if (!['comfortable', 'compact'].includes(input.density)) throw new Error('Choose a valid density.');
      settings.density = input.density;
    }
    if (has(input, 'dockSide')) {
      if (!['left', 'right'].includes(input.dockSide)) throw new Error('Sidebar position must be left or right.');
      settings.dockSide = input.dockSide;
    }
    if (has(input, 'categories')) {
      if (!Array.isArray(input.categories) || input.categories.length < 1 || input.categories.length > 30) {
        throw new Error('Use between 1 and 30 categories.');
      }
      const categories = input.categories.map(value => boundedString(value, 'Category', 80));
      if (new Set(categories.map(value => value.toLowerCase())).size !== categories.length) {
        throw new Error('Category names must be unique.');
      }
      settings.categories = categories;
    }
    return settings;
  }

  function validateBackup(data) {
    requireRecord(data, 'Backup');
    if (data.version !== 1) throw new Error('This backup version is not supported.');
    if (!Array.isArray(data.events) || data.events.length > 10000) {
      throw new Error('Backup must contain an events array with at most 10,000 events.');
    }
    const events = data.events.map((event, index) => {
      try {
        return normalizeEvent(event);
      } catch (error) {
        throw new Error('Event ' + (index + 1) + ': ' + error.message);
      }
    });
    if (new Set(events.map(event => event.id)).size !== events.length) {
      throw new Error('Backup contains duplicate event IDs.');
    }
    return { version: 1, events, settings: sanitizeSettings(data.settings), plans: normalizePlans(data.plans) };
  }

  function sortEvents(events) {
    return [...events].sort((left, right) =>
      left.date.localeCompare(right.date) ||
      Number(right.allDay) - Number(left.allDay) ||
      left.time.localeCompare(right.time) ||
      priorityRank[left.priority] - priorityRank[right.priority] ||
      left.title.localeCompare(right.title)
    );
  }

  function escapeICSText(value) {
    return String(value)
      .replace(/\\/g, '\\\\')
      .replace(/\r\n|\r|\n/g, '\\n')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,');
  }

  function foldICSLine(line) {
    let result = '';
    let bytes = 0;
    for (const character of line) {
      const point = character.codePointAt(0);
      const size = point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
      if (bytes + size > 75) {
        result += '\r\n ';
        bytes = 1;
      }
      result += character;
      bytes += size;
    }
    return result;
  }

  function toICS(events) {
    if (!Array.isArray(events)) throw new Error('Events must be an array.');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Clawlinder//EN', 'CALSCALE:GREGORIAN'];
    for (const event of sortEvents(events.map(normalizeEvent))) {
      lines.push('BEGIN:VEVENT', 'UID:' + event.id + '@personal-calendar.local', 'DTSTAMP:' + stamp);
      const compactDate = event.date.replace(/-/g, '');
      if (event.allDay) {
        const nextDay = parseDate(event.date);
        nextDay.setDate(nextDay.getDate() + 1);
        lines.push('DTSTART;VALUE=DATE:' + compactDate);
        lines.push('DTEND;VALUE=DATE:' + dateKey(nextDay).replace(/-/g, ''));
      } else {
        lines.push('DTSTART:' + compactDate + 'T' + event.time.replace(':', '') + '00');
        if (event.endTime) lines.push('DTEND:' + compactDate + 'T' + event.endTime.replace(':', '') + '00');
      }
      lines.push('SUMMARY:' + escapeICSText(event.title));
      if (event.notes) lines.push('DESCRIPTION:' + escapeICSText(event.notes));
      lines.push('CATEGORIES:' + escapeICSText(event.category));
      lines.push('PRIORITY:' + priorityNumber[event.priority]);
      lines.push('X-PERSONAL-CALENDAR-COMPLETED:' + (event.completed ? 'TRUE' : 'FALSE'));
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.map(foldICSLine).join('\r\n') + '\r\n';
  }

  const CalendarCore = {
    PRIORITIES, DEFAULT_SETTINGS, dateKey, parseDate, monthDays, nextSevenDays,
    normalizeEvent, normalizePlans, validateBackup, sanitizeSettings, sortEvents, toICS
  };
  root.CalendarCore = CalendarCore;
  if (typeof module !== 'undefined' && module.exports) module.exports = CalendarCore;
})(globalThis);
