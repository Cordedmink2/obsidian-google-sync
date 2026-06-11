import { promises as fs } from "node:fs";
import * as nodePath from "node:path";
import { DEFAULT_SETTINGS, GoogleSyncSettings } from "../src/settings-data";
import { TokenSet } from "../src/google/auth";

export interface HeadlessGitConfig {
    /** Commit + push the vault after a sync run. */
    enabled: boolean;
    remote: string;
    /** Branch to sync; empty = the vault's current branch. */
    branch: string;
    authorName: string;
    authorEmail: string;
}

export interface HeadlessConfig {
    /** Absolute path of the vault directory on this machine. */
    vaultPath: string;
    /** Where OAuth tokens live (created by `authorize`, chmod 600). Keep OUTSIDE the vault
     * so it is never committed/pushed with the notes. */
    tokenFile: string;
    settings: GoogleSyncSettings;
    git: HeadlessGitConfig;
    /** Port for the one-time interactive `authorize` loopback listener. */
    loopbackPort: number;
}

const DEFAULT_GIT: HeadlessGitConfig = {
    enabled: true,
    remote: "origin",
    branch: "",
    authorName: "google-sync",
    authorEmail: "google-sync@localhost",
};

/**
 * Load a headless config JSON. The `settings` object uses the exact same shape as the
 * plugin's data.json `settings`, so a plugin install's configuration can be copied in
 * verbatim (see `authorize --from-plugin-data`). `GSYNC_CLIENT_SECRET` overrides the
 * client secret so it can stay out of the file.
 */
export async function loadConfig(
    file: string,
    options: { requireVault?: boolean } = {},
): Promise<HeadlessConfig> {
    const requireVault = options.requireVault ?? true;
    const configDir = nodePath.dirname(nodePath.resolve(file));
    let raw: Record<string, unknown>;
    try {
        raw = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
    } catch (e) {
        throw new Error(`Could not read config ${file}: ${(e as Error).message}`);
    }
    if (requireVault && (typeof raw.vaultPath !== "string" || !raw.vaultPath)) {
        throw new Error(`Config ${file} must set "vaultPath"`);
    }

    const settings: GoogleSyncSettings = {
        ...DEFAULT_SETTINGS,
        ...((raw.settings as Partial<GoogleSyncSettings>) ?? {}),
    };
    if (process.env.GSYNC_CLIENT_SECRET) settings.clientSecret = process.env.GSYNC_CLIENT_SECRET;
    if (process.env.GSYNC_CLIENT_ID) settings.clientId = process.env.GSYNC_CLIENT_ID;

    const vaultPath =
        typeof raw.vaultPath === "string" && raw.vaultPath
            ? nodePath.resolve(configDir, raw.vaultPath)
            : "";
    const tokenFile = nodePath.resolve(
        configDir,
        typeof raw.tokenFile === "string" && raw.tokenFile ? raw.tokenFile : "gsync-tokens.json",
    );
    if (vaultPath && tokenFile.startsWith(vaultPath + nodePath.sep)) {
        throw new Error(
            `tokenFile must live outside the vault (it would be committed and pushed): ${tokenFile}`,
        );
    }

    const loopbackPort = Number((raw.loopbackPort as number | string | undefined) ?? 8765);
    if (!Number.isInteger(loopbackPort) || loopbackPort < 1 || loopbackPort > 65535) {
        throw new Error(`Invalid loopbackPort: ${String(raw.loopbackPort)}`);
    }

    return {
        vaultPath,
        tokenFile,
        settings,
        git: { ...DEFAULT_GIT, ...((raw.git as Partial<HeadlessGitConfig>) ?? {}) },
        loopbackPort,
    };
}

/** The slices of a plugin data.json an install can hand over to headless. */
export interface PluginData {
    settings?: Partial<GoogleSyncSettings>;
    tokens?: TokenSet | null;
}

export async function readPluginData(dataJsonPath: string): Promise<PluginData> {
    return JSON.parse(await fs.readFile(dataJsonPath, "utf8")) as PluginData;
}
