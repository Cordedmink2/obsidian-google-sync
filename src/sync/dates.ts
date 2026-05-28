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

/** Google Tasks `due` is RFC3339 but only the date is honored; emit UTC RFC3339. */
export function taskDue(localIso: string, zone: string): string {
    const iso = parse(localIso, zone).toUTC().toISO({ suppressMilliseconds: true });
    if (!iso) throw new DateParseError(`Invalid due "${localIso}"`);
    return iso;
}

/** True when the given local time is strictly before `now`. Invalid dates are not "past". */
export function isPast(localIso: string, zone: string, now: DateTime = DateTime.now()): boolean {
    const dt = DateTime.fromISO(localIso, { zone });
    return dt.isValid && dt < now;
}
