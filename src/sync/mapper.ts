import {
    EventFrontmatter,
    GoogleEvent,
    GoogleEventAttendee,
    GoogleTask,
    TaskFrontmatter,
} from "../types";
import { allDayEnd, eventDateTime, taskDue } from "./dates";

/**
 * Map an event note's frontmatter to a Google Calendar event body. Pure; throws
 * DateParseError on unparseable dates (caller surfaces it). `defaultTz` is used when the
 * note has no `timezone`.
 */
export function eventToGoogle(fm: EventFrontmatter, defaultTz: string): GoogleEvent {
    const zone = fm.timezone || defaultTz;
    const ev: GoogleEvent = { summary: fm.title };

    if (fm.description != null) ev.description = fm.description;
    if (fm.location != null) ev.location = fm.location;
    if (fm.status != null) ev.status = fm.status;
    if (fm.visibility != null) ev.visibility = fm.visibility;
    if (fm.color != null) ev.colorId = fm.color;
    if (fm.guestsCanInviteOthers != null) ev.guestsCanInviteOthers = fm.guestsCanInviteOthers;
    if (fm.guestsCanModify != null) ev.guestsCanModify = fm.guestsCanModify;
    if (fm.guestsCanSeeOtherGuests != null)
        ev.guestsCanSeeOtherGuests = fm.guestsCanSeeOtherGuests;
    if (fm.reminders != null) ev.reminders = fm.reminders;

    if (typeof fm.eventType === "string" && fm.eventType.trim() !== "") {
        ev.extendedProperties = {
            ...ev.extendedProperties,
            private: {
                ...(ev.extendedProperties?.private || {}),
                obsidianEventType: fm.eventType,
            },
        };
    }

    if (fm.date) ev.start = eventDateTime(fm.date, zone, fm.allDay);
    if (fm.end) ev.end = eventDateTime(fm.end, zone, fm.allDay);
    else if (fm.allDay && fm.date) ev.end = allDayEnd(fm.date, zone);

    const attendees: GoogleEventAttendee[] = [];
    for (const email of fm.attendees?.required ?? []) attendees.push({ email });
    for (const email of fm.attendees?.optional ?? []) attendees.push({ email, optional: true });
    if (attendees.length) ev.attendees = attendees;

    if (fm.recurrence) ev.recurrence = [fm.recurrence];

    return ev;
}

/** Map a task note's frontmatter to a Google Tasks body. Pure. */
export function taskToGoogle(fm: TaskFrontmatter, defaultTz: string): GoogleTask {
    const task: GoogleTask = { title: fm.title };
    if (fm.notes != null) task.notes = fm.notes;
    if (fm.due) task.due = taskDue(fm.due, defaultTz);
    task.status = fm.completed ? "completed" : "needsAction";
    return task;
}

/** Map a Google Calendar event into event note frontmatter. Pure. */
export function remoteEventToNote(event: GoogleEvent, calendarId: string): EventFrontmatter {
    const start = event.start;
    const end = event.end;
    const fm: EventFrontmatter = {
        title: event.summary || "Untitled event",
        calendarId,
    };

    if (event.id) fm.googleId = event.id;
    if (start?.date) {
        fm.date = start.date;
        fm.allDay = true;
    } else if (start?.dateTime) {
        fm.date = start.dateTime;
    }
    if (end?.date) fm.end = end.date;
    else if (end?.dateTime) fm.end = end.dateTime;
    if (start?.timeZone || end?.timeZone) fm.timezone = start?.timeZone || end?.timeZone;
    if (event.location != null) fm.location = event.location;
    if (event.description != null) fm.description = event.description;
    if (event.status != null) fm.status = event.status;
    if (event.visibility != null) fm.visibility = event.visibility;
    if (event.colorId != null) fm.color = event.colorId;
    if (event.guestsCanInviteOthers != null)
        fm.guestsCanInviteOthers = event.guestsCanInviteOthers;
    if (event.guestsCanModify != null) fm.guestsCanModify = event.guestsCanModify;
    if (event.guestsCanSeeOtherGuests != null)
        fm.guestsCanSeeOtherGuests = event.guestsCanSeeOtherGuests;
    if (event.reminders != null) fm.reminders = event.reminders;
    const remoteEventType = event.extendedProperties?.private?.obsidianEventType;
    if (remoteEventType != null) fm.eventType = remoteEventType;
    if (event.recurrence?.[0]) fm.recurrence = event.recurrence[0];

    const required = event.attendees?.filter((a) => !a.optional).map((a) => a.email) ?? [];
    const optional = event.attendees?.filter((a) => a.optional).map((a) => a.email) ?? [];
    if (required.length || optional.length) fm.attendees = { required, optional };

    return fm;
}

/**
 * Frontmatter keys the plugin owns for each note kind. On import these are taken
 * authoritatively from Google (so Google can set *or clear* them); every other key —
 * user-authored properties, tags, wiki links, the event `tasks` link field — is preserved.
 */
export const EVENT_MANAGED_KEYS = [
    "title",
    "calendarId",
    "googleId",
    "date",
    "allDay",
    "end",
    "timezone",
    "location",
    "description",
    "status",
    "visibility",
    "color",
    "guestsCanInviteOthers",
    "guestsCanModify",
    "guestsCanSeeOtherGuests",
    "reminders",
    "eventType",
    "recurrence",
    "attendees",
] as const;

export const TASK_MANAGED_KEYS = [
    "title",
    "completed",
    "status",
    "googleId",
    "tasklist",
    "due",
    "notes",
] as const;

/**
 * Merge Google-derived frontmatter onto an existing note. Managed keys come from
 * `incoming` (Google is the source of truth, including removals); any other key in
 * `existing` is kept, so a re-import no longer wipes user-added properties. Pure.
 */
export function mergeManagedFrontmatter(
    existing: Record<string, unknown>,
    incoming: Record<string, unknown>,
    kind: "event" | "task",
): Record<string, unknown> {
    const managed: readonly string[] = kind === "event" ? EVENT_MANAGED_KEYS : TASK_MANAGED_KEYS;
    const preserved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(existing)) {
        if (!managed.includes(k)) preserved[k] = v;
    }
    return { ...incoming, ...preserved };
}

/** Map a Google Tasks item into task note frontmatter. Pure. */
export function remoteTaskToNote(task: GoogleTask, taskListId?: string): TaskFrontmatter {
    const fm: TaskFrontmatter = {
        title: task.title || "Untitled task",
        completed: task.status === "completed",
        status: task.status || "needsAction",
    };
    if (task.id) fm.googleId = task.id;
    if (taskListId) fm.tasklist = taskListId;
    if (task.due) fm.due = task.due;
    if (task.notes != null) fm.notes = task.notes;
    return fm;
}
