import { describe, it } from "mocha";
import { expect } from "chai";
import { SyncRouter } from "../../src/sync/router";
import { GoogleCalendarClient } from "../../src/google/calendar";
import { GoogleTasksClient } from "../../src/google/tasks";
import { DEFAULT_SETTINGS, GoogleSyncSettings } from "../../src/settings-data";
import { GoogleBody, MemoryBaselineStore } from "../../src/sync/baseline";
import { MemoryVault } from "./helpers/memoryVault";
import { fakeHttp, jsonResp, noWaitRetry, token } from "./helpers/fakeHttp";
import { HttpResponse } from "../../src/google/http";

function makeRouter(
    vault: MemoryVault,
    options: {
        settings?: Partial<GoogleSyncSettings>;
        baselines?: Record<string, GoogleBody>;
        responses?: HttpResponse[];
    } = {},
) {
    const settings: GoogleSyncSettings = {
        ...DEFAULT_SETTINGS,
        taskListId: "L1",
        ...options.settings,
    };
    const { calls, fn } = fakeHttp(options.responses ?? []);
    const calendar = new GoogleCalendarClient(fn, token, noWaitRetry);
    const tasks = new GoogleTasksClient(fn, token, noWaitRetry);
    const notices: string[] = [];
    const baselines = new MemoryBaselineStore(options.baselines ?? {});
    const router = new SyncRouter(
        vault,
        calendar,
        tasks,
        () => settings,
        baselines,
        (m) => notices.push(m),
    );
    return { router, calls, notices, baselines };
}

const EVENT_FM = {
    title: "Standup",
    date: "2026-06-02T09:00:00",
    timezone: "Pacific/Auckland",
    googleId: "ev-1",
};

describe("SyncRouter (one-way, baseline-diffed)", () => {
    it("first contact: diffs against a GET of the remote item, then patches", async () => {
        const vault = new MemoryVault();
        vault.seed("events/standup.md", EVENT_FM);
        const { router, calls } = makeRouter(vault, {
            responses: [jsonResp(200, { summary: "Old title" }), jsonResp(200, { id: "ev-1" })],
        });

        await router.syncPath("events/standup.md");

        expect(calls.map((c) => c.method)).to.deep.equal(["GET", "PATCH"]);
        expect(calls[1]?.url).to.contain("/calendars/primary/events/ev-1");
        const body = JSON.parse(calls[1]?.body ?? "{}") as Record<string, unknown>;
        expect(body.summary).to.equal("Standup");
    });

    it("sends no request at all for an unchanged note", async () => {
        const vault = new MemoryVault();
        vault.seed("tasks/buy-milk.md", { title: "Buy milk", googleId: "t-1" });
        const { router, calls } = makeRouter(vault, {
            baselines: {
                "tasks/buy-milk.md": { title: "Buy milk", status: "needsAction" },
            },
        });

        await router.syncPath("tasks/buy-milk.md");

        expect(calls).to.have.length(0);
    });

    it("patches only the fields that changed against the baseline", async () => {
        const vault = new MemoryVault();
        vault.seed("tasks/buy-milk.md", {
            title: "Buy milk",
            notes: "oat, 2 cartons",
            completed: true,
            googleId: "t-1",
        });
        const { router, calls } = makeRouter(vault, {
            baselines: {
                "tasks/buy-milk.md": {
                    title: "Buy milk",
                    notes: "oat, 2 cartons",
                    status: "needsAction",
                },
            },
        });

        await router.syncPath("tasks/buy-milk.md");

        expect(calls).to.have.length(1);
        expect(calls[0]?.method).to.equal("PATCH");
        // Only the completion flipped — title/notes are not resent.
        expect(JSON.parse(calls[0]?.body ?? "{}")).to.deep.equal({ status: "completed" });
    });

    it("never overwrites a field changed only on the Google side", async () => {
        const vault = new MemoryVault();
        vault.seed("events/standup.md", { ...EVENT_FM, description: undefined });
        // Google gained a description meanwhile; the note never had one. The baseline
        // (from import) doesn't have it either, so the diff must not clear it.
        const { router, calls } = makeRouter(vault, {
            baselines: {
                "events/standup.md": {
                    summary: "Standup",
                    start: { dateTime: "2026-06-02T09:00:00+12:00", timeZone: "Pacific/Auckland" },
                },
            },
        });

        await router.syncPath("events/standup.md");

        expect(calls).to.have.length(0);
    });

    it("vetoes a template-clobber patch (placeholder title) and notifies", async () => {
        const vault = new MemoryVault();
        vault.seed("events/imported.md", {
            title: "Event title",
            date: "2026-06-02T09:00:00",
            googleId: "ev-1",
        });
        const { router, calls, notices } = makeRouter(vault, {
            baselines: {
                "events/imported.md": {
                    summary: "Real meeting",
                    start: { dateTime: "2026-06-02T09:00:00+12:00" },
                },
            },
        });

        await router.syncPath("events/imported.md");

        expect(calls).to.have.length(0);
        expect(notices.join(" ")).to.contain("placeholder");
    });

    it("does nothing for a note without a googleId (never inserts)", async () => {
        const vault = new MemoryVault();
        vault.seed("events/new.md", { title: "New", date: "2026-06-02T09:00:00" });
        vault.seed("tasks/new.md", { title: "New task" });
        const { router, calls } = makeRouter(vault);

        await router.syncAll({ confirmed: true });

        expect(calls).to.have.length(0);
        expect(vault.fm("events/new.md")?.googleId).to.equal(undefined);
    });

    it("honors a per-note pull-only opt-out", async () => {
        const vault = new MemoryVault();
        vault.seed("tasks/quiet.md", {
            title: "Quiet",
            googleId: "t-1",
            syncDirection: "pull-only",
        });
        const { router, calls } = makeRouter(vault);

        await router.syncPath("tasks/quiet.md");

        expect(calls).to.have.length(0);
    });

    it("re-nests a task via the move endpoint when its parent link changes", async () => {
        const vault = new MemoryVault();
        vault.seed("tasks/renew-rego.md", { title: "Renew", googleId: "task-parent" });
        vault.seed("tasks/pick-up-car.md", {
            title: "Pick up car",
            googleId: "task-child",
            parent: "[[renew-rego]]",
        });
        const { router, calls } = makeRouter(vault, {
            baselines: {
                "tasks/pick-up-car.md": { title: "Pick up car", status: "needsAction" },
            },
        });

        await router.syncPath("tasks/pick-up-car.md");

        // parent is not PATCHable — it travels via /move only.
        expect(calls).to.have.length(1);
        expect(calls[0]?.method).to.equal("POST");
        expect(calls[0]?.url).to.contain("/tasks/task-child/move");
        expect(calls[0]?.url).to.contain("parent=task-parent");
    });

    it("trips the mass-update breaker in syncAll and pushes only when confirmed", async () => {
        const vault = new MemoryVault();
        for (let i = 0; i < 4; i++) {
            vault.seed(`tasks/t${i}.md`, {
                title: `Task ${i}`,
                completed: true,
                googleId: `t-${i}`,
            });
        }
        const baselines: Record<string, GoogleBody> = {};
        for (let i = 0; i < 4; i++) {
            baselines[`tasks/t${i}.md`] = { title: `Task ${i}`, status: "needsAction" };
        }
        const { router, calls, notices } = makeRouter(vault, {
            settings: { maxPatchesPerRun: 3 },
            baselines,
        });

        const blockedRun = await router.syncAll();
        expect(blockedRun.blocked).to.have.length(4);
        expect(blockedRun.synced).to.equal(0);
        expect(calls).to.have.length(0);
        // The one user-facing notice is built from the result (formatPushNotice); the router
        // must not add a second, overlapping one for a whole-vault run.
        expect(notices.join(" ")).to.not.contain("mass-update guard");
        expect(blockedRun.limit).to.equal(3);

        const confirmedRun = await router.syncAll({ confirmed: true });
        expect(confirmedRun.synced).to.equal(4);
        expect(calls.filter((c) => c.method === "PATCH")).to.have.length(4);
    });

    it("rate-limits single-note syncs through the rolling-window guard", async () => {
        const vault = new MemoryVault();
        const baselines: Record<string, GoogleBody> = {};
        for (let i = 0; i < 3; i++) {
            vault.seed(`tasks/t${i}.md`, {
                title: `Task ${i}`,
                completed: true,
                googleId: `t-${i}`,
            });
            baselines[`tasks/t${i}.md`] = { title: `Task ${i}`, status: "needsAction" };
        }
        const { router, calls, notices } = makeRouter(vault, {
            settings: { maxPatchesPerRun: 2 },
            baselines,
        });

        await router.syncPath("tasks/t0.md");
        await router.syncPath("tasks/t1.md");
        await router.syncPath("tasks/t2.md"); // third within the window: guarded

        expect(calls.filter((c) => c.method === "PATCH")).to.have.length(2);
        expect(notices.join(" ")).to.contain("mass-update guard");
    });

    it("previewAll reports pending changes without writing to Google", async () => {
        const vault = new MemoryVault();
        vault.seed("tasks/buy-milk.md", { title: "Buy milk", completed: true, googleId: "t-1" });
        const { router, calls } = makeRouter(vault, {
            baselines: {
                "tasks/buy-milk.md": { title: "Buy milk", status: "needsAction" },
            },
        });

        const pending = await router.previewAll();

        expect(pending).to.have.length(1);
        expect(pending[0]?.changedKeys).to.deep.equal(["status"]);
        expect(calls.filter((c) => c.method !== "GET")).to.have.length(0);
    });

    it("skips notes in managed subfolders and isolates per-note failures", async () => {
        const vault = new MemoryVault();
        vault.seed("events/archive/old.md", { title: "Old", googleId: "ev-old" });
        vault.seed("events/bad.md", { title: "Bad", date: "not-a-date", googleId: "ev-bad" });
        vault.seed("events/good.md", {
            title: "Good",
            date: "2026-06-02T09:00:00",
            googleId: "ev-good",
        });
        const { router, calls, notices } = makeRouter(vault, {
            baselines: { "events/good.md": { summary: "Old name" } },
        });

        const { synced } = await router.syncAll({ confirmed: true });

        expect(calls.map((c) => c.method)).to.deep.equal(["PATCH"]);
        expect(calls[0]?.url).to.contain("/events/ev-good");
        expect(synced).to.equal(1);
        expect(notices.join(" ")).to.contain("bad.md");
    });
});
