import { describe, it } from "mocha";
import { expect } from "chai";
import { NOTHING_TO_PUSH, formatPendingLines, formatPushNotice } from "../../src/sync/push-report";
import { SyncRouter, SyncRunResult } from "../../src/sync/router";
import { GoogleCalendarClient } from "../../src/google/calendar";
import { GoogleTasksClient } from "../../src/google/tasks";
import { DEFAULT_SETTINGS } from "../../src/settings-data";
import { MemoryBaselineStore } from "../../src/sync/baseline";
import { MemoryVault } from "./helpers/memoryVault";
import { fakeHttp, jsonResp, noWaitRetry, token } from "./helpers/fakeHttp";

const empty = (over: Partial<SyncRunResult> = {}): SyncRunResult => ({
    synced: 0,
    failed: 0,
    blocked: [],
    limit: 10,
    skipped: { pullOnly: 0, unlinked: 0 },
    ...over,
});

describe("push feedback wording (D5)", () => {
    it("says nothing to push, with the same wording as preview", () => {
        expect(NOTHING_TO_PUSH).to.equal(
            "Google sync: everything is up to date — nothing to push.",
        );
        expect(formatPushNotice(empty())).to.equal(NOTHING_TO_PUSH);
    });

    it("reports a plain success without a skipped tail", () => {
        expect(formatPushNotice(empty({ synced: 2 }))).to.equal("Google sync: pushed 2 update(s).");
    });

    it("names a count for every reason notes were not pushed", () => {
        const msg = formatPushNotice(
            empty({
                synced: 1,
                failed: 2,
                blocked: ["a", "b", "c"],
                limit: 2,
                skipped: { pullOnly: 4, unlinked: 5 },
            }),
        );
        expect(msg).to.contain("pushed 1 update(s)");
        expect(msg).to.contain("4 pull-only");
        expect(msg).to.contain("5 not linked to Google (no googleId)");
        expect(msg).to.contain("3 held by the mass-update guard (limit 2");
        expect(msg).to.contain("Push pending updates (confirmed)");
        expect(msg).to.contain("2 failed");
        expect(msg).to.not.contain("console");
    });

    it("explains skips even when nothing at all was pushed", () => {
        const msg = formatPushNotice(empty({ skipped: { pullOnly: 0, unlinked: 3 } }));
        expect(msg).to.contain("nothing to push");
        expect(msg).to.contain("3 not linked to Google (no googleId)");
    });

    it("a guard-blocked run never claims everything is up to date", () => {
        const msg = formatPushNotice(empty({ blocked: ["a", "b"], limit: 1 }));
        expect(msg).to.not.contain("up to date");
        expect(msg).to.contain("2 held by the mass-update guard (limit 1");
    });

    it("renders each pending note and its changed fields for the preview modal", () => {
        const lines = formatPendingLines([
            { path: "events/a.md", changedKeys: ["summary", "start"] },
            { path: "tasks/b.md", changedKeys: [], veto: "title looks like a template" },
            { path: "events/c.md", changedKeys: [] },
        ]);
        expect(lines).to.deep.equal([
            { path: "events/a.md", detail: "summary, start", blocked: false },
            { path: "tasks/b.md", detail: "BLOCKED: title looks like a template", blocked: true },
            { path: "events/c.md", detail: "Meet link request", blocked: false },
        ]);
    });
});

describe("router skip accounting (D5)", () => {
    it("counts pull-only and unlinked notes instead of silently ignoring them", async () => {
        const vault = new MemoryVault();
        vault.seed("events/pull.md", {
            title: "P",
            date: "2026-06-02T09:00:00",
            timezone: "Pacific/Auckland",
            googleId: "ev-p",
            syncDirection: "pull-only",
        });
        vault.seed("events/local.md", {
            title: "L",
            date: "2026-06-02T09:00:00",
            timezone: "Pacific/Auckland",
        });
        vault.seed("tasks/local.md", { title: "T" });
        const { fn } = fakeHttp([jsonResp(200, {})]);
        const router = new SyncRouter(
            vault,
            new GoogleCalendarClient(fn, token, noWaitRetry),
            new GoogleTasksClient(fn, token, noWaitRetry),
            () => ({ ...DEFAULT_SETTINGS, taskListId: "L1" }),
            new MemoryBaselineStore({}),
        );
        const r = await router.syncAll();
        expect(r.synced).to.equal(0);
        expect(r.skipped).to.deep.equal({ pullOnly: 1, unlinked: 2 });
        expect(r.limit).to.equal(10);
    });
});
