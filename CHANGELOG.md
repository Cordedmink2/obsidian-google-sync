## 0.3.14

- Added: a time of day on a task's `due` (`due: 2026-06-01T14:00`) is now kept. Previously
  an import silently truncated it back to the date. Google Tasks stores a date only, so the
  time stays in your vault and never reaches Google; if Google moves the date, the time
  moves with it, and the task counts as overdue from that time rather than from midnight.
- Fixed: lifecycle auto-close now completes a linked task in the task list the note was
  imported from, instead of always patching the default list (which 404'd for tasks from
  other lists).
- Fixed: calendar and task-list listings now follow `nextPageToken`, so accounts with many
  calendars/lists no longer silently miss entries in imports and settings pickers.
- Fixed: a malformed OAuth token response can no longer be persisted as a broken
  "connected" session.
- Fixed: renames now respect the "Push local edits to Google" toggle and the plugin's own
  write-suppression window, like create/modify events already did.
- Fixed: non-numeric import-window day counts no longer abort the whole event import.
- Internal: headless tooling now uses plain `node:` imports instead of an obfuscated module
  loader; stale committed `dist/` bundles removed (build with `npm run build:headless`).
- Internal: CI now enforces formatting, release-metadata consistency, the mobile-safe
  runtime-bundle check, and the headless smoke test; releases verify the tag matches
  `manifest.json` and run unit tests before publishing.

## 0.3.1

- Community cache refresh patch.
