import { describe, it } from "mocha";
import { expect } from "chai";
import {
    eventToGoogle,
    mergeManagedFrontmatter,
    remoteEventToNote,
    remoteTaskToNote,
    taskToGoogle,
} from "../../src/sync/mapper";
import { EventFrontmatter, TaskFrontmatter } from "../../src/types";

const NZ = "Pacific/Auckland";

describe("eventToGoogle", () => {
    it("maps a full timed event", () => {
        const fm: EventFrontmatter = {
            title: "Team standup",
            date: "2026-06-02T09:00:00",
            end: "2026-06-02T09:15:00",
            timezone: NZ,
            location: "Zoom",
            description: "Daily sync.",
            status: "confirmed",
            visibility: "private",
            color: "7",
            eventType: "meeting",
            guestsCanInviteOthers: true,
            guestsCanModify: false,
            guestsCanSeeOtherGuests: true,
            reminders: {
                useDefault: false,
                overrides: [{ method: "popup", minutes: 10 }],
            },
            recurrence: "RRULE:FREQ=WEEKLY;BYDAY=MO",
            attendees: { required: ["a@x.com"], optional: ["b@x.com"] },
        };
        const ev = eventToGoogle(fm, "UTC");
        expect(ev.summary).to.equal("Team standup");
        expect(ev.start?.dateTime).to.equal("2026-06-02T09:00:00+12:00");
        expect(ev.start?.timeZone).to.equal(NZ);
        expect(ev.end?.dateTime).to.equal("2026-06-02T09:15:00+12:00");
        expect(ev.location).to.equal("Zoom");
        expect(ev.status).to.equal("confirmed");
        expect(ev.visibility).to.equal("private");
        expect(ev.colorId).to.equal("7");
        expect(ev.guestsCanInviteOthers).to.equal(true);
        expect(ev.guestsCanModify).to.equal(false);
        expect(ev.guestsCanSeeOtherGuests).to.equal(true);
        expect(ev.reminders).to.deep.equal({
            useDefault: false,
            overrides: [{ method: "popup", minutes: 10 }],
        });
        expect(ev.extendedProperties?.private?.obsidianEventType).to.equal("meeting");
        expect(ev.recurrence).to.deep.equal(["RRULE:FREQ=WEEKLY;BYDAY=MO"]);
        expect(ev.attendees).to.deep.equal([
            { email: "a@x.com" },
            { email: "b@x.com", optional: true },
        ]);
    });

    it("uses defaultTz when the note omits timezone", () => {
        const ev = eventToGoogle({ title: "X", date: "2026-06-02T09:00:00" }, NZ);
        expect(ev.start?.timeZone).to.equal(NZ);
    });

    it("derives an exclusive end for an all-day event without end", () => {
        const ev = eventToGoogle({ title: "Holiday", date: "2026-06-02", allDay: true }, NZ);
        expect(ev.start?.date).to.equal("2026-06-02");
        expect(ev.end?.date).to.equal("2026-06-03");
    });

    it("omits attendees and recurrence when absent", () => {
        const ev = eventToGoogle({ title: "X", date: "2026-06-02T09:00:00", timezone: NZ }, "UTC");
        expect(ev.attendees).to.equal(undefined);
        expect(ev.recurrence).to.equal(undefined);
    });

    it("maps transparency (free/busy)", () => {
        const ev = eventToGoogle(
            { title: "Focus", date: "2026-06-02T09:00:00", timezone: NZ, transparency: "transparent" },
            "UTC",
        );
        expect(ev.transparency).to.equal("transparent");
    });

    it("preserves multi-line recurrence (RRULE + EXDATE)", () => {
        const ev = eventToGoogle(
            {
                title: "Standup",
                date: "2026-06-02T09:00:00",
                timezone: NZ,
                recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE;TZID=Pacific/Auckland:20260615T090000"],
            },
            "UTC",
        );
        expect(ev.recurrence).to.deep.equal([
            "RRULE:FREQ=WEEKLY;BYDAY=MO",
            "EXDATE;TZID=Pacific/Auckland:20260615T090000",
        ]);
    });

    it("wraps a single recurrence string into a one-element array", () => {
        const ev = eventToGoogle(
            { title: "X", date: "2026-06-02T09:00:00", timezone: NZ, recurrence: "RRULE:FREQ=DAILY" },
            "UTC",
        );
        expect(ev.recurrence).to.deep.equal(["RRULE:FREQ=DAILY"]);
    });

    it("maps detailed attendees (response status, names, organizer)", () => {
        const ev = eventToGoogle(
            {
                title: "Review",
                date: "2026-06-02T09:00:00",
                timezone: NZ,
                attendees: [
                    {
                        email: "a@x.com",
                        displayName: "Ada",
                        responseStatus: "accepted",
                        organizer: true,
                    },
                    { email: "room@x.com", resource: true, optional: true },
                ],
            },
            "UTC",
        );
        expect(ev.attendees).to.deep.equal([
            { email: "a@x.com", displayName: "Ada", responseStatus: "accepted", organizer: true },
            { email: "room@x.com", optional: true, resource: true },
        ]);
    });

    it("maps attachments and source", () => {
        const ev = eventToGoogle(
            {
                title: "Doc review",
                date: "2026-06-02T09:00:00",
                timezone: NZ,
                attachments: [{ fileUrl: "https://drive.google.com/file/d/abc", title: "Spec" }],
                source: { title: "Ticket", url: "https://tracker/123" },
            },
            "UTC",
        );
        expect(ev.attachments).to.deep.equal([
            { fileUrl: "https://drive.google.com/file/d/abc", title: "Spec" },
        ]);
        expect(ev.source).to.deep.equal({ title: "Ticket", url: "https://tracker/123" });
    });

    it("does not itself add conferenceData (the router attaches the create request)", () => {
        const ev = eventToGoogle(
            { title: "Call", date: "2026-06-02T09:00:00", timezone: NZ, conferencing: true },
            "UTC",
        );
        expect(ev.conferenceData).to.equal(undefined);
    });
});

describe("remoteEventToNote", () => {
    it("maps extended event fields back into frontmatter", () => {
        const fm = remoteEventToNote(
            {
                id: "evt_123",
                summary: "Planning",
                visibility: "private",
                colorId: "9",
                guestsCanInviteOthers: false,
                guestsCanModify: false,
                guestsCanSeeOtherGuests: true,
                reminders: { useDefault: true },
                extendedProperties: { private: { obsidianEventType: "deep-work" } },
            },
            "primary",
        );
        expect(fm.googleId).to.equal("evt_123");
        expect(fm.visibility).to.equal("private");
        expect(fm.color).to.equal("9");
        expect(fm.guestsCanInviteOthers).to.equal(false);
        expect(fm.guestsCanModify).to.equal(false);
        expect(fm.guestsCanSeeOtherGuests).to.equal(true);
        expect(fm.reminders).to.deep.equal({ useDefault: true });
        expect(fm.eventType).to.equal("deep-work");
    });

    it("maps transparency back into frontmatter", () => {
        const fm = remoteEventToNote(
            { id: "e1", summary: "Focus", transparency: "transparent" },
            "primary",
        );
        expect(fm.transparency).to.equal("transparent");
    });

    it("keeps a single RRULE as a string but preserves multiple lines as an array", () => {
        const single = remoteEventToNote(
            { id: "e1", summary: "X", recurrence: ["RRULE:FREQ=DAILY"] },
            "primary",
        );
        expect(single.recurrence).to.equal("RRULE:FREQ=DAILY");

        const multi = remoteEventToNote(
            { id: "e2", summary: "Y", recurrence: ["RRULE:FREQ=WEEKLY", "EXDATE:20260615T090000Z"] },
            "primary",
        );
        expect(multi.recurrence).to.deep.equal([
            "RRULE:FREQ=WEEKLY",
            "EXDATE:20260615T090000Z",
        ]);
    });

    it("emits the detailed attendee form only when metadata is present", () => {
        const fm = remoteEventToNote(
            {
                id: "e1",
                summary: "Sync",
                attendees: [
                    { email: "a@x.com", responseStatus: "accepted", displayName: "Ada" },
                    { email: "b@x.com", optional: true, responseStatus: "needsAction" },
                ],
            },
            "primary",
        );
        expect(fm.attendees).to.deep.equal([
            { email: "a@x.com", responseStatus: "accepted", displayName: "Ada" },
            { email: "b@x.com", optional: true, responseStatus: "needsAction" },
        ]);
    });

    it("maps the Meet link from hangoutLink and from conferenceData", () => {
        const fromHangout = remoteEventToNote(
            { id: "e1", summary: "Call", hangoutLink: "https://meet.google.com/abc-defg-hij" },
            "primary",
        );
        expect(fromHangout.meetLink).to.equal("https://meet.google.com/abc-defg-hij");

        const fromConf = remoteEventToNote(
            {
                id: "e2",
                summary: "Call",
                conferenceData: {
                    entryPoints: [
                        { entryPointType: "phone", uri: "tel:+64..." },
                        { entryPointType: "video", uri: "https://meet.google.com/xyz" },
                    ],
                },
            },
            "primary",
        );
        expect(fromConf.meetLink).to.equal("https://meet.google.com/xyz");
    });

    it("maps attachments and source back into frontmatter", () => {
        const fm = remoteEventToNote(
            {
                id: "e1",
                summary: "Doc",
                attachments: [{ fileUrl: "https://drive/abc", title: "Spec", mimeType: "application/pdf" }],
                source: { title: "Ticket", url: "https://tracker/1" },
            },
            "primary",
        );
        expect(fm.attachments).to.deep.equal([
            { fileUrl: "https://drive/abc", title: "Spec", mimeType: "application/pdf" },
        ]);
        expect(fm.source).to.deep.equal({ title: "Ticket", url: "https://tracker/1" });
    });
});

describe("taskToGoogle", () => {
    it("maps an incomplete task with due + notes", () => {
        const fm: TaskFrontmatter = {
            title: "Buy groceries",
            due: "2026-05-30T18:00:00",
            notes: "Almond milk.",
            completed: false,
        };
        const t = taskToGoogle(fm, NZ);
        expect(t.title).to.equal("Buy groceries");
        expect(t.notes).to.equal("Almond milk.");
        expect(t.due).to.equal("2026-05-30T00:00:00.000Z");
        expect(t.status).to.equal("needsAction");
    });

    it("marks completed tasks", () => {
        const t = taskToGoogle({ title: "Done", completed: true }, NZ);
        expect(t.status).to.equal("completed");
        expect(t.due).to.equal(undefined);
    });

    it("never puts parent in the body (it's a query param on insert/move)", () => {
        const t = taskToGoogle({ title: "Sub", parent: "[[Parent]]" }, NZ);
        expect(t).to.not.have.property("parent");
    });
});

describe("remoteTaskToNote", () => {
    it("maps notes + due and leaves parent unset for a top-level task", () => {
        const fm = remoteTaskToNote(
            { id: "t1", title: "Buy milk", notes: "2%", due: "2026-06-01T00:00:00.000Z" },
            "L1",
        );
        expect(fm.title).to.equal("Buy milk");
        expect(fm.notes).to.equal("2%");
        expect(fm.due).to.equal("2026-06-01T00:00:00.000Z");
        expect(fm.tasklist).to.equal("L1");
        expect(fm.parent).to.equal(undefined);
    });

    it("writes parent as a wikilink to the resolved parent note basename", () => {
        const fm = remoteTaskToNote(
            { id: "c1", title: "Sub", parent: "p1" },
            "L1",
            "buy-milk-p1",
        );
        expect(fm.parent).to.equal("[[buy-milk-p1]]");
    });

    it("omits parent when the parent basename couldn't be resolved", () => {
        const fm = remoteTaskToNote({ id: "c1", title: "Sub", parent: "p1" }, "L1", undefined);
        expect(fm.parent).to.equal(undefined);
    });

    it("writes the Google-assigned position (read-only) back into frontmatter", () => {
        const fm = remoteTaskToNote({ id: "t1", title: "X", position: "00000000000000001234" }, "L1");
        expect(fm.position).to.equal("00000000000000001234");
    });
});

describe("mergeManagedFrontmatter", () => {
    it("preserves user keys while taking managed keys from Google (task)", () => {
        const existing = {
            title: "old title",
            due: "2026-06-01",
            completed: false,
            googleId: "t1",
            related: "[[Some concept]]",
            tags: ["wiki", "setup"],
        };
        const incoming = {
            title: "Set up promptfoo/promptfoo",
            completed: false,
            status: "needsAction",
            googleId: "t1",
        };
        const merged = mergeManagedFrontmatter(existing, incoming, "task");
        // managed: taken from Google, including the now-removed `due`
        expect(merged.title).to.equal("Set up promptfoo/promptfoo");
        expect(merged.due).to.equal(undefined);
        expect(merged.status).to.equal("needsAction");
        // unmanaged: preserved
        expect(merged.related).to.equal("[[Some concept]]");
        expect(merged.tags).to.deep.equal(["wiki", "setup"]);
    });

    it("preserves the event `tasks` link field and other user keys across import", () => {
        const existing = {
            title: "Flight",
            date: "2026-06-01T09:00",
            googleId: "e1",
            tasks: ["[[Pack bags for malaysia]]"],
            project: "[[Malaysia trip]]",
        };
        const incoming = {
            title: "Flight to KL",
            date: "2026-06-01T13:00",
            googleId: "e1",
            calendarId: "primary",
        };
        const merged = mergeManagedFrontmatter(existing, incoming, "event");
        expect(merged.title).to.equal("Flight to KL");
        expect(merged.date).to.equal("2026-06-01T13:00");
        expect(merged.tasks).to.deep.equal(["[[Pack bags for malaysia]]"]);
        expect(merged.project).to.equal("[[Malaysia trip]]");
    });
});
