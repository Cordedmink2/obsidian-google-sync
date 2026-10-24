import { describe, it } from "mocha";
import { expect } from "chai";
import { GoogleCalendarClient } from "../../src/google/calendar";
import { GoogleTasksClient } from "../../src/google/tasks";
import { UnsafeRequestError, guardHttp } from "../../src/google/http";
import { fakeHttp, noWaitRetry, token } from "./helpers/fakeHttp";

const CAL = "https://www.googleapis.com/calendar/v3";
const TASKS = "https://tasks.googleapis.com/tasks/v1";
const TOKEN = "https://oauth2.googleapis.com/token";

async function outcome(method: string | undefined, url: string, body?: string) {
    const { calls, fn } = fakeHttp();
    let err: unknown;
    try {
        await guardHttp(fn)({ url, method, body });
    } catch (e) {
        err = e;
    }
    return { err, sent: calls.length };
}

describe("guardHttp (no create/delete defence in depth)", () => {
    it("refuses DELETE to calendar and tasks items, and sends nothing", async () => {
        for (const url of [
            `${CAL}/calendars/primary/events/e1`,
            `${TASKS}/lists/L1/tasks/t1`,
            `${TASKS}/lists/L1`,
        ]) {
            const r = await outcome("DELETE", url);
            expect(r.err, url).to.be.instanceOf(UnsafeRequestError);
            expect((r.err as Error).message).to.match(/DELETE/);
            expect(r.sent).to.equal(0);
        }
    });

    it("refuses lowercase and mixed-case delete", async () => {
        expect(
            (await outcome("delete", `${CAL}/calendars/primary/events/e1`)).err,
        ).to.be.instanceOf(UnsafeRequestError);
    });

    it("refuses POST to the events and tasks collections", async () => {
        for (const url of [
            `${CAL}/calendars/primary/events`,
            `${CAL}/calendars/primary/events?conferenceDataVersion=1`,
            `${CAL}/calendars/primary/events/quickAdd?text=x`,
            `${CAL}/calendars/primary/events/import`,
            `${CAL}/calendars`,
            `${TASKS}/lists/L1/tasks`,
            `${TASKS}/lists/L1/tasks?parent=p1`,
            `${TASKS}/users/@me/lists`,
            `${TASKS}/lists/L1/clear`,
        ]) {
            const r = await outcome("POST", url, "{}");
            expect(r.err, url).to.be.instanceOf(UnsafeRequestError);
            expect(r.sent).to.equal(0);
        }
    });

    it("treats a request with no method as a GET", async () => {
        expect((await outcome(undefined, `${CAL}/calendars/primary/events`)).err).to.equal(
            undefined,
        );
    });

    it("allows the OAuth token endpoint and Tasks /move", async () => {
        expect((await outcome("POST", TOKEN, "grant_type=refresh_token")).sent).to.equal(1);
        const move = await outcome("POST", `${TASKS}/lists/L1/tasks/t1/move?parent=p1`);
        expect(move.err).to.equal(undefined);
        expect(move.sent).to.equal(1);
        const enc = await outcome("POST", `${TASKS}/lists/%40default/tasks/t%201/move`);
        expect(enc.sent).to.equal(1);
    });

    it("does not allow a token-endpoint lookalike host", async () => {
        const r = await outcome("POST", "https://evil.example/oauth2.googleapis.com/token");
        expect(r.err).to.be.instanceOf(UnsafeRequestError);
        const r2 = await outcome("POST", `${TASKS}/lists/L1/tasks/move`);
        expect(r2.err).to.be.instanceOf(UnsafeRequestError);
    });

    it("allows GET and PATCH, including conferenceData createRequest", async () => {
        expect((await outcome("GET", `${CAL}/calendars/primary/events`)).sent).to.equal(1);
        const body = JSON.stringify({
            conferenceData: { createRequest: { requestId: "r1" } },
        });
        const r = await outcome(
            "PATCH",
            `${CAL}/calendars/primary/events/e1?conferenceDataVersion=1`,
            body,
        );
        expect(r.err).to.equal(undefined);
        expect(r.sent).to.equal(1);
        expect((await outcome("PATCH", `${TASKS}/lists/L1/tasks/t1`, "{}")).sent).to.equal(1);
    });

    it("guards the clients themselves, whatever transport they are given", async () => {
        const { calls, fn } = fakeHttp();
        const cal = new GoogleCalendarClient(fn, token, noWaitRetry);
        const tasks = new GoogleTasksClient(fn, token, noWaitRetry);
        // Reach past the typed API to prove the chokepoint holds even if a method sneaks back.
        const raw = (c: unknown, m: string, url: string) =>
            (c as { call(x: unknown): Promise<unknown> }).call({ method: m, url });
        let failures = 0;
        for (const p of [
            raw(cal, "DELETE", `${CAL}/calendars/primary/events/e1`),
            raw(cal, "POST", `${CAL}/calendars/primary/events`),
            raw(tasks, "DELETE", `${TASKS}/lists/L1/tasks/t1`),
            raw(tasks, "POST", `${TASKS}/lists/L1/tasks`),
        ]) {
            await p.catch((e: unknown) => {
                if (e instanceof UnsafeRequestError) failures++;
            });
        }
        expect(failures).to.equal(4);
        expect(calls).to.have.length(0);
    });

    it("is idempotent when wrapped twice", async () => {
        const { calls, fn } = fakeHttp();
        const g = guardHttp(guardHttp(fn));
        await g({ url: `${CAL}/calendars/primary/events` });
        expect(calls).to.have.length(1);
    });
});
