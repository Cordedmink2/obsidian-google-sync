import { DateTime } from "luxon";
import { GoogleEventDateTime } from "../types";

/** Thrown when a frontmatter date string can't be parsed. */
export class DateParseError extends Error {}

function parse(iso: string, zone: string): DateTime {
    const dt = DateTime.fromISO(iso, { zone });
    if (!dt.isValid) {
        throw new DateParseError(`Invalid date "${iso}" (${dt.invalidReason ?? "unknown"})`);
    }
    return dt;
}

/**
 * Build a Google event start/end object from a local ISO string + IANA timezone.
 * All-day events use { date: "YYYY-MM-DD" }; timed events use { dateTime, timeZone }.
 */
export function eventDateTime(localIso: string, zone: string, allDay = false): GoogleEventDateTime {
    const dt = parse(localIso, zone);
    if (allDay) {
        const date = dt.toISODate();
        if (!date) throw new DateParseError(`Invalid all-day date "${localIso}"`);
        return { date };
    }
    const dateTime = dt.toISO({ suppressMilliseconds: true });
    if (!dateTime) throw new DateParseError(`Invalid datetime "${localIso}"`);
    return { dateTime, timeZone: zone };
}

/** All-day Google events need an exclusive end date; default to the day after start. */
export function allDayEnd(localIso: string, zone: string): GoogleEventDateTime {
    const date = parse(localIso, zone).plus({ days: 1 }).toISODate();
    if (!date) throw new DateParseError(`Invalid all-day date "${localIso}"`);
    return { date };
}

/**
 * Google Tasks `due` is RFC3339 but only the DATE part is honored (interpreted in UTC). Emit
 * the user's intended calendar date at UTC midnight. Converting the local instant to UTC
 * instead would roll the date back a day for ahead-of-UTC zones (e.g. a date-only "due
 * tomorrow" in Pacific/Auckland becomes midnight local = the previous day in UTC, so Google
 * shows it due "today").
 */
export function taskDue(localIso: string, zone: string): string {
    const date = parse(localIso, zone).toISODate();
    if (!date) throw new DateParseError(`Invalid due "${localIso}"`);
    return `${date}T00:00:00.000Z`;
}

/** True when the given local time is strictly before `now`. Invalid dates are not "past". */
export function isPast(localIso: string, zone: string, now: DateTime = DateTime.now()): boolean {
    const dt = DateTime.fromISO(localIso, { zone });
    return dt.isValid && dt < now;
}
