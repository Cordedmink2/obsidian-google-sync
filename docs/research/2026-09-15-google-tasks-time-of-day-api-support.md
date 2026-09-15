---
title: Can any first-party Google API surface read or write the time-of-day on a Google Task?
date: 2026-09-15
status: verdict — negative, well corroborated, one open UI-only feature worth re-testing
related: GitHub issue #7 "Support time in Tasks"
---

## Question

GitHub issue #7 asks that importing Google Tasks into Obsidian carry the time of day a
user sets in the Google Tasks UI, not just the date. Is there **any** first-party Google
API surface — Tasks API, Calendar API, Apps Script, Workspace Events API, Keep API,
Takeout — that can read or write that time-of-day? If not, what is the authoritative
evidence?

## Direct answer

**No.** As of 2026-09-15, no first-party Google API can read or write the time-of-day
on a Google Task. The Tasks API v1 `due` field is documented as date-only by design, no
v2 exists, the two Google Issue Tracker feature requests for this are open and
unresolved after 5+ years (most recent Google engineering comment: "prioritizing other
work that blocks many of these features," May 2024; most recent tracker activity: an
automated bot re-opening the canonical request to "New," May 2026, with no substantive
engineering comment attached), and every adjacent surface checked (Calendar API events,
Apps Script Tasks service, Workspace Events API, Keep API) either wraps the same v1 API
or doesn't touch Tasks at all. The one thing that complicates a flat "the UI's time
doesn't exist anywhere API-side" claim is a **new (Nov 2025) Calendar UI feature,
"Start date and time,"** that lets a task carry a genuine start time and creates a
linked Calendar event for it — but Google's own announcement and the Calendar Events
API schema (last updated 2026-09-11) show no API-visible field or event property tying
that block back to the task, so it's a dead end too, just a more recent one.

## Evidence per surface

### 1. Google Tasks API v1 — `due` field

Source: https://developers.google.com/tasks/reference/rest/v1/tasks (page last updated
**2025-03-12 UTC**), the `Task` resource.

> "Due date of the task (as a RFC 3339 timestamp). Optional. The due date only records
> date information; the time portion of the timestamp is discarded when setting the due
> date. It isn't possible to read or write the time that a task is due via the API."

The rest of the `Task` resource schema (`kind`, `id`, `etag`, `title`, `updated`,
`selfLink`, `parent`, `position`, `notes`, `status`, `due`, `completed`, `deleted`,
`hidden`, `links[]`, `webViewLink`, `assignmentInfo`) has no other time-bearing field.
`completed` is a timestamp but only records when the task was marked done, not a due
time.

**No v2.** https://developers.google.com/workspace/tasks/reference/rest shows only
`v1`, with resources `tasklists` and `tasks`.

**Release notes**: https://developers.google.com/tasks/docs/release-notes lists exactly
two entries — GA announcement (2018-06-28) and Docs/Chat-assigned-tasks support
(2024-07-23) — neither mentions due time, start time, or scheduling. No changelog entry
exists for the Nov 2025 Calendar time-blocking feature (see surface 3 below), which is
itself evidence the API side wasn't touched when that shipped.

### 2. Google Issue Tracker — the due-time feature requests

Two requests exist and are linked to each other. Both were retrieved via a text-mode
fetch of the live tracker page (issuetracker.google.com renders via JS and returns a
sign-in shell to a plain HTTP fetch, so the reader-mode retrieval below is the only way
these were accessible — noted as a methodology caveat, not a sign the issues are
private; they are the public Workspace Developers tracker).

**Issue 128979662** — "Add the ability to get/set task due time via API"
(https://issuetracker.google.com/issues/128979662). Filed 2019-03-28. Metadata at
fetch time: Type Feature Request, Priority P2, Severity S0, **Status: Duplicate of
166896024**.

Google engineering comment (ek...@google.com, accepted the issue), **2019-04-15**:

> "The existing 'due' field in the API was added at a time when tasks only supported a
> due date, without a specific time. This field has always ignored the time portion of
> the date/time value passed to it. The UI now supports specific due times as well, but
> we can't overload the same 'due' field to hold that value, as it wouldn't be
> backwards compatible. I've forwarded your request to support that field to the
> engineering team."

Follow-up from the same engineer, **2019-04-24**:

> "The problem with using the existing `due` field is that there wouldn't be a way to
> differentiate between 'due on X day, with no due time' vs 'due on X day at
> midnight'. While in principle adding support for this is a relatively simple task,
> because of other backend changes taking place right now it's a bit more complicated
> than it may appear."

It was marked a duplicate on **2024-02-05** (jp...@google.com). The final comment on
this issue, **2024-05-01** (jp...@google.com):

> "The canonical issue for this is https://issuetracker.google.com/166896024. The team
> is aware of this issue but currently prioritizing other work that blocks many of
> these features."

Between 2019 and 2024 the issue accumulated roughly 140 comments, almost all "+1"s from
third-party developers (TasksBoard, Business Calendar 2, Zapier integrators, etc.); no
substantive engineering update appears between the 2019-04-24 comment and the 2024-05-01
close-out.

**Issue 166896024** — "Please update the API (set precise time, etc.)"
(https://issuetracker.google.com/issues/166896024). Filed 2020-08-29 by the co-maker of
TasksBoard.app, asking for precise time, recurring tasks, and a change-notification
webhook. Located under "Public Trackers > Google Workspace Developers > Tasks API >
Locked Tasks issues" (the "Locked" grouping is Google's own label for this issue
sub-list — it is consistent with the fact that outside "+1" comments on it stop after
2021 even though bot status churn continues into 2026).

This is the **currently canonical, open** issue. As of the fetch (2026-09-15):

- **Status shown in the metadata panel: "New"**, with an internal `status: blocked`
  field.
- Most recent status events: `is...@google.com` bot set **Status: New** three times —
  2023-05-17, 2026-05-09, and **2026-05-14** — interspersed with automated
  reassignment (`bl...@google.com`, 2026-05-11, "Automated by Blunderbuss job
  workspace-devrel-public-issue-tracker-blunderbuss-autoassigner").
- The page's own "STATUS UPDATE" panel reads: **"No update yet."**
- The last human-written comment is #23, **2021-08-03**, "+100500" — i.e. no
  substantive engineering or reporter comment in over four years; all activity since is
  automated bot churn (status resets, auto-reassignment).

So: the feature request that actually governs this limitation is open, unresolved, and
as recently as **9 days before this research (2026-05-14 is the last status touch;
2026-09-11 is the most recent adjacent doc update — see surface 3)** shows no sign of
being worked. This is a live, current negative result, not a stale one from 2019.

### 3. Google Calendar API — tasks as events

**Events resource** — https://developers.google.com/workspace/calendar/api/v3/reference/events
(page last updated **2026-09-11 UTC**, i.e. four days before this research). Full
top-level field list checked for any task-related field: `kind, etag, id, status,
htmlLink, created, updated, summary, description, location, colorId, eventLabelId,
creator, organizer, start, end, endTimeUnspecified, recurrence, recurringEventId,
originalStartTime, transparency, visibility, iCalUID, sequence, attendees,
attendeesOmitted, extendedProperties, hangoutLink, conferenceData, gadget,
anyoneCanAddSelf, guestsCanInviteOthers, guestsCanModify, guestsCanSeeOtherGuests,
privateCopy, locked, reminders, source, workingLocationProperties,
outOfOfficeProperties, focusTimeProperties, attachments, birthdayProperties,
eventType`. **Zero occurrences of "task" anywhere in the schema**, and no
`taskProperties`-shaped field analogous to `focusTimeProperties` /
`outOfOfficeProperties` / `workingLocationProperties` / `birthdayProperties`.

**Event types** — https://developers.google.com/workspace/calendar/api/guides/event-types
(also last updated **2026-09-11 UTC**). `eventType` enum: `birthday`, `default`,
`focusTime`, `fromGmail`, `outOfOffice`, `workingLocation`. No `task` value exists.
Confirms tasks are not modeled as a Calendar event type even in the current doc set.

**The Nov 2025 "block off time for a task" feature.** Official announcement:
https://workspaceupdates.googleblog.com/2025/11/block-time-for-tasks-google-calendar.html
— rollout "Rapid Release domains ... starting on November 6, 2025" / "Scheduled
Release domains ... starting on December 1, 2025." The post describes letting a user
"block off time on their calendar to work on a specific task" by selecting an empty
slot, clicking Task, and adding task details; per corroborating secondary reporting
(labelled secondary: reworked.co, techrepublic.com coverage of the same launch) this
"creates a calendar event for the task so that time is reserved, but it's still linked
to the original task." **The official Google post itself makes no mention of the Tasks
API, Calendar API, or any developer-facing surface for this feature** — it is
UI-only in the announcement. Combined with the Events resource schema check above
(current as of 2026-09-11, i.e. after this feature had been live for 10+ months) showing
no field that could carry that link, this is strong-but-not-airtight evidence that the
linked time-block is not exposed to API consumers: strong, because the schema page is
current and lists every other Google-first-party special event type (focus time,
out-of-office, working location, birthday) as a distinct typed sub-object, so the
absence of an equivalent for tasks is conspicuous; not airtight, because Google could in
principle expose the linked event as a plain `default`-type event with no discoverable
marker back to its source task, which this research cannot positively rule out without
a live account that has used the feature.

**Google Calendar Help Center** (official first-party product documentation, labelled
as such): https://support.google.com/calendar/answer/9901136 ("Create & manage tasks in
Google Calendar") — this is the page that explains what the UI's time-related fields
actually mean (see surface 5).

### 4. Other first-party surfaces

**Apps Script Tasks advanced service** —
https://developers.google.com/apps-script/advanced/tasks (last updated **2026-09-03
UTC**):

> "The Tasks service uses the same objects, methods, and parameters as the public API"

— i.e. it is a thin wrapper over Tasks API v1 and inherits the same `due`-is-date-only
limitation. No additional time field is documented.

**Workspace Events API** —
https://developers.google.com/workspace/events/release-notes: supported resources are
Chat (spaces, messages, memberships), Meet (conferences, recordings), and mentions of
Docs/Drive/Calendar change notifications generally — **Google Tasks is not a
subscribable resource type**. No mention of Tasks anywhere in the release notes.

**Google Keep API** — https://developers.google.com/keep/api/reference/rest/v1/notes:
the `Note` resource has only creation/modification/trash timestamps (not user-facing
due dates), and the `ListItem` sub-resource (checklist items inside a Keep note) has
only `childListItems`, `text`, `checked` — **no due date or time field of any kind**.
Keep is not a task-scheduling surface at all, so this is a clean dead end rather than a
near-miss.

**Google Takeout** — official page
https://support.google.com/tasks/answer/10017961 confirms "Due dates" and "Completed
timestamps" are among the data categories included in a Tasks export, but **does not
document the export's technical schema** (JSON structure, timestamp encoding). Claims
seen elsewhere that Takeout due dates are encoded as Unix epoch milliseconds come only
from third-party tool authors (e.g. GitHub conversion-script READMEs) — **this is
explicitly unverified against a primary source** and is not relied on for any
conclusion here. Even if Takeout's due-date field did carry a time component, Takeout is
an export-only, one-shot dump, not a sync API, so it could not serve as an ongoing
import path for this repo regardless.

### 5. What the UI time actually is (official Help Center, first-party product docs)

Full verbatim capture from https://support.google.com/calendar/answer/9901136 (task
settings table):

> "Start date and time - Enter the start date and how much time you plan to spend on
> the task."
>
> "Deadline - Enter the date you expect to complete the task. The deadline appears on
> the 'All day' section of Calendar."

And on notifications:

> "If you add a date and time to your task, you get notifications at the scheduled date
> and time."
> "For tasks without a time, notifications appear at 9 AM."
> "For tasks with a deadline, you get a notification to complete the task on the day of
> the deadline at 9 AM in your local time."

This resolves an ambiguity the issue-tracker thread argues about: there are now **two
distinct concepts** in the Google Tasks/Calendar UI:

1. **Deadline** — a date-only field. This is what the Tasks API's `due` field
   represents (confirmed by the "appears on the All day section" wording matching
   `due`'s date-only, UTC-midnight behaviour that `src/sync/dates.ts` already works
   around).
2. **Start date and time** — a genuinely time-bearing scheduling field, added with the
   Nov 2025 Calendar time-blocking feature (see surface 3), which is a _different_
   thing from `due` and has no corresponding Tasks API field at all, documented or
   undocumented, as of this research.

The screenshot in GitHub issue #7 shows a task with a time set — given the "Deadline"
field is documented as date-only and always has been, that time almost certainly comes
from "Start date and time," not from `due`. That reinforces the conclusion: the
specific thing the user wants imported has never had an API path, under either its old
name (2019 "start time," per the 2019-03-18 Workspace Updates post
https://workspaceupdates.googleblog.com/2019/03/set-start-times-and-import-reminders-in.html,
which introduced "two time-based properties, date and start time") or its current
Calendar-integrated form.

## Dead ends checked

- **Tasks API v1 `due`** — date-only by explicit doc statement. Dead end.
- **Tasks API v1 `completed`** — timestamp, but records completion time, not due/start
  time. Not usable for this purpose.
- **Tasks API v2** — does not exist.
- **Calendar API `events` resource** — no task-related field or `eventType`. Dead end.
- **Calendar API `focusTimeProperties` / `outOfOfficeProperties` /
  `workingLocationProperties` / `birthdayProperties` pattern** — no analogous
  `taskProperties` exists. Dead end.
- **Apps Script Tasks advanced service** — thin wrapper over Tasks API v1, same
  limitation. Dead end.
- **Workspace Events API** — Tasks is not a supported resource type at all. Dead end.
- **Google Keep API** — no due date/time concept on notes or list items. Dead end.
- **Google Takeout** — exports due dates but schema/timestamp encoding is undocumented
  by Google, and even if it carried a time, it's a one-shot export, not sync-capable.
  Ambiguous on time-of-day; dead end regardless for sync purposes.
- **Calendar UI "Start date and time" (Nov 2025 time-blocking feature)** — real,
  time-bearing, but shows no trace in the current (2026-09-11) Events API schema and no
  API mention in Google's own launch announcement. Treated as a dead end but the
  least-certain one (see caveat in surface 3) — flagged for re-check rather than closed
  outright.

## What this means for this repo

- `src/sync/dates.ts`, `taskDue()` (lines 43–61) already encodes the correct mental
  model: Google Tasks `due` is "RFC3339 but only the DATE part is honored (interpreted
  in UTC)," and the function deliberately emits `${date}T00:00:00.000Z` rather than
  trying to carry a real time — this research confirms that comment is accurate and
  future-proof; there is no time to carry through this field.
- `src/sync/mapper.ts`, `remoteTaskToNote()` (around line 258) does
  `if (task.due) fm.due = task.due.slice(0, 10);` — also correct: `task.due` from the
  API is always UTC midnight, so slicing to the date is not losing anything the API
  ever gave it in the first place.
- **`due` is in `TASK_MANAGED_KEYS`** (`src/sync/mapper.ts`, ~line 216). Per
  `mergeManagedFrontmatter`'s doc comment, managed keys are always taken authoritatively
  from Google on import/re-sync, overwriting anything in that key in the vault. This
  means **there is no way to store a user-authored "time I actually want to see" inside
  `due` itself** — even if the maintainer wanted to let a user manually annotate a time
  in the frontmatter after import, a future re-sync would silently discard it, because
  `due` is Google's field to overwrite, not the user's.
- **What is implementable for issue #7**: nothing that reads a real time from Google,
  because no time exists to read (see verdict above). What _could_ be built instead is
  a vault-local, **unmanaged** frontmatter key (something not in `TASK_MANAGED_KEYS`,
  e.g. a `time` or `dueTime` property) that a user sets by hand in Obsidian and that
  survives re-import untouched (per the `preserved` logic in
  `mergeManagedFrontmatter`, any key not in the managed list is kept across a
  re-sync). That is a vault-only convenience, not a Google-round-trippable field: it
  cannot be populated from an import (there is nothing to import), and if the plugin
  ever pushes tasks _back_ to Google, that time still has nowhere to go on the Google
  side.
- The GitHub issue itself: the maintainer (Cordedmink2, also the repo owner) commented
  "working on it now :)" on 2026-09-14 — the day before this research. That commit
  should be read as _the maintainer building the vault-local unmanaged-key workaround
  above_, not as evidence a real API path exists; if the maintainer is currently
  assuming `due` can carry a time, this research should reach them before that lands.

## Check again if

- **Tasks API `due` field description changes**, or a `v2` resource/version appears at
  https://developers.google.com/workspace/tasks/reference/rest. Re-check the Task
  resource schema page directly; the "It isn't possible to read or write the time..."
  sentence is the tripwire — if it's gone or softened, re-test with a live task that has
  a time set.
- **Issue 166896024's status field moves off "New"/`blocked`** to something like
  "Fixed," "Started," or a linked CL/release note. Its current state (2026-09-15) is
  bot-driven status churn with zero substantive comment since 2021-08-03 — a real
  status change or a new engineering comment would be the signal to re-open this
  investigation.
- **The Calendar Events resource schema gains a task-linked field** — watch for a
  `taskProperties`-style object appearing alongside `focusTimeProperties` /
  `workingLocationProperties`, or a new `eventType: "task"` value, in
  https://developers.google.com/workspace/calendar/api/v3/reference/events. Given the
  Nov 2025 UI feature already creates a linked calendar event with a real time, this is
  the most plausible route by which a time could eventually become readable — through
  Calendar, not Tasks.
- **A Workspace Updates post or Tasks API release note explicitly ships alongside the
  Nov 2025 time-blocking feature.** None exists as of this research (last Tasks API
  release note: 2024-07-23); a new entry mentioning "start time" or "scheduled time"
  would be the signal.
- **If someone with a live Google account that has used "Start date and time" checks
  what `events.list` actually returns for that block** — this research could not do
  that (no authenticated test account was exercised; everything above is doc-schema
  and issue-tracker analysis). That live check is the one gap that pure documentation
  research can't close, and would either confirm the dead end firmly or reveal an
  undocumented back door (e.g. an `extendedProperties.private` key Google's own client
  sets, which would still not be a supported/stable surface but might be readable).
