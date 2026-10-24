import { describe, it } from "mocha";
import { expect } from "chai";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { findDuplicateShots } from "../../scripts/screenshot-dupes.mjs";

function shots(files: Record<string, string>): string {
    const root = mkdtempSync(path.join(tmpdir(), "shots-"));
    mkdirSync(path.join(root, "desktop"));
    for (const [n, c] of Object.entries(files)) writeFileSync(path.join(root, "desktop", n), c);
    return root;
}

describe("screenshot duplicate check", () => {
    it("fails on two differently-named byte-identical screenshots", () => {
        const root = shots({ "11-a.png": "same", "13-b.png": "same", "14-c.png": "other" });
        expect(findDuplicateShots(root)).to.have.length(1);
    });
    it("passes when every frame differs", () => {
        expect(findDuplicateShots(shots({ "01-a.png": "x", "02-b.png": "y" }))).to.have.length(0);
    });
    it("lets an explicitly allow-listed pair through", () => {
        const root = shots({ "01-a.png": "same", "02-b.png": "same" });
        expect(findDuplicateShots(root, new Set(["a|b"]))).to.have.length(0);
    });
});
