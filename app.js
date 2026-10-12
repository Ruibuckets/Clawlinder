/* Clawlinder: UI and local browser storage. No framework required. */
(() => {
  'use strict';
  const Core = globalThis.CalendarCore;
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = 'personal-calendar.v1';
  const today = () => Core.dateKey(new Date());
  const state = {
    events: [], plans: {}, settings: { ...Core.DEFAULT_SETTINGS },
    selected: today(), month: new Date().getMonth(), year: new Date().getFullYear(),
    view: 'week', storageBlocked: false, storageAvailable: true,
  };
  let toastTimer;
  let desktopPinned = true;
  let displayedToday = today();
  const mediaTheme = window.matchMedia('(prefers-color-scheme: dark)');
  const weeklyCards = new Map();
  let weekSignature = '';
  let lastReminderSync = '';
  let desktopStatus = null;

  function showReminderStatus(status) {
    desktopStatus = status;
    $('reminderStatus').textContent = status.error || (!status.supported
      ? 'Desktop notifications are unavailable on this system.'
      : 'Closing the window keeps reminders running in the system tray. Right-click its icon to quit.');
    $('settingNotifications').disabled = !status.supported;
    $('testNotificationButton').disabled = !status.supported;
    $('settingStartAtLogin').disabled = !status.startupSupported;
  }

  function syncDesktopReminders() {
    if (!window.desktopCalendar || !window.desktopCalendar.syncReminders) return;
    const snapshot = { enabled: !state.storageBlocked && state.storageAvailable && state.settings.notifications,
      timeFormat: state.settings.timeFormat, events: state.storageBlocked ? [] : state.events };
    const signature = JSON.stringify(snapshot);
    if (signature === lastReminderSync) return;
    lastReminderSync = signature;
    window.desktopCalendar.syncReminders(snapshot).then((status) => {
      if (!status) throw new Error('Reminder update rejected.');
      showReminderStatus(status);
    }).catch(() => {
      lastReminderSync = '';
      notify('Could not update desktop reminders. Reopen Clawlinder and try again.');
    });
  }

  function showEventReminders() {
    const schedules = { low: '1 day', normal: '2 days and 1 day', high: '3, 2, and 1 day', urgent: '7 days and 4 days' };
    $('eventReminders').textContent = !window.desktopCalendar ? 'Install the desktop app for importance-based reminders.'
      : !state.settings.notifications ? 'Reminders are turned off in Make it yours.'
      : `Reminders: ${schedules[$('eventPriority').value]} before. Each day is 24 hours.${$('eventAllDay').checked ? ' All-day reminders use 9:00 AM on the event date.' : ''}`;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function notify(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').classList.add('visible');
    toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 6500);
  }

  function reportError(message) {
    const target = $('eventDialog').open ? $('eventError') : $('settingsDialog').open ? $('settingsError') : null;
    if (target) { target.textContent = message; target.hidden = false; }
    else notify(message);
  }

  function setLayout(layout) {
    document.documentElement.dataset.layout = layout;
    const url = new URL(location.href);
    if (layout === 'full') url.searchParams.set('view', 'full');
    else url.searchParams.delete('view');
    history.replaceState(null, '', url);
  }

  function showStorageStatus() {
    $('storageStatus').textContent = state.storageBlocked
      ? 'Saved data needs recovery. Import a backup.'
      : state.storageAvailable ? 'Saved in this browser' : 'Temporary mode — export a backup';
    if (state.view === 'week') $('statusSummary').textContent = state.storageAvailable && !state.storageBlocked
      ? 'Your writing saves automatically.' : 'Export a backup before closing.';
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        try {
          const saved = Core.validateBackup(JSON.parse(raw));
          state.events = saved.events;
          state.plans = saved.plans;
          state.settings = saved.settings;
        } catch (error) {
          // Leave the original storage intact so an invalid file is never silently lost.
          state.storageBlocked = true;
          notify('Saved calendar could not be read. Import a valid backup to recover; existing storage is preserved.');
        }
      }
    } catch (error) {
      state.storageAvailable = false;
      notify('Browser storage is unavailable. Export your calendar before closing this page.');
    }
    showStorageStatus();
  }

  function persist() {
    if (state.storageBlocked) {
      notify('Changes are temporary until you import a valid backup. Export your current work before closing.');
      return false;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(backup()));
      state.storageAvailable = true;
      showStorageStatus();
      syncDesktopReminders();
      return true;
    } catch (error) {
      state.storageAvailable = false;
      showStorageStatus();
      syncDesktopReminders();
      notify('Changes could not be saved in this browser. Export a backup before closing.');
      return false;
    }
  }

  function backup() {
    return { version: 1, events: state.events, plans: state.plans, settings: state.settings };
  }

  function visibleEvents() {
    const search = $('searchInput').value.trim().toLocaleLowerCase();
    const priority = $('priorityFilter').value;
    const category = $('categoryFilter').value;
    return Core.sortEvents(state.events.filter((event) =>
      (priority === 'all' || event.priority === priority) &&
      (!category || event.category === category) &&
      (!search || [event.title, event.category, event.notes].join(' ').toLocaleLowerCase().includes(search))
    ));
  }

  function formattedDate(key, options) {
    return Core.parseDate(key).toLocaleDateString(undefined, options);
  }

  function formattedTime(time) {
    if (!time) return '';
    const [hour, minute] = time.split(':').map(Number);
    const date = new Date(2000, 0, 1, hour, minute);
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: state.settings.timeFormat === '12' });
  }

  function eventTime(event) {
    return event.allDay ? 'All day' : formattedTime(event.time) + (event.endTime ? ' – ' + formattedTime(event.endTime) : '');
  }

  function applySettings() {
    const settings = state.settings;
    document.documentElement.dataset.theme = settings.theme === 'system' ? (mediaTheme.matches ? 'dark' : 'light') : settings.theme;
    document.documentElement.dataset.density = settings.density;
    document.documentElement.dataset.dock = settings.dockSide;
    document.documentElement.style.setProperty('--accent', settings.accent);
    const rgb = settings.accent.slice(1).match(/.{2}/g).map((part) => parseInt(part, 16) / 255);
    const luminance = rgb.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
    document.documentElement.style.setProperty('--accent-ink', luminance > 0.179 ? '#17231a' : '#ffffff');
    const isDark = document.documentElement.dataset.theme === 'dark';
    document.documentElement.style.setProperty('--accent-text', isDark && luminance < 0.12 ? '#b7d5b5' : !isDark && luminance > 0.4 ? '#35593b' : settings.accent);
    if (window.desktopCalendar) window.desktopCalendar.setDockSide(settings.dockSide)
      .then((moved) => { if (!moved) notify('Could not move the desktop sidebar.'); })
      .catch(() => notify('Could not move the desktop sidebar.'));
    $('calendarName').textContent = settings.name;
    document.title = settings.name + ' · Clawlinder';
    populateCategories();
    updateClock();
  }

  function categories() {
    // Preserve existing event categories when someone changes their custom list.
    return [...new Set([...state.settings.categories, ...state.events.map((event) => event.category)].filter(Boolean))];
  }

  function populateSelect(select, values, allLabel) {
    const previous = select.value;
    select.replaceChildren();
    if (allLabel) {
      const option = element('option', '', allLabel);
      option.value = '';
      select.append(option);
    }
    values.forEach((value) => {
      const option = element('option', '', value);
      option.value = value;
      select.append(option);
    });
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  }

  function populateCategories() {
    const values = categories();
    populateSelect($('categoryFilter'), values, 'All categories');
    const draftCategory = $('eventDialog').open ? $('eventCategory').value : '';
    if (draftCategory && !values.includes(draftCategory)) values.push(draftCategory);
    populateSelect($('eventCategory'), values.length ? values : ['Personal']);
  }

  function render(forcePlans = false) {
    document.documentElement.dataset.view = state.view;
    const events = visibleEvents();
    const monthPrefix = `${String(state.year).padStart(4, '0')}-${String(state.month + 1).padStart(2, '0')}-`;
    const monthEvents = events.filter((event) => event.date.startsWith(monthPrefix));
    $('monthLabel').textContent = state.view === 'week' ? 'Next 7 days'
      : Core.parseDate(monthPrefix + '01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const important = monthEvents.filter((event) => event.priority === 'high' || event.priority === 'urgent').length;
    $('statusSummary').textContent = `${monthEvents.length} event${monthEvents.length === 1 ? '' : 's'} this month · ${important} high importance`;
    $('weekView').hidden = state.view !== 'week';
    $('monthView').hidden = state.view !== 'month';
    $('agendaView').hidden = state.view !== 'agenda';
    $('viewMonth').setAttribute('aria-pressed', String(state.view === 'month'));
    $('viewAgenda').setAttribute('aria-pressed', String(state.view === 'agenda'));
    $('viewWeek').setAttribute('aria-pressed', String(state.view === 'week'));
    $('prevMonth').hidden = state.view === 'week';
    $('nextMonth').hidden = state.view === 'week';
    renderWeek(forcePlans === true);
    showStorageStatus();
    renderGrid(events);
    renderAgenda(monthEvents);
    renderDay(events);
  }

  function renderWeek(forcePlans = false) {
    const days = Core.nextSevenDays(today());
    const labelOptions = { month: 'short', day: 'numeric' };
    $('weekRange').textContent = formattedDate(days[0], labelOptions) + ' – ' + formattedDate(days[6], { ...labelOptions, year: 'numeric' });
    const cards = days.map((key, index) => {
      let entry = weeklyCards.get(key);
      if (!entry) {
        const card = element('section', 'week-plan');
        card.dataset.date = key;
        const heading = element('div', 'week-plan-heading');
        const label = element('label', 'week-plan-label', formattedDate(key, { weekday: 'long' }));
        label.htmlFor = 'plan-' + key;
        const date = element('span', 'week-plan-date', formattedDate(key, labelOptions));
        const badge = element('span', 'week-plan-today', 'Today');
        heading.append(label, date, badge);
        const input = element('textarea', 'week-plan-input');
        input.id = 'plan-' + key;
        input.dataset.date = key;
        input.maxLength = 10000;
        input.rows = 3;
        input.spellcheck = true;
        input.setAttribute('aria-label', 'Plans for ' + formattedDate(key, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }));
        input.addEventListener('input', () => {
          // Save exactly what was typed; informal times and line breaks are welcome.
          if (input.value === '') delete state.plans[key];
          else state.plans[key] = input.value;
          persist();
        });
        card.append(heading, input);
        entry = { card, input, badge };
        weeklyCards.set(key, entry);
      }
      entry.card.classList.toggle('is-today', index === 0);
      entry.badge.hidden = index !== 0;
      // Reuse textareas while someone types, keeping their cursor and selection.
      if (forcePlans || document.activeElement !== entry.input) entry.input.value = state.plans[key] || '';
      return entry.card;
    });
    if (weekSignature !== days.join(',')) {
      const focused = document.activeElement;
      const activeEntry = [...weeklyCards.values()].find((entry) => entry.input === focused && cards.includes(entry.card));
      const selection = activeEntry ? [focused.selectionStart, focused.selectionEnd, focused.selectionDirection] : null;
      $('weeklyDays').replaceChildren(...cards);
      if (activeEntry) {
        focused.focus({ preventScroll: true });
        focused.setSelectionRange(selection[0], selection[1], selection[2] || 'none');
      }
      weekSignature = days.join(',');
      for (const key of weeklyCards.keys()) if (!days.includes(key)) weeklyCards.delete(key);
    }
  }

  function renderGrid(events) {
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    $('weekdayLabels').replaceChildren(...weekdays.map((_, index) => element('span', '', weekdays[(index + Number(state.settings.weekStart)) % 7])));
    $('calendarGrid').replaceChildren();
    Core.monthDays(state.year, state.month, Number(state.settings.weekStart)).forEach((key) => {
      if (!/^\d{4}-/.test(key) || key.startsWith('0000-')) {
        const placeholder = element('div', 'day-cell outside');
        placeholder.setAttribute('aria-hidden', 'true');
        $('calendarGrid').append(placeholder);
        return;
      }
      const date = Core.parseDate(key);
      const daily = events.filter((event) => event.date === key);
      const button = element('button', 'day-cell');
      button.type = 'button';
      button.dataset.date = key;
      button.classList.toggle('outside', date.getMonth() !== state.month);
      button.classList.toggle('is-today', key === today());
      button.classList.toggle('is-selected', key === state.selected);
      button.setAttribute('aria-pressed', String(key === state.selected));
      button.setAttribute('aria-label', formattedDate(key, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + `, ${daily.length} events`);
      button.append(element('span', 'day-number', date.getDate()));
      const chips = element('span', 'day-events');
      daily.slice(0, 3).forEach((event) => {
        const chip = element('span', 'event-chip');
        chip.dataset.priority = event.priority;
        chip.style.setProperty('--event-color', event.color);
        chip.classList.toggle('completed', event.completed);
        chip.append(element('span', 'priority-dot'), element('span', 'event-chip-title', event.title));
        chips.append(chip);
      });
      if (daily.length > 3) chips.append(element('span', 'overflow-count', `+${daily.length - 3} more`));
      button.append(chips);
      button.addEventListener('click', () => {
        state.selected = key;
        state.month = date.getMonth();
        state.year = date.getFullYear();
        render();
        const newButton = $('calendarGrid').querySelector(`[data-date="${key}"]`);
        if (newButton) newButton.focus({ preventScroll: true });
      });
      $('calendarGrid').append(button);
    });
  }

  function emptyState(title, detail) {
    const box = element('div', 'empty-state');
    box.append(element('p', 'empty-title', title), element('p', '', detail));
    return box;
  }

  function renderAgenda(events) {
    $('agendaList').replaceChildren();
    if (!events.length) {
      $('agendaList').append(emptyState('A little room to plan.', 'Add an event, or adjust your filters to see more of your month.'));
      return;
    }
    const groups = new Map();
    events.forEach((event) => {
      if (!groups.has(event.date)) groups.set(event.date, []);
      groups.get(event.date).push(event);
    });
    groups.forEach((daily, key) => {
      const group = element('section', 'agenda-group');
      group.append(element('h3', 'agenda-date', formattedDate(key, { weekday: 'long', month: 'short', day: 'numeric' })));
      daily.forEach((event) => group.append(eventCard(event)));
      $('agendaList').append(group);
    });
  }

  function renderDay(events) {
    const daily = events.filter((event) => event.date === state.selected);
    $('selectedDateLabel').textContent = formattedDate(state.selected, { weekday: 'long', month: 'long', day: 'numeric' });
    $('daySummary').textContent = `${daily.length} event${daily.length === 1 ? '' : 's'}${state.selected === today() ? ' · Today' : ''}`;
    $('dayEvents').replaceChildren();
    if (!daily.length) $('dayEvents').append(emptyState('Make space for what matters.', 'Add something to this day. Events matching your filters will appear here.'));
    daily.forEach((event) => $('dayEvents').append(eventCard(event)));
  }

  function eventCard(event) {
    const card = element('article', 'event-card');
    card.style.setProperty('--event-color', event.color);
    card.classList.toggle('completed', event.completed);
    const meta = element('div', 'event-meta');
    const badge = element('span', 'priority-badge', Core.PRIORITIES.find((priority) => priority.id === event.priority).label);
    badge.dataset.priority = event.priority;
    meta.append(element('span', '', eventTime(event)), badge);
    card.append(meta, element('h3', 'event-title', event.title), element('p', 'event-category', event.category));
    if (event.notes) card.append(element('p', 'event-notes', event.notes));
    const actions = element('div', 'event-actions');
    const complete = element('button', 'text-button', event.completed ? '✓ Done · Undo' : 'Mark done');
    complete.type = 'button';
    complete.setAttribute('aria-label', `${event.completed ? 'Mark incomplete' : 'Mark done'}: ${event.title}`);
    complete.addEventListener('click', () => {
      event.completed = !event.completed;
      persist();
      render();
    });
    const edit = element('button', 'text-button', 'Edit');
    edit.type = 'button';
    edit.setAttribute('aria-label', `Edit ${event.title}`);
    edit.addEventListener('click', () => openEvent(event));
    actions.append(complete, edit);
    card.append(actions);
    return card;
  }

  function syncTimeFields() {
    const allDay = $('eventAllDay').checked;
    $('eventTimeFields').hidden = allDay;
    $('eventTime').disabled = allDay;
    $('eventTime').required = !allDay;
    $('eventEndTime').disabled = allDay;
    $('eventEndTime').min = !allDay ? $('eventTime').value : '';
    showEventReminders();
  }

  function openEvent(event) {
    $('eventForm').reset();
    $('eventError').hidden = true;
    populateCategories();
    $('eventId').value = event ? event.id : '';
    $('eventDialogTitle').textContent = event ? 'Edit event' : 'A new plan';
    $('eventTitle').value = event ? event.title : '';
    $('eventDate').value = event ? event.date : state.selected;
    $('eventAllDay').checked = event ? event.allDay : true;
    $('eventTime').value = event && event.time ? event.time : '09:00';
    $('eventEndTime').value = event ? event.endTime : '';
    $('eventPriority').value = event ? event.priority : 'normal';
    if (event) $('eventCategory').value = event.category;
    $('eventColor').value = event ? event.color : state.settings.accent;
    $('eventNotes').value = event ? event.notes : '';
    $('eventCompleted').checked = event ? event.completed : false;
    $('deleteEventButton').hidden = !event;
    syncTimeFields();
    $('eventDialog').showModal();
    $('eventTitle').focus();
  }

  function saveEvent(event) {
    event.preventDefault();
    $('eventError').hidden = true;
    try {
      const id = $('eventId').value;
      const candidate = Core.normalizeEvent({
        ...(id ? { id } : {}), title: $('eventTitle').value.trim(), date: $('eventDate').value,
        allDay: $('eventAllDay').checked, time: $('eventTime').value, endTime: $('eventEndTime').value,
        priority: $('eventPriority').value, category: $('eventCategory').value,
        color: $('eventColor').value, notes: $('eventNotes').value, completed: $('eventCompleted').checked,
      });
      const index = state.events.findIndex((item) => item.id === candidate.id);
      if (index === -1) state.events.push(candidate);
      else state.events[index] = candidate;
      state.selected = candidate.date;
      state.view = 'month';
      const date = Core.parseDate(candidate.date);
      state.month = date.getMonth();
      state.year = date.getFullYear();
      // A saved event should be immediately visible, even after a filtered search.
      $('searchInput').value = '';
      $('priorityFilter').value = 'all';
      $('categoryFilter').value = '';
      const saved = persist();
      $('eventDialog').close();
      render();
      if (saved) notify(id ? 'Event updated.' : 'Event added.');
    } catch (error) {
      reportError(error.message || 'Please check the event details.');
    }
  }

  function changeMonth(direction) {
    const date = Core.parseDate(`${String(state.year).padStart(4, '0')}-${String(state.month + 1).padStart(2, '0')}-01`);
    date.setMonth(date.getMonth() + direction);
    if (date.getFullYear() < 1 || date.getFullYear() > 9999) return;
    state.month = date.getMonth();
    state.year = date.getFullYear();
    state.selected = Core.dateKey(date);
    render();
  }

  function openSettings() {
    const settings = state.settings;
    $('settingsError').hidden = true;
    $('settingName').value = settings.name;
    $('settingTheme').value = settings.theme;
    $('settingAccent').value = settings.accent;
    $('settingWeekStart').value = String(settings.weekStart);
    $('settingTimeFormat').value = settings.timeFormat;
    $('settingDensity').value = settings.density;
    $('settingDockSide').value = settings.dockSide;
    $('settingCategories').value = settings.categories.join(', ');
    $('settingNotifications').checked = settings.notifications;
    if (window.desktopCalendar && window.desktopCalendar.reminderStatus) {
      window.desktopCalendar.reminderStatus().then((status) => {
        if (!status) return;
        showReminderStatus(status);
        $('settingStartAtLogin').checked = status.startAtLogin;
      }).catch(() => notify('Could not read reminder settings.'));
    }
    $('settingsDialog').showModal();
  }

  async function saveSettings(event) {
    event.preventDefault();
    $('settingsError').hidden = true;
    try {
      const settings = Core.sanitizeSettings({
        name: $('settingName').value.trim(), theme: $('settingTheme').value,
        accent: $('settingAccent').value, weekStart: Number($('settingWeekStart').value),
        timeFormat: $('settingTimeFormat').value, density: $('settingDensity').value,
        dockSide: $('settingDockSide').value,
        notifications: $('settingNotifications').checked,
        categories: [...new Set($('settingCategories').value.split(',').map((value) => value.trim()).filter(Boolean))],
      });
      if (desktopStatus && desktopStatus.startupSupported &&
          $('settingStartAtLogin').checked !== desktopStatus.startAtLogin) {
        const changed = await window.desktopCalendar.setStartAtLogin($('settingStartAtLogin').checked);
        if (!changed) throw new Error('Could not change Start with Windows. Please try again.');
        desktopStatus.startAtLogin = $('settingStartAtLogin').checked;
      }
      state.settings = settings;
      const saved = persist();
      applySettings();
      render();
      $('settingsDialog').close();
      if (saved) notify('Your calendar, your way. Settings saved.');
    } catch (error) {
      reportError(error.message || 'Please check the settings.');
    }
  }

  function download(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = element('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importBackup(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      notify('This backup is too large. Choose a JSON file under 20 MB.');
      return;
    }
    try {
      const imported = Core.validateBackup(JSON.parse(await file.text()));
      if (!window.confirm(`Replace your current events, written plans, and settings with ${imported.events.length} imported events and ${Object.keys(imported.plans).length} days of writing? Export a backup first if you want to keep your current calendar.`)) return;
      state.events = imported.events;
      state.plans = imported.plans;
      state.settings = imported.settings;
      state.storageBlocked = false;
      $('searchInput').value = '';
      $('priorityFilter').value = 'all';
      $('categoryFilter').value = '';
      const saved = persist();
      applySettings();
      render(true);
      if (saved) notify(`${imported.events.length} events imported.`);
    } catch (error) {
      notify('Import failed: ' + (error.message || 'Invalid calendar backup.'));
    }
  }

  function updateClock() {
    const now = new Date();
    $('liveClock').textContent = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: state.settings.timeFormat === '12' });
    $('liveDate').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    if (today() !== displayedToday) {
      displayedToday = today();
      render();
    }
  }

  function bind() {
    $('newEventButton').addEventListener('click', () => openEvent());
    $('addDayEvent').addEventListener('click', () => openEvent());
    $('eventForm').addEventListener('submit', saveEvent);
    $('eventCancel').addEventListener('click', () => $('eventDialog').close());
    $('eventAllDay').addEventListener('change', syncTimeFields);
    $('eventTime').addEventListener('change', syncTimeFields);
    $('eventPriority').addEventListener('change', showEventReminders);
    $('deleteEventButton').addEventListener('click', () => {
      const id = $('eventId').value;
      const event = state.events.find((item) => item.id === id);
      if (!event || !window.confirm(`Delete “${event.title}”?`)) return;
      state.events = state.events.filter((item) => item.id !== id);
      const saved = persist();
      $('eventDialog').close();
      populateCategories();
      render();
      if (saved) notify('Event deleted.');
    });
    $('prevMonth').addEventListener('click', () => changeMonth(-1));
    $('nextMonth').addEventListener('click', () => changeMonth(1));
    $('todayButton').addEventListener('click', () => {
      const date = new Date();
      state.selected = Core.dateKey(date);
      state.month = date.getMonth();
      state.year = date.getFullYear();
      render();
    });
    $('viewMonth').addEventListener('click', () => { state.view = 'month'; render(); });
    $('viewAgenda').addEventListener('click', () => { state.view = 'agenda'; render(); });
    $('viewWeek').addEventListener('click', () => { state.view = 'week'; render(); });
    $('searchInput').addEventListener('input', render);
    $('priorityFilter').addEventListener('change', render);
    $('categoryFilter').addEventListener('change', render);
    $('settingsButton').addEventListener('click', openSettings);
    $('settingsCancel').addEventListener('click', () => $('settingsDialog').close());
    $('settingsForm').addEventListener('submit', saveSettings);
    $('testNotificationButton').addEventListener('click', async () => {
      const button = $('testNotificationButton');
      button.disabled = true;
      try {
        const shown = await window.desktopCalendar.testNotification();
        notify(shown ? 'Test notification sent. Check your Windows notifications.'
          : 'Notification could not be shown. Check Windows Settings → System → Notifications → Clawlinder.');
      } catch { notify('Could not send the test notification.'); }
      finally { button.disabled = false; }
    });
    $('exportButton').addEventListener('click', () => {
      download(`clawlinder-backup-${today()}.json`, JSON.stringify(backup(), null, 2), 'application/json');
      notify('Backup exported. Keep it somewhere safe.');
    });
    $('exportICSButton').addEventListener('click', () => {
      download('clawlinder.ics', Core.toICS(state.events), 'text/calendar;charset=utf-8');
      notify('Events exported. Use a JSON backup to include your written plans.');
    });
    $('importInput').addEventListener('change', importBackup);
    $('popoutButton').addEventListener('click', () => {
      const width = 410;
      const left = state.settings.dockSide === 'left' ? 0 : Math.max(0, screen.availWidth - width);
      const url = new URL(location.href);
      url.searchParams.delete('view');
      const opened = window.open(url.href, 'clawlinder-sidebar', `popup=yes,width=${width},height=${Math.min(950, screen.availHeight)},left=${left},top=0`);
      if (!opened) notify('Allow this page to open a popup window, then try again.');
    });
    $('fullPageButton').addEventListener('click', () => setLayout('full'));
    $('expandCalendarButton').addEventListener('click', () => setLayout('full'));
    $('sidebarViewButton').addEventListener('click', () => setLayout('sidebar'));
    if (window.desktopCalendar) {
      document.documentElement.dataset.desktop = 'true';
      $('desktopReminderSettings').hidden = false;
      $('browserReminderHelp').hidden = true;
      $('pinSidebarButton').hidden = false;
      $('pinSidebarButton').setAttribute('aria-pressed', 'true');
      $('pinSidebarButton').addEventListener('click', async () => {
        try {
          const nextPinned = !desktopPinned;
          const changed = await window.desktopCalendar.setPinned(nextPinned);
          if (!changed) throw new Error('Desktop window rejected pin change.');
          desktopPinned = nextPinned;
          $('pinSidebarButton').setAttribute('aria-pressed', String(desktopPinned));
          $('pinSidebarButton').textContent = desktopPinned ? 'Unpin sidebar' : 'Keep on top';
        } catch { notify('Could not change the desktop window setting.'); }
      });
      $('pinSidebarButton').textContent = 'Unpin sidebar';
    }
    mediaTheme.addEventListener('change', () => { if (state.settings.theme === 'system') applySettings(); });
    window.addEventListener('storage', (event) => {
      if (event.key !== STORAGE_KEY || !event.newValue || state.storageBlocked) return;
      try {
        const saved = Core.validateBackup(JSON.parse(event.newValue));
        state.events = saved.events;
        state.plans = saved.plans;
        // Keep an active writing draft while incorporating other days from another window.
        for (const [key, entry] of weeklyCards) {
          if (document.activeElement === entry.input) {
            if (entry.input.value === '') delete state.plans[key];
            else state.plans[key] = entry.input.value;
          }
        }
        state.settings = saved.settings;
        syncDesktopReminders();
        applySettings();
        render();
        if ($('eventDialog').open || $('settingsDialog').open) reportError('Calendar updated in another window. Your open form is preserved; saving will apply your edits.');
      } catch (error) { notify('Another tab saved invalid data. Export a backup of your current calendar.'); }
    });
  }

  load();
  document.documentElement.dataset.layout = new URL(location.href).searchParams.get('view') === 'full' ? 'full' : 'sidebar';
  bind();
  applySettings();
  render();
  syncDesktopReminders();
  setInterval(updateClock, 1000);
  if ('serviceWorker' in navigator && ['http:', 'https:'].includes(location.protocol)) {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // The calendar still works when a browser does not permit offline caching.
    });
  }
})();
