#!/usr/bin/env node
// Fails when two differently-named screenshots in one run are byte-identical (a frame that
// does not show the step it is named for), unless the pair is allow-listed below.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Explicitly allowed identical groups, by step name without the NN- prefix. Frames inside one
 * group may match each other; any other identical pair fails.
 */
export const ALLOW_GROUPS = [
    // Push and Preview with nothing pending end in the same "nothing to push" toast.
    ["notice-push-nothing", "notice-preview-nothing", "empty-push", "empty-preview"],
    // The point of the step: the settings page shows the same values after a reload.
    ["persist-before-reload", "persist-after-reload"],
    // The palette with the same command typed, before two different imports.
    ["palette-import", "orphan-event-palette-import", "orphan-task-palette-import"],
];
export const ALLOW = new Set(
    ALLOW_GROUPS.flatMap((g) => g.flatMap((a) => g.filter((b) => b !== a).map((b) => `${a}|${b}`))),
);

const step = (f) => f.replace(/^\d+-/, "").replace(/\.png$/, "");

/** Returns [[fileA, fileB], ...] for identical, non-allow-listed PNG pairs per directory. */
export function findDuplicateShots(root, allow = ALLOW) {
    const out = [];
    const dirs = [root];
    for (const e of readdirSync(root)) {
        if (statSync(path.join(root, e)).isDirectory()) dirs.push(path.join(root, e));
    }
    for (const dir of dirs) {
        const seen = new Map();
        for (const f of readdirSync(dir)
            .filter((x) => x.endsWith(".png"))
            .sort()) {
            const h = createHash("sha256")
                .update(readFileSync(path.join(dir, f)))
                .digest("hex");
            const first = seen.get(h);
            if (first === undefined) seen.set(h, f);
            else if (!allow.has(`${step(first)}|${step(f)}`)) {
                out.push([path.join(dir, first), path.join(dir, f)]);
            }
        }
    }
    return out;
}

if (process.argv[2] === "--clean") {
    // Start of an E2E run: drop frames left by an earlier run so only this run is compared.
    const root = path.resolve(process.env.GSYNC_SHOTS ?? "test-results/screenshots");
    rmSync(root, { recursive: true, force: true });
} else if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
    const root = path.resolve(
        process.argv[2] ?? process.env.GSYNC_SHOTS ?? "test-results/screenshots",
    );
    const dupes = findDuplicateShots(root);
    for (const [a, b] of dupes) console.error(`byte-identical screenshots: ${a} == ${b}`);
    if (dupes.length) process.exit(1);
    console.log(`no byte-identical screenshots under ${root}`);
}
