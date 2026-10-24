import { browser } from "@wdio/globals";
import "./helpers/invariantHook";
import { before, beforeEach, describe, it } from "mocha";
import { expect } from "chai";
import {
    MockErrorRule,
    getMockCalls,
    resetMockCalls,
    setMockErrors,
    setupGoogleSyncMock,
} from "./helpers/mockGoogle";
import { bulkFixture } from "./helpers/fixtures";

/**
 * Volume and failure behaviour against the stateful mock: 500+ items over several pages,
 * calendars and lists; malformed / 429 / 5xx responses; awkward titles. The import runs in
 * the background inside Obsidian (webdriver script calls time out at 30s) and we poll.
 */

interface ImportOutcome {
    notice: string;
    files: { path: string; text: string }[];
}

async function runImport(): Promise<ImportOutcome> {
    await browser.executeObsidian(({ app }) => {
        document.querySelectorAll(".notice").forEach((n) => n.remove());
        const w = window as unknown as {
            __gsyncImport?: Promise<void>;
            __gsyncImportDone?: boolean;
        };
        const plugin = (app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins
            .plugins["google-sync"] as { importFromGoogle(): Promise<void> };
        w.__gsyncImportDone = false;
        w.__gsyncImport = plugin.importFromGoogle().finally(() => {
            w.__gsyncImportDone = true;
        });
    });
    await browser.waitUntil(
        () =>
            browser.executeObsidian(
                () =>
                    (window as unknown as { __gsyncImportDone?: boolean }).__gsyncImportDone ===
                    true,
            ),
        { timeout: 240000, interval: 1000, timeoutMsg: "import did not finish" },
    );
    return browser.executeObsidian(async ({ app }) => {
        const notice = Array.from(document.querySelectorAll(".notice"))
            .map((n) => n.textContent ?? "")
            .join(" | ");
        const files = [] as { path: string; text: string }[];
        for (const f of app.vault.getMarkdownFiles()) {
            if (f.path.startsWith("events/") || f.path.startsWith("tasks/"))
                files.push({ path: f.path, text: await app.vault.cachedRead(f) });
        }
        return { notice, files };
    });
}

async function configure(): Promise<void> {
    await browser.executeObsidian(async ({ app }) => {
        const plugin = (app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins
            .plugins["google-sync"] as {
            settings: Record<string, unknown>;
            saveSettings(): Promise<void>;
        };
        plugin.settings.importOnlyDefaultCalendar = false;
        plugin.settings.importOnlyDefaultTaskList = false;
        plugin.settings.maxPatchesPerRun = 100000;
        await plugin.saveSettings();
    });
}

async function clearVault(): Promise<void> {
    await browser.executeObsidian(async ({ app, obsidian }) => {
        for (const f of app.vault.getMarkdownFiles()) {
            if (f.path.startsWith("events/") || f.path.startsWith("tasks/"))
                await app.vault.delete(f);
        }
        void obsidian;
    });
}

const ids = (files: { text: string }[]) =>
    files.map((f) => /^googleId:\s*"?([^"\n]+)"?$/m.exec(f.text)?.[1]).filter(Boolean) as string[];

/**
 * Failure diagnostics only: for notes the vault tree does not list, say whether the file
 * is on disk (adapter) and whether the tree knows the path, so a tree-vs-disk lag is
 * told apart from a note that was never written.
 */
async function describeMissing(missing: string[]): Promise<string> {
    if (missing.length === 0) return "none";
    return browser.executeObsidian(async ({ app }, ids) => {
        const out: string[] = [];
        for (const folder of ["events", "tasks"]) {
            const listed = await app.vault.adapter.list(folder);
            const onDisk = new Set<string>();
            const walk = async (l: { files: string[]; folders: string[] }): Promise<void> => {
                l.files.forEach((f) => onDisk.add(f));
                for (const d of l.folders) await walk(await app.vault.adapter.list(d));
            };
            await walk(listed);
            const inTree = new Set(app.vault.getMarkdownFiles().map((f) => f.path));
            const diskOnly = [...onDisk].filter((p) => p.endsWith(".md") && !inTree.has(p));
            out.push(`${folder}: disk=${onDisk.size} tree-lacks-disk=${diskOnly.length}`);
        }
        return `${ids.length} ids, e.g. ${ids.slice(0, 5).join(",")}; ${out.join("; ")}`;
    }, missing);
}

describe("volume: 500+ events and tasks over many pages, calendars and lists", function () {
    this.timeout(280000);
    const fixture = bulkFixture(new Date());
    const nEvents = Object.values(fixture.events).reduce((n, l) => n + l.length, 0);
    const nTasks = Object.values(fixture.tasks).reduce((n, l) => n + l.length, 0);

    before(async () => {
        await setupGoogleSyncMock(fixture);
        await configure();
    });

    it("imports every event and task exactly once, following every page", async () => {
        expect(nEvents).to.be.greaterThan(500);
        await clearVault();
        const r = await runImport();

        const got = ids(r.files);
        const expected = [
            ...Object.values(fixture.events).flat(),
            ...Object.values(fixture.tasks).flat(),
        ].map((x) => String(x.id));
        expect(r.notice).to.contain(`imported ${nEvents} event(s) and ${nTasks} task(s)`);
        expect(new Set(got).size, "no duplicate notes").to.equal(got.length);
        const missing = expected.filter((id) => !got.includes(id));
        expect(missing.length, `missing notes: ${await describeMissing(missing)}`).to.equal(0);
        expect(got.sort()).to.deep.equal(expected.sort());

        const calls = await getMockCalls();
        const pages = (needle: string) =>
            calls.filter((c) => c.method === "GET" && c.url.includes(needle)).length;
        expect(pages("/calendars/work/events")).to.equal(Math.ceil(300 / 250));
        expect(pages("/lists/shopping/tasks")).to.equal(Math.ceil(130 / 20));
        expect(pages("/calendars/family/events")).to.be.greaterThan(1);
    });

    it("produces valid vault filenames for unicode, emoji and illegal-character titles", async () => {
        const r = await browser.executeObsidian(({ app }) =>
            app.vault
                .getMarkdownFiles()
                .filter((f) => f.path.startsWith("events/") || f.path.startsWith("tasks/"))
                .map((f) => f.path),
        );
        expect(r.length).to.equal(nEvents + nTasks);
        for (const p of r) {
            const name = p.split("/").pop() as string;
            expect(name, p).to.match(/^[a-z0-9][a-z0-9-]*\.md$/);
            expect(name.length, p).to.be.lessThan(160);
            expect(p, p).to.not.contain("..");
        }
        // Titles themselves are kept verbatim in frontmatter.
        const files = await browser.executeObsidian(async ({ app }) => {
            for (const f of app.vault.getMarkdownFiles()) {
                if (!f.path.startsWith("events/")) continue;
                const text = await app.vault.cachedRead(f);
                if (/^googleId:\s*primary-ev-0$/m.test(text)) return text;
            }
            return "";
        });
        expect(files).to.contain("Café");
    });

    it("a second import is idempotent: same notes, no duplicates", async () => {
        const before = await browser.executeObsidian(
            ({ app }) => app.vault.getMarkdownFiles().length,
        );
        const r = await runImport();
        expect(r.files.length).to.equal(nEvents + nTasks);
        const after = await browser.executeObsidian(
            ({ app }) => app.vault.getMarkdownFiles().length,
        );
        expect(after).to.equal(before);
    });
});

describe("failure handling: clear notice, no partial corruption", function () {
    this.timeout(280000);

    const small = () => {
        const f = bulkFixture(new Date(), { eventsPerCalendar: 10, tasksPerList: 10 });
        return f;
    };

    before(async () => {
        await setupGoogleSyncMock(small());
        await configure();
    });
    beforeEach(async () => {
        await setMockErrors([]);
        await clearVault();
        await resetMockCalls();
    });

    const cases: { name: string; rules: MockErrorRule[]; mention: RegExp }[] = [
        {
            name: "malformed JSON from the events endpoint",
            rules: [{ match: "/calendars/[^/]+/events\\?", status: 200, malformed: true }],
            mention: /malformed|unreadable|invalid/i,
        },
        {
            name: "429 that never clears on the events endpoint",
            rules: [{ match: "/calendars/[^/]+/events\\?", status: 429, retryAfter: 0 }],
            mention: /429|rate/i,
        },
        {
            name: "503 that never clears on the events endpoint",
            rules: [{ match: "/calendars/[^/]+/events\\?", status: 503 }],
            mention: /503|unavailable|server/i,
        },
        {
            name: "403 on the tasks endpoint",
            rules: [{ match: "/lists/[^/]+/tasks\\?", status: 403 }],
            mention: /403|permission|forbidden/i,
        },
    ];

    for (const c of cases) {
        it(`${c.name}: the notice says what went wrong and nothing half-written is left`, async () => {
            await setMockErrors(c.rules);
            const r = await runImport();

            expect(r.notice).to.match(/Google sync/);
            expect(r.notice, "notice names the cause").to.match(c.mention);
            // Every note that exists is complete: closed frontmatter with a googleId and title.
            for (const f of r.files) {
                expect(f.text, f.path).to.match(/^---\n[\s\S]*\n---\n?/);
                expect(f.text, f.path).to.match(/^googleId:/m);
                expect(f.text, f.path).to.match(/^title:/m);
            }
            const calls = await getMockCalls();
            expect(calls.filter((x) => x.method === "DELETE")).to.have.length(0);
        });
    }

    it("a transient 429 (Retry-After 0) is retried and the import completes fully", async () => {
        await setMockErrors([
            { match: "/calendars/primary/events\\?", status: 429, retryAfter: 0, times: 2 },
        ]);
        const r = await runImport();
        expect(r.notice).to.contain("imported");
        expect(r.notice).to.not.match(/failed/);
        expect(ids(r.files).length).to.be.greaterThan(10);
    });
});
