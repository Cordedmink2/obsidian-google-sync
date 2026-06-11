# Field reference & worked examples

All bodies use the friendly field names below (the CLI maps them to the Google API).
Power users can bypass the mapping with `--raw` and send a verbatim
[Calendar event resource](https://developers.google.com/calendar/api/v3/reference/events)
or [Tasks resource](https://developers.google.com/tasks/reference/rest/v1/tasks) body.

## Event fields

| Field | Type | Notes |
| --- | --- | --- |
| `title` | string | Required on create. Maps to `summary`. |
| `date` | ISO datetime/date | Start. Required on create. `2026-06-18T10:00` or `2026-06-18` with `allDay`. |
| `end` | ISO datetime/date | Optional; all-day events default to the next day. |
| `allDay` | boolean | Use date-only `date`/`end`. |
| `timezone` | IANA string | e.g. `Pacific/Auckland`; defaults to the config timezone. |
| `location` | string | Free text. |
| `description` | string | Supports basic HTML in Google UIs. |
| `status` | string | `confirmed` \| `tentative` \| `cancelled` (cancelling via update is the closest thing to delete). |
| `visibility` | string | `default` \| `public` \| `private` \| `confidential`. |
| `transparency` | string | `opaque` (busy) \| `transparent` (free). |
| `color` | string | Google colorId `"1"`–`"11"`. |
| `eventType` | string | Free-form label (stored in the event's private extended properties; round-trips to vault notes). |
| `attendees` | object or array | Simple: `{ "required": [emails], "optional": [emails] }`. Detailed: array of `{ email, displayName?, optional?, responseStatus?, comment?, additionalGuests? }`. |
| `recurrence` | string or string[] | RRULE/EXDATE/RDATE lines, e.g. `"RRULE:FREQ=DAILY;COUNT=5"`. |
| `conferencing` | boolean | `true` requests a Google Meet link; read it back from `hangoutLink` in the response. |
| `reminders` | object | `{ "useDefault": bool, "overrides": [{ "method": "popup"\|"email", "minutes": n }] }`. |
| `guestsCanInviteOthers` / `guestsCanModify` / `guestsCanSeeOtherGuests` | boolean | Guest permissions. |
| `attachments` | array | `{ fileUrl, title?, mimeType? }` — Google Drive URLs only. |
| `source` | object | `{ title?, url? }` back-link shown in Calendar. |

Flag, not field: `--send-updates all|externalOnly|none` controls invitation/update emails.

## Task fields

| Field | Type | Notes |
| --- | --- | --- |
| `title` | string | Required on create. |
| `notes` | string | The task's details/description. |
| `due` | ISO date | Google honors the date part only. |
| `completed` | boolean | Or set `status` directly (`needsAction` \| `completed`). |

Nesting/ordering travel via flags (`--parent`, `--previous`), not the body — that is how
the Google API works.

## Worked examples

Invite people to a new event and email them:

```bash
node scripts/google.cjs events create --send-updates all --json '{
  "title": "Design review", "date": "2026-06-19T14:00", "end": "2026-06-19T15:00",
  "attendees": [
    { "email": "alex@example.com", "displayName": "Alex" },
    { "email": "sam@example.com", "optional": true }
  ]
}'
```

Create a weekly recurring event with a Meet link and a 10-minute popup reminder:

```bash
node scripts/google.cjs events create --json '{
  "title": "Team standup", "date": "2026-06-15T09:15", "end": "2026-06-15T09:30",
  "recurrence": "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR",
  "conferencing": true,
  "reminders": { "useDefault": false, "overrides": [{ "method": "popup", "minutes": 10 }] }
}'
```

Reschedule an event and mark it tentative (PATCH — only send what changes):

```bash
node scripts/google.cjs events update abc123def --json '{
  "date": "2026-06-20T11:00", "end": "2026-06-20T12:00", "status": "tentative"
}'
```

Set an event's type and color:

```bash
node scripts/google.cjs events update abc123def --json '{ "eventType": "deep-work", "color": "9" }'
```

Add an all-day event:

```bash
node scripts/google.cjs events create --json '{ "title": "Public holiday", "date": "2026-06-22", "allDay": true }'
```

Create a task with details and a deadline, then complete / uncomplete it:

```bash
node scripts/google.cjs tasks create --json '{ "title": "Renew passport", "due": "2026-07-01", "notes": "Bring old passport + photos" }'
node scripts/google.cjs tasks complete  <taskId>
node scripts/google.cjs tasks uncomplete <taskId>
```

Make a task a subtask of another, then promote it back:

```bash
node scripts/google.cjs tasks move <childId> --parent <parentId>
node scripts/google.cjs tasks move <childId>
```

Change a task's title/notes/due in one call:

```bash
node scripts/google.cjs tasks update <taskId> --json '{ "title": "Renew passports (both)", "due": "2026-07-15" }'
```

Find ids when you don't know them:

```bash
node scripts/google.cjs events list --days-ahead 14   # then match on summary
node scripts/google.cjs tasks list                    # then match on title
```
