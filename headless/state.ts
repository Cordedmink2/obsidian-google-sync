import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import { BaselineStore, GoogleBody } from "../src/sync/baseline";

interface StateFile {
    version: 1;
    /** Per-note last-pushed/imported Google bodies (the diff-patching baselines). */
    baselines: Record<string, GoogleBody>;
}

/**
 * Headless baseline store, persisted at <vault>/.google-sync/state.json and committed
 * with the vault so the sync state travels alongside the notes. Mutations are in-memory
 * until flush(), which only writes when something actually changed — an unchanged run
 * must leave the repo clean so it produces no commit.
 */
export class FileBaselineStore implements BaselineStore {
    private state: StateFile | null = null;
    private dirty = false;

    constructor(private readonly vaultPath: string) {}

    private get file(): string {
        return nodePath.join(this.vaultPath, ".google-sync", "state.json");
    }

    private async load(): Promise<StateFile> {
        if (this.state) return this.state;
        try {
            const raw = JSON.parse(await fs.readFile(this.file, "utf8")) as Partial<StateFile>;
            this.state = { version: 1, baselines: raw.baselines ?? {} };
        } catch {
            this.state = { version: 1, baselines: {} };
        }
        return this.state;
    }

    async get(path: string): Promise<GoogleBody | undefined> {
        return (await this.load()).baselines[path];
    }

    async set(path: string, body: GoogleBody): Promise<void> {
        const state = await this.load();
        if (JSON.stringify(state.baselines[path]) !== JSON.stringify(body)) {
            state.baselines[path] = body;
            this.dirty = true;
        }
    }

    /** Drop baselines for notes that no longer exist (moved/renamed/deleted). */
    async prune(livePaths: Set<string>): Promise<void> {
        const state = await this.load();
        for (const path of Object.keys(state.baselines)) {
            if (!livePaths.has(path)) {
                delete state.baselines[path];
                this.dirty = true;
            }
        }
    }

    async flush(): Promise<void> {
        if (!this.dirty) return;
        const state = await this.load();
        await fs.mkdir(nodePath.dirname(this.file), { recursive: true });
        await fs.writeFile(this.file, JSON.stringify(state, null, 2) + "\n", "utf8");
        this.dirty = false;
    }
}
