import { describe, it } from "mocha";
import { expect } from "chai";
import { GoogleCalendarClient } from "../../src/google/calendar";
import { GoogleTasksClient } from "../../src/google/tasks";
import { remoteEventToNote, remoteTaskToNote } from "../../src/sync/mapper";
import { jsonResp, fakeHttp, noWaitRetry, token } from "./helpers/fakeHttp";

describe("Google import sync", () => {
    it("lists every calendar event page with sync tokens and expands recurring events", async () => {
        const { calls, fn } = fakeHttp([
            jsonResp(200, {
                items: [{ id: "ev1", summary: "One" }],
                nextPageToken: "page-2",
            }),
            jsonResp(200, {
                items: [{ id: "ev2", summary: "Two" }],
                nextSyncToken: "sync-token-1",
            }),
        ]);
        const client = new GoogleCalendarClient(fn, token, noWaitRetry);

        const result = await client.listEvents("primary", {
            syncToken: "old-token",
            pageSize: 2,
        });

        expect(result.items.map((e) => e.id)).to.deep.equal(["ev1", "ev2"]);
        expect(result.nextSyncToken).to.equal("sync-token-1");
        expect(calls).to.have.length(2);
        expect(calls[0]?.url).to.equal(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&showDeleted=true&maxResults=2&syncToken=old-token",
        );
        expect(calls[1]?.url).to.equal(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&showDeleted=true&maxResults=2&syncToken=old-token&pageToken=page-2",
        );
    });

    it("lists every Google task page including completed and hidden tasks", async () => {
        const { calls, fn } = fakeHttp([
            jsonResp(200, {
                items: [{ id: "t1", title: "One" }],
                nextPageToken: "page-2",
            }),
            jsonResp(200, { items: [{ id: "t2", title: "Two" }] }),
        ]);
        const client = new GoogleTasksClient(fn, token, noWaitRetry);

        const tasks = await client.listTasks("@default", { pageSize: 2 });

        expect(tasks.map((t) => t.id)).to.deep.equal(["t1", "t2"]);
        expect(calls).to.have.length(2);
        expect(calls[0]?.url).to.equal(
            "https://tasks.googleapis.com/tasks/v1/lists/%40default/tasks?showCompleted=true&showHidden=true&maxResults=2",
        );
        expect(calls[1]?.url).to.equal(
            "https://tasks.googleapis.com/tasks/v1/lists/%40default/tasks?showCompleted=true&showHidden=true&maxResults=2&pageToken=page-2",
        );
    });

    it("maps a Google Calendar event into event note frontmatter", () => {
        const fm = remoteEventToNote(
            {
                id: "ev1",
                summary: "Dentist",
                description: "Bring forms",
                location: "Clinic",
                status: "confirmed",
                start: { dateTime: "2026-06-02T09:00:00+12:00", timeZone: "Pacific/Auckland" },
                end: { dateTime: "2026-06-02T10:00:00+12:00", timeZone: "Pacific/Auckland" },
                recurrence: ["RRULE:FREQ=WEEKLY"],
                attendees: [{ email: "a@example.com" }, { email: "b@example.com", optional: true }],
            },
            "primary",
        );

        expect(fm).to.deep.equal({
            title: "Dentist",
            date: "2026-06-02T09:00:00+12:00",
            end: "2026-06-02T10:00:00+12:00",
            timezone: "Pacific/Auckland",
            location: "Clinic",
            description: "Bring forms",
            status: "confirmed",
            calendarId: "primary",
            recurrence: "RRULE:FREQ=WEEKLY",
            attendees: { required: ["a@example.com"], optional: ["b@example.com"] },
            googleId: "ev1",
        });
    });

    it("maps a completed Google Task into task note frontmatter", () => {
        const fm = remoteTaskToNote(
            {
                id: "t1",
                title: "Buy milk",
                notes: "Oat",
                due: "2026-06-01T00:00:00.000Z",
                status: "completed",
                completed: "2026-06-01T03:04:05.000Z",
            },
            "L1",
        );

        expect(fm).to.deep.equal({
            title: "Buy milk",
            due: "2026-06-01",
            notes: "Oat",
            completed: true,
            status: "completed",
            googleId: "t1",
            tasklist: "L1",
        });
    });
});
