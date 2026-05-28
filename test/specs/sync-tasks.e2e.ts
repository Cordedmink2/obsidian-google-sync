import { browser } from "@wdio/globals";
import { before, beforeEach, describe, it } from "mocha";
import { expect } from "chai";
import { MockCall, getMockCalls, resetMockCalls, setupGoogleSyncMock } from "./helpers/mockGoogle";

// executeObsidian callbacks are serialized — plugin access is inlined in each.

describe("task sync against mocked Google", function () {
    before(async () => {
        await setupGoogleSyncMock();
    });
    beforeEach(async () => {
        await resetMockCalls();
    });

    it("inserts a new task and writes googleId back", async () => {
        const googleId = await browser.executeObsidian(async ({ app, obsidian }) => {
            const plugin = (app as unknown as { plugins: { plugins: Record<string, unknown> } })
                .plugins.plugins["google-sync"] as { syncNow(): Promise<void> };
            if (!app.vault.getAbstractFileByPath("tasks")) await app.vault.createFolder("tasks");
            const path = "tasks/buy-milk.md";
            const old = app.vault.getAbstractFileByPath(path);
            if (old instanceof obsidian.TFile) await app.vault.delete(old);
            await app.vault.create(
                path,
                "---\ntitle: Buy milk\ndue: 2026-05-30T18:00:00\ncompleted: false\n---\n",
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
            (c: MockCall) => c.method === "POST" && c.url.includes("/lists/L1/tasks"),
        );
        if (!insert) throw new Error("no task insert recorded");
        const body = JSON.parse(insert.body ?? "{}") as { title?: string; status?: string };
        expect(body.title).to.equal("Buy milk");
        expect(body.status).to.equal("needsAction");
    });

    it("marks a completed task as completed in Google", async () => {
        await browser.executeObsidian(async ({ app, obsidian }) => {
            const plugin = (app as unknown as { plugins: { plugins: Record<string, unknown> } })
                .plugins.plugins["google-sync"] as { syncNow(): Promise<void> };
            const path = "tasks/done.md";
            const old = app.vault.getAbstractFileByPath(path);
            if (old instanceof obsidian.TFile) await app.vault.delete(old);
            await app.vault.create(
                path,
                "---\ntitle: Done thing\ncompleted: true\ngoogleId: task-done\n---\n",
            );
            await plugin.syncNow();
        });

        const calls = await getMockCalls();
        const patch = calls.find(
            (c: MockCall) => c.method === "PATCH" && c.url.includes("/tasks/task-done"),
        );
        if (!patch) throw new Error("no task patch recorded");
        const body = JSON.parse(patch.body ?? "{}") as { status?: string };
        expect(body.status).to.equal("completed");
    });
});
