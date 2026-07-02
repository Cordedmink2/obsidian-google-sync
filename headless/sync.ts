import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { setTimeout as nodeSleep } from "node:timers/promises";
import { GoogleAuth, DEFAULT_SCOPES } from "../src/google/auth";
import { GoogleCalendarClient } from "../src/google/calendar";
import { GoogleTasksClient } from "../src/google/tasks";
import { SyncRouter } from "../src/sync/router";
import { GoogleImporter } from "../src/sync/importer";
import { Lifecycle } from "../src/sync/lifecycle";
import { NodeVaultPort } from "./node-vault";
import { nodeFetchHttp } from "./transport";
import { FileTokenStore } from "./token-store";
import { FileBaselineStore } from "./state";
import { GitSync } from "./git";
import { HeadlessConfig, loadConfig } from "./config";

/**
 * Headless vault sync — run from cron/systemd to keep a server-side vault in sync with
 * Google Calendar + Tasks independently of Obsidian, committing and pushing the vault's
 * git repo after each run. Same one-way rules as the plugin: import creates/updates
 * notes, local edits patch existing items, nothing is ever created or deleted in Google.
 *
 *   node sync.cjs --config /etc/gsync/config.json [--dry-run] [--allow-mass-update] [--no-git]
 */

interface Args {
    config: string;
    dryRun: boolean;
    allowMassUpdate: boolean;
    noGit: boolean;
}

function parseArgs(argv: string[]): Args {
    const args: Args = { config: "", dryRun: false, allowMassUpdate: false, noGit: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--config") args.config = argv[++i] ?? "";
        else if (a === "--dry-run") args.dryRun = true;
        else if (a === "--allow-mass-update") args.allowMassUpdate = true;
        else if (a === "--no-git") args.noGit = true;
        else if (a === "--help" || a === "-h") {
            console.log(
                "usage: sync --config <gsync.json> [--dry-run] [--allow-mass-update] [--no-git]",
            );
            process.exit(0);
        } else {
            console.error(`unknown argument: ${a}`);
            process.exit(2);
        }
    }
    if (!args.config) {
        console.error("required: --config <gsync.json>");
        process.exit(2);
    }
    return args;
}

const log = (msg: string) => console.log(`[gsync ${new Date().toISOString()}] ${msg}`);

const LOCK_STALE_MS = 30 * 60 * 1000;

async function acquireLock(vaultPath: string): Promise<(() => Promise<void>) | null> {
    // Lives in the OS temp dir (keyed by vault path) so it is never committed.
    const key = createHash("sha1").update(vaultPath).digest("hex").slice(0, 12);
    const lockFile = nodePath.join(os.tmpdir(), `gsync-${key}.lock`);
    const payload = () => JSON.stringify({ pid: process.pid, time: Date.now() });
    // `wx` creates exclusively, so two runs starting together can't both win —
    // a read-then-write check would let both pass before either wrote the lock.
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            await fs.writeFile(lockFile, payload(), { flag: "wx" });
            return async () => fs.unlink(lockFile).catch(() => undefined);
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        }
        let time: number | undefined;
        try {
            time = (JSON.parse(await fs.readFile(lockFile, "utf8")) as { time?: number }).time;
        } catch {
            // unreadable/corrupt lock — treat as stale
        }
        if (time && Date.now() - time < LOCK_STALE_MS) return null;
        log("stale lock found — taking over");
        await fs.unlink(lockFile).catch(() => undefined);
    }
    return null;
}

async function runSync(config: HeadlessConfig, args: Args): Promise<number> {
    const port = new NodeVaultPort(config.vaultPath);
    const baselines = new FileBaselineStore(config.vaultPath);
    const retry = { sleep: nodeSleep };
    const auth = new GoogleAuth(
        nodeFetchHttp,
        () => ({
            clientId: config.settings.clientId,
            clientSecret: config.settings.clientSecret,
            redirectUri: `http://127.0.0.1:${config.loopbackPort}/callback`,
            scopes: DEFAULT_SCOPES,
        }),
        new FileTokenStore(config.tokenFile),
        Date.now,
        retry,
    );
    if (!(await auth.isConnected())) {
        log(`not authorized — run: authorize --config ${args.config}`);
        return 2;
    }
    const tokenProvider = () => auth.getAccessToken();
    const calendar = new GoogleCalendarClient(nodeFetchHttp, tokenProvider, retry);
    const tasks = new GoogleTasksClient(nodeFetchHttp, tokenProvider, retry);
    const settings = () => config.settings;
    const router = new SyncRouter(port, calendar, tasks, settings, baselines, log);
    const importer = new GoogleImporter(port, calendar, tasks, settings, () => {}, baselines);
    const lifecycle = new Lifecycle(port, tasks, settings, log);

    if (args.dryRun) {
        const pending = await router.previewAll();
        if (!pending.length) log("dry run: no pending local updates");
        for (const p of pending) {
            log(
                `dry run: ${p.path} -> ${p.veto ? `BLOCKED (${p.veto})` : p.changedKeys.join(", ") || "(meet link request)"}`,
            );
        }
        log("dry run: import/lifecycle/git skipped");
        return 0;
    }

    let exitCode = 0;

    // 1. Push local edits first, so fields the server-side vault changed win; the import
    //    that follows pulls Google's merged result straight back into the notes.
    if (config.settings.syncOnModify) {
        const push = await router.syncAll({ confirmed: args.allowMassUpdate });
        if (push.blocked.length) {
            log(
                `mass-update guard: ${push.blocked.length} pending updates — re-run with --allow-mass-update to push them`,
            );
            for (const path of push.blocked) log(`  pending: ${path}`);
            exitCode = 3;
        } else {
            log(`pushed ${push.synced} update(s), ${push.failed} failed`);
            if (push.failed > 0) exitCode = 1;
        }
    }

    // 2. Pull Google's current state into the vault.
    const counts = await importer.importAll();
    log(
        `imported ${counts.events} event(s), ${counts.tasks} task(s), ${counts.failed} failed, ${counts.orphaned} orphaned`,
    );
    if (counts.failed > 0) exitCode = exitCode || 1;

    // 3. File archive/overdue/completed and close linked tasks.
    if (config.settings.autoArchiveEnabled) {
        const lc = await lifecycle.runOnce();
        log(`lifecycle: ${lc.archived} archived, ${lc.overdue} overdue, ${lc.completed} completed`);
    }

    // 4. Persist baselines (pruned to live notes) inside the same commit as the notes.
    const live = new Set(
        (await port.listMarkdown([config.settings.eventsFolder, config.settings.tasksFolder])).map(
            (r) => r.path,
        ),
    );
    await baselines.prune(live);
    await baselines.flush();

    return exitCode;
}

async function main(): Promise<number> {
    const args = parseArgs(process.argv.slice(2));
    const config = await loadConfig(args.config);

    const release = await acquireLock(config.vaultPath);
    if (!release) {
        log("another sync is already running — exiting");
        return 0;
    }
    try {
        const git = new GitSync(config.vaultPath, config.git, log);
        const gitEnabled = config.git.enabled && !args.noGit && !args.dryRun;
        if (gitEnabled) await git.preSync();

        const code = await runSync(config, args);

        if (gitEnabled) {
            const s = config.settings;
            const stamp = new Date().toISOString();
            await git.commitAndPush(
                [s.eventsFolder, s.tasksFolder, ".google-sync"],
                `google-sync: ${stamp}`,
            );
            log("git: pushed");
        }
        return code;
    } finally {
        await release();
    }
}

main()
    .then((code) => process.exit(code))
    .catch((e) => {
        console.error(`[gsync] fatal: ${(e as Error).stack ?? String(e)}`);
        process.exit(1);
    });
