import { describe, it, beforeEach, afterEach } from "mocha";
import { expect } from "chai";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { NodeVaultPort } from "../../headless/node-vault";

describe("NodeVaultPort", () => {
    let dir: string;
    let port: NodeVaultPort;

    beforeEach(async () => {
        dir = await fs.mkdtemp(nodePath.join(os.tmpdir(), "gsync-vault-"));
        port = new NodeVaultPort(dir);
    });
    afterEach(async () => {
        await fs.rm(dir, { recursive: true, force: true });
    });

    it("round-trips nested frontmatter and preserves the body", async () => {
        const fm = {
            title: "Coffee with Alex",
            date: "2026-06-02T10:00",
            attendees: [{ email: "alex@example.com", responseStatus: "accepted" }],
            reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 10 }] },
            googleId: "ev-1",
        };
        await port.upsertMarkdown("events/coffee.md", fm, "my private body\n");

        expect(await port.readFrontmatter("events/coffee.md")).to.deep.equal(fm);

        await port.writeFrontmatterKey("events/coffee.md", "meetLink", "https://meet/x");
        const updated = await port.readFrontmatter("events/coffee.md");
        expect(updated.meetLink).to.equal("https://meet/x");
        expect(updated.title).to.equal("Coffee with Alex");

        const content = await fs.readFile(nodePath.join(dir, "events", "coffee.md"), "utf8");
        expect(content).to.contain("my private body");
        expect(content.startsWith("---\n")).to.equal(true);
    });

    it("replaces frontmatter without touching the body", async () => {
        await port.upsertMarkdown("tasks/t.md", { title: "Old" }, "keep me\n");
        await port.writeFrontmatter("tasks/t.md", { title: "New", completed: true });
        const content = await fs.readFile(nodePath.join(dir, "tasks", "t.md"), "utf8");
        expect(content).to.contain("keep me");
        expect(await port.readFrontmatter("tasks/t.md")).to.deep.equal({
            title: "New",
            completed: true,
        });
    });

    it("lists markdown recursively under the given roots only, skipping dot-dirs", async () => {
        await port.upsertMarkdown("events/a.md", { title: "A" });
        await port.upsertMarkdown("events/archive/b.md", { title: "B" });
        await port.upsertMarkdown("notes/other.md", { title: "C" });
        await fs.mkdir(nodePath.join(dir, "events", ".hidden"), { recursive: true });
        await fs.writeFile(nodePath.join(dir, "events", ".hidden", "x.md"), "nope");

        const refs = await port.listMarkdown(["events", "missing-folder"]);
        expect(refs.map((r) => r.path).sort()).to.deep.equal(["events/a.md", "events/archive/b.md"]);
        expect(refs.find((r) => r.path === "events/a.md")?.basename).to.equal("a");
    });

    it("moves a note creating the destination folder", async () => {
        await port.upsertMarkdown("tasks/done.md", { title: "Done" }, "body");
        await port.move("tasks/done.md", "tasks/completed/done.md");
        expect(await port.exists("tasks/done.md")).to.equal(false);
        expect((await port.readFrontmatter("tasks/completed/done.md")).title).to.equal("Done");
    });

    it("keeps ISO dates as strings (no YAML timestamp coercion)", async () => {
        await fs.mkdir(nodePath.join(dir, "tasks"), { recursive: true });
        await fs.writeFile(
            nodePath.join(dir, "tasks", "t.md"),
            "---\ntitle: X\ndue: 2026-06-01\n---\n",
        );
        const fm = await port.readFrontmatter("tasks/t.md");
        expect(fm.due).to.equal("2026-06-01");
        expect(typeof fm.due).to.equal("string");
    });

    it("reads frontmatter from a note with CRLF line endings", async () => {
        await fs.mkdir(nodePath.join(dir, "tasks"), { recursive: true });
        await fs.writeFile(
            nodePath.join(dir, "tasks", "crlf.md"),
            "---\r\ntitle: Windows note\r\ncompleted: false\r\n---\r\n\r\nbody line\r\n",
        );
        const fm = await port.readFrontmatter("tasks/crlf.md");
        expect(fm.title).to.equal("Windows note");
        expect(fm.completed).to.equal(false);
    });

    it("rewrites CRLF frontmatter without duplicating the block or losing the body", async () => {
        await fs.mkdir(nodePath.join(dir, "tasks"), { recursive: true });
        await fs.writeFile(
            nodePath.join(dir, "tasks", "crlf.md"),
            "---\r\ntitle: Old\r\n---\r\n\r\nkeep me\r\n",
        );
        await port.writeFrontmatter("tasks/crlf.md", { title: "New", completed: true });
        const content = await fs.readFile(nodePath.join(dir, "tasks", "crlf.md"), "utf8");
        expect(content).to.contain("keep me");
        expect(content.match(/^---/gm)?.length).to.equal(2); // one block, not a prepended second one
        expect(await port.readFrontmatter("tasks/crlf.md")).to.deep.equal({
            title: "New",
            completed: true,
        });
    });

    it("refuses paths that escape the vault", async () => {
        let err: unknown;
        try {
            await port.readFrontmatter("../outside.md");
        } catch (e) {
            err = e;
        }
        expect((err as Error)?.message ?? "").to.contain("escapes the vault");
    });
});
