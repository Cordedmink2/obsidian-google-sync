import { describe, it } from "mocha";
import { expect } from "chai";
import { mergeManagedFrontmatter, remoteTaskToNote, taskToGoogle } from "../../src/sync/mapper";
import { isPast } from "../../src/sync/dates";
import { DateTime } from "luxon";

/**
 * Issue #7. Google Tasks stores a Deadline (date only) and cannot hold a time of day, so
 * a time on `due` is the vault's own refinement: Google never supplies it and can never
 * contradict it. Google still owns the date.
 */
describe("task due refinement", () => {
    const zone = "Pacific/Auckland";

    /** What Google echoes back for a given calendar date: always UTC midnight. */
    function googleEcho(date: string, extra: Record<string, unknown> = {}) {
        return {
            id: "t1",
            title: "Web 2",
            status: "needsAction" as const,
            due: `${date}T00:00:00.000Z`,
            ...extra,
        };
    }

    function importOnto(existing: Record<string, unknown>, echoed: ReturnType<typeof googleEcho>) {
        const incoming = remoteTaskToNote(echoed, "@default");
        return mergeManagedFrontmatter(existing, incoming, "task");
    }

    const withTime = {
        title: "Web 2",
        completed: false,
        status: "needsAction",
        due: "2026-09-10T14:00",
    };

    it("keeps a time the user typed into `due` across an import", () => {
        expect(importOnto(withTime, googleEcho("2026-09-10")).due).to.equal("2026-09-10T14:00");
    });

    it("carries the time onto the new date when Google moves the deadline", () => {
        expect(importOnto(withTime, googleEcho("2026-09-11")).due).to.equal("2026-09-11T14:00");
    });

    it("drops the time when Google clears the deadline, since there is nothing to refine", () => {
        const echoed = { id: "t1", title: "Web 2", status: "needsAction" as const };
        const incoming = remoteTaskToNote(echoed, "@default");
        const merged = mergeManagedFrontmatter(withTime, incoming, "task");
        expect(merged.due).to.equal(undefined);
    });

    it("leaves a date-only note exactly as it behaves today", () => {
        const bare = { title: "Web 2", completed: false, status: "needsAction", due: "2026-09-10" };
        expect(importOnto(bare, googleEcho("2026-09-10")).due).to.equal("2026-09-10");
        expect(importOnto(bare, googleEcho("2026-09-11")).due).to.equal("2026-09-11");
    });

    it("preserves seconds and an explicit offset verbatim", () => {
        const precise = { ...withTime, due: "2026-09-10T14:00:00+12:00" };
        expect(importOnto(precise, googleEcho("2026-09-10")).due).to.equal(
            "2026-09-10T14:00:00+12:00",
        );
    });

    it("still sends Google a date-only due, whatever the note says", () => {
        expect(taskToGoogle(withTime, zone).due).to.equal("2026-09-10T00:00:00.000Z");
    });

    it("does not treat a task as overdue until its time has passed", () => {
        const tenAm = DateTime.fromISO("2026-09-10T10:00", { zone });
        expect(isPast("2026-09-10", zone, tenAm), "a bare date is overdue from midnight").to.equal(
            true,
        );
        expect(isPast("2026-09-10T14:00", zone, tenAm), "2pm has not passed at 10am").to.equal(
            false,
        );
        expect(isPast("2026-09-10T09:00", zone, tenAm), "9am has passed at 10am").to.equal(true);
    });
});
