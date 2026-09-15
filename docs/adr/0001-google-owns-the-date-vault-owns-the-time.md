# Google owns the date, the vault owns the time

Every managed frontmatter property is taken wholesale from Google on import, which is
what makes the sync model easy to reason about. A time of day on a task's `due` is the
one exception: it is kept from the vault, and only the date is taken from Google.

The exception is safe rather than arbitrary. Google Tasks' Deadline is date-only at every
layer — the Tasks API states outright that it discards the time portion and that the time
cannot be read or written — so a time in `due` is always user-authored and Google has no
value there to conflict with it. Without the exception, typing a time into `due` loses it
silently on the next import, which is what issue #7 surfaced.

## Considered options

A separate unmanaged property (`dueTime`) would have needed no exception at all, since
unmanaged keys already survive import. It was rejected because it splits one instant
across two properties that can drift apart, and the modelling wart outlives the code one.
Truncating the time and reporting it in the import summary was rejected because it makes
a deliberate user edit into a recurring warning.

## Consequences

A task is overdue from its stated time rather than from local midnight, but only for
notes that carry a time; a date-only `due` behaves exactly as before. Nothing reaches
Google differently — the outbound value was already date-only — so there is no change to
what is pushed, and no effect on change detection.
