# Templater setup for Google Sync

Templater can help you create consistent event/task notes, but it must not automatically run on notes imported by Google Sync.

## Important: avoid folder-template auto-runs on imported notes

Do not map Templater folder templates to Google Sync's managed `events/` or `tasks/` folders while **Trigger Templater on new file creation** is enabled.

Templater cannot tell who created a new file. A note imported by Google Sync and a note you create by hand both look like "a new file in `events/` or `tasks/`". If trigger-on-creation is enabled for those folders, Templater can immediately replace the imported note's real Google data with template defaults such as `title: Event title` or today's date.

Use one of these safe workflows instead:

1. **Manual template insertion**: keep trigger-on-creation off, create your own note, then run Templater's command to insert the event/task template.
2. **Separate draft folders**: use Templater folder templates only in folders Google Sync does not manage, such as `event-drafts/` or `task-drafts/`.
3. **No import workflow only**: use folder templates on `events/` and `tasks/` only if you never import from Google.

Recommended setting for vaults that import from Google:

```text
Trigger Templater on new file creation: Off
```

## Install Templater

- In Obsidian: **Settings → Community plugins → Browse**
- Search for **Templater** and install/enable it
- Quick link: `obsidian://show-plugin?id=templater-obsidian`

## Fast setup

From this repo, run:

```bash
./scripts/setup-templater.sh /path/to/your/vault
```

This creates, if missing:

- `templates/google-sync/event-template.md`
- `templates/google-sync/task-template.md`
- `templates/google-sync/README.md`
- `events/`
- `tasks/`

Optional: also set Templater's template folder and safe trigger setting:

```bash
./scripts/setup-templater.sh /path/to/your/vault --configure-templater
```

That updates or creates `.obsidian/plugins/templater-obsidian/data.json` with:

- `templates_folder: "templates"`
- `trigger_on_file_creation: false`

It does not configure folder-template mappings.

## Manual setup

1. Create `templates/google-sync/`.
2. Add the event and task templates below.
3. In **Templater settings**, set **Template folder location** to `templates`.
4. Leave **Trigger Templater on new file creation** off if you import from Google.
5. When you create a new note yourself, run Templater's insert-template command and choose the event or task template.

If you insist on automatic folder templates, map them only to draft folders that Google Sync does not write to, for example:

- `event-drafts` → `templates/google-sync/event-template.md`
- `task-drafts` → `templates/google-sync/task-template.md`

Do not map automatic templates to the same `events` and `tasks` folders used for Google imports.

## Event template

`templates/google-sync/event-template.md`:

```yaml
---
title: <% tp.file.title %>
date: <% tp.date.now("YYYY-MM-DD[T]09:00") %>
end: <% tp.date.now("YYYY-MM-DD[T]10:00") %>
timezone: Pacific/Auckland
location:
description:
status: confirmed
visibility: default
transparency: opaque # opaque = busy, transparent = free
eventType: meeting
color: # Google Calendar colorId (1-11)
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
        -
    optional:
        -
---
Notes:
    -
```

## Task template

`templates/google-sync/task-template.md`:

```yaml
---
title: <% tp.file.title %>
due: <% tp.date.now("YYYY-MM-DD") %>
completed: false
notes: # task details synced to Google Tasks
parent: # optional "[[Parent task]]" wikilink to nest as a subtask
---
Free-form body stays in Obsidian and is not synced.
```

## Smoke test

After setup, run:

```bash
./scripts/verify-setup.sh /path/to/your/vault
./scripts/bootstrap-sample-notes.sh /path/to/your/vault
```

Then in Obsidian:

1. Run **Push updates to Google**.
2. Confirm the sample event/task appear in Google.
3. Optionally mark the sample task `completed: true` and sync again.

## Notes

- The setup script does not overwrite existing template files.
- You can change timezone/defaults after generation.
- If your Google Sync folders are different, keep Templater's automatic folder templates out of those folders unless import is disabled.
