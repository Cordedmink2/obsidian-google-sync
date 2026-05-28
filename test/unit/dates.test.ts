import { describe, it } from "mocha";
import { expect } from "chai";
import { DateTime } from "luxon";
import { DateParseError, allDayEnd, eventDateTime, isPast, taskDue } from "../../src/sync/dates";

const NZ = "Pacific/Auckland"; // June = NZST (UTC+12)

describe("eventDateTime", () => {
    it("maps a timed local datetime to dateTime + timeZone", () => {
        const r = eventDateTime("2026-06-02T09:00:00", NZ);
        expect(r.timeZone).to.equal(NZ);
        expect(r.dateTime).to.equal("2026-06-02T09:00:00+12:00");
        expect(r.date).to.equal(undefined);
    });

    it("maps an all-day event to a bare date", () => {
        const r = eventDateTime("2026-06-02T00:00:00", NZ, true);
        expect(r.date).to.equal("2026-06-02");
        expect(r.dateTime).to.equal(undefined);
    });

    it("throws DateParseError on an invalid date", () => {
        expect(() => eventDateTime("not-a-date", NZ)).to.throw(DateParseError);
    });
});

describe("allDayEnd", () => {
    it("returns the exclusive next-day date", () => {
        expect(allDayEnd("2026-06-02", NZ).date).to.equal("2026-06-03");
    });
});

describe("taskDue", () => {
    it("converts a local due to UTC RFC3339", () => {
        // 18:00 NZST (+12) -> 06:00Z same day
        expect(taskDue("2026-05-30T18:00:00", NZ)).to.equal("2026-05-30T06:00:00Z");
    });
});

describe("isPast", () => {
    const now = DateTime.fromISO("2026-05-28T12:00:00", { zone: NZ });
    it("is true for an earlier time", () => {
        expect(isPast("2026-05-27T09:00:00", NZ, now)).to.equal(true);
    });
    it("is false for a later time", () => {
        expect(isPast("2026-05-29T09:00:00", NZ, now)).to.equal(false);
    });
    it("is false for an invalid date", () => {
        expect(isPast("nope", NZ, now)).to.equal(false);
    });
});
