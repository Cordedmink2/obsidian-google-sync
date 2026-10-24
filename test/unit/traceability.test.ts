import { describe, it } from "mocha";
import { expect } from "chai";
import { existsSync, readFileSync } from "fs";

const table = readFileSync("docs/verification/traceability.md", "utf8");
const rows = table
    .split("\n")
    .filter((l) => l.startsWith("|") && !/^\|\s*-/.test(l))
    .map((l) =>
        l
            .split("|")
            .slice(1, -1)
            .map((c) => c.trim()),
    );
const header = rows[0] as string[];
const body = rows.slice(1);

const col = (name: string): number => header.findIndex((h) => h.toLowerCase() === name);

describe("verification traceability table", () => {
    it("has a repo evidence column, a local evidence column and a status column", () => {
        expect(col("repo evidence")).to.be.greaterThan(-1);
        expect(col("local evidence")).to.be.greaterThan(-1);
        expect(col("status")).to.be.greaterThan(-1);
        expect(body.length).to.be.greaterThan(5);
    });

    it("every repo-relative evidence path exists (local evidence column is skipped)", () => {
        const c = col("repo evidence");
        const missing: string[] = [];
        for (const r of body) {
            for (const m of (r[c] as string).matchAll(/`([^`]+)`/g)) {
                const p = m[1] as string;
                if (p.startsWith("/") || /\s/.test(p)) continue;
                if (!existsSync(p)) missing.push(p);
            }
        }
        expect(missing, `evidence paths that do not exist: ${missing.join(", ")}`).to.deep.equal(
            [],
        );
    });

    it("local evidence entries are absolute artefact paths, not repo paths", () => {
        const c = col("local evidence");
        for (const r of body) {
            for (const m of (r[c] as string).matchAll(/`([^`]+)`/g)) {
                expect(m[1], "local evidence must be absolute").to.match(/^\/home\/ubuntu\//);
            }
        }
    });

    it("no status is left pending or tied to a stale commit", () => {
        const c = col("status");
        for (const r of body) {
            expect(r[c], r[0]).to.not.match(/pending|will be updated|787c21c/i);
        }
    });
});
