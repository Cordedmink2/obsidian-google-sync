import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import { TokenSet, TokenStore } from "../src/google/auth";

/**
 * TokenStore over a JSON file (chmod 600). GoogleAuth persists rotated refresh tokens
 * through save(), so a long-lived server install keeps itself alive.
 */
export class FileTokenStore implements TokenStore {
    constructor(private readonly file: string) {}

    async load(): Promise<TokenSet | null> {
        try {
            const raw = await fs.readFile(this.file, "utf8");
            return JSON.parse(raw) as TokenSet;
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw e;
        }
    }

    async save(tokens: TokenSet | null): Promise<void> {
        if (!tokens) {
            await fs.unlink(this.file).catch(() => undefined);
            return;
        }
        await fs.mkdir(nodePath.dirname(this.file), { recursive: true });
        // Atomic-ish: write a sibling temp file, then rename over the target.
        const tmp = `${this.file}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(tokens, null, 2), { mode: 0o600 });
        await fs.rename(tmp, this.file);
    }
}
