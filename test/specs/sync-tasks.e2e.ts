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

    it("nests a child task under its parent via the move/insert parent param", async () => {
        await browser.executeObsidian(async ({ app, obsidian }) => {
            if (!app.vault.getAbstractFileByPath("tasks")) await app.vault.createFolder("tasks");
            for (const p of ["tasks/renew-rego.md", "tasks/pick-up-car.md"]) {
                const old = app.vault.getAbstractFileByPath(p);
                if (old instanceof obsidian.TFile) await app.vault.delete(old);
            }
            // Parent already has a googleId so the child's wikilink can resolve to it.
            await app.vault.create(
                "tasks/renew-rego.md",
                "---\ntitle: Renew registration\ngoogleId: task-parent\ncompleted: false\n---\n",
            );
            await app.vault.create(
                "tasks/pick-up-car.md",
                '---\ntitle: Pick up the car\nparent: "[[renew-rego]]"\ncompleted: false\n---\n',
            );
        });

        // Wait for the metadata cache to index the parent's googleId before syncing.
        await browser.waitUntil(
            async () =>
                browser.executeObsidian(({ app }) => {
                    const dest = app.metadataCache.getFirstLinkpathDest(
                        "renew-rego",
                        "tasks/pick-up-car.md",
                    );
                    const fm = dest && app.metadataCache.getFileCache(dest)?.frontmatter;
                    return !!fm && fm.googleId === "task-parent";
                }),
            { timeout: 8000, interval: 250, timeoutMsg: "parent googleId not cached" },
        );

        await browser.executeObsidian(async ({ app }) => {
            const plugin = (app as unknown as { plugins: { plugins: Record<string, unknown> } })
                .plugins.plugins["google-sync"] as { syncNow(): Promise<void> };
            await plugin.syncNow();
        });

        await browser.waitUntil(
            async () => {
                const calls = await getMockCalls();
                // The child is new, so it's inserted with ?parent=task-parent.
                return calls.some(
                    (c: MockCall) =>
                        c.method === "POST" &&
                        c.url.includes("/lists/L1/tasks") &&
                        c.url.includes("parent=task-parent"),
                );
            },
            { timeout: 8000, interval: 250, timeoutMsg: "no parented task insert recorded" },
        );
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
