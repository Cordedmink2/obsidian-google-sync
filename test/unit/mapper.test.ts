import { describe, it } from "mocha";
import { expect } from "chai";
import { eventToGoogle, taskToGoogle } from "../../src/sync/mapper";
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
});
