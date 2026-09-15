# Obsidian ↔ Google Sync

Keeps an Obsidian vault in step with Google Calendar and Google Tasks. Notes are the
editable surface; Google is a peer that may be read from and written to, but never
created in or deleted from by this plugin.

## Language

### Notes and properties

**Task note**:
A vault note representing one Google Tasks item, identified by its `googleId`.
_Avoid_: todo, to-do note, task file

**Event note**:
A vault note representing one Google Calendar event, identified by its `googleId`.
_Avoid_: appointment, meeting note, calendar note

**Managed property**:
A frontmatter property Google owns. On import its value is taken from Google, including
removal; the vault's copy is not consulted. Every other property in the note belongs to
the user and survives a re-import untouched.
_Avoid_: synced field, owned key, controlled property

**Overdue**:
A task note whose `due` has passed. A date-only `due` passes at local midnight; one
carrying a Refinement passes at the stated time.
_Avoid_: late, past due, expired

**Orphan**:
A note whose Google counterpart no longer exists. Filed aside rather than deleted,
because this plugin never deletes.
_Avoid_: dangling note, stale note, deleted note

### Google's two notions of "when"

Google Tasks distinguishes two time-related fields that the word "due" is routinely used
for. They are different concepts and only one of them is reachable by software.

**Deadline**:
The day a task is expected to be completed. Date-only: it has no time of day, by design
and at every layer. This is the only one of the two that any Google API exposes, where it
is named `due`.
_Avoid_: due date, due time, due

**Start date and time**:
A separate Google Tasks field holding a genuine time of day, which Google Calendar
renders as a block of reserved time. Visible to a person in the Google interface and
readable by no Google API.
_Avoid_: due time, scheduled time, start time

**`due` (frontmatter property)**:
A task note's Deadline. Named `due` because that is the Tasks API's name for the same
field; it mirrors Deadline and never Start date and time. A time of day appearing here did
not come from Google and cannot be sent to it.
_Avoid_: deadline, dueDate, due date

**Refinement**:
Precision a note carries that Google has no field to hold — presently a time of day on
`due`. The vault's alone: Google can neither supply nor contradict it, so it is the one
thing a managed property keeps from the vault rather than taking from Google.
_Avoid_: local override, extra precision, vault value
