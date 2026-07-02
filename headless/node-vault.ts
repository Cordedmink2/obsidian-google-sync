import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { VaultNoteRef, VaultPort } from "../src/vault/port";
import { basenameOf, normalizeVaultPath } from "../src/vault/paths";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/** Directories that are never part of the synced note tree. */
const SKIP_DIRS = new Set([".obsidian", ".git", ".google-sync", ".trash"]);

/**
 * VaultPort over the plain filesystem, rooted at an Obsidian vault directory — lets the
 * sync core run on a server with no Obsidian. Vault-relative "/" paths in, real files out.
 */
export class NodeVaultPort implements VaultPort {
    constructor(private readonly vaultPath: string) {}

    /** Resolve a vault-relative path, refusing escapes from the vault root. */
    private abs(vaultRelative: string): string {
        const normalized = normalizeVaultPath(vaultRelative);
        if (normalized.split("/").includes("..")) {
            throw new Error(`Path escapes the vault: ${vaultRelative}`);
        }
        return nodePath.join(this.vaultPath, ...normalized.split("/"));
    }

    async listMarkdown(roots: string[]): Promise<VaultNoteRef[]> {
        const out: VaultNoteRef[] = [];
        const seen = new Set<string>();

        const walk = async (relDir: string): Promise<void> => {
            let entries;
            try {
                entries = await fs.readdir(this.abs(relDir), { withFileTypes: true });
            } catch {
                return; // missing root folder = no notes
            }
            for (const entry of entries) {
                const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
                if (entry.isDirectory()) {
                    if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) await walk(rel);
                } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
                    if (!seen.has(rel)) {
                        seen.add(rel);
                        out.push({ path: rel, basename: basenameOf(rel) });
                    }
                }
            }
        };

        for (const root of roots) {
            const normalized = normalizeVaultPath(root);
            if (normalized) await walk(normalized);
        }
        return out;
    }

    async exists(path: string): Promise<boolean> {
        try {
            await fs.access(this.abs(path));
            return true;
        } catch {
            return false;
        }
    }

    private async readParts(path: string): Promise<{ fm: Record<string, unknown>; body: string }> {
        const content = await fs.readFile(this.abs(path), "utf8");
        const match = content.match(FRONTMATTER_RE);
        const block = match?.[1];
        if (!block) return { fm: {}, body: content };
        const parsed: unknown = parseYaml(block);
        return {
            fm: parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {},
            body: content.replace(FRONTMATTER_RE, "").replace(/^(\r?\n)+/, ""),
        };
    }

    private async write(
        path: string,
        frontmatter: Record<string, unknown>,
        body: string,
    ): Promise<void> {
        const abs = this.abs(path);
        await fs.mkdir(nodePath.dirname(abs), { recursive: true });
        await fs.writeFile(abs, `---\n${stringifyYaml(frontmatter)}---\n${body}`, "utf8");
    }

    async readFrontmatter(path: string): Promise<Record<string, unknown>> {
        return (await this.readParts(path)).fm;
    }

    async writeFrontmatter(path: string, frontmatter: Record<string, unknown>): Promise<void> {
        const { body } = await this.readParts(path);
        await this.write(path, frontmatter, body);
    }

    async writeFrontmatterKey(path: string, key: string, value: unknown): Promise<void> {
        const { fm, body } = await this.readParts(path);
        fm[key] = value;
        await this.write(path, fm, body);
    }

    async upsertMarkdown(
        path: string,
        frontmatter: Record<string, unknown>,
        body = "",
    ): Promise<void> {
        await this.write(path, frontmatter, body);
    }

    async move(oldPath: string, newPath: string): Promise<void> {
        const to = this.abs(newPath);
        await fs.mkdir(nodePath.dirname(to), { recursive: true });
        await fs.rename(this.abs(oldPath), to);
    }
}
