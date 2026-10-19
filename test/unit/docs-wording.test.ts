import { describe, it } from "mocha";
import { expect } from "chai";
import { readFileSync } from "fs";
import { OWN_CLIENT_NOTE } from "../../src/setup-checks";

const readme = readFileSync("README.md", "utf8");

function section(md: string, heading: string): string {
    const start = md.indexOf(`\n## ${heading}\n`);
    expect(start, `README has no "## ${heading}"`).to.be.greaterThan(-1);
    const rest = md.slice(start + 1);
    const next = rest.indexOf("\n## ", 3);
    return next === -1 ? rest : rest.slice(0, next);
}

describe("own OAuth client wording (D6)", () => {
    it("states plainly that the plugin needs its own client", () => {
        expect(OWN_CLIENT_NOTE).to.match(/needs its own Google OAuth client/);
        expect(OWN_CLIENT_NOTE).to.match(/do not reuse another plugin's client/i);
    });
    it("README setup section carries the same statement", () => {
        expect(section(readme, "First-time setup")).to.contain(OWN_CLIENT_NOTE);
    });
});

describe("README command list (D7)", () => {
    it("matches the command names registered in src/commands.ts exactly", () => {
        const src = readFileSync("src/commands.ts", "utf8");
        const registered = [...src.matchAll(/^\s+name: "([^"]+)",$/gm)].map((m) => m[1]);
        expect(registered.length).to.be.greaterThan(5);
        const documented = [...section(readme, "Commands").matchAll(/^- \*\*(.+)\*\*$/gm)].map(
            (m) => m[1],
        );
        expect(documented).to.deep.equal(registered);
    });
});
