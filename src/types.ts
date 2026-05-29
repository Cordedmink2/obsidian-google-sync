// Shared types for obsidian-google-sync.

export type NoteKind = "event" | "task";

/** Event note frontmatter (subset of the spec we sync). Extra keys are preserved. */
export interface EventFrontmatter {
    title: string;
    date?: string; // ISO local datetime, e.g. 2026-06-02T09:00:00
    end?: string;
    allDay?: boolean;
    timezone?: string; // IANA, e.g. Pacific/Auckland
    location?: string;
    description?: string;
    calendarId?: string;
    status?: string; // confirmed | tentative | cancelled
    visibility?: string; // default | public | private | confidential
    eventType?: string; // stored in extendedProperties.private.obsidianEventType
    color?: string; // Google colorId string
    guestsCanInviteOthers?: boolean;
    guestsCanModify?: boolean;
    guestsCanSeeOtherGuests?: boolean;
    reminders?: { useDefault?: boolean; overrides?: { method?: string; minutes?: number }[] };
    attendees?: { required?: string[]; optional?: string[] };
    recurrence?: string; // single RRULE line
    googleId?: string; // filled by the plugin after insert
    tasks?: string[]; // linked task note basenames to close on archive
    [key: string]: unknown;
}

/** Task note frontmatter (subset of the spec we sync). Extra keys are preserved. */
export interface TaskFrontmatter {
    title: string;
    due?: string; // ISO local datetime
    completed?: boolean;
    notes?: string;
    status?: string; // needsAction | completed
    tasklist?: string;
    googleId?: string;
    [key: string]: unknown;
}

// ---- Google API shapes (only the fields we read/write) ----

export interface GoogleEventDateTime {
    dateTime?: string; // RFC3339 with offset
    date?: string; // YYYY-MM-DD for all-day
    timeZone?: string; // IANA
}

export interface GoogleEventAttendee {
    email: string;
    optional?: boolean;
}

export interface GoogleEvent {
    id?: string;
    summary?: string;
    description?: string;
    location?: string;
    status?: string;
    visibility?: string;
    colorId?: string;
    guestsCanInviteOthers?: boolean;
    guestsCanModify?: boolean;
    guestsCanSeeOtherGuests?: boolean;
    reminders?: { useDefault?: boolean; overrides?: { method?: string; minutes?: number }[] };
    extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
    start?: GoogleEventDateTime;
    end?: GoogleEventDateTime;
    attendees?: GoogleEventAttendee[];
    recurrence?: string[];
    recurringEventId?: string; // set on expanded instances of a recurring series
}

export interface GoogleTask {
    id?: string;
    title?: string;
    notes?: string;
    due?: string; // RFC3339; Google Tasks only honors the date part
    status?: "needsAction" | "completed";
    completed?: string;
}
