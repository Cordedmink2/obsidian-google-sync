import { describe, it } from "mocha";
import { expect } from "chai";
import { GoogleImporter } from "../../src/sync/importer";
import { GoogleCalendarClient } from "../../src/google/calendar";
import { GoogleTasksClient } from "../../src/google/tasks";
import { DEFAULT_SETTINGS, GoogleSyncSettings } from "../../src/settings-data";
import { MemoryVault } from "./helpers/memoryVault";
import { HttpFn, HttpRequest } from "../../src/google/http";
import { noWaitRetry, token } from "./helpers/fakeHttp";

/** Routes Google API GETs to canned list payloads, independent of call order. */
function googleStub(events: unknown[], tasks: unknown[]): HttpFn {
    return async (req: HttpRequest) => {
        const body = req.url.includes("/calendars/")
            ? { items: events }
            : req.url.includes("/tasks")
              ? { items: tasks }
              : { items: [] };
        return { status: 200, headers: {}, text: JSON.stringify(body), json: body };
    };
}

function makeImporter(
    vault: MemoryVault,
    events: unknown[],
    tasks: unknown[],
    overrides: Partial<GoogleSyncSettings> = {},
) {
    const settings: GoogleSyncSettings = { ...DEFAULT_SETTINGS, taskListId: "L1", ...overrides };
    const http = googleStub(events, tasks);
    return new GoogleImporter(
        vault,
        new GoogleCalendarClient(http, token, noWaitRetry),
        new GoogleTasksClient(http, token, noWaitRetry),
        () => settings,
    );
}

describe("GoogleImporter (port-based)", () => {
    it("creates notes for remote events and tasks", async () => {
        const vault = new MemoryVault();
        const importer = makeImporter(
            vault,
            [
                {
                    id: "ev1",
                    summary: "Dentist",
                    start: { dateTime: "2026-06-02T09:00:00+12:00" },
                },
            ],
            [{ id: "t1", title: "Buy milk", status: "needsAction" }],
        );

        const counts = await importer.importAll();

        expect(counts.events).to.equal(1);
        expect(counts.tasks).to.equal(1);
        expect(counts.failed).to.equal(0);
        const eventPath = vault.paths().find((p) => p.startsWith("events/"));
        const taskPath = vault.paths().find((p) => p.startsWith("tasks/"));
        expect(vault.fm(eventPath ?? "")?.googleId).to.equal("ev1");
        expect(vault.fm(taskPath ?? "")?.googleId).to.equal("t1");
    });

    it("updates an existing note by googleId, preserving user keys and syncDirection", async () => {
        const vault = new MemoryVault();
        vault.seed("tasks/buy-milk.md", {
            title: "old title",
            googleId: "t1",
            related: "[[Groceries]]",
            syncDirection: "pull-only",
        });
        const importer = makeImporter(
            vault,
            [],
            [{ id: "t1", title: "Buy milk", status: "completed" }],
        );

        await importer.importAll();

        const fm = vault.fm("tasks/buy-milk.md");
        expect(fm?.title).to.equal("Buy milk");
        expect(fm?.completed).to.equal(true);
        expect(fm?.related).to.equal("[[Groceries]]");
        expect(fm?.syncDirection).to.equal("pull-only");
        // No duplicate note was created.
        expect(vault.paths().filter((p) => p.startsWith("tasks/"))).to.have.length(1);
    });

    it("leaves existing notes untouched in createOnly mode", async () => {
        const vault = new MemoryVault();
        vault.seed("tasks/buy-milk.md", { title: "edited locally", googleId: "t1" });
        const importer = makeImporter(vault, [], [{ id: "t1", title: "Buy milk" }]);

        await importer.importAll({ createOnly: true });

        expect(vault.fm("tasks/buy-milk.md")?.title).to.equal("edited locally");
    });

    it("upserts a googleId seen twice in one run into a single note", async () => {
        const vault = new MemoryVault();
        // e.g. the same event returned by two calendar listings in one import.
        const occurrence = {
            id: "ev1",
            summary: "Dentist",
            start: { dateTime: "2026-06-02T09:00:00+12:00" },
        };
        const importer = makeImporter(vault, [occurrence, { ...occurrence }], []);

        await importer.importAll();

        expect(vault.paths().filter((p) => p.startsWith("events/"))).to.have.length(1);
    });

    it("avoids path collisions with a -2 suffix", async () => {
        const vault = new MemoryVault();
        // Same slug as the incoming event, but a different googleId.
        vault.seed("events/dentist-ev1.md", { title: "Dentist", googleId: "other" });
        const importer = makeImporter(
            vault,
            [{ id: "ev1", summary: "Dentist", start: { dateTime: "2026-06-02T09:00:00+12:00" } }],
            [],
        );

        await importer.importAll();

        expect(vault.fm("events/dentist-ev1-2.md")?.googleId).to.equal("ev1");
    });

    it("links imported subtasks to their parent note via wikilink", async () => {
        const vault = new MemoryVault();
        const importer = makeImporter(
            vault,
            [],
            [
                { id: "p1", title: "Parent task" },
                { id: "c1", title: "Child task", parent: "p1" },
            ],
        );

        await importer.importAll();

        const childPath = vault.paths().find((p) => p.includes("child-task"));
        expect(vault.fm(childPath ?? "")?.parent).to.equal("[[parent-task-p1]]");
    });
});
