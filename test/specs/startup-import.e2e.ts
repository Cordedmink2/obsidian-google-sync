import { browser } from "@wdio/globals";
import { before, describe, it } from "mocha";
import { expect } from "chai";
import { setupGoogleSyncMock, getMockCalls, resetMockCalls } from "./helpers/mockGoogle";

describe("startup Google import", function () {
    before(async () => {
        await setupGoogleSyncMock();
    });

    it("imports configured events and tasks when the plugin starts", async () => {
        await browser.executeObsidian(async ({ app, obsidian }) => {
            const plugin = (app as unknown as { plugins: { plugins: Record<string, unknown> } })
                .plugins.plugins["google-sync"] as {
                settings: { importOnStartup?: boolean };
                saveSettings(): Promise<void>;
            };
            plugin.settings.importOnStartup = true;
            await plugin.saveSettings();
            for (const path of [
                "events/imported-appointment-import-event-1.md",
                "events/archive/past-imported-appointment-past-import-event-1.md",
                "tasks/imported-task-import-task-1.md",
                "tasks/overdue/late-imported-task-late-import-task-1.md",
            ]) {
                const old = app.vault.getAbstractFileByPath(path);
                if (old instanceof obsidian.TFile) await app.vault.delete(old);
            }
        });
        await resetMockCalls();

        await browser.executeObsidian(async ({ app }) => {
            const plugins = (
                app as unknown as {
                    plugins: {
                        disablePlugin(pluginId: string): Promise<void>;
                        enablePlugin(pluginId: string): Promise<void>;
                    };
                }
            ).plugins;
            await plugins.disablePlugin("google-sync");
            await plugins.enablePlugin("google-sync");
        });

        await browser.waitUntil(
            async () =>
                browser.executeObsidian(({ app, obsidian }) => {
                    const eventFile = app.vault.getAbstractFileByPath(
                        "events/imported-appointment-import-event-1.md",
                    );
                    const taskFile = app.vault.getAbstractFileByPath(
                        "tasks/imported-task-import-task-1.md",
                    );
                    return (
                        eventFile instanceof obsidian.TFile && taskFile instanceof obsidian.TFile
                    );
                }),
            { timeout: 5000, interval: 250, timeoutMsg: "startup import did not create notes" },
        );

        const result = await browser.executeObsidian(async ({ app, obsidian }) => {
            const eventFile = app.vault.getAbstractFileByPath(
                "events/imported-appointment-import-event-1.md",
            );
            const taskFile = app.vault.getAbstractFileByPath(
                "tasks/imported-task-import-task-1.md",
            );
            return {
                event: eventFile instanceof obsidian.TFile ? await app.vault.read(eventFile) : null,
                task: taskFile instanceof obsidian.TFile ? await app.vault.read(taskFile) : null,
            };
        });

        expect(result.event).to.contain("googleId: import-event-1");
        expect(result.task).to.contain("googleId: import-task-1");
        const calls = await getMockCalls();
        expect(calls.some((c) => c.url.includes("/calendars/primary/events"))).to.equal(true);
        expect(calls.some((c) => c.url.includes("/lists/L1/tasks"))).to.equal(true);
    });

    it("does not rewrite existing notes during startup import", async () => {
        await browser.executeObsidian(async ({ app, obsidian }) => {
            const plugin = (app as unknown as { plugins: { plugins: Record<string, unknown> } })
                .plugins.plugins["google-sync"] as {
                settings: { importOnStartup?: boolean };
                saveSettings(): Promise<void>;
            };
            plugin.settings.importOnStartup = true;
            await plugin.saveSettings();
            for (const path of [
                "events/imported-appointment-import-event-1.md",
                "tasks/imported-task-import-task-1.md",
            ]) {
                const old = app.vault.getAbstractFileByPath(path);
                if (old instanceof obsidian.TFile) await app.vault.delete(old);
            }
            const future = new Date();
            future.setDate(future.getDate() + 30);
            const eventDate = future.toISOString().slice(0, 10);
            future.setDate(future.getDate() + 1);
            const taskDue = `${future.toISOString().slice(0, 10)}T00:00:00.000Z`;
            await app.vault.create(
                "events/imported-appointment-import-event-1.md",
                `---\ntitle: Local edited appointment\ndate: ${eventDate}T09:00:00+12:00\ngoogleId: import-event-1\ncalendarId: primary\n---\n`,
            );
            await app.vault.create(
                "tasks/imported-task-import-task-1.md",
                `---\ntitle: Local edited task\ndue: ${taskDue}\ncompleted: false\ngoogleId: import-task-1\ntasklist: L1\n---\n`,
            );
        });
        await resetMockCalls();

        await browser.executeObsidian(async ({ app }) => {
            const plugins = (
                app as unknown as {
                    plugins: {
                        disablePlugin(pluginId: string): Promise<void>;
                        enablePlugin(pluginId: string): Promise<void>;
                    };
                }
            ).plugins;
            await plugins.disablePlugin("google-sync");
            await plugins.enablePlugin("google-sync");
        });

        const result = await browser.executeObsidian(async ({ app, obsidian }) => {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            const eventFile = app.vault.getAbstractFileByPath(
                "events/imported-appointment-import-event-1.md",
            );
            const taskFile = app.vault.getAbstractFileByPath(
                "tasks/imported-task-import-task-1.md",
            );
            return {
                event: eventFile instanceof obsidian.TFile ? await app.vault.read(eventFile) : null,
                task: taskFile instanceof obsidian.TFile ? await app.vault.read(taskFile) : null,
            };
        });

        expect(result.event).to.contain("title: Local edited appointment");
        expect(result.task).to.contain("title: Local edited task");
        const calls = await getMockCalls();
        expect(calls.some((c) => c.url.includes("/calendars/primary/events"))).to.equal(true);
        expect(calls.some((c) => c.url.includes("/lists/L1/tasks"))).to.equal(true);
    });
});
