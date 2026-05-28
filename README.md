# Google Calendar & Tasks Sync for Obsidian

Keep your Obsidian notes in sync with **Google Calendar** and **Google Tasks** — on your
computer *and* your iPhone.

Write notes the way you normally would. The plugin watches two folders in your vault and
mirrors them to Google for you:

- 📅 Notes in **`events/`** become Google Calendar events.
- ✅ Notes in **`tasks/`** become Google Tasks.

Edit a note, the event updates. Delete the note, the event goes away. Tick a task off,
Google Tasks marks it done.

## What it does

- **Events** — title, date/time, all-day, time zone, location, attendees, and recurring
  events all sync to Google Calendar.
- **Tasks** — title, due date, notes, and completion sync to Google Tasks.
- **Tidies up after itself** — once a day it moves past events to `events/archive/`,
  overdue tasks to `tasks/overdue/`, and finished tasks to `tasks/completed/` so your
  active folders stay clean.
- **Works on iPhone** — same flow as desktop, including the Google sign-in.
- **Plays nicely with Google** — backs off and retries when Google is busy, so you don't
  get errored out.

## Getting started

1. Install the plugin into your vault.
2. Connect it to your Google account — the one-time setup is in
   [docs/google-setup.md](docs/google-setup.md).
3. In Obsidian, run **Connect to Google** and approve in the browser.
4. Make a note in `events/` or `tasks/`, then run **Sync now**.

On iPhone, the extra checklist is in [docs/ios-checklist.md](docs/ios-checklist.md).

## Commands you'll use

Open Obsidian's command palette and search for:

- **Connect to Google** — sign in (do this once).
- **Sync now** — push your latest changes to Google.
- **Import events and tasks from Google** — pull events/tasks from your configured Google Calendar and Google Tasks list into your vault folders. By default it only imports the configured calendar/list to avoid vault spam; turn off the import-only toggles if you intentionally want every visible calendar/task list. It runs the lifecycle tidy-up immediately afterwards, so imported past events go to `events/archive/` and imported overdue/completed tasks go to `tasks/overdue/` or `tasks/completed/`. You can enable **Import from Google on startup** if you want this to run automatically when Obsidian opens; it is off by default and only creates new additions, leaving existing imported notes untouched.
- **Run lifecycle scan** — archive past events and tidy completed/overdue tasks.
- **Test connection** — quick check that Google is reachable.
- **Validate setup** — confirms your settings, calendar, and task list all work.
- **Disconnect from Google** — sign out.

## How a note becomes an event or task

The plugin reads the **frontmatter** at the top of each note (the bit between `---`
fences). The body of the note stays in Obsidian — only the frontmatter syncs.

**Event** (`events/my-meeting.md`):

```yaml
---
title: Coffee with Alex
date: 2026-06-02T10:00
end: 2026-06-02T11:00
timezone: Pacific/Auckland
location: Wellington
attendees:
    - alex@example.com
---
Notes for myself stay here, in Obsidian.
```

**Task** (`tasks/buy-milk.md`):

```yaml
---
title: Buy milk
due: 2026-06-01
completed: false
---
```

After the first sync, a `googleId` field appears in the frontmatter — that's how the
plugin knows which Google event/task this note belongs to. Leave it alone.

## For developers

Toolchain, build scripts, tests, and architecture notes live in
[docs/development.md](docs/development.md).
