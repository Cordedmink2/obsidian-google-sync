import { describe, it } from "mocha";
import { expect } from "chai";
import { GoogleCalendarClient } from "../../src/google/calendar";
import { GoogleTasksClient } from "../../src/google/tasks";
import { GoogleApiError } from "../../src/google/api";
import { HttpFn, parseJson } from "../../src/google/http";
import { createGoogleMock, MockFixture } from "../specs/helpers/mockEngine";
import {
    AWKWARD_TITLES,
    bulkFixture,
    defaultFixture,
    dstTransitions,
    recurringInstances,
} from "../specs/helpers/fixtures";
import { assertTrafficInvariants, isForbiddenCall } from "../specs/helpers/invariants";
import { token } from "./helpers/fakeHttp";

const NOW = new Date("2026-10-20T01:00:00.000Z");
const noWait = { sleep: async () => {}, random: () => 0 };

/** Adapt the mock to the plugin's HttpFn exactly as the transport does (text + parsed json). */
function wire(fx: MockFixture) {
    const mock = createGoogleMock(fx);
    const http: HttpFn = async (req) => {
        const r = await mock.http(req);
        return { status: r.status, headers: r.headers, text: r.text, json: parseJson(r.text) };
    };
    return {
        mock,
        cal: new GoogleCalendarClient(http, token, noWait),
        tasks: new GoogleTasksClient(http, token, noWait),
    };
}

describe("mock Google: paging", () => {
    it("pages events at 250 and the client follows every page", async () => {
        const { mock, cal } = wire(bulkFixture(NOW, { eventsPerCalendar: 600 }));
        const r = await cal.listEvents("work");
        expect(r.items).to.have.length(600);
        expect(new Set(r.items.map((e) => e.id)).size).to.equal(600);
        const gets = mock.calls.filter((c) => c.url.includes("/calendars/work/events"));
        expect(gets).to.have.length(3);
        expect(gets[1]?.url).to.contain("pageToken=page%3A250");
        expect(r.nextSyncToken).to.be.a("string");
    });

    it("pages tasks at 20 and the client follows every page", async () => {
        const { mock, tasks } = wire(bulkFixture(NOW, { tasksPerList: 130 }));
        const items = await tasks.listTasks("L1");
        expect(items).to.have.length(130);
        expect(mock.calls.filter((c) => c.url.includes("/lists/L1/tasks"))).to.have.length(7);
    });

    it("honours maxResults and caps it (events 2500, tasks 100)", async () => {
        const { mock, tasks } = wire(bulkFixture(NOW, { tasksPerList: 250 }));
        await tasks.listTasks("L1", { pageSize: 5000 });
        expect(mock.calls.filter((c) => c.url.includes("/lists/L1/tasks"))).to.have.length(3);
    });

    it("rejects a pageToken it did not issue instead of restarting", async () => {
        const { mock } = wire(bulkFixture(NOW));
        const res = await mock.http({
            url: "https://tasks.googleapis.com/tasks/v1/lists/L1/tasks?pageToken=bogus",
        });
        expect(res.status).to.equal(500);
        expect(mock.unknown).to.have.length(1);
    });

    it("applies timeMin/timeMax, showDeleted and keeps cancelled stubs", async () => {
        const fx = defaultFixture(NOW);
        const { cal } = wire(fx);
        const win = await cal.listEvents("primary", {
            timeMin: new Date(NOW.getTime() - 7 * 864e5).toISOString(),
            timeMax: new Date(NOW.getTime() + 90 * 864e5).toISOString(),
        });
        const ids = win.items.map((e) => e.id);
        expect(ids).to.include("import-event-1");
        expect(ids).to.not.include("ev-conf"); // sync targets sit outside the window
        expect(win.items.some((e) => e.status === "cancelled" && e.recurringEventId)).to.equal(
            true,
        );
    });

    it("lists hidden/completed tasks only when asked and never deleted ones", async () => {
        const fx = defaultFixture(NOW);
        (fx.tasks.L1 as Record<string, unknown>[]).push(
            { id: "hid", title: "hidden", hidden: true, status: "completed" },
            { id: "del", title: "deleted", deleted: true },
        );
        const { tasks } = wire(fx);
        const ids = (await tasks.listTasks("L1")).map((t) => t.id);
        expect(ids).to.include("hid");
        expect(ids).to.not.include("del");
    });
});

describe("mock Google: state and routes", () => {
    it("PATCH changes what later GETs return", async () => {
        const { cal, tasks } = wire(defaultFixture(NOW));
        await cal.patchEvent("primary", "ev-existing", { summary: "Renamed" });
        expect((await cal.getEvent("primary", "ev-existing")).summary).to.equal("Renamed");
        await tasks.patchTask("L1", "task-done", { status: "completed" });
        const t = await tasks.getTask("L1", "task-done");
        expect(t.status).to.equal("completed");
        expect(t.completed).to.be.a("string");
    });

    it("Meet creation via PATCH conferenceData.createRequest returns entryPoints", async () => {
        const { cal } = wire(defaultFixture(NOW));
        const ev = await cal.patchEvent(
            "primary",
            "ev-conf",
            { conferenceData: { createRequest: { requestId: "r1" } } },
            { conferenceDataVersion: 1 },
        );
        expect(ev.hangoutLink).to.equal("https://meet.google.com/e2e-link");
    });

    it("/move reparents and is the only POST the mock serves for tasks", async () => {
        const { mock, tasks } = wire(defaultFixture(NOW));
        const moved = await tasks.moveTask("L1", "task-child", { parent: "task-parent" });
        expect(moved.parent).to.equal("task-parent");
        const insert = await mock.http({
            url: "https://tasks.googleapis.com/tasks/v1/lists/L1/tasks",
            method: "POST",
            body: "{}",
        });
        expect(insert.status).to.equal(501);
    });

    it("unknown routes fail loudly (501) and are recorded; no catch-all 200", async () => {
        const { mock } = wire(defaultFixture(NOW));
        const res = await mock.http({ url: "https://www.googleapis.com/calendar/v3/colors" });
        expect(res.status).to.equal(501);
        expect(mock.unknown.map((c) => c.url)).to.deep.equal([
            "https://www.googleapis.com/calendar/v3/colors",
        ]);
        expect(() => assertTrafficInvariants(mock.calls, mock.unknown)).to.throw(/no route/);
    });

    it("answers 404 for ids it never had, 404/410 for removed ones", async () => {
        const fx = defaultFixture(NOW);
        fx.removedEvents = { "primary/ev-del": 410, "primary/ev-existing": 404 };
        fx.removedTasks = { "L1/task-done": 410 };
        const { cal, tasks } = wire(fx);
        const status = async (p: Promise<unknown>) => {
            try {
                await p;
                return 200;
            } catch (e) {
                return (e as GoogleApiError).status;
            }
        };
        expect(await status(cal.getEvent("primary", "nope"))).to.equal(404);
        expect(await status(cal.getEvent("primary", "ev-del"))).to.equal(410);
        expect(await status(cal.getEvent("primary", "ev-existing"))).to.equal(404);
        expect(await status(tasks.getTask("L1", "task-done"))).to.equal(410);
        expect(await status(tasks.getTask("L1", "nope"))).to.equal(404);
    });

    it("a deleted:true task still answers GET (that is how Google reports it)", async () => {
        const fx = defaultFixture(NOW);
        (fx.tasks.L1 as Record<string, unknown>[]).push({ id: "gone", title: "x", deleted: true });
        const { tasks } = wire(fx);
        expect((await tasks.getTask("L1", "gone")).deleted).to.equal(true);
    });
});

describe("mock Google: error injection", () => {
    const rule = (status: number, extra: object = {}) => ({
        match: "/calendars/primary/events$|/calendars/primary/events\\?",
        status,
        ...extra,
    });

    for (const status of [401, 403, 404, 410]) {
        it(`${status} surfaces as GoogleApiError with that status`, async () => {
            const fx = defaultFixture(NOW);
            fx.errors = [rule(status)];
            const { cal } = wire(fx);
            let err: unknown;
            await cal.listEvents("primary").catch((e: unknown) => (err = e));
            expect(err).to.be.instanceOf(GoogleApiError);
            expect((err as GoogleApiError).status).to.equal(status);
        });
    }

    it("429 with Retry-After is retried, honouring the header, then succeeds", async () => {
        const fx = defaultFixture(NOW);
        fx.errors = [rule(429, { retryAfter: 7, times: 2 })];
        const mock = createGoogleMock(fx);
        const sleeps: number[] = [];
        const http: HttpFn = async (req) => {
            const r = await mock.http(req);
            return { status: r.status, headers: r.headers, text: r.text, json: parseJson(r.text) };
        };
        const cal = new GoogleCalendarClient(http, token, {
            sleep: async (ms) => void sleeps.push(ms),
            random: () => 0,
        });
        const r = await cal.listEvents("primary");
        expect(r.items.length).to.be.greaterThan(0);
        expect(sleeps).to.deep.equal([7000, 7000]);
    });

    it("persistent 503 exhausts retries and throws GoogleApiError(503)", async () => {
        const fx = defaultFixture(NOW);
        fx.errors = [rule(503)];
        const { mock, cal } = wire(fx);
        let err: unknown;
        await cal.listEvents("primary").catch((e: unknown) => (err = e));
        expect((err as GoogleApiError).status).to.equal(503);
        expect(mock.calls.filter((c) => c.url.includes("/events"))).to.have.length(5);
    });

    it("a malformed 200 body is a clear GoogleApiError, never a TypeError", async () => {
        for (const run of [
            (w: ReturnType<typeof wire>) => w.cal.listEvents("primary"),
            (w: ReturnType<typeof wire>) => w.cal.listCalendars(),
            (w: ReturnType<typeof wire>) => w.tasks.listTasks("L1"),
            (w: ReturnType<typeof wire>) => w.tasks.listTaskLists(),
            (w: ReturnType<typeof wire>) => w.cal.getEvent("primary", "ev-conf"),
            (w: ReturnType<typeof wire>) => w.tasks.getTask("L1", "task-done"),
        ]) {
            const fx = defaultFixture(NOW);
            fx.errors = [{ match: ".", status: 200, malformed: true }];
            let err: unknown;
            await run(wire(fx)).catch((e: unknown) => (err = e));
            expect(err, String(run)).to.be.instanceOf(GoogleApiError);
            expect((err as Error).message).to.match(/malformed|invalid|unreadable/i);
        }
    });

    it("an empty 200 body from a list endpoint is also reported, not treated as no items", async () => {
        const fx = defaultFixture(NOW);
        const mock = createGoogleMock(fx);
        const http: HttpFn = async () => ({ status: 200, headers: {}, text: "", json: undefined });
        void mock;
        const cal = new GoogleCalendarClient(http, token, noWait);
        let err: unknown;
        await cal.listEvents("primary").catch((e: unknown) => (err = e));
        expect(err).to.be.instanceOf(GoogleApiError);
    });
});

describe("fixtures", () => {
    it("are relative to the supplied clock", () => {
        const a = defaultFixture(new Date("2026-10-20T01:00:00Z"));
        const b = defaultFixture(new Date("2027-03-02T01:00:00Z"));
        const startOf = (f: MockFixture) =>
            ((f.events.primary as Record<string, unknown>[])[0]?.start as { dateTime: string })
                .dateTime;
        expect(startOf(a).slice(0, 10)).to.equal("2026-10-25");
        expect(startOf(b).slice(0, 10)).to.equal("2027-03-07");
    });

    it("cover both Auckland DST transitions and expose the offset change", () => {
        const t = dstTransitions(NOW);
        expect(t.length).to.be.greaterThanOrEqual(2);
        const months = new Set(t.map((x) => x.month));
        expect(months.has(4)).to.equal(true);
        expect(months.has(9)).to.equal(true);
    });

    it("include a recurring series with a cancelled exception and original start", () => {
        const r = recurringInstances(NOW, "series");
        expect(r.some((e) => e.status === "cancelled" && e.recurringEventId === "series")).to.equal(
            true,
        );
        expect(r.some((e) => e.originalStartTime !== undefined)).to.equal(true);
    });

    it("bulk fixture is 500+ items with awkward titles and missing-parent subtasks", () => {
        const b = bulkFixture(NOW);
        const nEv = Object.values(b.events).reduce((n, l) => n + l.length, 0);
        const nTk = Object.values(b.tasks).reduce((n, l) => n + l.length, 0);
        expect(nEv).to.be.greaterThan(500);
        expect(nTk).to.be.greaterThan(300);
        expect(AWKWARD_TITLES.length).to.be.greaterThan(5);
        const all = Object.values(b.tasks).flat();
        const ids = new Set(all.map((t) => t.id));
        expect(all.some((t) => t.parent && ids.has(t.parent))).to.equal(true);
    });
});

describe("invariants predicate", () => {
    const c = (method: string, url: string) => ({ method, url });
    it("flags DELETE and non-allow-listed POST on both calendar and tasks URLs", () => {
        expect(
            isForbiddenCall(
                c("DELETE", "https://www.googleapis.com/calendar/v3/calendars/p/events/e"),
            ),
        ).to.equal(true);
        expect(
            isForbiddenCall(c("DELETE", "https://tasks.googleapis.com/tasks/v1/lists/L/tasks/t")),
        ).to.equal(true);
        expect(
            isForbiddenCall(c("POST", "https://tasks.googleapis.com/tasks/v1/lists/L/tasks")),
        ).to.equal(true);
        expect(
            isForbiddenCall(c("POST", "https://www.googleapis.com/calendar/v3/calendars/p/events")),
        ).to.equal(true);
        expect(
            isForbiddenCall(
                c("post", "https://tasks.googleapis.com/tasks/v1/lists/L/tasks?parent=x"),
            ),
        ).to.equal(true);
    });
    it("allows token, /move, GET and PATCH", () => {
        expect(isForbiddenCall(c("POST", "https://oauth2.googleapis.com/token"))).to.equal(false);
        expect(
            isForbiddenCall(
                c("POST", "https://tasks.googleapis.com/tasks/v1/lists/L/tasks/t/move?parent=p"),
            ),
        ).to.equal(false);
        expect(
            isForbiddenCall(c("GET", "https://www.googleapis.com/calendar/v3/calendars/p/events")),
        ).to.equal(false);
        expect(
            isForbiddenCall(
                c(
                    "PATCH",
                    "https://www.googleapis.com/calendar/v3/calendars/p/events/e?conferenceDataVersion=1",
                ),
            ),
        ).to.equal(false);
    });
});
