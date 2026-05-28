import { browser } from "@wdio/globals";
import { before, describe, it } from "mocha";
import { expect } from "chai";
import { setupGoogleSyncMock } from "./helpers/mockGoogle";

interface PluginApi {
    runLifecycle(manual?: boolean): Promise<void>;
}

describe("lifecycle scan against mocked Google", function () {
    before(async () => {
        await setupGoogleSyncMock();
    });

    it("archives a past event and moves an overdue task", async () => {
        const result = await browser.executeObsidian(async ({ app, obsidian }) => {
            for (const folder of ["events", "tasks"]) {
                if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
            }
            const cleanup = [
                "events/past-event.md",
                "events/archive/past-event.md",
                "tasks/late-task.md",
                "tasks/overdue/late-task.md",
            ];
            for (const p of cleanup) {
                const f = app.vault.getAbstractFileByPath(p);
                if (f instanceof obsidian.TFile) await app.vault.delete(f);
            }

            await app.vault.create(
                "events/past-event.md",
                "---\ntitle: Past event\ndate: 2026-01-01T09:00:00\ntimezone: Pacific/Auckland\n---\n",
            );
            await app.vault.create(
                "tasks/late-task.md",
                "---\ntitle: Late task\ndue: 2026-01-01T09:00:00\ncompleted: false\n---\n",
            );

            const plugin = (app as unknown as { plugins: { plugins: Record<string, unknown> } })
                .plugins.plugins["google-sync"] as PluginApi;
            await plugin.runLifecycle(true);

            return {
                archived:
                    app.vault.getAbstractFileByPath("events/archive/past-event.md") instanceof
                    obsidian.TFile,
                overdue:
                    app.vault.getAbstractFileByPath("tasks/overdue/late-task.md") instanceof
                    obsidian.TFile,
                originalEventGone: !app.vault.getAbstractFileByPath("events/past-event.md"),
                originalTaskGone: !app.vault.getAbstractFileByPath("tasks/late-task.md"),
            };
        });

        expect(result.archived, "event moved to archive/").to.equal(true);
        expect(result.overdue, "task moved to overdue/").to.equal(true);
        expect(result.originalEventGone).to.equal(true);
        expect(result.originalTaskGone).to.equal(true);
    });
});
