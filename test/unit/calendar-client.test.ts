import { describe, it } from "mocha";
import { expect } from "chai";
import { GoogleCalendarClient } from "../../src/google/calendar";
import { GoogleApiError } from "../../src/google/api";
import { fakeHttp, jsonResp, noWaitRetry, token } from "./helpers/fakeHttp";

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

    it("bounds a list to the given time window", async () => {
        const { calls, fn } = fakeHttp([jsonResp(200, { items: [] })]);
        const client = new GoogleCalendarClient(fn, token, noWaitRetry);

        await client.listEvents("primary", {
            timeMin: "2026-05-22T00:00:00.000Z",
            timeMax: "2026-08-27T00:00:00.000Z",
        });

        expect(calls[0]?.url).to.equal(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&showDeleted=true&timeMin=2026-05-22T00%3A00%3A00.000Z&timeMax=2026-08-27T00%3A00%3A00.000Z",
        );
    });

    it("patches an event by id", async () => {
        const { calls, fn } = fakeHttp([jsonResp(200, { id: "ev1" })]);
        const client = new GoogleCalendarClient(fn, token, noWaitRetry);
        await client.patchEvent("primary", "ev1", { location: "Room B" });
        expect(calls[0]?.method).to.equal("PATCH");
        expect(calls[0]?.url).to.contain("/events/ev1");
    });

    it("passes conferenceDataVersion and supportsAttachments query params on insert", async () => {
        const { calls, fn } = fakeHttp([jsonResp(200, { id: "ev1" })]);
        const client = new GoogleCalendarClient(fn, token, noWaitRetry);
        await client.insertEvent(
            "primary",
            { summary: "Call" },
            { conferenceDataVersion: 1, supportsAttachments: true },
        );
        expect(calls[0]?.url).to.equal(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&supportsAttachments=true",
        );
    });

    it("passes conferenceDataVersion on patch and omits unset query params", async () => {
        const { calls, fn } = fakeHttp([
            jsonResp(200, { id: "ev1" }),
            jsonResp(200, { id: "ev1" }),
        ]);
        const client = new GoogleCalendarClient(fn, token, noWaitRetry);
        await client.patchEvent("primary", "ev1", {}, { conferenceDataVersion: 1 });
        expect(calls[0]?.url).to.equal(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events/ev1?conferenceDataVersion=1",
        );
        await client.patchEvent("primary", "ev1", { location: "B" });
        expect(calls[1]?.url).to.equal(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events/ev1",
        );
    });

    it("has no delete capability (one-way: nothing here may delete Google events)", () => {
        const client = new GoogleCalendarClient(fakeHttp().fn, token, noWaitRetry);
        expect((client as unknown as Record<string, unknown>).deleteEvent).to.equal(undefined);
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
