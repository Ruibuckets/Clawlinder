# Clawlinder tests

Run `npm test` from the project root.

The tests cover calendar dates, saved plans, events, simulated browser interactions, and the desktop wrapper. They do not require installing Electron.

Reminder tests cover exact importance milestones, DST, all-day timing, duplicates across restarts, sleep recovery, edits, deletion/completion, opt-out, IPC validation, notification failures, tray behavior, and optional Windows startup. OS notification delivery still depends on the installed app's Start menu shortcut and Windows notification settings; these tests simulate the OS APIs.
