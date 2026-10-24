import { describe, it } from "mocha";
import { expect } from "chai";
import { Lifecycle } from "../../src/sync/lifecycle";
import { GoogleTasksClient } from "../../src/google/tasks";
import { DEFAULT_SETTINGS, GoogleSyncSettings } from "../../src/settings-data";
import { MemoryVault } from "./helpers/memoryVault";
import { fakeHttp, noWaitRetry, token } from "./helpers/fakeHttp";

function makeLifecycle(vault: MemoryVault, overrides: Partial<GoogleSyncSettings> = {}) {
    const settings: GoogleSyncSettings = { ...DEFAULT_SETTINGS, taskListId: "L1", ...overrides };
    const { calls, fn } = fakeHttp();
    const lifecycle = new Lifecycle(
        vault,
        new GoogleTasksClient(fn, token, noWaitRetry),
        () => settings,
    );
    return { lifecycle, calls };
}

describe("Lifecycle execution (port-based)", () => {
    it("files completed tasks and archives past events", async () => {
        const vault = new MemoryVault();
        vault.seed("tasks/done.md", { title: "Done", completed: true });
        vault.seed("events/old.md", { title: "Old", date: "2020-01-01T09:00:00" });
        const { lifecycle } = makeLifecycle(vault);

        const counts = await lifecycle.runOnce();

        expect(counts.completed).to.equal(1);
        expect(counts.archived).to.equal(1);
        expect(vault.paths()).to.include("tasks/completed/done.md");
        expect(vault.paths()).to.include("events/archive/old.md");
    });

    it("suffixes the destination when a filed note with the same name exists", async () => {
        const vault = new MemoryVault();
        vault.seed("tasks/done.md", { title: "Done", completed: true });
        vault.seed("tasks/completed/done.md", { title: "Previously filed" });
        const { lifecycle } = makeLifecycle(vault);

        const counts = await lifecycle.runOnce();

        expect(counts.completed).to.equal(1);
        expect(vault.paths()).to.include("tasks/completed/done-2.md");
        expect(vault.fm("tasks/completed/done.md")?.title).to.equal("Previously filed");
    });

    it("a note that vanishes between listing and reading does not abort the scan", async () => {
        const vault = new MemoryVault();
        vault.seed("tasks/gone.md", { title: "Gone", completed: true });
        vault.seed("tasks/done.md", { title: "Done", completed: true });
        // Deterministic gate: the note is removed (e.g. renamed by a concurrent import)
        // after listMarkdown returned it but before its frontmatter is read.
        const list = vault.listMarkdown.bind(vault);
        vault.listMarkdown = async (roots: string[]) => {
            const refs = await list(roots);
            await vault.move("tasks/gone.md", "elsewhere/gone.md");
            return refs;
        };
        const { lifecycle } = makeLifecycle(vault);

        const counts = await lifecycle.runOnce();

        expect(counts.completed).to.equal(1);
        expect(vault.paths()).to.include("tasks/completed/done.md");
    });

    it("one failing move does not abort the remaining moves", async () => {
        const vault = new MemoryVault();
        vault.seed("tasks/a.md", { title: "A", completed: true });
        vault.seed("tasks/b.md", { title: "B", completed: true });
        const failingMove = vault.move.bind(vault);
        vault.move = async (oldPath: string, newPath: string) => {
            if (oldPath === "tasks/a.md") throw new Error("simulated fs error");
            return failingMove(oldPath, newPath);
        };
        const { lifecycle } = makeLifecycle(vault);

        const counts = await lifecycle.runOnce();

        expect(counts.completed).to.equal(1);
        expect(vault.paths()).to.include("tasks/completed/b.md");
        expect(vault.paths()).to.include("tasks/a.md");
    });

    it("closes linked Google tasks when archiving an event", async () => {
        const vault = new MemoryVault();
        vault.seed("events/trip.md", {
            title: "Trip",
            date: "2020-01-01T09:00:00",
            tasks: ["[[pack-bags]]"],
        });
        vault.seed("tasks/pack-bags.md", { title: "Pack bags", googleId: "t-pack" });
        const { lifecycle, calls } = makeLifecycle(vault);

        await lifecycle.runOnce();

        const patch = calls.find((c) => c.method === "PATCH" && c.url.includes("/tasks/t-pack"));
        expect(patch, "linked task should be completed via PATCH").to.not.equal(undefined);
        expect(JSON.parse(patch?.body ?? "{}")).to.deep.equal({ status: "completed" });
        expect(vault.paths()).to.include("events/archive/trip.md");
    });

    it("closes a linked task in the note's own task list, not the default", async () => {
        const vault = new MemoryVault();
        vault.seed("events/trip.md", {
            title: "Trip",
            date: "2020-01-01T09:00:00",
            tasks: ["[[pack-bags]]"],
        });
        vault.seed("tasks/pack-bags.md", {
            title: "Pack bags",
            googleId: "t-pack",
            tasklist: "L-other",
        });
        const { lifecycle, calls } = makeLifecycle(vault);

        await lifecycle.runOnce();

        const patch = calls.find((c) => c.method === "PATCH" && c.url.includes("/tasks/t-pack"));
        expect(patch?.url).to.include("/lists/L-other/");
    });

    it("closes linked tasks even when no default task list is configured", async () => {
        const vault = new MemoryVault();
        vault.seed("events/trip.md", {
            title: "Trip",
            date: "2020-01-01T09:00:00",
            tasks: ["[[pack-bags]]"],
        });
        vault.seed("tasks/pack-bags.md", {
            title: "Pack bags",
            googleId: "t-pack",
            tasklist: "L-own",
        });
        const { lifecycle, calls } = makeLifecycle(vault, { taskListId: "" });

        await lifecycle.runOnce();

        const patch = calls.find((c) => c.method === "PATCH" && c.url.includes("/tasks/t-pack"));
        expect(patch?.url).to.include("/lists/L-own/");
    });
});
