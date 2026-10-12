# Clawlinder

A customizable personal calendar for your computer, with a compact side window for easy access. It opens to seven blank daily planning spaces, starting today. The calendar uses plain HTML, CSS, and JavaScript; an optional Electron wrapper gives it a native desktop window that can stay above other apps. The browser version needs no packages or account.

## What you can do

- Type directly into the next seven days, starting today, with a casual handwriting font and automatic local saving. On Sunday, the planner runs from Sunday through Saturday.
- Write schedules in your own words, such as `7:00pm- 9:00pm, study SAT`, with multiple lines per day.
- Add, edit, delete, and complete events with a date, start/end time or all-day option, notes, category, color, and importance level.
- Switch between the seven-day planner, month calendar, and agenda; see today's date and a live clock.
- Search events and filter them by importance and category.
- Customize your calendar name, light/dark/system theme, accent color, week start, clock format, display density, screen side, and categories.
- Export a JSON backup containing daily plans, events, and settings; restore a JSON backup; or export structured events as an `.ics` calendar file.
- Use the installed app offline after its first successful load through a local server or HTTPS.

Events cover one day each. Recurring events, device sync, accounts, and reminders while the app is closed are future features.

## Run it on your computer

### Desktop side window

Install [Node.js](https://nodejs.org/), extract the project ZIP, and open a terminal in the extracted folder. Run:

```sh
npm install
npm start
```

The first command downloads the desktop dependencies; later launches need only `npm start`. The calendar opens in a narrow window on the right edge of your screen and stays above other windows. Use **Unpin sidebar / Keep on top** to change that behavior. Open **Make it yours → Screen side** to choose the left or right edge. You can also move and resize the window normally.

After updating the source files, close and reopen the desktop app with `npm start`. This planner update does not require reinstalling dependencies. Existing events and settings remain in local storage.

Press `Ctrl+Shift+Space` to hide or show the running calendar (`Command+Shift+Space` on macOS). The shortcut works only while the desktop app is running and can be unavailable if another app has registered it. Closing the window exits the app. It does not start automatically when your computer starts.

Desktop dependencies are pinned to [Electron 44.7.0](https://releases.electronjs.org/) and [electron-builder 26.15.3](https://www.npmjs.com/package/electron-builder?activeTab=versions), checked on October 12, 2026.

### Browser version

For a quick look, double-click `index.html`. For dependable browser storage and offline app support, use the local server below. The browser's sidebar layout gives you a compact view; the desktop wrapper supplies the native always-on-top behavior.

Use **Open sidebar window** to put the calendar in a small browser popup beside your work. Allow popups for the page if the browser blocks it. **Full calendar** or **Full** expands the calendar layout, and **Sidebar** switches back. **Make it yours → Screen side** selects the preferred left or right side. The browser controls popup placement, so it may adjust the requested position. Native pinning and the global shortcut are available in the desktop version.

If you have [Node.js](https://nodejs.org/), open a terminal in the extracted project folder and run:

```sh
node serve.cjs
```

Open the address printed in the terminal, normally `http://127.0.0.1:4173/`. If that port is busy, the server prints a different available port. Leave the terminal running while using the local site. Press `Ctrl+C` to stop it. This browser preview does not require `npm install`.

Direct `file://` access supports the basic calendar, but storage behavior depends on the browser and it does not enable the service worker or app installation. Use the same browser and address each time to return to the same saved calendar.

## Use and customize it

1. In **7 days**, type into any day's blank space. Plans save automatically as you type. Press Enter for another line, or resize a box to make more room.
2. Use your own wording, such as `7:00pm- 9:00pm, study SAT`. Text stays free-form; it does not become a timed event or trigger reminders. Clear a box to remove that day's plan.
3. The seven days roll forward with today's date. Earlier daily plans remain saved by date and are included in JSON backups.
4. For an event with importance, category, or a calendar export, choose **New event**, enter its details, and save. Switch to **Month** or **Agenda** to browse events, use search and filters, or edit and complete them.
5. Open settings to change the appearance and categories.
6. Export a JSON backup before moving the calendar to a different browser or address.

**Import replaces the current calendar, daily plans, and settings after confirmation.** It does not merge calendars. Export your current data first if you want to keep it. Backups from earlier versions still import; because they have no daily plans, importing one resets those spaces to blank. `.ics` export includes structured events for other calendar software; free-form daily plans are included only in JSON backups.

Calendar data stays in this browser's `localStorage`. Publishing the app shares its source code, not the events or plans you enter in it. Other visitors each have their own local calendar. Clearing site data, using a different browser profile, or switching from the local address to the published address creates an empty calendar unless you restore a backup. Save backups outside the project folder; JSON exports contain your event details and daily plans, and `.ics` exports contain your structured events.

The native desktop app has its own local storage, separate from your normal browser. Transfer events between the desktop and browser versions using JSON export/import.

To install the app, first open the published HTTPS site or the local server and let it finish loading. In a supported browser such as Chrome or Edge, use the browser's install-app control or menu. Browser wording and availability vary. The installed app uses the same local data as the corresponding site.

## Build a portable Windows app

On Windows, after `npm install`, run:

```sh
npm run dist
```

The builder produces a portable `.exe` inside `dist/` that you can launch without an installer. The first build may download packaging tools. This project includes the build configuration; a built executable is not included. The build is unsigned unless you configure code signing. Keep build outputs out of the source repository; if you distribute one later, attach it to a GitHub release.

## Publish on GitHub: browser method

You need a GitHub account. A public repository works with GitHub Pages on GitHub Free. ([GitHub Pages availability](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages))

1. On GitHub, choose **New repository**, name it `clawlinder`, and select **Public**. Leave the automatic README, license, and `.gitignore` options off because these files are included. Create the repository. ([Repository guide](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository))
2. Use the repository's upload-files link or **Add file → Upload files**. Upload the **contents of the extracted project folder**, including the `tests` folder. Do not upload the ZIP or put everything inside another `clawlinder` folder. `index.html` must be visible at the repository's top level. Commit the upload to `main`. ([Upload guide](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository))
3. Open **Settings → Pages**. Under **Build and deployment**, set **Source** to **Deploy from a branch**, choose **main** and **/(root)**, then **Save**. ([Publishing-source guide](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site))
4. When deployment completes, open `https://YOUR_USERNAME.github.io/clawlinder/`, replacing `YOUR_USERNAME` with your account name. The **Visit site** link appears in Pages settings. Publishing changes can take up to 10 minutes. ([Site guide](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site))

The included empty `.nojekyll` file skips Jekyll processing. If your upload picker omits this dotfile, you can create a file named `.nojekyll` in the repository; this plain app does not otherwise depend on Jekyll. ([GitHub static-site guidance](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site))

If the page is missing, check that `index.html` is at the root, the publishing branch is `main`, and the latest deployment completed in the **Actions** tab. Future commits to this publishing branch update the site automatically.

## Publish with Git instead

This alternative requires Git installed and configured, plus GitHub authentication. Follow [GitHub's Git setup guide](https://docs.github.com/en/get-started/git-basics/set-up-git). Create an empty GitHub repository as above, then run these commands **inside the extracted project folder**. Replace `YOUR_USERNAME` with your username:

```sh
git init -b main
git add .
git commit -m "Build Clawlinder"
git remote add origin https://github.com/YOUR_USERNAME/clawlinder.git
git push -u origin main
```

Then enable Pages using step 3 above. To publish later edits:

```sh
git add .
git commit -m "Update calendar"
git push
```

## Make it your own: how the code works

| File | What to change here |
| --- | --- |
| `index.html` | Page structure, buttons, form fields, and text |
| `styles.css` | Colors, fonts, spacing, and responsive layout; `.week-plan-input` controls the handwriting boxes |
| `calendar-core.js` | Event validation, rolling seven-day dates, daily plan and backup validation, and `.ics` export |
| `app.js` | Calendar and seven-day planner rendering, direct typing/autosave, user actions, settings, and local storage |
| `manifest.webmanifest` | Installed app name, icon references, and launch behavior |
| `sw.js` | Offline caching; change its cache version when cached app files change |
| `serve.cjs` | Optional local preview server |
| `desktop/main.cjs` | Native window size, screen-edge positioning, pin behavior, and shortcut |
| `desktop/preload.cjs` | Small bridge that lets the calendar choose its dock side and pin state |
| `package.json` | Desktop dependencies, launch commands, and portable Windows build settings |
| `tests/core.test.cjs` | Automated checks for calendar logic |
| `tests/desktop-wrapper.test.cjs` | Simulated native window, shortcut, and IPC behavior |
| `tests/ui-smoke.test.cjs` | Simulated browser UI, storage, forms, imports, and layout controls |

Start by changing labels or CSS and refreshing the page. For a new event field, add an input in `index.html`, save/read it in `app.js`, and update validation and backup handling in `calendar-core.js`. Try changes with a few test events and check that exporting and importing preserves them.

Run all included checks with Node.js; this does not require installing Electron:

```sh
node --test
```

These tests check calendar logic and simulate the browser UI and native wrapper, including seven-day date rollovers, typing and restoring daily plans, event editing, storage, imports, layout controls, dock/pin actions, sender validation, the shortcut, and single-instance behavior. A simulated UI check does not replace verifying rendering and keyboard behavior in a real browser. The Windows executable has not been built.

Useful next projects are recurring events, drag-to-move scheduling, and an optional sync service. These need additional design and code; they are not included in this version. GitHub Pages hosts the browser version; GitHub stores the desktop source, which you run or package locally.

## License

MIT — see [LICENSE](LICENSE).
