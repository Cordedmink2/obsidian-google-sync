import { describe, it } from "mocha";
import { expect } from "chai";
import { GoogleCalendarClient } from "../../src/google/calendar";
import { GoogleApiError } from "../../src/google/api";
import { emptyResp, fakeHttp, jsonResp, noWaitRetry, token } from "./helpers/fakeHttp";

describe("GoogleCalendarClient", () => {
    it("inserts an event with bearer auth and JSON body", async () => {
        const { calls, fn } = fakeHttp([jsonResp(200, { id: "ev1", summary: "Standup" })]);
        const client = new GoogleCalendarClient(fn, token, noWaitRetry);

        const result = await client.insertEvent("primary", { summary: "Standup" });

        expect(result.id).to.equal("ev1");
        expect(calls[0]?.method).to.equal("POST");
        expect(calls[0]?.url).to.equal(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        );
        expect(calls[0]?.headers?.Authorization).to.equal("Bearer test-token");
        expect(JSON.parse(calls[0]?.body ?? "{}")).to.deep.equal({ summary: "Standup" });
    });

    it("patches an event by id", async () => {
        const { calls, fn } = fakeHttp([jsonResp(200, { id: "ev1" })]);
        const client = new GoogleCalendarClient(fn, token, noWaitRetry);
        await client.patchEvent("primary", "ev1", { location: "Room B" });
        expect(calls[0]?.method).to.equal("PATCH");
        expect(calls[0]?.url).to.contain("/events/ev1");
    });

    it("deletes an event (handles empty 204)", async () => {
        const { calls, fn } = fakeHttp([emptyResp(204)]);
        const client = new GoogleCalendarClient(fn, token, noWaitRetry);
        await client.deleteEvent("primary", "ev1");
        expect(calls[0]?.method).to.equal("DELETE");
    });

    it("throws GoogleApiError on 404", async () => {
        const { fn } = fakeHttp([jsonResp(404, { error: { message: "Not Found" } })]);
        const client = new GoogleCalendarClient(fn, token, noWaitRetry);
        let err: unknown;
        try {
            await client.patchEvent("primary", "missing", {});
        } catch (e) {
            err = e;
        }
        expect(err).to.be.instanceOf(GoogleApiError);
        expect((err as GoogleApiError).status).to.equal(404);
    });

    it("retries a 429 then succeeds", async () => {
        const { calls, fn } = fakeHttp([jsonResp(429), jsonResp(200, { id: "ev2" })]);
        const client = new GoogleCalendarClient(fn, token, noWaitRetry);
        const result = await client.insertEvent("primary", { summary: "X" });
        expect(result.id).to.equal("ev2");
        expect(calls).to.have.length(2);
    });

    it("lists calendars", async () => {
        const { fn } = fakeHttp([jsonResp(200, { items: [{ id: "primary", primary: true }] })]);
        const client = new GoogleCalendarClient(fn, token, noWaitRetry);
        const cals = await client.listCalendars();
        expect(cals).to.have.length(1);
        expect(cals[0]?.id).to.equal("primary");
    });
});
