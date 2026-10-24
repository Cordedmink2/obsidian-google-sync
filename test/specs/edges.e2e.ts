import { browser } from "@wdio/globals";
import "./helpers/invariantHook";
import { afterEach, before, describe, it } from "mocha";
import { expect } from "chai";
import { DateTime } from "luxon";
import {
    MockFixture,
    getMockCalls,
    resetMockCalls,
    setupGoogleSyncMock,
} from "./helpers/mockGoogle";
import { ZONE, dstTransitions, task, timedEvent } from "./helpers/fixtures";
import {
    clearNotices,
    closeSettings,
    disableAutoPush,
    dismissOverlays,
    findNoteByGoogleId,
    openNote,
    readNote,
    removeNotes,
    runCommand,
    shot,
    startShots,
    waitForNotice,
    writeNote,
} from "./helpers/ui";

/**
 * Edge cases, driven through the command palette (screenshots continue from 60):
 *   - user-owned frontmatter properties and the note body survive re-import and push;
 *   - a task due time (#7: the vault owns the time, Google owns the date) round-trips across
 *     a DST change and across midnight, and rides onto a date moved in Google.
 */
const now = new Date();
// The next DST change ahead of today: its tasks are not yet overdue, so the lifecycle scan
// leaves them in tasks/ where they are pushable.
const transitions = dstTransitions(now).filter((t) => t.toMillis() > now.getTime() + 3 * 86400000);
const dstDay = (transitions[0] as DateTime).setZone(ZONE).toISODate() as string;
const dayBefore = (transitions[0] as DateTime).minus({ days: 1 }).toISODate() as string;
const dayAfter = (transitions[0] as DateTime).plus({ days: 1 }).toISODate() as string;

function fixture(): MockFixture {
    return {
        calendars: [{ id: "primary", summary: "connor@example.com", primary: true }],
        events: { primary: [timedEvent(now, "edge-ev", "Edge event", 4)] },
        taskLists: [
            { id: "@default", title: "My Tasks" },
            { id: "L1", title: "Test list" },
        ],
        tasks: {
            "@default": [],
            L1: [
                task(now, "dst-task", "DST task", null, { due: `${dstDay}T00:00:00.000Z` }),
                task(now, "midnight-task", "Midnight task", null, {
                    due: `${dayBefore}T00:00:00.000Z`,
                }),
            ],
        },
    };
}

async function importAll(): Promise<void> {
    await clearNotices();
    await runCommand("Import events and tasks from Google");
    await waitForNotice("imported");
}

async function pushAll(): Promise<string> {
    await clearNotices();
    await runCommand("Push updates to Google");
    return waitForNotice("Google sync:");
}

async function moveTaskDueInGoogle(id: string, date: string): Promise<void> {
    await browser.executeObsidian(
        (_c, tid: string, d: string) => {
            const mock = (
                window as unknown as {
                    __gsyncMock: {
                        state: { tasks: Record<string, { id: string; due?: string }[]> };
                    };
                }
            ).__gsyncMock;
            const t = (mock.state.tasks.L1 ?? []).find((x) => x.id === tid);
            if (t) t.due = `${d}T00:00:00.000Z`;
        },
        id,
        date,
    );
}

describe("click-through edges: user data and due-time refinement", function () {
    this.timeout(90 * 1000);

    before(async () => {
        await setupGoogleSyncMock(fixture());
        await startShots(60);
        await disableAutoPush();
        await removeNotes("events/");
        await removeNotes("tasks/");
        await importAll();
    });

    afterEach(async () => {
        await closeSettings();
        await dismissOverlays();
    });

    it("user-owned properties and the body survive re-import and push", async () => {
        const p = (await findNoteByGoogleId("edge-ev")) as string;
        expect(p, "event note imported").to.be.a("string");
        const original = (await readNote(p)) as string;
        const edited = original
            .replace(/^---\n/, "---\nmyRating: 5\nmyTags: [alpha, beta]\n")
            .replace(/title: Edge event/, "title: Edge event (mine)");
        await writeNote(p, `${edited.trimEnd()}\n\nMy own meeting notes — keep me.\n`);
        await clearNotices();
        await openNote(p);
        await shot("user-data-edited");

        await resetMockCalls();
        const n = await pushAll();
        expect(n).to.contain("pushed 1 update(s)");
        await shot("user-data-pushed");
        await clearNotices();
        const patch = (await getMockCalls()).find((c) => c.method === "PATCH");
        expect(patch, "an update was sent").to.not.equal(undefined);
        expect(patch!.body).to.not.contain("myRating");
        expect(patch!.body).to.not.contain("My own meeting notes");

        await importAll();
        const after = (await readNote(p)) as string;
        expect(after).to.contain("myRating: 5");
        expect(after).to.match(/myTags:\n?\s*(- alpha|\[alpha)/);
        expect(after).to.contain("My own meeting notes — keep me.");
        expect(after).to.contain("title: Edge event (mine)");
        await clearNotices();
        await openNote(p);
        await shot("user-data-after-reimport");
    });

    for (const [label, id, wallTime, googleDay] of [
        ["on the DST change day", "dst-task", "T14:30", dstDay],
        ["just before midnight", "midnight-task", "T23:45", dayBefore],
        ["just after midnight", "midnight-task", "T00:15", dayBefore],
    ] as const) {
        it(`a due time ${label} survives push and re-import, and Google keeps the date`, async () => {
            const p = (await findNoteByGoogleId(id)) as string;
            const note = (await readNote(p)) as string;
            const withTime = note.replace(/^due: .*$/m, `due: ${googleDay}${wallTime}`);
            expect(withTime).to.contain(`due: ${googleDay}${wallTime}`);
            await writeNote(p, withTime.replace(/title: (.*)/, "title: $1 *"));
            await resetMockCalls();
            const pushNotice = await pushAll();
            const patch = (await getMockCalls()).find(
                (c) => c.method === "PATCH" && c.url.includes(`/tasks/${id}`),
            );
            expect(
                patch,
                `task updated; notice=${pushNotice}; note=${await readNote(p)}`,
            ).to.not.equal(undefined);
            // The date did not change, so Google is sent only the title: the time of day never
            // leaks to Google and the date never shifts.
            const sent = JSON.parse(patch!.body ?? "{}") as { due?: string };
            if (sent.due !== undefined) {
                expect(sent.due).to.equal(`${googleDay}T00:00:00.000Z`);
            }
            const stored = await browser.executeObsidian((_c, tid: string) => {
                const mock = (
                    window as unknown as {
                        __gsyncMock: {
                            state: { tasks: Record<string, { id: string; due?: string }[]> };
                        };
                    }
                ).__gsyncMock;
                return (mock.state.tasks.L1 ?? []).find((x) => x.id === tid)?.due;
            }, id);
            expect(stored, "Google's due still the same calendar day").to.equal(
                `${googleDay}T00:00:00.000Z`,
            );
            await importAll();
            expect(await readNote(p)).to.contain(`due: ${googleDay}${wallTime}`);
            await clearNotices();
            await openNote(p);
            await shot(`due-${label.replace(/ /g, "-")}`);
        });
    }

    it("when Google moves the date, the vault keeps its time", async () => {
        const p = (await findNoteByGoogleId("dst-task")) as string;
        await writeNote(
            p,
            ((await readNote(p)) as string).replace(/^due: .*$/m, `due: ${dstDay}T14:30`),
        );
        await moveTaskDueInGoogle("dst-task", dayAfter);
        await importAll();
        const after = (await readNote(p)) as string;
        expect(after).to.contain(`due: ${dayAfter}T14:30`);
        await clearNotices();
        await openNote(p);
        await shot("due-date-moved-in-google");
    });
});
