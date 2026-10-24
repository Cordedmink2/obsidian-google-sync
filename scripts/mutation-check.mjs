#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cases = [
    {
        invariant: "no-create/delete (D1 runtime guard)",
        file: "src/google/http.ts",
        from: 'if (method === "DELETE") {',
        to: 'if (method === "DELETE" && false) {',
        test: "test/unit/http-guard.test.ts",
        grep: "refuses DELETE to calendar and tasks items",
    },
    {
        invariant: "no-create/delete (D3 E2E invariant predicate)",
        file: "test/specs/helpers/invariants.ts",
        from: 'if (method === "DELETE") return true;',
        to: 'if (method === "DELETE") return false;',
        test: "test/unit/mock-google.test.ts",
        grep: "flags DELETE and non-allow-listed POST",
    },
    {
        invariant: "managed-vs-user property merge",
        file: "src/sync/mapper.ts",
        from: "if (!managed.includes(k)) preserved[k] = v;",
        to: "if (managed.includes(k)) preserved[k] = v;",
        test: "test/unit/mapper.test.ts",
        grep: "mergeManagedFrontmatter",
    },
    {
        invariant: "orphan confirmation by GET",
        file: "src/sync/orphans.ts",
        from: 'return remote.status === "cancelled";',
        to: "return true;",
        test: "test/unit/orphans.test.ts",
        grep: "keeps an in-window event when the confirming GET says it still exists",
    },
    {
        invariant: "mass-update guard",
        file: "src/sync/router.ts",
        from: "if (!options.confirmed && plans.length > this.maxPatchesPerRun()) {",
        to: "if (false) {",
        test: "test/unit/router.test.ts",
        grep: "trips the mass-update breaker",
    },
    {
        invariant: "due-time refinement",
        file: "src/sync/mapper.ts",
        from: "return { ...merged, due: after.slice(0, 10) + time };",
        to: "return { ...merged, due: after.slice(0, 10) };",
        test: "test/unit/task-due-time-roundtrip.test.ts",
        grep: "keeps a time the user typed into `due`",
    },
    {
        invariant: "pagination",
        file: "src/google/calendar.ts",
        from: "nextSyncToken = r.nextSyncToken ?? nextSyncToken;\n        } while (pageToken);",
        to: "nextSyncToken = r.nextSyncToken ?? nextSyncToken;\n        } while (false);",
        test: "test/unit/mock-google.test.ts",
        grep: "pages events at 250",
    },
    {
        invariant: "honest no-op message",
        file: "src/sync/push-report.ts",
        from: 'export const NOTHING_TO_PUSH = "Google sync: everything is up to date — nothing to push.";',
        to: 'export const NOTHING_TO_PUSH = "Google sync: pushed 0 update(s).";',
        test: "test/unit/push-feedback.test.ts",
        grep: "says nothing to push",
    },
];

function runTest(cwd, test, grep) {
    return spawnSync(
        process.execPath,
        [
            path.join(root, "node_modules/mocha/bin/mocha.js"),
            "--require",
            "tsx",
            test,
            "--grep",
            grep,
        ],
        { cwd, encoding: "utf8", timeout: 120_000 },
    );
}

const rows = [];
for (const item of cases) {
    const temp = await mkdtemp(path.join(tmpdir(), "obsidian-google-sync-mutation-"));
    try {
        let source = await readFile(path.join(root, item.file), "utf8");
        if (!source.includes(item.from)) throw new Error(`sabotage anchor missing: ${item.file}`);
        source = source.replace(item.from, item.to);
        if (source === (await readFile(path.join(root, item.file), "utf8"))) {
            throw new Error(`sabotage did not change ${item.file}`);
        }
        const archive = spawnSync("git", ["archive", "HEAD"], {
            cwd: root,
            encoding: "buffer",
            maxBuffer: 64 * 1024 * 1024,
        });
        if (archive.status !== 0) throw new Error(`git archive failed for ${item.invariant}`);
        const unpack = spawnSync("tar", ["-x", "-C", temp], { input: archive.stdout });
        if (unpack.status !== 0) throw new Error(`archive extraction failed for ${item.invariant}`);
        // Apply the sabotage to the isolated, clean tracked checkout.
        await writeFile(path.join(temp, item.file), source);
        const link = spawnSync(
            "ln",
            ["-s", path.join(root, "node_modules"), path.join(temp, "node_modules")],
            {
                encoding: "utf8",
            },
        );
        if (link.status !== 0) throw new Error(`dependency link failed: ${link.stderr}`);
        const result = runTest(temp, item.test, item.grep);
        const caught = result.status !== 0;
        rows.push({
            ...item,
            result: caught ? "CAUGHT" : "MISSED",
            detail: result.stderr || result.stdout,
        });
    } finally {
        await rm(temp, { recursive: true, force: true });
    }
}

console.log("invariant | sabotage | catching test | result");
for (const row of rows)
    console.log(
        `${row.invariant} | named source mutation | ${row.test}: ${row.grep} | ${row.result}`,
    );
if (rows.some((row) => row.result !== "CAUGHT")) {
    for (const row of rows.filter((x) => x.result !== "CAUGHT"))
        console.error(`FAILED ${row.invariant}:\n${row.detail}`);
    process.exitCode = 1;
}
