import { App, TFile, normalizePath, parseYaml, stringifyYaml } from "obsidian";

/**
 * Obsidian Vault file helpers. Mobile-safe (Vault API + fileManager only, no Node fs).
 * Reading frontmatter parses the leading `---` block directly so it doesn't depend on
 * metadataCache timing right after a write.
 */

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

export async function readFrontmatter(app: App, file: TFile): Promise<Record<string, unknown>> {
    const content = await app.vault.read(file);
    const match = content.match(FRONTMATTER_RE);
    const block = match?.[1];
    if (!block) return {};
    const parsed: unknown = parseYaml(block);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

/** Set a single frontmatter key, preserving the rest. */
export async function writeFrontmatterKey(
    app: App,
    file: TFile,
    key: string,
    value: unknown,
): Promise<void> {
    await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        fm[key] = value;
    });
}

export async function writeFrontmatter(
    app: App,
    file: TFile,
    frontmatter: Record<string, unknown>,
): Promise<void> {
    const content = await app.vault.read(file);
    const body = content.replace(FRONTMATTER_RE, "").replace(/^(\r?\n)+/, "");
    await app.vault.modify(file, `---\n${stringifyYaml(frontmatter)}---\n${body}`);
}

export async function upsertMarkdownFile(
    app: App,
    path: string,
    frontmatter: Record<string, unknown>,
    body = "",
): Promise<TFile> {
    const normalized = normalizePath(path);
    const dir = normalized.split("/").slice(0, -1).join("/");
    if (dir && !app.vault.getAbstractFileByPath(dir)) {
        await app.vault.createFolder(dir).catch(() => undefined);
    }
    const content = `---\n${stringifyYaml(frontmatter)}---\n${body}`;
    const existing = app.vault.getAbstractFileByPath(normalized);
    if (existing instanceof TFile) {
        await app.vault.modify(existing, content);
        return existing;
    }
    return app.vault.create(normalized, content);
}

/** Move a note to newPath, creating the parent folder if needed. Returns the moved file. */
export async function moveFile(app: App, file: TFile, newPath: string): Promise<void> {
    const path = normalizePath(newPath);
    const dir = path.split("/").slice(0, -1).join("/");
    if (dir && !app.vault.getAbstractFileByPath(dir)) {
        await app.vault.createFolder(dir).catch(() => undefined);
    }
    await app.fileManager.renameFile(file, path);
}
