# Google Calendar and Tasks Sync

Keep your Obsidian notes in sync with **Google Calendar** and **Google Tasks** — on desktop and mobile.

This plugin is for people who like planning in Markdown but still want their calendar and task list available everywhere Google works.

## What it syncs

- 📅 Google Calendar events become notes in **`events/`**.
- ✅ Google Tasks become notes in **`tasks/`**.
- Editing an imported note (one with a `googleId`) updates the Google item — change fields, complete/uncomplete tasks, link tasks to events.
- Past events and old tasks can be tidied into archive/overdue/completed folders.

## Important sync model

Google is the **source of truth for existence** — the plugin can never create or delete anything in your Google account:

- **Google → Obsidian:** import creates and updates notes (manual via **Import events and tasks from Google**, or optionally on startup).
- **Obsidian → Google:** edits to notes that already have a `googleId` are pushed as updates while Obsidian is open (toggleable). Notes without a `googleId` are local-only; deleting or renaming a note never touches Google.
- **Per-note opt-out:** set `syncDirection: pull-only` in a note's frontmatter to stop its edits from pushing to Google (imports still update it).

## Import settings

When pulling from Google (manual import or import-on-startup), these settings keep the volume sane and stop your vault filling with thousands of notes:

- **Import window — days past / days ahead:** only events inside this window are imported. Defaults are **7 days past** and **90 days ahead**. Recurring events are expanded into one note per occurrence, so a wide window pulls a lot of notes — widen it deliberately.
- **Recurring event filter:** controls which repeating events (lectures, standups, weekly 1:1s) get imported. One-off events are always imported.
    - **Allowlist** (default): import only recurring events whose title matches one of your patterns. An **empty allowlist imports no recurring events** — this is the strict default, so add titles to opt them in.
    - **Blocklist:** import every recurring event _except_ those whose title matches. An empty blocklist imports them all.
- **Recurring event titles:** one title per line, with `*` as a wildcard (e.g. `Weekly*`, `Standup*`). Used by whichever mode is selected above. Matching is case-insensitive.

These only affect what is _imported from_ Google.

## Install

### From Obsidian Community Plugins

1. Open Obsidian.
2. Go to **Settings → Community plugins**.
3. Turn off **Restricted mode** if needed.
4. Select **Browse**.
5. Search for **Google Calendar and Tasks Sync**.
6. Select **Install**, then **Enable**.

### Manual install (GitHub release)

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest GitHub release.
2. In your vault, create:

    ```text
    .obsidian/plugins/google-sync/
    ```

3. Put the three downloaded files in that folder.
4. Restart Obsidian.
5. Go to **Settings → Community plugins** and enable **Google Calendar and Tasks Sync**.

## First-time setup

The plugin needs your own Google OAuth client. This avoids any shared hosted backend and keeps Google tokens in your vault’s local plugin data.

Follow the full guide here:

- [Google setup guide](https://github.com/Cordedmink2/obsidian-google-sync/blob/main/docs/google-setup.md)

Short version:

1. Create or choose a Google Cloud project.
2. Enable **Google Calendar API** and **Google Tasks API**.
3. Configure the OAuth consent screen.
4. Host the tiny redirect bridge page included in this repo.
5. Create a **Web application** OAuth client.
6. Paste the client ID, client secret, and bridge URL into the plugin settings.
7. Run **Connect to Google** from Obsidian’s command palette.
8. Run **Validate setup**.

For iPhone/iPad setup and checks, use:

- [iOS checklist](https://github.com/Cordedmink2/obsidian-google-sync/blob/main/docs/ios-checklist.md)

## Optional: Templater workflow (recommended)

If you use the **Templater** community plugin, you can auto-insert valid event/task frontmatter when creating new notes.

- Full guide: [Templater setup](https://github.com/Cordedmink2/obsidian-google-sync/blob/main/docs/templater-setup.md)
- Quick install link: `obsidian://show-plugin?id=templater-obsidian`
- One-command scaffold:

```bash
./scripts/setup-templater.sh /path/to/your/vault --configure-templater
```

This creates event/task templates and can auto-configure Templater’s template folder + trigger-on-create setting.

Then add folder mappings in Obsidian Templater:

- `events` → `templates/google-sync/event-template.md`
- `tasks` → `templates/google-sync/task-template.md`

Quick smoke test from terminal:

```bash
./scripts/verify-setup.sh /path/to/your/vault
./scripts/bootstrap-sample-notes.sh /path/to/your/vault
```

Screenshot walkthrough: [Templater setup screenshots](https://github.com/Cordedmink2/obsidian-google-sync/tree/main/docs/assets/templater)

## Commands

Open Obsidian’s command palette and search for these commands:

- **Connect to Google** — sign in once and store Google tokens in the plugin data file.
- **Sync now** — push matching Obsidian notes to Google.
- **Import events and tasks from Google** — pull Google items into your vault. By default it only imports the configured calendar and task list, within the import window, to avoid vault spam. Recurring events are filtered by the allowlist/blocklist (see [Import settings](#import-settings)).
- **Run lifecycle scan** — move past events to `events/archive/`, overdue tasks to `tasks/overdue/`, and completed tasks to `tasks/completed/`.
- **Test connection** — quick Google connectivity check.
- **Validate setup** — checks OAuth settings, Google connection, selected calendar, and selected task list.
- **Disconnect from Google** — remove stored Google tokens.

## Folder layout

The defaults are:

```text
events/
events/archive/
tasks/
tasks/overdue/
tasks/completed/
```

You can change the folder names in plugin settings before you start syncing.

## Event note example

An imported event note under `events/` looks like this — edit any of these fields and the change is pushed to the Google event:

```yaml
---
title: Coffee with Alex
date: 2026-06-02T10:00
end: 2026-06-02T11:00
timezone: Pacific/Auckland
location: Wellington
description: Catch-up about Q3 plan
status: confirmed
visibility: default
transparency: opaque # opaque = busy, transparent = free
eventType: meeting
color: "7" # Google Calendar colorId (1-11)
guestsCanInviteOthers: true
guestsCanModify: false
guestsCanSeeOtherGuests: true
reminders:
    useDefault: false
    overrides:
        - method: popup
          minutes: 10
attendees:
    required:
        - alex@example.com
    optional:
        -
recurrence: RRULE:FREQ=WEEKLY;BYDAY=MO # or a YAML list of RRULE/EXDATE/RDATE lines
---
Notes for myself stay here, in Obsidian.
```

`recurrence` accepts either a single rule string or a YAML list when you need exceptions, e.g.:

```yaml
recurrence:
    - RRULE:FREQ=WEEKLY;BYDAY=MO
    - EXDATE;TZID=Pacific/Auckland:20260615T100000
```

### More event fields

- **Google Meet:** add `conferencing: true` and the plugin asks Google to create a Meet link on the next sync, then writes the resolved URL back into a read-only `meetLink` field.
- **Detailed attendees:** instead of the `required`/`optional` email lists, you can use a YAML list of objects to see and set response status, names, organizer/resource flags. Imported events use this richer form automatically when Google sends that detail:

    ```yaml
    attendees:
        - email: alex@example.com
          displayName: Alex
          responseStatus: accepted # needsAction | declined | tentative | accepted
          organizer: true
        - email: room-3@resource.calendar.google.com
          resource: true
    ```

- **Attachments:** a `attachments` list of `{ fileUrl, title, mimeType }` (Google requires Drive file URLs).
- **Source:** a `source: { title, url }` linking the event back to where it came from.
- **transparency:** `opaque` (busy) or `transparent` (free).

The import writes a `googleId` field into the frontmatter. Leave that field alone; it is how the plugin knows which Google event belongs to the note — and only notes that have one push updates.

## Task note example

An imported task note under `tasks/` looks like this:

```yaml
---
title: Buy milk
due: 2026-06-01 # deadline (Google Tasks honours the date only)
completed: false
notes: 2% organic, two cartons # the task's details/notes in Google Tasks
---
Free-form note body stays in Obsidian and is not synced.
```

`notes` maps to the native Google Tasks **details** field (the body of the note is kept locally and not synced). `due` maps to the native **deadline**. Set `completed: true` and sync to mark the task completed in Google Tasks. With **Auto-archive past events** on, completing a task also files it into `tasks/completed/` straight away — you no longer have to wait for the periodic lifecycle scan.

### Subtasks

Google Tasks supports one level of nesting. To make a task a subtask, add a `parent` wikilink pointing at the parent task note:

```yaml
---
title: Pick up the car
parent: "[[Renew registration]]"
---
```

On sync the plugin nests it under the parent in Google Tasks (both notes must be linked to Google, i.e. have a `googleId`). Subtasks imported from Google get their `parent` wikilink written back automatically.

## Linking tasks to events

You can link task notes to an event so they are completed in Google Tasks automatically when the event passes (and gets archived). On the **event** note, add a `tasks:` list:

```yaml
tasks:
    - "[[Pack bags for malaysia]]"
    - "[[Buy travel adapter]]"
```

Entries can be Obsidian wikilinks (so they also show up in the graph) or plain note basenames — both work. When the event is archived (its date is more than the configured days in the past), each linked task is marked completed in Google Tasks. Requires **Auto-archive past events** and **Auto-close linked tasks on archive** to be on.

## Obsidian-friendly notes

- Notes use standard YAML frontmatter (Obsidian **Properties**) plus a Markdown body, so wiki links, tags, and embeds work normally.
- **Importing from Google is non-destructive to your own metadata.** It updates only the fields it manages (title, date, due, etc.); the note body and any extra properties you add (tags, `[[wiki links]]`, your own fields, the event `tasks` list) are preserved across re-imports.

## Privacy and safety

- The plugin talks directly to Google Calendar and Google Tasks using Obsidian’s `requestUrl` API.
- It does not include analytics or telemetry.
- Google OAuth tokens are stored by Obsidian in the plugin’s vault-local `data.json`.
- Your OAuth client secret is also stored in plugin settings. Treat the vault’s `.obsidian/plugins/google-sync/data.json` as private.
- The plugin only manages notes inside the configured event/task folders.
- Startup Google import is off by default and additions-only when enabled.
- Full privacy details: [PRIVACY.md](https://github.com/Cordedmink2/obsidian-google-sync/blob/main/PRIVACY.md)
- Security reporting policy: [SECURITY.md](https://github.com/Cordedmink2/obsidian-google-sync/blob/main/SECURITY.md)

## Troubleshooting

- Run **Validate setup** first. It gives the clearest checklist of what is missing.
- If login does not return to Obsidian, check that your Google OAuth redirect URI exactly matches your hosted bridge URL.
- If a note does not sync, check that it is under the configured `events/` or `tasks/` folder and has the required frontmatter fields.
- If event times look wrong, add an explicit `timezone` such as `Pacific/Auckland`.
- Task `due` dates are date-only in Google Tasks. The plugin preserves the calendar date you set (no off-by-one in timezones ahead of UTC); upgrade to 0.1.13+ if "due tomorrow" ever showed as today.
- If imported notes get overwritten back to a template (e.g. `title: Event title`), see the Templater warning in the [Templater setup guide](https://github.com/Cordedmink2/obsidian-google-sync/blob/main/docs/templater-setup.md) — don't pair folder templates + trigger-on-creation with Import from Google. Re-running the import restores the real Google data into clobbered notes.
- Test with a spare Google calendar/task list before using important real data.

More developer and test notes:

- [Development guide](https://github.com/Cordedmink2/obsidian-google-sync/blob/main/docs/development.md)
- [Google setup guide](https://github.com/Cordedmink2/obsidian-google-sync/blob/main/docs/google-setup.md)
- [iOS checklist](https://github.com/Cordedmink2/obsidian-google-sync/blob/main/docs/ios-checklist.md)
- [Contributing](https://github.com/Cordedmink2/obsidian-google-sync/blob/main/CONTRIBUTING.md)
