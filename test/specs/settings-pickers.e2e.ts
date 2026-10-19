import { browser } from "@wdio/globals";
import "./helpers/invariantHook";
import { before, describe, it } from "mocha";
import { expect } from "chai";
import { setupGoogleSyncMock } from "./helpers/mockGoogle";

interface PluginApi {
    listCalendars(): Promise<{ id: string }[]>;
    listTaskLists(): Promise<{ id: string }[]>;
    validateSetup(): Promise<string>;
}

describe("settings pickers data (mocked Google)", function () {
    before(async () => {
        await setupGoogleSyncMock();
    });

    it("loads calendars and task lists from Google", async () => {
        const result = await browser.executeObsidian(async ({ app }) => {
            const plugin = (app as unknown as { plugins: { plugins: Record<string, unknown> } })
                .plugins.plugins["google-sync"] as PluginApi;
            const calendars = await plugin.listCalendars();
            const taskLists = await plugin.listTaskLists();
            return { calendars: calendars.map((c) => c.id), taskLists: taskLists.map((t) => t.id) };
        });
        expect(result.calendars).to.include("primary");
        expect(result.taskLists).to.include("@default");
    });

    it("reports a healthy setup from validateSetup", async () => {
        const report = await browser.executeObsidian(async ({ app }) => {
            const plugin = (app as unknown as { plugins: { plugins: Record<string, unknown> } })
                .plugins.plugins["google-sync"] as PluginApi;
            return plugin.validateSetup();
        });
        expect(report).to.contain("connected to Google");
        expect(report).to.contain("calendar");
        expect(report).to.contain("task list");
        expect(report).to.not.contain("[--]");
    });
});
