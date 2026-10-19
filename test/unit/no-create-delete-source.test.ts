import { describe, it } from "mocha";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

const root = path.resolve(__dirname, "../..");

function walk(dir: string, exts: string[]): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return walk(p, exts);
        return exts.some((x) => e.name.endsWith(x)) ? [p] : [];
    });
}

describe("no Google create/delete code or CLI surface ships", () => {
    const shipped = [
        ...walk(path.join(root, "src"), [".ts"]),
        ...walk(path.join(root, "headless"), [".ts"]),
    ];

    it("has no insert/create/delete client calls in src or headless", () => {
        const bad = /\b(insertEvent|insertTask|deleteEvent|deleteTask|createEvent|createTask)\b/;
        const hits = shipped.filter((f) => bad.test(fs.readFileSync(f, "utf8")));
        expect(hits.map((f) => path.relative(root, f))).to.deep.equal([]);
    });

    it("exposes no `events create` / `tasks create` command in the headless CLI", () => {
        const cli = fs.readFileSync(path.join(root, "headless/cli.ts"), "utf8");
        expect(cli).to.not.match(/events create|tasks create/);
    });

    it("the agent skill documents no create or delete command", () => {
        for (const f of ["SKILL.md", "reference.md"]) {
            const text = fs.readFileSync(path.join(root, "skill/google-tasks-calendar", f), "utf8");
            expect(text, f).to.not.match(/(events|tasks) create/);
        }
    });
});
