---
name: google-tasks-calendar
description: Create, read, and update Google Calendar events and Google Tasks — list/reschedule/complete/uncomplete tasks, set task details, create one-off or recurring events, invite attendees, request Google Meet links, set reminders/colors/visibility, nest subtasks. Use when the user asks about their calendar, schedule, meetings, events, tasks, or todos. Deleting is intentionally not supported.
---

# Google Tasks & Calendar

Drive Google Calendar and Google Tasks through `scripts/google.cjs` (Node ≥ 20, bundled,
no install). Everything is create/read/update — **there are no delete commands**; if the
user asks to delete something, say you can't and offer to cancel-by-updating instead
(e.g. mark a task completed, set an event's `status` to `cancelled`).

## Running it

```bash
node <this-skill-dir>/scripts/google.cjs <group> <command> [id] [flags]
```

Configuration resolves in this order: `--config <file>` flag → `GSYNC_CONFIG` env var →
`~/.config/gsync/gsync.json`. All commands print JSON to stdout; failures print
`{"error": {...}}` to stderr and exit non-zero — read the error body, it usually says
exactly what Google rejected.

If a command fails with `not authorized`, tell the user to run
`node <this-skill-dir>/scripts/authorize.cjs --config <their config>` once (see setup
at the end).

## Commands

```text
calendars list                      # discover calendar ids
tasklists list                      # discover task list ids

events list      [--calendar <id>] [--days-past N] [--days-ahead N]
events get       <eventId>  [--calendar <id>]
events create    --json '<event>'  [--calendar <id>] [--send-updates all|externalOnly|none]
events update    <eventId> --json '<changed fields>' [--calendar <id>] [--send-updates ...]

tasks list       [--tasklist <id>]
tasks get        <taskId>   [--tasklist <id>]
tasks create     --json '<task>' [--tasklist <id>] [--parent <taskId>] [--previous <taskId>]
tasks update     <taskId> --json '<changed fields>' [--tasklist <id>]
tasks complete   <taskId>   [--tasklist <id>]
tasks uncomplete <taskId>   [--tasklist <id>]
tasks move       <taskId> [--parent <taskId>] [--previous <taskId>]   # nest/reorder
```

`--json -` reads the body from stdin (use for large payloads). Updates are PATCH
semantics: send only the fields to change. Defaults for `--calendar`/`--tasklist` come
from the config file.

## Event JSON (full field list + examples: see reference.md)

```json
{
    "title": "Quarterly planning",
    "date": "2026-06-18T10:00",
    "end": "2026-06-18T11:30",
    "timezone": "Pacific/Auckland",
    "allDay": false,
    "location": "Room 3",
    "description": "Agenda: …",
    "attendees": { "required": ["alex@example.com"], "optional": ["sam@example.com"] },
    "recurrence": "RRULE:FREQ=WEEKLY;BYDAY=TH",
    "conferencing": true,
    "reminders": { "useDefault": false, "overrides": [{ "method": "popup", "minutes": 10 }] },
    "eventType": "planning",
    "color": "7",
    "visibility": "private",
    "transparency": "opaque",
    "status": "confirmed"
}
```

- `title` + `date` are required on create; everything else is optional.
- **Invite people**: `attendees` (simple lists above, or detailed objects with
  `displayName`/`responseStatus`/`optional`/`comment`/`additionalGuests` — see
  reference.md). Add `--send-updates all` so Google emails the invitations.
- **Recurring on creation**: `recurrence` takes an RRULE string or a list of
  RRULE/EXDATE/RDATE lines.
- **Google Meet**: `"conferencing": true` — the response contains the new link in
  `hangoutLink`.
- **Event type**: `eventType` is a free-form label; `color` is a Google colorId "1"–"11".

## Task JSON

```json
{
    "title": "Book flights",
    "due": "2026-06-20",
    "notes": "NZ → MEL, check baggage allowance",
    "completed": false
}
```

- `title` required on create. `notes` is the task's details/description field.
- `due` is date-only in Google Tasks (time parts are ignored by Google).
- **Subtasks**: create with `--parent <taskId>`, or re-nest later with
  `tasks move <id> --parent <parentId>` (omit `--parent` to promote to top level).

## Obsidian vault interplay (when the user also syncs a vault)

Notes under the vault's `events/`/`tasks/` folders mirror these items (`googleId` in the
note's frontmatter ties them together). Anything you change via this CLI flows into the
vault on the next sync. To make an event auto-complete tasks when it ends, edit the
**event note's** frontmatter `tasks:` list with wikilinks to task notes — that linkage
lives in the vault, not in Google.

## One-time setup (tell the user, don't do it silently)

1. Create `~/.config/gsync/gsync.json` with at least
   `{"settings": {"clientId": "…", "clientSecret": "…", "taskListId": "…"}}`
   (same Google OAuth client as their Obsidian plugin; full reference in the repo's
   `docs/headless.md`).
2. Register `http://127.0.0.1:8765/callback` as a redirect URI on that OAuth client.
3. Run `node <this-skill-dir>/scripts/authorize.cjs --config ~/.config/gsync/gsync.json`
   and finish the browser consent.
