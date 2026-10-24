import { DateTime } from "luxon";
import type { MockFixture } from "./mockEngine";

/**
 * Synthetic-but-realistic Google payloads. Everything is generated relative to a `now`
 * the caller supplies (the real clock in E2E, a fixed instant in unit tests) using explicit
 * day offsets, so fixtures never age out of the import / lifecycle windows.
 */
export const ZONE = "Pacific/Auckland";

const at = (now: Date, days: number, hour = 9): DateTime =>
    DateTime.fromJSDate(now, { zone: ZONE })
        .plus({ days })
        .set({ hour, minute: 0, second: 0, millisecond: 0 });

const dateOnly = (now: Date, days: number): string => at(now, days).toISODate() as string;
const dueOf = (now: Date, days: number): string => `${dateOnly(now, days)}T00:00:00.000Z`;

const stamp = {
    etag: '"3400000000000000"',
    created: "2026-01-05T01:00:00.000Z",
    updated: "2026-01-05T01:00:00.000Z",
};

export function timedEvent(
    now: Date,
    id: string,
    summary: string,
    days: number,
    extra: Record<string, unknown> = {},
    hour = 9,
    hours = 1,
): Record<string, unknown> {
    const s = at(now, days, hour);
    return {
        kind: "calendar#event",
        id,
        status: "confirmed",
        summary,
        htmlLink: `https://www.google.com/calendar/event?eid=${id}`,
        iCalUID: `${id}@google.com`,
        ...stamp,
        creator: { email: "connor@example.com", self: true },
        organizer: { email: "connor@example.com", self: true },
        start: { dateTime: s.toISO(), timeZone: ZONE },
        end: { dateTime: s.plus({ hours }).toISO(), timeZone: ZONE },
        sequence: 0,
        reminders: { useDefault: true },
        eventType: "default",
        ...extra,
    };
}

export function allDayEvent(
    now: Date,
    id: string,
    summary: string,
    days: number,
    lengthDays = 1,
): Record<string, unknown> {
    return {
        kind: "calendar#event",
        id,
        status: "confirmed",
        summary,
        ...stamp,
        start: { date: dateOnly(now, days) },
        // Google's all-day end date is exclusive.
        end: { date: dateOnly(now, days + lengthDays) },
        transparency: "transparent",
        eventType: "default",
    };
}

export function cancelledStub(id: string, recurringEventId?: string): Record<string, unknown> {
    return {
        kind: "calendar#event",
        id,
        status: "cancelled",
        ...(recurringEventId ? { recurringEventId } : {}),
    };
}

export function task(
    now: Date,
    id: string,
    title: string,
    dueDays: number | null,
    extra: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        kind: "tasks#task",
        id,
        etag: '"LTE2MDAwMDAwMA"',
        title,
        updated: "2026-01-05T01:00:00.000Z",
        selfLink: `https://www.googleapis.com/tasks/v1/lists/L1/tasks/${id}`,
        position: "00000000000000000001",
        status: "needsAction",
        ...(dueDays === null ? {} : { due: dueOf(now, dueDays) }),
        links: [],
        ...extra,
    };
}

/** Titles that stress filename generation: unicode, emoji, illegal path characters. */
export const AWKWARD_TITLES = [
    "Café ☕ catch-up — Zoë & Jürgen",
    "会議 / ミーティング 📅",
    'Q3: "plan" <draft> | review?*',
    "../../etc/passwd",
    "   ",
    "CON",
    "a".repeat(300),
    "🏳️‍🌈🎉🎉🎉",
    "Tab\tand\nnewline in title",
    "trailing dots...",
];

/** Transitions of the Pacific/Auckland offset within +/- a year of `ref`. */
export function dstTransitions(ref: Date): DateTime[] {
    const out: DateTime[] = [];
    let prev = DateTime.fromJSDate(ref, { zone: ZONE }).minus({ days: 366 }).startOf("day");
    for (let i = 1; i <= 732; i++) {
        const cur = prev.plus({ days: 1 });
        if (cur.offset !== prev.offset) out.push(cur);
        prev = cur;
    }
    return out;
}

/** Events either side of each Auckland DST change (April end, September start). */
export function dstEdgeEvents(ref: Date): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    dstTransitions(ref).forEach((t, i) => {
        for (const [tag, hourOfDay] of [
            ["before", 23],
            ["after", 4],
        ] as const) {
            const start =
                tag === "before"
                    ? t.minus({ days: 1 }).set({ hour: hourOfDay, minute: 30 })
                    : t.set({ hour: hourOfDay, minute: 30 });
            out.push({
                kind: "calendar#event",
                id: `dst-${i}-${tag}`,
                status: "confirmed",
                summary: `DST edge ${i} ${tag} (offset ${start.offset / 60}h)`,
                ...stamp,
                start: { dateTime: start.toISO(), timeZone: ZONE },
                end: { dateTime: start.plus({ hours: 1 }).toISO(), timeZone: ZONE },
            });
        }
    });
    return out;
}

/** A recurring series' instances (singleEvents=true) plus a cancelled exception. */
export function recurringInstances(
    now: Date,
    seriesId: string,
    count = 4,
): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    for (let i = 0; i < count; i++) {
        const start = at(now, 2 + i * 7, 10);
        const idStamp = start.toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'");
        if (i === 2) {
            out.push(cancelledStub(`${seriesId}_${idStamp}`, seriesId));
            continue;
        }
        out.push({
            kind: "calendar#event",
            id: `${seriesId}_${idStamp}`,
            status: "confirmed",
            summary: "Weekly standup",
            recurringEventId: seriesId,
            originalStartTime: { dateTime: start.toISO(), timeZone: ZONE },
            ...stamp,
            start: { dateTime: start.toISO(), timeZone: ZONE },
            end: { dateTime: start.plus({ minutes: 30 }).toISO(), timeZone: ZONE },
        });
    }
    return out;
}

/**
 * The default world for the E2E specs. Ids and titles of the original hard-coded mock are
 * kept so existing specs read the same; additions are the realistic bits.
 *
 * "Sync targets" (ev-conf, task-parent, ...) are items that specs push edits at. Events sit
 * outside the import window so imports do not pull them in; they must exist because the
 * mock is stateful and answers 404 for an id it has never seen.
 */
export function defaultFixture(now: Date): MockFixture {
    return {
        calendars: [
            { id: "primary", summary: "connor@example.com", primary: true },
            { id: "secondary", summary: "Secondary calendar" },
        ],
        events: {
            primary: [
                timedEvent(now, "import-event-1", "Imported appointment", 5),
                // Past by 3 days: inside the import window, beyond the 1-day archive threshold.
                timedEvent(now, "past-import-event-1", "Past imported appointment", -3),
                allDayEvent(now, "all-day-1", "Public holiday", 12),
                allDayEvent(now, "multi-day-1", "Conference trip", 20, 3),
                ...recurringInstances(now, "weekly-standup"),
                // Sync targets, far outside the import window.
                timedEvent(now, "ev-conf", "Call", -60),
                timedEvent(now, "ev-existing", "Existing", -61),
                timedEvent(now, "ev-del", "Delete me", -62),
            ],
            secondary: [timedEvent(now, "secondary-event-1", "Secondary appointment", 6)],
        },
        taskLists: [
            { id: "@default", title: "My Tasks" },
            { id: "L1", title: "Test list" },
        ],
        tasks: {
            "@default": [task(now, "default-import-task-1", "Default list task", 10)],
            L1: [
                task(now, "import-task-1", "Imported task", 10),
                task(now, "late-import-task-1", "Late imported task", -5),
                // Sync targets (specs patch / move these).
                task(now, "task-parent", "Renew registration", null),
                task(now, "task-child", "Pick up the car", null),
                task(now, "task-done", "Done thing", null),
            ],
        },
    };
}

/** 500+ events and tasks over several calendars and lists, for paging. */
export function bulkFixture(
    now: Date,
    opts: { eventsPerCalendar?: number; tasksPerList?: number } = {},
): MockFixture {
    const eventsPer = opts.eventsPerCalendar ?? 300;
    const tasksPer = opts.tasksPerList ?? 130;
    const titleAt = (i: number) => AWKWARD_TITLES[i % AWKWARD_TITLES.length] as string;
    const calendars = [
        { id: "primary", summary: "connor@example.com", primary: true },
        { id: "work", summary: "Work" },
        { id: "family", summary: "Family" },
    ];
    const events: MockFixture["events"] = {};
    calendars.forEach((c, ci) => {
        events[c.id] = Array.from({ length: eventsPer }, (_, i) =>
            timedEvent(
                now,
                `${c.id}-ev-${i}`,
                i % 7 === 0 ? titleAt(i) : `${c.id} event ${i}`,
                1 + (i % 80),
                {},
                8 + (ci % 6),
            ),
        );
    });
    const taskLists = [
        { id: "@default", title: "My Tasks" },
        { id: "L1", title: "Test list" },
        { id: "shopping", title: "Shopping" },
    ];
    const tasks: MockFixture["tasks"] = {};
    taskLists.forEach((l) => {
        const rows: Record<string, unknown>[] = [];
        for (let i = 0; i < tasksPer; i++) {
            const parent = i % 10 === 5 ? `${l.id}-task-${i - 1}` : undefined;
            rows.push(
                task(
                    now,
                    `${l.id}-task-${i}`,
                    i % 9 === 0 ? titleAt(i) : `${l.id} task ${i}`,
                    1 + (i % 60),
                    {
                        ...(parent ? { parent } : {}),
                        ...(i % 17 === 0
                            ? { status: "completed", completed: "2026-01-06T01:00:00.000Z" }
                            : {}),
                    },
                ),
            );
        }
        tasks[l.id] = rows;
    });
    return { calendars, events, taskLists, tasks };
}
