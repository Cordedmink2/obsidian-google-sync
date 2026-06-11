import { browser } from "@wdio/globals";
import { before, beforeEach, describe, it } from "mocha";
import { expect } from "chai";
import { MockCall, getMockCalls, resetMockCalls, setupGoogleSyncMock } from "./helpers/mockGoogle";

// Note: executeObsidian callbacks are serialized to the renderer, so they cannot reference
// module-scope helpers — plugin access is inlined in each callback.

describe("event sync against mocked Google", function () {
    before(async () => {
        await setupGoogleSyncMock();
    });
    beforeEach(async () => {
        await resetMockCalls();
    });

    it("does not create a Google event for a note without googleId (one-way)", async () => {
        const googleId = await browser.executeObsidian(async ({ app, obsidian }) => {
            const plugin = (app as unknown as { plugins: { plugins: Record<string, unknown> } })
                .plugins.plugins["google-sync"] as { syncNow(): Promise<void> };
            if (!app.vault.getAbstractFileByPath("events")) await app.vault.createFolder("events");
            const path = "events/standup.md";
            const old = app.vault.getAbstractFileByPath(path);
            if (old instanceof obsidian.TFile) await app.vault.delete(old);
            await app.vault.create(
                path,
                "---\ntitle: Standup\ndate: 2026-06-02T09:00:00\ntimezone: Pacific/Auckland\n---\n\nbody\n",
            );
            await plugin.syncNow();
            const file = app.vault.getAbstractFileByPath(path);
            if (!(file instanceof obsidian.TFile)) return null;
            const content = await app.vault.read(file);
            const m = content.match(/googleId:\s*"?([^"\n]+)"?/);
            return m ? m[1] : null;
        });

        expect(googleId).to.equal(null);

        const calls = await getMockCalls();
        const insert = calls.find(
            (c: MockCall) => c.method === "POST" && c.url.includes("/events"),
        );
        expect(insert, "sync must never POST a new event").to.equal(undefined);
    });

    it("requests a Meet link for conferencing:true on patch and writes meetLink back", async () => {
        const meetLink = await browser.executeObsidian(async ({ app, obsidian }) => {
            const plugin = (app as unknown as { plugins: { plugins: Record<string, unknown> } })
                .plugins.plugins["google-sync"] as { syncNow(): Promise<void> };
            if (!app.vault.getAbstractFileByPath("events")) await app.vault.createFolder("events");
            const path = "events/call.md";
            const old = app.vault.getAbstractFileByPath(path);
            if (old instanceof obsidian.TFile) await app.vault.delete(old);
            await app.vault.create(
                path,
                "---\ntitle: Call\ndate: 2026-06-04T09:00:00\ntimezone: Pacific/Auckland\nconferencing: true\ngoogleId: ev-conf\n---\n",
            );
            await plugin.syncNow();
            const file = app.vault.getAbstractFileByPath(path);
            if (!(file instanceof obsidian.TFile)) return null;
            const content = await app.vault.read(file);
            const m = content.match(/meetLink:\s*"?([^"\n]+)"?/);
            return m ? m[1] : null;
        });

        const calls = await getMockCalls();
        const patch = calls.find(
            (c: MockCall) =>
                c.method === "PATCH" &&
                c.url.includes("/events/ev-conf") &&
                c.url.includes("conferenceDataVersion=1"),
        );
        if (!patch) throw new Error("no conferencing patch recorded");
        const body = JSON.parse(patch.body ?? "{}") as {
            conferenceData?: { createRequest?: unknown };
        };
        expect(body.conferenceData?.createRequest).to.not.equal(undefined);
        expect(meetLink).to.equal("https://meet.google.com/e2e-link");
    });

    it("patches an existing event (note already has googleId)", async () => {
        await browser.executeObsidian(async ({ app, obsidian }) => {
            const plugin = (app as unknown as { plugins: { plugins: Record<string, unknown> } })
                .plugins.plugins["google-sync"] as { syncNow(): Promise<void> };
            const path = "events/existing.md";
            const old = app.vault.getAbstractFileByPath(path);
            if (old instanceof obsidian.TFile) await app.vault.delete(old);
            await app.vault.create(
                path,
                "---\ntitle: Existing\ndate: 2026-06-03T10:00:00\ntimezone: Pacific/Auckland\ngoogleId: ev-existing\n---\n",
            );
            await plugin.syncNow();
        });

        const calls = await getMockCalls();
        const patch = calls.find(
            (c: MockCall) => c.method === "PATCH" && c.url.includes("/events/ev-existing"),
        );
        if (!patch) throw new Error("no calendar patch recorded");
        const body = JSON.parse(patch.body ?? "{}") as { summary?: string };
        expect(body.summary).to.equal("Existing");
    });

    it("leaves the Google event alone when the note is deleted (one-way)", async () => {
        await browser.executeObsidian(async ({ app, obsidian }) => {
            const plugin = (app as unknown as { plugins: { plugins: Record<string, unknown> } })
                .plugins.plugins["google-sync"] as { syncNow(): Promise<void> };
            const path = "events/to-delete.md";
            const old = app.vault.getAbstractFileByPath(path);
            if (old instanceof obsidian.TFile) await app.vault.delete(old);
            await app.vault.create(
                path,
                "---\ntitle: Delete me\ndate: 2026-06-04T10:00:00\ntimezone: Pacific/Auckland\ngoogleId: ev-del\n---\n",
            );
            await plugin.syncNow();
            const file = app.vault.getAbstractFileByPath(path);
            if (file instanceof obsidian.TFile) await app.vault.delete(file);
        });

        // Give a would-be delete handler ample time to fire, then assert it never did.
        await browser.pause(2500);
        const calls = await getMockCalls();
        const del = calls.find((c: MockCall) => c.method === "DELETE");
        expect(del, "note deletion must never delete the Google event").to.equal(undefined);
    });
});
