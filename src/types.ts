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
    transparency?: string; // opaque (busy) | transparent (free)
    eventType?: string; // stored in extendedProperties.private.obsidianEventType
    color?: string; // Google colorId string
    guestsCanInviteOthers?: boolean;
    guestsCanModify?: boolean;
    guestsCanSeeOtherGuests?: boolean;
    reminders?: { useDefault?: boolean; overrides?: { method?: string; minutes?: number }[] };
    // Either the simple required/optional email lists, or a detailed list that also
    // carries response status, display names, organizer/resource flags, etc.
    attendees?: { required?: string[]; optional?: string[] } | EventAttendee[];
    recurrence?: string | string[]; // RRULE/EXDATE/RDATE line(s); a bare string is one line
    conferencing?: boolean | string; // request a Google Meet link on create (true | "hangoutsMeet")
    meetLink?: string; // resolved video link, written back from Google (read-only)
    attachments?: EventAttachment[];
    source?: { title?: string; url?: string };
    googleId?: string; // links the note to its Google event; written on import
    /** Set to `pull-only` to opt this note out of outbound sync (Google edits still import). */
    syncDirection?: "pull-only" | "two-way";
    tasks?: string[]; // linked task note basenames to close on archive
    [key: string]: unknown;
}

/** Detailed attendee frontmatter shape (superset of an email string). */
export interface EventAttendee {
    email: string;
    displayName?: string;
    optional?: boolean;
    organizer?: boolean;
    resource?: boolean;
    responseStatus?: string; // needsAction | declined | tentative | accepted
    comment?: string;
    additionalGuests?: number;
}

export interface EventAttachment {
    fileUrl?: string;
    title?: string;
    mimeType?: string;
    iconLink?: string;
    fileId?: string;
}

/** Task note frontmatter (subset of the spec we sync). Extra keys are preserved. */
export interface TaskFrontmatter {
    title: string;
    due?: string; // ISO local datetime
    completed?: boolean;
    notes?: string;
    status?: string; // needsAction | completed
    tasklist?: string;
    parent?: string; // wikilink/basename of the parent task note (Google `parent` subtask)
    position?: string; // Google-assigned sort key (read-only, written back on import)
    googleId?: string; // links the note to its Google task; written on import
    /** Set to `pull-only` to opt this note out of outbound sync (Google edits still import). */
    syncDirection?: "pull-only" | "two-way";
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
    displayName?: string;
    optional?: boolean;
    organizer?: boolean;
    self?: boolean;
    resource?: boolean;
    responseStatus?: string;
    comment?: string;
    additionalGuests?: number;
}

export interface GoogleConferenceEntryPoint {
    entryPointType?: string; // video | phone | sip | more
    uri?: string;
    label?: string;
    pin?: string;
}

export interface GoogleConferenceData {
    conferenceId?: string;
    conferenceSolution?: { key?: { type?: string }; name?: string; iconUri?: string };
    entryPoints?: GoogleConferenceEntryPoint[];
    createRequest?: {
        requestId?: string;
        conferenceSolutionKey?: { type?: string };
        status?: { statusCode?: string };
    };
    notes?: string;
}

export interface GoogleEventAttachment {
    fileUrl?: string;
    title?: string;
    mimeType?: string;
    iconLink?: string;
    fileId?: string;
}

export interface GoogleEvent {
    id?: string;
    summary?: string;
    description?: string;
    location?: string;
    status?: string;
    visibility?: string;
    colorId?: string;
    transparency?: string;
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
    hangoutLink?: string;
    conferenceData?: GoogleConferenceData;
    attachments?: GoogleEventAttachment[];
    source?: { title?: string; url?: string };
}

export interface GoogleTask {
    id?: string;
    title?: string;
    notes?: string;
    due?: string; // RFC3339; Google Tasks only honors the date part
    status?: "needsAction" | "completed";
    completed?: string;
    parent?: string; // id of the parent task; set via insert/move query params, not the body
    position?: string; // Google-assigned sort key within the (sub)list
    deleted?: boolean;
    hidden?: boolean;
}
