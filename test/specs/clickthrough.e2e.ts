import { browser } from "@wdio/globals";
import "./helpers/invariantHook";
import { afterEach, before, describe, it } from "mocha";
import { expect } from "chai";
import { getMockCalls, resetMockCalls, setupGoogleSyncMock } from "./helpers/mockGoogle";
import {
    chooseSetting,
    clearNotices,
    clickSettingButton,
    clickToggle,
    closeSettings,
    dismissOverlays,
    modalText,
    openSettings,
    readNote,
    removeNotes,
    runCommand,
    scrollToSetting,
    settingValue,
    shot,
    startShots,
    typeSetting,
    useMain,
    waitForNotice,
    writeNote,
} from "./helpers/ui";

/**
 * Click-through of the real UI, on desktop and emulated mobile: commands are typed into the
 * command palette and run with Enter, settings are changed by clicking/typing in the real
 * settings tab, and Preview is read from the real modal. Vault edits stand in for the user
 * typing in the editor. No plugin method is called. A screenshot is saved at every step.
 */
const NOTHING = "everything is up to date — nothing to push";

describe("click-through: connect, import, edit, preview, push", function () {
    this.timeout(90 * 1000);

    before(async () => {
        await setupGoogleSyncMock();
        await startShots();
        await removeNotes("events/");
        await removeNotes("tasks/");
    });

    afterEach(async () => {
        // A failed step must not leave Settings or a modal open for the next one.
        await closeSettings();
        await dismissOverlays();
    });

    it("Test connection from the command palette", async () => {
        await runCommand("Test connection", { shotName: "palette-test-connection" });
        const n = await waitForNotice("Connection OK");
        expect(n).to.contain("2 calendar(s) visible");
        await shot("notice-test-connection");
    });

    it("Validate setup from the command palette names the own-client rule", async () => {
        await clearNotices();
        await runCommand("Validate setup");
        const n = await waitForNotice("calendar");
        expect(n).to.contain("connected to Google");
        expect(n).to.contain("needs its own Google OAuth client");
        expect(n).to.not.contain("[--]");
        await shot("notice-validate-setup");
    });

    it("settings: Test connection button, pickers, and the push toggle", async () => {
        await clearNotices();
        await openSettings();
        await shot("settings-top");
        await clickSettingButton("Connection", "Test connection");
        await waitForNotice("Connection OK");
        await shot("settings-test-connection-button");

        await scrollToSetting("Default calendar");
        const cal = await settingValue("Default calendar");
        expect(cal).to.equal("primary");
        await shot("settings-pickers");
        await chooseSetting("Default calendar", "Secondary calendar");
        expect(await settingValue("Default calendar")).to.equal("secondary");
        await shot("settings-calendar-secondary-chosen");
        await chooseSetting("Default calendar", "connor@example.com (primary)");
        expect(await settingValue("Default calendar")).to.equal("primary");
        await scrollToSetting("Task list");
        expect(await settingValue("Task list")).to.equal("L1");

        // Auto-push on edit off: the user pushes by hand below.
        await clickToggle("Push local edits to Google");
        await scrollToSetting("Push local edits to Google");
        await shot("settings-push-toggle-off");
        await closeSettings();
        await useMain();
    });

    it("Import events and tasks creates the notes", async () => {
        await clearNotices();
        await runCommand("Import events and tasks from Google", { shotName: "palette-import" });
        const n = await waitForNotice("imported");
        expect(n).to.match(/imported \d+ event\(s\) and \d+ task\(s\)/);
        await shot("notice-import");
        const note = await readNote("events/imported-appointment-import-event-1.md");
        expect(note).to.contain("googleId: import-event-1");
    });

    it("Push with nothing changed says so (issue #2: 'Push does nothing')", async () => {
        await clearNotices();
        await runCommand("Push updates to Google");
        const n = await waitForNotice("Google sync:");
        expect(n).to.contain(NOTHING);
        await shot("notice-push-nothing");
    });

    it("Preview with nothing changed says so", async () => {
        await clearNotices();
        await runCommand("Preview pending Google updates (dry run)");
        const n = await waitForNotice("Google sync:");
        expect(n).to.contain(NOTHING);
        await shot("notice-preview-nothing");
    });

    it("edit a note, Preview opens a modal listing it, Push sends exactly that", async () => {
        await writeNote(
            "events/imported-appointment-import-event-1.md",
            (await readNote("events/imported-appointment-import-event-1.md"))!.replace(
                "title: Imported appointment",
                "title: Imported appointment (renamed in vault)",
            ),
        );
        await shot("note-edited");

        await clearNotices();
        await resetMockCalls();
        await runCommand("Preview pending Google updates (dry run)");
        await browser.$(".modal-container .modal").waitForDisplayed({ timeout: 10000 });
        const text = await modalText();
        expect(text).to.contain("events/imported-appointment-import-event-1.md");
        expect(text).to.contain("summary");
        expect(text).to.contain("Nothing has been sent");
        await shot("preview-modal");
        expect((await getMockCalls()).filter((c) => c.method === "PATCH")).to.have.length(0);
        await dismissOverlays();

        await clearNotices();
        await runCommand("Push updates to Google");
        const n = await waitForNotice("pushed 1 update(s)");
        expect(n).to.not.contain("console");
        await shot("notice-push-1");
        const patches = (await getMockCalls()).filter((c) => c.method === "PATCH");
        expect(patches).to.have.length(1);
        expect(patches[0]!.url).to.contain("/events/import-event-1");
    });

    it("Push again afterwards: nothing to push", async () => {
        await clearNotices();
        await runCommand("Push updates to Google");
        expect(await waitForNotice("Google sync:")).to.contain(NOTHING);
        await shot("notice-push-nothing-again");
    });

    it("trips the mass-update guard, names every skip reason, then Push confirmed sends", async () => {
        await clearNotices();
        await openSettings();
        await typeSetting("Mass-update guard", "2");
        await scrollToSetting("Mass-update guard");
        await shot("settings-guard-limit-2");
        await closeSettings();
        await useMain();

        const stamp = "\ndate: 2026-06-02T09:00:00\ntimezone: Pacific/Auckland";
        await writeNote("events/g1.md", `---\ntitle: Guard one${stamp}\ngoogleId: ev-conf\n---\n`);
        await writeNote(
            "events/g2.md",
            `---\ntitle: Guard two${stamp}\ngoogleId: ev-existing\n---\n`,
        );
        await writeNote("events/g3.md", `---\ntitle: Guard three${stamp}\ngoogleId: ev-del\n---\n`);
        await writeNote("events/local-only.md", `---\ntitle: Local only${stamp}\n---\n`);
        await writeNote(
            "events/pull.md",
            `---\ntitle: Pull only${stamp}\ngoogleId: ev-conf\nsyncDirection: pull-only\n---\n`,
        );
        await shot("guard-notes-created");

        await clearNotices();
        await resetMockCalls();
        await runCommand("Push updates to Google", { shotName: "palette-push-guard" });
        const blocked = await waitForNotice("held by the mass-update guard");
        expect(blocked).to.contain("3 held by the mass-update guard (limit 2");
        expect(blocked).to.contain("Push pending updates (confirmed)");
        expect(blocked).to.contain("1 pull-only");
        expect(blocked).to.contain("1 not linked to Google (no googleId)");
        await shot("notice-guard-blocked");
        expect((await getMockCalls()).filter((c) => c.method === "PATCH")).to.have.length(0);

        await clearNotices();
        await runCommand("Push pending updates (confirmed)");
        const done = await waitForNotice("pushed 3 update(s)");
        expect(done).to.contain("1 pull-only");
        await shot("notice-push-confirmed");
        expect((await getMockCalls()).filter((c) => c.method === "PATCH")).to.have.length(3);
    });

    it("Push confirmed with nothing pending says nothing to push", async () => {
        await clearNotices();
        await runCommand("Push pending updates (confirmed)");
        // The pull-only and unlinked notes from the guard step are still there: the notice
        // must say nothing was pushed AND why they were left, never "everything is up to date".
        const n = await waitForNotice("Google sync:");
        expect(n).to.contain("nothing to push");
        expect(n).to.not.contain("up to date");
        expect(n).to.contain("1 pull-only");
        expect(n).to.contain("1 not linked to Google (no googleId)");
        await shot("notice-push-confirmed-nothing");
    });

    it("Run lifecycle scan", async () => {
        await clearNotices();
        await writeNote(
            "events/old-event.md",
            "---\ntitle: Old event\ndate: 2026-01-01T09:00:00\ntimezone: Pacific/Auckland\n---\n",
        );
        await runCommand("Run lifecycle scan", { shotName: "palette-lifecycle" });
        const n = await waitForNotice("Google sync", 15000);
        await shot("notice-lifecycle");
        expect(n.length).to.be.greaterThan(10);
        expect(await readNote("events/archive/old-event.md")).to.contain("Old event");
    });
});
