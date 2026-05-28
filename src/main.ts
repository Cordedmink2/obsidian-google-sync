import { Notice, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, GoogleSyncSettings, GoogleSyncSettingTab } from "./settings";
import { HttpFn } from "./google/http";
import { obsidianHttp } from "./google/transport";
import { DEFAULT_SCOPES, GoogleAuth, OAuthConfig, TokenSet, TokenStore } from "./google/auth";
import { CalendarListEntry, GoogleCalendarClient } from "./google/calendar";
import { GoogleTasksClient, TaskListEntry } from "./google/tasks";
import { SyncRouter } from "./sync/router";
import { Lifecycle } from "./sync/lifecycle";
import { registerCommands } from "./commands";

interface PersistedData {
    settings: GoogleSyncSettings;
    tokens: TokenSet | null;
    lastLifecycleRun?: number;
}

const DEBOUNCE_MS = 750;
const SETTINGS_SAVE_DEBOUNCE_MS = 500;
const LIFECYCLE_CHECK_MS = 60 * 60 * 1000; // hourly tick
const LIFECYCLE_MIN_INTERVAL_MS = 23 * 60 * 60 * 1000; // ~daily

/**
 * Google Calendar/Tasks sync. Obsidian -> Google, desktop + iOS. main.ts only wires
 * lifecycle + services; logic lives in src/google and src/sync.
 */
export default class GoogleSyncPlugin extends Plugin {
    settings: GoogleSyncSettings = { ...DEFAULT_SETTINGS };
    private tokens: TokenSet | null = null;
    private auth!: GoogleAuth;
    private calendar!: GoogleCalendarClient;
    private tasks!: GoogleTasksClient;
    private router!: SyncRouter;
    private lifecycle!: Lifecycle;
    private lastLifecycleRun = 0;
    private timers = new Map<string, number>();
    private settingsSaveTimer: number | null = null;
    private settingsSavePending: Promise<void> | null = null;

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
        this.router = new SyncRouter(this.app, this.calendar, this.tasks, () => this.settings);
        this.lifecycle = new Lifecycle(this.app, this.tasks, () => this.settings);

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
            this.router.buildIndex();
            void this.maybeRunLifecycle();
        });
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

    async connect(): Promise<void> {
        if (!this.settings.clientId || !this.settings.redirectUri) {
            new Notice("Set the OAuth client ID and redirect URL in settings first.");
            return;
        }
        const { url } = await this.auth.beginAuth();
        window.open(url, "_blank");
        new Notice("Continue in your browser, then return to Obsidian.");
    }

    async disconnect(): Promise<void> {
        await this.auth.signOut();
        new Notice("Disconnected from Google.");
    }

    isConnected(): Promise<boolean> {
        return this.auth.isConnected();
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
        this.router.buildIndex();
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
            this.router.buildIndex();
            new Notice("Connected to Google.");
        } catch (e) {
            new Notice(`Google auth failed: ${(e as Error).message}`);
        }
    }

    private registerVaultEvents(): void {
        this.registerEvent(
            this.app.vault.on("create", (f) => {
                if (f instanceof TFile && this.settings.syncOnCreate) this.debounceSync(f);
            }),
        );
        this.registerEvent(
            this.app.vault.on("modify", (f) => {
                if (f instanceof TFile && this.settings.syncOnModify) this.debounceSync(f);
            }),
        );
        this.registerEvent(
            this.app.vault.on("delete", (f) => {
                if (f instanceof TFile && this.settings.syncOnDelete) void this.safeDelete(f.path);
            }),
        );
        this.registerEvent(
            this.app.vault.on("rename", (f, oldPath) => {
                if (f instanceof TFile) void this.safeRename(f, oldPath);
            }),
        );
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
        } catch (e) {
            new Notice(`google-sync: ${(e as Error).message}`);
        }
    }

    private async safeDelete(path: string): Promise<void> {
        if (!(await this.auth.isConnected())) return;
        try {
            await this.router.handleDelete(path);
        } catch (e) {
            new Notice(`google-sync: ${(e as Error).message}`);
        }
    }

    private async safeRename(file: TFile, oldPath: string): Promise<void> {
        if (!(await this.auth.isConnected())) return;
        try {
            await this.router.handleRename(file, oldPath);
        } catch (e) {
            new Notice(`google-sync: ${(e as Error).message}`);
        }
    }
}
