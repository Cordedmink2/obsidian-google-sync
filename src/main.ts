import { Notice, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, GoogleSyncSettings, GoogleSyncSettingTab } from "./settings";
import { HttpFn } from "./google/http";
import { obsidianHttp } from "./google/transport";
import { DEFAULT_SCOPES, GoogleAuth, OAuthConfig, TokenSet, TokenStore } from "./google/auth";
import { CalendarListEntry, GoogleCalendarClient } from "./google/calendar";
import { GoogleTasksClient, TaskListEntry } from "./google/tasks";
import { SyncRouter } from "./sync/router";
import { Lifecycle } from "./sync/lifecycle";
import { GoogleImporter } from "./sync/importer";
import { SyncSuppressor } from "./sync/suppression";
import { registerCommands } from "./commands";
import { readFrontmatter } from "./io";

interface PersistedData {
    settings: GoogleSyncSettings;
    tokens: TokenSet | null;
    lastLifecycleRun?: number;
}

const DEBOUNCE_MS = 750;
const SETTINGS_SAVE_DEBOUNCE_MS = 500;
// How long to ignore vault events for a note the plugin just wrote. Must comfortably outlast
// the debounce plus any same-tick rewrite by another plugin (e.g. Templater's "trigger on file
// creation"), so an import can't echo back into sync and overwrite the real Google item.
const SYNC_SUPPRESS_MS = 15_000;
const LIFECYCLE_CHECK_MS = 60 * 60 * 1000; // hourly tick
const LIFECYCLE_MIN_INTERVAL_MS = 23 * 60 * 60 * 1000; // ~daily

/**
 * Google Calendar/Tasks sync, desktop + iOS. Google is the source of truth for existence:
 * imports pull events/tasks into the vault, edits to linked notes patch back, and nothing
 * here ever creates or deletes a Google object. main.ts only wires lifecycle + services;
 * logic lives in src/google and src/sync.
 */
export default class GoogleSyncPlugin extends Plugin {
    settings: GoogleSyncSettings = { ...DEFAULT_SETTINGS };
    private tokens: TokenSet | null = null;
    private auth!: GoogleAuth;
    private calendar!: GoogleCalendarClient;
    private tasks!: GoogleTasksClient;
    private router!: SyncRouter;
    private lifecycle!: Lifecycle;
    private importer!: GoogleImporter;
    private lastLifecycleRun = 0;
    private suppressor = new SyncSuppressor(SYNC_SUPPRESS_MS);
    private timers = new Map<string, number>();
    private settingsSaveTimer: number | null = null;
    private settingsSavePending: Promise<void> | null = null;
    private importInFlight: Promise<void> | null = null;

    async onload(): Promise<void> {
        await this.loadAll();

        // Late-bound transport so e2e can inject a mock after load.
        const http: HttpFn = (req) => {
            const injected = (window as unknown as { __gsyncHttp?: HttpFn }).__gsyncHttp;
            return (typeof injected === "function" ? injected : obsidianHttp)(req);
        };

        this.auth = new GoogleAuth(http, () => this.oauthConfig(), this.tokenStore());
        const tokenProvider = () => this.auth.getAccessToken();
        this.calendar = new GoogleCalendarClient(http, tokenProvider);
        this.tasks = new GoogleTasksClient(http, tokenProvider);
        const suppress = (path: string) => this.suppressor.suppress(path, Date.now());
        this.router = new SyncRouter(
            this.app,
            this.calendar,
            this.tasks,
            () => this.settings,
            (m) => {
                new Notice(m);
            },
            suppress,
        );
        this.lifecycle = new Lifecycle(this.app, this.tasks, () => this.settings);
        this.importer = new GoogleImporter(
            this.app,
            this.calendar,
            this.tasks,
            () => this.settings,
            suppress,
        );

        this.addSettingTab(new GoogleSyncSettingTab(this.app, this));
        registerCommands(this);
        this.registerObsidianProtocolHandler(
            "google-sync",
            (params) => void this.onOAuthCallback(params),
        );
        this.registerVaultEvents();
        this.registerInterval(
            window.setInterval(() => void this.maybeRunLifecycle(), LIFECYCLE_CHECK_MS),
        );
        this.app.workspace.onLayoutReady(() => {
            // Run the startup import first, THEN the standalone lifecycle. Firing both
            // concurrently let the lifecycle scan before the import had written any notes —
            // it would archive nothing and still consume the ~daily interval, so nothing
            // got archived until the next day.
            void this.importOnStartup().finally(() => void this.maybeRunLifecycle());
        });

        // Pre-build the OAuth consent URL so Connect (including from the command
        // palette, which never opens settings) can open the browser synchronously
        // inside the tap — iOS blocks a post-await window.open.
        this.prepareConnect();
    }

    onunload(): void {
        for (const id of this.timers.values()) window.clearTimeout(id);
        this.timers.clear();
        if (this.settingsSaveTimer !== null) {
            window.clearTimeout(this.settingsSaveTimer);
            this.settingsSaveTimer = null;
            void this.saveAll();
        }
    }

    // ---- persistence (settings + tokens together in data.json) ----

    private async loadAll(): Promise<void> {
        const data = (await this.loadData()) as Partial<PersistedData> | null;
        this.settings = { ...DEFAULT_SETTINGS, ...(data?.settings ?? {}) };
        this.tokens = data?.tokens ?? null;
        this.lastLifecycleRun = data?.lastLifecycleRun ?? 0;
    }

    private async saveAll(): Promise<void> {
        const data: PersistedData = {
            settings: this.settings,
            tokens: this.tokens,
            lastLifecycleRun: this.lastLifecycleRun,
        };
        await this.saveData(data);
    }

    async saveSettings(): Promise<void> {
        await this.saveAll();
    }

    /**
     * Debounced settings save. Coalesces rapid changes (e.g. each keystroke in a text input)
     * into a single disk write — without this Obsidian Sync would upload data.json on every
     * character and hang the renderer.
     */
    scheduleSaveSettings(): void {
        if (this.settingsSaveTimer !== null) window.clearTimeout(this.settingsSaveTimer);
        this.settingsSaveTimer = window.setTimeout(() => {
            this.settingsSaveTimer = null;
            this.settingsSavePending = this.saveAll().finally(() => {
                this.settingsSavePending = null;
            });
        }, SETTINGS_SAVE_DEBOUNCE_MS);
    }

    /** Flush any pending debounced settings save. Call when leaving the settings tab. */
    async flushPendingSettingsSave(): Promise<void> {
        if (this.settingsSaveTimer !== null) {
            window.clearTimeout(this.settingsSaveTimer);
            this.settingsSaveTimer = null;
            this.settingsSavePending = this.saveAll().finally(() => {
                this.settingsSavePending = null;
            });
        }
        if (this.settingsSavePending) await this.settingsSavePending;
    }

    private tokenStore(): TokenStore {
        return {
            load: async () => this.tokens,
            save: async (t) => {
                this.tokens = t;
                await this.saveAll();
            },
        };
    }

    private oauthConfig(): OAuthConfig {
        return {
            clientId: this.settings.clientId,
            clientSecret: this.settings.clientSecret,
            redirectUri: this.settings.redirectUri,
            scopes: DEFAULT_SCOPES,
        };
    }

    // ---- public API used by settings tab + commands ----

    /**
     * Pre-build the PKCE material so {@link connect} can open the browser
     * synchronously inside the click. iOS (Obsidian mobile) only honours
     * window.open during the user-gesture call stack, so we can't await here.
     * Called from the settings render; only touches in-memory auth state.
     */
    prepareConnect(): void {
        if (!this.settings.clientId || !this.settings.redirectUri) return;
        void this.auth.prepare();
    }

    async connect(): Promise<void> {
        if (!this.settings.clientId || !this.settings.redirectUri) {
            new Notice("Set the OAuth client ID and redirect URL in settings first.");
            return;
        }
        // Open the consent page synchronously when settings pre-built the PKCE
        // material — iOS blocks window.open once we await. The await branch is the
        // desktop / not-yet-prepared fallback (Electron has no gesture rule).
        const { url } = this.auth.isPrepared()
            ? this.auth.authUrlFromPrepared()
            : await this.auth.beginAuth();
        window.open(url, "_blank");
        new Notice("Continue in your browser, then return to Obsidian.");
    }

    async disconnect(): Promise<void> {
        await this.auth.signOut();
        // signOut clears the prepared PKCE material — rebuild it so the next
        // Connect still opens synchronously on iOS.
        this.prepareConnect();
        new Notice("Disconnected from Google.");
    }

    isConnected(): Promise<boolean> {
        return this.auth.isConnected();
    }

    /**
     * Sync variant of isConnected() — reads the in-memory token without awaiting. Use
     * from the settings tab render so we don't have to mutate a Setting from a microtask
     * (which deadlocks Obsidian's renderer in 1.12.x when the Setting has child controls).
     */
    isConnectedSync(): boolean {
        return !!this.tokens?.refreshToken || (!!this.tokens && this.tokens.expiresAt > Date.now());
    }

    listCalendars(): Promise<CalendarListEntry[]> {
        return this.calendar.listCalendars();
    }

    listTaskLists(): Promise<TaskListEntry[]> {
        return this.tasks.listTaskLists();
    }

    /** Full preflight the user can run to verify real-account wiring end to end. */
    async validateSetup(): Promise<string> {
        const s = this.settings;
        const lines: string[] = [];
        const mark = (ok: boolean, label: string) => lines.push(`${ok ? "[ok]" : "[--]"} ${label}`);

        mark(!!s.clientId, "OAuth client ID");
        mark(!!s.clientSecret, "OAuth client secret");
        mark(!!s.redirectUri, "redirect bridge URL");

        const connected = await this.auth.isConnected();
        mark(
            connected,
            connected ? "connected to Google" : "not connected (run Connect to Google)",
        );

        if (connected) {
            try {
                const cals = await this.calendar.listCalendars();
                const found =
                    s.defaultCalendarId === "primary" ||
                    cals.some((c) => c.id === s.defaultCalendarId);
                mark(found, `calendar "${s.defaultCalendarId}" among ${cals.length} found`);
            } catch (e) {
                mark(false, `calendar check failed: ${(e as Error).message}`);
            }
            try {
                const lists = await this.tasks.listTaskLists();
                const found =
                    s.taskListId === "@default" || lists.some((l) => l.id === s.taskListId);
                mark(found, `task list "${s.taskListId}" among ${lists.length} found`);
            } catch (e) {
                mark(false, `task list check failed: ${(e as Error).message}`);
            }
        }
        return lines.join("\n");
    }

    async testConnection(): Promise<string> {
        try {
            await this.auth.getAccessToken();
            const cals = await this.calendar.listCalendars();
            return `Connection OK — ${cals.length} calendar(s) visible.`;
        } catch (e) {
            return `Connection failed: ${(e as Error).message}`;
        }
    }

    async syncNow(): Promise<void> {
        if (!(await this.auth.isConnected())) {
            new Notice("Connect to Google first.");
            return;
        }
        try {
            const { synced, failed } = await this.router.syncAll();
            new Notice(
                failed > 0
                    ? `google-sync: synced ${synced}, ${failed} failed (see console).`
                    : `google-sync: synced ${synced} note(s).`,
            );
        } catch (e) {
            new Notice(`google-sync error: ${(e as Error).message}`);
        }
    }

    async importFromGoogle(): Promise<void> {
        if (!(await this.auth.isConnected())) {
            new Notice("Connect to Google first.");
            return;
        }
        try {
            const { events, tasks, failed, lifecycleCounts } = await this.runImportPipeline();
            const moved =
                lifecycleCounts.archived + lifecycleCounts.overdue + lifecycleCounts.completed;
            const lifecycleSuffix =
                moved > 0
                    ? ` Lifecycle moved ${lifecycleCounts.archived} archived, ${lifecycleCounts.overdue} overdue, ${lifecycleCounts.completed} completed.`
                    : "";
            new Notice(
                failed > 0
                    ? `google-sync: imported ${events} event(s), ${tasks} task(s), ${failed} failed.${lifecycleSuffix}`
                    : `google-sync: imported ${events} event(s) and ${tasks} task(s).${lifecycleSuffix}`,
            );
        } catch (e) {
            new Notice(`google-sync import error: ${(e as Error).message}`);
        }
    }

    private async importOnStartup(): Promise<void> {
        if (!this.settings.importOnStartup) return;
        if (!(await this.auth.isConnected())) return;
        try {
            await this.runImportPipeline({ createOnly: true, lifecycleOnlyWhenAdded: true });
        } catch (e) {
            console.error("[google-sync] startup import failed", e);
        }
    }

    private async runImportPipeline(
        options: {
            createOnly?: boolean;
            lifecycleOnlyWhenAdded?: boolean;
        } = {},
    ): Promise<{
        events: number;
        tasks: number;
        failed: number;
        lifecycleCounts: Awaited<ReturnType<Lifecycle["runOnce"]>>;
    }> {
        if (this.importInFlight) {
            await this.importInFlight;
            return {
                events: 0,
                tasks: 0,
                failed: 0,
                lifecycleCounts: { archived: 0, overdue: 0, completed: 0 },
            };
        }
        let result!: {
            events: number;
            tasks: number;
            failed: number;
            lifecycleCounts: Awaited<ReturnType<Lifecycle["runOnce"]>>;
        };
        this.importInFlight = (async () => {
            const { events, tasks, failed } = await this.importer.importAll({
                createOnly: options.createOnly,
            });
            const addedOrUpdated = events + tasks;
            const lifecycleCounts =
                options.lifecycleOnlyWhenAdded && addedOrUpdated === 0
                    ? { archived: 0, overdue: 0, completed: 0 }
                    : await this.lifecycle.runOnce();
            if (!options.lifecycleOnlyWhenAdded || addedOrUpdated > 0) {
                this.lastLifecycleRun = Date.now();
                await this.saveAll();
            }
            result = { events, tasks, failed, lifecycleCounts };
        })();
        try {
            await this.importInFlight;
            return result;
        } finally {
            this.importInFlight = null;
        }
    }

    /** Run the archive/overdue/completed scan. Notifies always when manual; else only if it did something. */
    async runLifecycle(manual = false): Promise<void> {
        try {
            const c = await this.lifecycle.runOnce();
            this.lastLifecycleRun = Date.now();
            await this.saveAll();
            const total = c.archived + c.overdue + c.completed;
            if (manual || total > 0) {
                new Notice(
                    `google-sync lifecycle: ${c.archived} archived, ${c.overdue} overdue, ${c.completed} completed.`,
                );
            }
        } catch (e) {
            new Notice(`google-sync lifecycle error: ${(e as Error).message}`);
        }
    }

    private async maybeRunLifecycle(): Promise<void> {
        if (!this.settings.autoArchiveEnabled) return;
        if (Date.now() - this.lastLifecycleRun < LIFECYCLE_MIN_INTERVAL_MS) return;
        await this.runLifecycle(false);
    }

    /** Guarded e2e hook: seed a fake token so sync runs against the mock transport. */
    async e2eSeedToken(): Promise<void> {
        if (!(window as unknown as { __gsyncE2E?: boolean }).__gsyncE2E) return;
        this.tokens = {
            accessToken: "e2e-token",
            refreshToken: "e2e-refresh",
            expiresAt: Date.now() + 3600_000,
        };
        await this.saveAll();
    }

    // ---- internals ----

    private async onOAuthCallback(params: Record<string, string>): Promise<void> {
        if (params.error) {
            new Notice(`Google auth failed: ${params.error}`);
            return;
        }
        if (!params.code || !params.state) return;
        try {
            await this.auth.completeAuth(params.code, params.state);
            new Notice("Connected to Google.");
        } catch (e) {
            new Notice(`Google auth failed: ${(e as Error).message}`);
        } finally {
            // completeAuth consumed the prepared material — rebuild for a future reconnect.
            this.prepareConnect();
        }
    }

    private registerVaultEvents(): void {
        // Creation and deletion never touch Google: a created note with a googleId (e.g.
        // arriving via git/Obsidian Sync) is patched like an edit, one without is a no-op
        // in the router, and deleting a note leaves the Google item alone.
        this.registerEvent(
            this.app.vault.on("create", (f) => {
                if (f instanceof TFile && this.settings.syncOnModify && !this.isSuppressed(f.path))
                    this.debounceSync(f);
            }),
        );
        this.registerEvent(
            this.app.vault.on("modify", (f) => {
                if (f instanceof TFile && this.settings.syncOnModify && !this.isSuppressed(f.path))
                    this.debounceSync(f);
            }),
        );
        this.registerEvent(
            this.app.vault.on("rename", (f) => {
                if (f instanceof TFile) void this.safeRename(f);
            }),
        );
    }

    /** True while a note the plugin just wrote is in its echo-suppression window. */
    private isSuppressed(path: string): boolean {
        return this.suppressor.isSuppressed(path, Date.now());
    }

    private debounceSync(file: TFile): void {
        if (!this.router.syncKind(file.path)) return;
        const prev = this.timers.get(file.path);
        if (prev) window.clearTimeout(prev);
        const id = window.setTimeout(() => {
            this.timers.delete(file.path);
            void this.safeSync(file);
        }, DEBOUNCE_MS);
        this.timers.set(file.path, id);
    }

    private async safeSync(file: TFile): Promise<void> {
        if (!this.router.syncKind(file.path)) return;
        if (!(await this.auth.isConnected())) return;
        try {
            await this.router.syncFile(file);
            await this.maybeFileCompletedTask(file);
        } catch (e) {
            new Notice(`google-sync: ${(e as Error).message}`);
        }
    }

    /**
     * File a task into tasks/completed the moment it's marked done, rather than waiting for the
     * ~daily lifecycle timer. Runs after a successful task sync (so Google is updated first).
     * Gated on autoArchiveEnabled — the master auto-file switch — and skips notes already in a
     * managed subfolder (syncKind returns null for those), so it never re-triggers on the move.
     */
    private async maybeFileCompletedTask(file: TFile): Promise<void> {
        if (!this.settings.autoArchiveEnabled) return;
        if (this.router.syncKind(file.path) !== "task") return;
        const fm = await readFrontmatter(this.app, file);
        if (fm.completed !== true && fm.status !== "completed") return;
        await this.runLifecycle(false);
    }

    private async safeRename(file: TFile): Promise<void> {
        if (!(await this.auth.isConnected())) return;
        try {
            await this.router.syncFile(file);
        } catch (e) {
            new Notice(`google-sync: ${(e as Error).message}`);
        }
    }
}
