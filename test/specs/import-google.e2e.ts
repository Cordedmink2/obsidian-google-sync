import { browser } from "@wdio/globals";
import { before, describe, it } from "mocha";
import { expect } from "chai";
import { setupGoogleSyncMock, getMockCalls } from "./helpers/mockGoogle";

describe("Google import against mocked Google", function () {
    before(async () => {
        await setupGoogleSyncMock();
    });

    it("creates configured event/task notes from Google and runs lifecycle routing", async () => {
        const result = await browser.executeObsidian(async ({ app, obsidian }) => {
            const plugin = (app as unknown as { plugins: { plugins: Record<string, unknown> } })
                .plugins.plugins["google-sync"] as { importFromGoogle(): Promise<void> };

            for (const path of [
                "events/imported-appointment-import-event-1.md",
                "events/secondary-appointment-secondary-event-1.md",
                "events/past-imported-appointment-past-import-event-1.md",
                "events/archive/past-imported-appointment-past-import-event-1.md",
                "tasks/default-list-task-default-import-task-1.md",
                "tasks/imported-task-import-task-1.md",
                "tasks/late-imported-task-late-import-task-1.md",
                "tasks/overdue/late-imported-task-late-import-task-1.md",
            ]) {
                const old = app.vault.getAbstractFileByPath(path);
                if (old instanceof obsidian.TFile) await app.vault.delete(old);
            }

            await plugin.importFromGoogle();

            const eventFile = app.vault.getAbstractFileByPath(
                "events/imported-appointment-import-event-1.md",
            );
            const secondaryEventFile = app.vault.getAbstractFileByPath(
                "events/secondary-appointment-secondary-event-1.md",
            );
            const pastEventFile = app.vault.getAbstractFileByPath(
                "events/archive/past-imported-appointment-past-import-event-1.md",
            );
            const defaultTaskFile = app.vault.getAbstractFileByPath(
                "tasks/default-list-task-default-import-task-1.md",
            );
            const taskFile = app.vault.getAbstractFileByPath("tasks/imported-task-import-task-1.md");
            const overdueTaskFile = app.vault.getAbstractFileByPath(
                "tasks/overdue/late-imported-task-late-import-task-1.md",
            );
            return {
                event: eventFile instanceof obsidian.TFile ? await app.vault.read(eventFile) : null,
                secondaryEventExists: secondaryEventFile instanceof obsidian.TFile,
                pastEvent:
                    pastEventFile instanceof obsidian.TFile ? await app.vault.read(pastEventFile) : null,
                defaultTaskExists: defaultTaskFile instanceof obsidian.TFile,
                task: taskFile instanceof obsidian.TFile ? await app.vault.read(taskFile) : null,
                overdueTask:
                    overdueTaskFile instanceof obsidian.TFile ? await app.vault.read(overdueTaskFile) : null,
            };
        });

        expect(result.event).to.contain("title: Imported appointment");
        expect(result.event).to.contain("googleId: import-event-1");
        expect(result.secondaryEventExists).to.equal(false);
        expect(result.pastEvent).to.contain("googleId: past-import-event-1");
        expect(result.defaultTaskExists).to.equal(false);
        expect(result.task).to.contain("title: Imported task");
        expect(result.task).to.contain("googleId: import-task-1");
        expect(result.task).to.contain("tasklist: L1");
        expect(result.overdueTask).to.contain("googleId: late-import-task-1");

        const calls = await getMockCalls();
        expect(calls.some((c) => c.url.includes("/calendars/primary/events"))).to.equal(true);
        expect(calls.some((c) => c.url.includes("/calendars/secondary/events"))).to.equal(false);
        expect(calls.some((c) => c.url.includes("/lists/L1/tasks"))).to.equal(true);
        expect(calls.some((c) => c.url.includes("/lists/%40default/tasks"))).to.equal(false);
    });
});
