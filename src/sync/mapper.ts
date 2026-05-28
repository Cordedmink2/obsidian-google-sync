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
