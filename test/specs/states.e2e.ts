import { browser } from "@wdio/globals";
import "./helpers/invariantHook";
import { afterEach, before, describe, it } from "mocha";
import { expect } from "chai";
import { MockFixture, setMockErrors, setupGoogleSyncMock } from "./helpers/mockGoogle";
import {
    clearNotices,
    clickToggle,
    closeSettings,
    disableAutoPush,
    dismissOverlays,
    isToggleOn,
    notices,
    openSettings,
    readSavedSettings,
    reloadPlugin,
    removeNotes,
    runCommand,
    scrollToSetting,
    settingValue,
    shot,
    startShots,
    typeSetting,
    waitForNotice,
    writeNote,
} from "./helpers/ui";

/**
 * Click-through of the states a user lands in when Google has nothing, Google refuses, or
 * Obsidian restarts the plugin. Same rules as clickthrough.e2e.ts: palette + real settings
 * controls, no plugin method calls, a screenshot per step (numbering continues from 40).
 */
const emptyFixture: MockFixture = {
    calendars: [{ id: "primary", summary: "connor@example.com", primary: true }],
    events: { primary: [] },
    taskLists: [
        { id: "@default", title: "My Tasks" },
        { id: "L1", title: "Test list" },
    ],
    tasks: { "@default": [], L1: [] },
};

describe("click-through: empty, error and persistence states", function () {
    this.timeout(90 * 1000);

    before(async () => {
        await setupGoogleSyncMock(emptyFixture);
        await startShots(40);
        await disableAutoPush();
        await removeNotes("events/");
        await removeNotes("tasks/");
    });

    afterEach(async () => {
        await closeSettings();
        await dismissOverlays();
        await setMockErrors([]);
    });

    it("empty Google: Import, Push and Preview say so plainly", async () => {
        await clearNotices();
        await runCommand("Import events and tasks from Google");
        const n = await waitForNotice("nothing to import");
        expect(n).to.contain("nothing to import");
        await shot("empty-import");

        await clearNotices();
        await runCommand("Push updates to Google");
        expect(await waitForNotice("Google sync:")).to.contain("nothing to push");
        await shot("empty-push");

        await clearNotices();
        await runCommand("Preview pending Google updates (dry run)");
        expect(await waitForNotice("Google sync:")).to.contain("nothing to push");
        await shot("empty-preview");
    });

    it("401 from Google: Test connection, Import and Push each say what failed", async () => {
        await setMockErrors([{ match: "googleapis\\.com", status: 401 }]);
        await writeNote(
            "events/needs-auth.md",
            "---\ntitle: Needs auth\ndate: 2030-06-02T09:00:00\ntimezone: Pacific/Auckland\ngoogleId: ev-401\n---\n",
        );

        await clearNotices();
        await runCommand("Test connection");
        const t = await waitForNotice("Connection failed");
        expect(t).to.contain("Connect to Google");
        expect(t).to.not.match(/https?:|GET /);
        await shot("401-test-connection");

        await clearNotices();
        await runCommand("Import events and tasks from Google");
        const i = await waitForNotice("Google sync");
        expect(i).to.contain("Connect to Google");
        expect(i).to.not.match(/https?:|GET /);
        await shot("401-import");

        await clearNotices();
        await runCommand("Push updates to Google");
        const p = await waitForNotice("Not pushed");
        const all = (await notices()).join(" || ");
        expect(all, all).to.not.contain("up to date");
        expect(p).to.contain("1 failed");
        expect(p).to.contain("Connect to Google");
        expect(all).to.not.match(/https?:|GET /);
        await shot("401-push");

        await clearNotices();
        await runCommand("Validate setup");
        const v = await waitForNotice("calendar");
        expect(v).to.contain("[--]");
        expect(v).to.not.match(/https?:|GET /);
        await shot("401-validate-setup");
    });

    it("5xx from Google: failures are reported, not swallowed or shown as success", async () => {
        await setMockErrors([{ match: "googleapis\\.com", status: 503 }]);
        await clearNotices();
        await runCommand("Test connection");
        const t = await waitForNotice("Connection failed", 40000);
        expect(t).to.match(/temporarily unavailable \(503\)/);
        expect(t).to.not.match(/https?:|GET /);
        await shot("5xx-test-connection");

        await clearNotices();
        await runCommand("Import events and tasks from Google");
        const i = await waitForNotice("Google sync", 40000);
        expect(i).to.not.contain("nothing to import");
        expect(i).to.contain("failed");
        expect(i).to.not.match(/https?:|GET /);
        await shot("5xx-import");

        await clearNotices();
        await runCommand("Push updates to Google");
        await waitForNotice("Not pushed", 40000);
        const all = (await notices()).join(" || ");
        expect(all, all).to.not.contain("up to date");
        expect(all).to.match(/temporarily unavailable \(503\)/);
        expect(all).to.not.match(/https?:|GET /);
        await shot("5xx-push");
    });

    it("settings persist across a real plugin reload", async () => {
        // The 5xx toast from the previous step may still be on screen; start from a clean view.
        await clearNotices();
        await openSettings();
        await typeSetting("Mass-update guard", "7");
        await typeSetting("Archive after days past", "9");
        await clickToggle("Import from Google on startup");
        const startupBefore = await isToggleOn("Import from Google on startup");
        await scrollToSetting("Mass-update guard");
        await shot("persist-before-reload");
        await closeSettings();
        // Let the debounced save flush, then restart the plugin the way Obsidian does.
        await browser.pause(1200);
        await reloadPlugin();
        // No frame here: right after a reload nothing is visible that the next frames do not show.

        const saved = await readSavedSettings();
        const settings = saved.settings as Record<string, unknown>;
        expect(settings.maxPatchesPerRun).to.equal(7);
        expect(settings.autoArchiveDaysPast).to.equal(9);

        await openSettings();
        expect(await settingValue("Mass-update guard")).to.equal("7");
        expect(await settingValue("Archive after days past")).to.equal("9");
        expect(await isToggleOn("Import from Google on startup")).to.equal(startupBefore);
        await scrollToSetting("Mass-update guard");
        await shot("persist-after-reload");

        // Connection survives too: Test connection still works with no re-auth.
        await closeSettings();
        await clearNotices();
        await runCommand("Test connection");
        expect(await waitForNotice("Connection")).to.contain("Connection OK");
        await shot("persist-still-connected");
    });
});
