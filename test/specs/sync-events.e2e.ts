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

    it("inserts a new event and writes googleId back into the note", async () => {
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

        expect(googleId ?? "").to.match(/^mock-/);

        const calls = await getMockCalls();
        const insert = calls.find(
            (c: MockCall) => c.method === "POST" && c.url.endsWith("/events"),
        );
        if (!insert) throw new Error("no calendar insert recorded");
        const body = JSON.parse(insert.body ?? "{}") as { summary?: string; start?: unknown };
        expect(body.summary).to.equal("Standup");
        expect(body.start).to.not.equal(undefined);
    });

    it("requests a Meet link for conferencing:true and writes meetLink back", async () => {
        const meetLink = await browser.executeObsidian(async ({ app, obsidian }) => {
            const plugin = (app as unknown as { plugins: { plugins: Record<string, unknown> } })
                .plugins.plugins["google-sync"] as { syncNow(): Promise<void> };
            if (!app.vault.getAbstractFileByPath("events")) await app.vault.createFolder("events");
            const path = "events/call.md";
            const old = app.vault.getAbstractFileByPath(path);
            if (old instanceof obsidian.TFile) await app.vault.delete(old);
            await app.vault.create(
                path,
                "---\ntitle: Call\ndate: 2026-06-04T09:00:00\ntimezone: Pacific/Auckland\nconferencing: true\n---\n",
            );
            await plugin.syncNow();
            const file = app.vault.getAbstractFileByPath(path);
            if (!(file instanceof obsidian.TFile)) return null;
            const content = await app.vault.read(file);
            const m = content.match(/meetLink:\s*"?([^"\n]+)"?/);
            return m ? m[1] : null;
        });

        const calls = await getMockCalls();
        const insert = calls.find(
            (c: MockCall) =>
                c.method === "POST" &&
                c.url.includes("/events?") &&
                c.url.includes("conferenceDataVersion=1"),
        );
        if (!insert) throw new Error("no conferencing insert recorded");
        const body = JSON.parse(insert.body ?? "{}") as { conferenceData?: { createRequest?: unknown } };
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

    it("deletes the Google event when the note is deleted", async () => {
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
            await plugin.syncNow(); // populates the path -> id index
            const file = app.vault.getAbstractFileByPath(path);
            if (file instanceof obsidian.TFile) await app.vault.delete(file);
        });

        await browser.waitUntil(
            async () => {
                const calls = await getMockCalls();
                return calls.some(
                    (c: MockCall) => c.method === "DELETE" && c.url.includes("/events/ev-del"),
                );
            },
            { timeout: 8000, interval: 250, timeoutMsg: "no calendar delete recorded" },
        );
    });
});
