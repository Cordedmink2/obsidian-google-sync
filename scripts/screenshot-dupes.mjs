#!/usr/bin/env node
// Fails when two differently-named screenshots in one run are byte-identical (a frame that
// does not show the step it is named for), unless the pair is allow-listed below.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Explicitly allowed identical pairs, by step name without the NN- prefix, e.g. "a|b". */
export const ALLOW = new Set(/** @type {string[]} */ ([]));

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

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
    const root = path.resolve(process.argv[2] ?? "test-results/screenshots");
    const dupes = findDuplicateShots(root);
    for (const [a, b] of dupes) console.error(`byte-identical screenshots: ${a} == ${b}`);
    if (dupes.length) process.exit(1);
    console.log(`no byte-identical screenshots under ${root}`);
}
