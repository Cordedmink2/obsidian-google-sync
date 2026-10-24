import { browser } from "@wdio/globals";
import "./helpers/invariantHook";
import {
    clearNotices,
    revealInExplorer,
    runCommand,
    shot,
    startShots,
    waitForNotice,
} from "./helpers/ui";
import { before, beforeEach, describe, it } from "mocha";
import { expect } from "chai";
import {
    MockCall,
    cancelEventInGoogle,
    deleteTaskInGoogle,
    getMockCalls,
    removeEventInGoogle,
    removeTaskInGoogle,
    resetMockCalls,
    setupGoogleSyncMock,
    unlistEventInGoogle,
} from "./helpers/mockGoogle";

/**
 * Google decides whether an item exists. When an item is deleted in Google, its note is
 * filed into orphaned/ (never deleted), the user is told, and Google is only ever READ:
 * the importer confirms with a GET, and never issues a DELETE.
 */

const eventNote = (title: string, googleId: string): string => {
    const d = new Date(Date.now() + 4 * 864e5).toISOString().slice(0, 10);
    return `---\ntitle: ${title}\ndate: ${d}T09:00:00+13:00\ntimezone: Pacific/Auckland\ngoogleId: ${googleId}\ncalendarId: primary\n---\nMy own notes survive.\n`;
};
const taskNote = (title: string, googleId: string): string =>
    `---\ntitle: ${title}\ngoogleId: ${googleId}\ntasklist: L1\ncompleted: false\n---\nMy own notes survive.\n`;

async function put(path: string, content: string): Promise<void> {
    await browser.executeObsidian(
        async ({ app, obsidian }, p: string, c: string) => {
            const folder = p.split("/")[0] as string;
            if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
            const old = app.vault.getAbstractFileByPath(p);
            if (old instanceof obsidian.TFile) await app.vault.delete(old);
            await app.vault.create(p, c);
            // On Android a freshly created note can read back blank for a moment, and the
            // import would then see a note with no googleId and (safely) not file it. Write it
            // again until it reads back as written, so the test exercises the orphan flow.
            for (let i = 0; i < 20; i++) {
                const created = app.vault.getAbstractFileByPath(p);
                if (!(created instanceof obsidian.TFile)) break;
                if ((await app.vault.read(created)) === c) break;
                await app.vault.modify(created, c);
                await new Promise((r) => setTimeout(r, 100));
            }
        },
        path,
        content,
    );
}

/** Run a full import; return the notice text, and where the note ended up. */
async function importAndLook(
    original: string,
    orphaned: string,
): Promise<{ notice: string; atOriginal: boolean; atOrphaned: boolean; orphanedBody: string }> {
    return browser.executeObsidian(
        async ({ app, obsidian }, o: string, f: string) => {
            document.querySelectorAll(".notice").forEach((n) => n.remove());
            const plugin = (app as unknown as { plugins: { plugins: Record<string, unknown> } })
                .plugins.plugins["google-sync"] as { importFromGoogle(): Promise<void> };
            await plugin.importFromGoogle();
            const notice = Array.from(document.querySelectorAll(".notice"))
                .map((n) => n.textContent ?? "")
                .join(" | ");
            const at = app.vault.getAbstractFileByPath(f);
            return {
                notice,
                atOriginal: app.vault.getAbstractFileByPath(o) instanceof obsidian.TFile,
                atOrphaned: at instanceof obsidian.TFile,
                orphanedBody: at instanceof obsidian.TFile ? await app.vault.read(at) : "",
            };
        },
        original,
        orphaned,
    );
}

const forbidden = (c: MockCall) => c.method === "DELETE" || c.method === "POST";
const isGet = (c: MockCall, needle: string) => c.method === "GET" && c.url.includes(needle);

describe("Google-side deletion files the note to orphaned/ (mocked Google)", function () {
    before(async () => {
        await setupGoogleSyncMock();
        await startShots(70);
    });
    beforeEach(async () => {
        await resetMockCalls();
    });

    for (const status of [404, 410] as const) {
        it(`event removed in Google (${status}): note moves to events/orphaned/, notice shown, confirming GET recorded, no DELETE`, async () => {
            const id = `gone-event-${status}`;
            await put(`events/gone-${status}.md`, eventNote(`Gone ${status}`, id));
            await removeEventInGoogle("primary", id, status);

            const r = await importAndLook(
                `events/gone-${status}.md`,
                `events/orphaned/gone-${status}.md`,
            );

            expect(r.atOriginal).to.equal(false);
            expect(r.atOrphaned).to.equal(true);
            expect(r.orphanedBody).to.contain("My own notes survive.");
            expect(r.notice).to.contain("filed to orphaned/");
            const calls = await getMockCalls();
            expect(
                calls.some((c) => isGet(c, `/events/${id}`)),
                "confirming GET",
            ).to.equal(true);
            expect(calls.filter((c) => c.method === "DELETE")).to.have.length(0);
            expect(calls.filter((c) => forbidden(c) && !c.url.includes("oauth2"))).to.have.length(
                0,
            );
        });
    }

    it("event listed as cancelled: note moves to events/orphaned/ with no DELETE", async () => {
        await put(
            "events/cancelled-listed.md",
            eventNote("Cancelled listed", "cancelled-listed-1"),
        );
        await cancelEventInGoogle("primary", "cancelled-listed-1");

        const r = await importAndLook(
            "events/cancelled-listed.md",
            "events/orphaned/cancelled-listed.md",
        );

        expect(r.atOrphaned).to.equal(true);
        expect(r.notice).to.contain("filed to orphaned/");
        const calls = await getMockCalls();
        expect(calls.filter((c) => c.method === "DELETE")).to.have.length(0);
    });

    it("event cancelled but missing from the listing: confirming GET sees status cancelled, then it is filed", async () => {
        await put(
            "events/cancelled-unlisted.md",
            eventNote("Cancelled unlisted", "cancelled-unlisted-1"),
        );
        await unlistEventInGoogle("primary", "cancelled-unlisted-1", "cancelled");

        const r = await importAndLook(
            "events/cancelled-unlisted.md",
            "events/orphaned/cancelled-unlisted.md",
        );

        const calls = await getMockCalls();
        expect(r.atOrphaned).to.equal(true);
        expect(
            calls.some((c) => isGet(c, "/events/cancelled-unlisted-1")),
            "confirming GET",
        ).to.equal(true);
        expect(calls.filter((c) => c.method === "DELETE")).to.have.length(0);
    });

    it("NEGATIVE: event absent from the listing but still alive on GET is NOT orphaned", async () => {
        await put("events/still-here.md", eventNote("Still here", "still-here-1"));
        await unlistEventInGoogle("primary", "still-here-1", "confirmed");

        const r = await importAndLook("events/still-here.md", "events/orphaned/still-here.md");

        expect(r.atOriginal).to.equal(true);
        expect(r.atOrphaned).to.equal(false);
        expect(r.notice).to.not.contain("orphaned/");
        const calls = await getMockCalls();
        expect(
            calls.some((c) => isGet(c, "/events/still-here-1")),
            "confirming GET",
        ).to.equal(true);
        expect(calls.filter((c) => c.method === "DELETE")).to.have.length(0);
    });

    for (const status of [404, 410] as const) {
        it(`task removed in Google (${status}): note moves to tasks/orphaned/, notice shown, confirming GET recorded, no DELETE`, async () => {
            const id = `gone-task-${status}`;
            await put(`tasks/gone-task-${status}.md`, taskNote(`Gone task ${status}`, id));
            await removeTaskInGoogle("L1", id, status);

            const r = await importAndLook(
                `tasks/gone-task-${status}.md`,
                `tasks/orphaned/gone-task-${status}.md`,
            );

            expect(r.atOriginal).to.equal(false);
            expect(r.atOrphaned).to.equal(true);
            expect(r.orphanedBody).to.contain("My own notes survive.");
            expect(r.notice).to.contain("filed to orphaned/");
            const calls = await getMockCalls();
            expect(
                calls.some((c) => isGet(c, `/tasks/${id}`)),
                "confirming GET",
            ).to.equal(true);
            expect(calls.filter((c) => c.method === "DELETE")).to.have.length(0);
        });
    }

    it("task flagged deleted:true: note moves to tasks/orphaned/, confirmed by GET, no DELETE", async () => {
        await put("tasks/flagged.md", taskNote("Flagged deleted", "flagged-task-1"));
        await browser.executeObsidian(() => {
            const mock = (
                window as unknown as {
                    __gsyncMock: { state: { tasks: Record<string, Record<string, unknown>[]> } };
                }
            ).__gsyncMock;
            (mock.state.tasks.L1 as Record<string, unknown>[]).push({
                id: "flagged-task-1",
                title: "Flagged deleted",
                status: "needsAction",
            });
        });
        await deleteTaskInGoogle("L1", "flagged-task-1");

        const r = await importAndLook("tasks/flagged.md", "tasks/orphaned/flagged.md");

        expect(r.atOrphaned).to.equal(true);
        expect(r.notice).to.contain("filed to orphaned/");
        const calls = await getMockCalls();
        expect(
            calls.some((c) => isGet(c, "/tasks/flagged-task-1")),
            "confirming GET",
        ).to.equal(true);
        expect(calls.filter((c) => c.method === "DELETE")).to.have.length(0);
    });

    it("NEGATIVE: a task that still exists in Google is NOT orphaned", async () => {
        await put("tasks/alive.md", taskNote("Alive", "import-task-1"));

        const r = await importAndLook("tasks/alive.md", "tasks/orphaned/alive.md");

        expect(r.atOrphaned).to.equal(false);
        expect(r.notice).to.not.contain("orphaned/");
    });

    it("does not orphan anything when the listing itself failed (503)", async () => {
        await put("events/outage.md", eventNote("Outage", "outage-event-1"));
        await removeEventInGoogle("primary", "outage-event-1", 404);
        await browser.executeObsidian(() => {
            const mock = (window as unknown as { __gsyncMock: { state: { errors?: unknown[] } } })
                .__gsyncMock;
            mock.state.errors = [
                { match: "/calendars/primary/events\\\\?", status: 503, method: "GET" },
            ];
        });

        const r = await importAndLook("events/outage.md", "events/orphaned/outage.md");

        expect(r.atOriginal).to.equal(true);
        expect(r.atOrphaned).to.equal(false);
        await browser.executeObsidian(() => {
            (
                window as unknown as { __gsyncMock: { state: { errors?: unknown[] } } }
            ).__gsyncMock.state.errors = [];
        });
    });

    // Click-through: the import is run from the command palette like a user would, then the
    // notice and the orphaned/ folder are captured (desktop and emulated mobile).
    for (const [kind, folder, name, note, remove] of [
        [
            "event",
            "events",
            "shot-gone-event",
            () => eventNote("Shot gone event", "shot-gone-event-1"),
            () => removeEventInGoogle("primary", "shot-gone-event-1", 404),
        ],
        [
            "task",
            "tasks",
            "shot-gone-task",
            () => taskNote("Shot gone task", "shot-gone-task-1"),
            () => removeTaskInGoogle("L1", "shot-gone-task-1", 404),
        ],
    ] as const) {
        it(`click-through: palette import files a deleted ${kind} to ${folder}/orphaned/ and the folder shows it`, async () => {
            await put(`${folder}/${name}.md`, note());
            await remove();
            await clearNotices();
            await runCommand("Import events and tasks from Google", {
                shotName: `orphan-${kind}-palette-import`,
            });
            const n = await waitForNotice("filed to orphaned/");
            expect(n).to.contain("filed to orphaned/ (deleted in Google)");
            await shot(`orphan-${kind}-notice`);

            await revealInExplorer(`${folder}/orphaned/${name}.md`);
            const there = await browser.executeObsidian(
                ({ app }, f: string) => !!app.vault.getAbstractFileByPath(f),
                `${folder}/orphaned/${name}.md`,
            );
            expect(there, "note filed, not deleted").to.equal(true);
            await shot(`orphan-${kind}-folder`);
        });
    }
});
