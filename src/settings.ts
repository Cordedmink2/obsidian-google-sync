import { App, Notice, PluginSettingTab, Setting, TextComponent } from "obsidian";
import { IANAZone } from "luxon";
import GoogleSyncPlugin from "./main";
import { CalendarListEntry } from "./google/calendar";
import { TaskListEntry } from "./google/tasks";
import { RecurringFilterMode } from "./sync/recurrence";
import { DEFAULT_SETTINGS, GoogleSyncSettings, systemTimezone } from "./settings-data";
import { normalizeVaultPath } from "./vault/paths";
import { isLikelyClientId, normalizeRedirectUri, redirectUriWarning } from "./setup-checks";

const SETUP_GUIDE_URL =
    "https://github.com/Cordedmink2/obsidian-google-sync/blob/main/docs/google-setup.md";
/** Google Cloud / Auth Platform consoles the setup steps point at. */
const GOOGLE_LINKS: { label: string; url: string }[] = [
    { label: "Projects", url: "https://console.cloud.google.com/projectselector2/home/dashboard" },
    { label: "Enable APIs", url: "https://console.cloud.google.com/apis/library" },
    { label: "Audience (test users)", url: "https://console.cloud.google.com/auth/audience" },
    { label: "Clients", url: "https://console.cloud.google.com/auth/clients" },
];

export { DEFAULT_SETTINGS } from "./settings-data";
export type { GoogleSyncSettings } from "./settings-data";

const INVALID_CLASS = "gsync-invalid";

/** Per-field validation: returns an error message, or null when the value is fine. */
type Validator = (value: string) => string | null;

export class GoogleSyncSettingTab extends PluginSettingTab {
    plugin: GoogleSyncPlugin;
    private calendars: CalendarListEntry[] = [];
    private taskLists: TaskListEntry[] = [];
    private pickersLoadAttempted = false;

    constructor(app: App, plugin: GoogleSyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    hide(): void {
        // Flush any in-flight debounced save before the tab is torn down so a fast
        // close-after-typing doesn't lose the last few keystrokes.
        void this.plugin.flushPendingSettingsSave();
    }

    /** Show/clear an inline error under a text input. */
    private markValidity(input: TextComponent, error: string | null): void {
        input.inputEl.toggleClass(INVALID_CLASS, error !== null);
        input.inputEl.title = error ?? "";
        input.inputEl.setAttribute("aria-invalid", error === null ? "false" : "true");
    }

    private text(
        name: string,
        desc: string,
        key: keyof GoogleSyncSettings,
        options: {
            placeholder?: string;
            validate?: Validator;
            normalize?: (v: string) => string;
        } = {},
    ): void {
        new Setting(this.containerEl)
            .setName(name)
            .setDesc(desc)
            .addText((t) => {
                t.setPlaceholder(options.placeholder ?? "").setValue(
                    String(this.plugin.settings[key] ?? ""),
                );
                t.onChange(async (value) => {
                    const normalized = options.normalize ? options.normalize(value) : value;
                    const error = options.validate ? options.validate(normalized) : null;
                    this.markValidity(t, error);
                    if (error !== null) return; // keep the last valid value
                    (this.plugin.settings[key] as unknown) = normalized;
                    this.plugin.scheduleSaveSettings();
                });
                const initialError = options.validate
                    ? options.validate(String(this.plugin.settings[key] ?? ""))
                    : null;
                this.markValidity(t, initialError);
            });
    }

    private toggle(name: string, desc: string, key: keyof GoogleSyncSettings): void {
        new Setting(this.containerEl)
            .setName(name)
            .setDesc(desc)
            .addToggle((t) =>
                t.setValue(Boolean(this.plugin.settings[key])).onChange(async (value) => {
                    (this.plugin.settings[key] as unknown) = value;
                    this.plugin.scheduleSaveSettings();
                }),
            );
    }

    private number(
        name: string,
        desc: string,
        key: "importPastDays" | "importFutureDays" | "autoArchiveDaysPast" | "maxPatchesPerRun",
        bounds: { min: number; max: number },
    ): void {
        new Setting(this.containerEl)
            .setName(name)
            .setDesc(`${desc} (${bounds.min}–${bounds.max})`)
            .addText((t) => {
                t.setValue(String(this.plugin.settings[key]));
                t.inputEl.type = "number";
                t.inputEl.min = String(bounds.min);
                t.inputEl.max = String(bounds.max);
                t.onChange(async (value) => {
                    const n = Number(value);
                    const valid =
                        value.trim() !== "" &&
                        Number.isFinite(n) &&
                        n >= bounds.min &&
                        n <= bounds.max;
                    this.markValidity(
                        t,
                        valid ? null : `Enter a number between ${bounds.min} and ${bounds.max}`,
                    );
                    if (!valid) return; // keep the last valid value
                    this.plugin.settings[key] = Math.round(n);
                    this.plugin.scheduleSaveSettings();
                });
            });
    }

    private list(name: string, desc: string, key: "recurringEventFilters", placeholder = ""): void {
        new Setting(this.containerEl)
            .setName(name)
            .setDesc(desc)
            .addTextArea((t) => {
                t.setPlaceholder(placeholder)
                    .setValue((this.plugin.settings[key] ?? []).join("\n"))
                    .onChange(async (value) => {
                        this.plugin.settings[key] = value
                            .split("\n")
                            .map((s) => s.trim())
                            .filter((s) => s.length > 0);
                        this.plugin.scheduleSaveSettings();
                    });
                t.inputEl.rows = 4;
            });
    }

    /**
     * Render a Google target as a dropdown of loaded options (plus a Refresh button), or a
     * plain text field with a Load button when nothing has been fetched yet. When connected,
     * options are fetched automatically on first render.
     */
    private picker(
        name: string,
        desc: string,
        key: "defaultCalendarId" | "taskListId",
        options: { id: string; label: string }[],
        load: () => Promise<void>,
    ): void {
        const setting = new Setting(this.containerEl).setName(name).setDesc(desc);
        if (options.length) {
            setting.addDropdown((d) => {
                const current = this.plugin.settings[key];
                if (current && !options.some((o) => o.id === current)) {
                    d.addOption(current, `${current} (not found)`);
                }
                for (const o of options) d.addOption(o.id, o.label);
                d.setValue(current).onChange(async (v) => {
                    this.plugin.settings[key] = v;
                    this.plugin.scheduleSaveSettings();
                });
            });
            setting.addExtraButton((b) =>
                b
                    .setIcon("refresh-cw")
                    .setTooltip("Reload from Google")
                    .onClick(async () => {
                        try {
                            await load();
                            this.display();
                        } catch (e) {
                            new Notice(`google-sync: ${(e as Error).message}`);
                        }
                    }),
            );
        } else {
            setting.addText((t) =>
                t.setValue(this.plugin.settings[key]).onChange(async (v) => {
                    this.plugin.settings[key] = v;
                    this.plugin.scheduleSaveSettings();
                }),
            );
            setting.addButton((b) =>
                b.setButtonText("Load from Google").onClick(async () => {
                    try {
                        await load();
                        this.display();
                    } catch (e) {
                        new Notice(`google-sync: ${(e as Error).message}`);
                    }
                }),
            );
        }
    }

    /** Fetch picker options once per tab-open when already connected. */
    private autoLoadPickers(connected: boolean): void {
        if (!connected || this.pickersLoadAttempted) return;
        if (this.calendars.length && this.taskLists.length) return;
        this.pickersLoadAttempted = true;
        // Re-render via a macrotask: mutating Settings from a microtask after display()
        // returns deadlocks Obsidian 1.12.x's renderer; a fresh display() pass is safe.
        window.setTimeout(() => {
            void (async () => {
                try {
                    const [calendars, taskLists] = await Promise.all([
                        this.plugin.listCalendars(),
                        this.plugin.listTaskLists(),
                    ]);
                    this.calendars = calendars;
                    this.taskLists = taskLists;
                    if (this.containerEl.isConnected) this.display();
                } catch (e) {
                    console.warn("[google-sync] could not load pickers:", e);
                }
            })();
        }, 0);
    }

    display(): void {
        try {
            this.renderUnsafe();
        } catch (e) {
            // Settings render must never crash Obsidian's renderer. Log + show a banner so
            // the user (and the console) gets a clear signal instead of a frozen UI.
            console.error("[google-sync] settings render failed:", e);
            this.containerEl.empty();
            new Setting(this.containerEl).setName("Google sync failed to load").setHeading();
            this.containerEl.createEl("p", {
                text: `${(e as Error).message}. See the developer console for details.`,
            });
        }
    }

    private renderUnsafe(): void {
        const { containerEl } = this;
        containerEl.empty();

        // --- Account ---
        new Setting(containerEl).setName("Account").setHeading();
        new Setting(containerEl)
            .setName("Setup help")
            .setDesc(
                "Most people should follow the setup guide first. It walks through the no-code setup path, then explains the advanced bring-your-own-host option.",
            )
            .addButton((b) =>
                b.setButtonText("Open setup guide").onClick(() => window.open(SETUP_GUIDE_URL, "_blank")),
            )
            .addButton((b) =>
                b.setButtonText("Open Google setup pages").onClick(() => {
                    for (const link of GOOGLE_LINKS) window.open(link.url, "_blank");
                    new Notice("Opened Google Cloud setup pages in your browser.");
                }),
            );

        // NOTE: setDesc must be computed SYNCHRONOUSLY here, not via an async
        // .then() callback after display() returns. Mutating a Setting from a
        // microtask after render — when the Setting has child controls — deadlocks
        // Obsidian 1.12.x's renderer (100% CPU loop). isConnectedSync reads the
        // in-memory token field directly so no await is needed.
        const connected = this.plugin.isConnectedSync();
        // Pre-build the OAuth consent URL so Connect can open the browser
        // synchronously inside the click — iOS blocks a post-await window.open.
        this.plugin.prepareConnect();
        new Setting(containerEl)
            .setName("Connection")
            .setDesc(
                connected
                    ? "Connected to Google."
                    : "Not connected. Fill in the credentials below, then Connect.",
            )
            .addButton((b) =>
                b
                    .setButtonText("Connect")
                    .setCta()
                    .onClick(() => void this.plugin.connect()),
            )
            .addButton((b) =>
                b.setButtonText("Disconnect").onClick(async () => {
                    await this.plugin.disconnect();
                    this.display();
                }),
            )
            .addButton((b) =>
                b.setButtonText("Test connection").onClick(async () => {
                    new Notice(await this.plugin.testConnection());
                }),
            );

        this.text("OAuth client ID", "From your Google Cloud Web application OAuth client.", "clientId", {
            validate: (v) => {
                if (v.trim() === "") return "Required to connect";
                return isLikelyClientId(v) ? null : "Should end in .apps.googleusercontent.com";
            },
        });
        this.text("OAuth client secret", "From your Google Cloud OAuth client.", "clientSecret", {
            validate: (v) => (v.trim() === "" ? "Required to connect" : null),
        });
        this.text(
            "Redirect bridge URL",
            "Your hosted bridge page, also set as the redirect URI in Google Cloud (must match exactly, including any trailing slash).",
            "redirectUri",
            {
                placeholder: "https://your-username.github.io/obsidian-google-sync/",
                normalize: normalizeRedirectUri,
                validate: redirectUriWarning,
            },
        );
        new Setting(containerEl)
            .setName("Bridge URL tools")
            .setDesc("Open or copy the redirect bridge URL after you paste it above.")
            .addButton((b) =>
                b.setButtonText("Open bridge URL").onClick(() => {
                    const url = normalizeRedirectUri(this.plugin.settings.redirectUri);
                    if (!url) {
                        new Notice("Paste a redirect bridge URL first.");
                        return;
                    }
                    window.open(url, "_blank");
                }),
            )
            .addButton((b) =>
                b.setButtonText("Copy bridge URL").onClick(async () => {
                    const url = normalizeRedirectUri(this.plugin.settings.redirectUri);
                    if (!url) {
                        new Notice("Paste a redirect bridge URL first.");
                        return;
                    }
                    try {
                        await navigator.clipboard.writeText(url);
                        new Notice("Copied bridge URL.");
                    } catch (e) {
                        console.warn("[google-sync] could not copy bridge URL:", e);
                        new Notice("Copy failed. Select the bridge URL field and copy it manually.");
                    }
                }),
            );

        this.autoLoadPickers(connected);

        // --- Google targets ---
        new Setting(containerEl).setName("Google targets").setHeading();
        this.picker(
            "Default calendar",
            "Calendar events are imported from and updated in.",
            "defaultCalendarId",
            this.calendars.map((c) => ({
                id: c.id,
                label: c.primary ? `${c.summary ?? c.id} (primary)` : (c.summary ?? c.id),
            })),
            async () => {
                this.calendars = await this.plugin.listCalendars();
            },
        );
        this.picker(
            "Task list",
            "Google Tasks list tasks are imported from and updated in.",
            "taskListId",
            this.taskLists.map((t) => ({ id: t.id, label: t.title ?? t.id })),
            async () => {
                this.taskLists = await this.plugin.listTaskLists();
            },
        );
        this.text(
            "Default timezone",
            "IANA timezone for notes without their own `timezone` field.",
            "defaultTimezone",
            {
                placeholder: systemTimezone(),
                validate: (v) =>
                    v.trim() === "" || IANAZone.isValidZone(v.trim())
                        ? null
                        : `Not a valid IANA timezone (e.g. ${systemTimezone()})`,
            },
        );

        // --- Sync safety ---
        new Setting(containerEl).setName("Sync safety").setHeading();
        this.toggle(
            "Push local edits to Google",
            "Update the Google item when a note that already has a googleId is edited. New notes and deletions never touch Google. Only fields you changed are sent.",
            "syncOnModify",
        );
        this.number(
            "Mass-update guard",
            "If more notes than this have pending updates in one run, nothing is sent until you run “Push pending updates (confirmed)”. Use “Preview pending Google updates” to see what would change.",
            "maxPatchesPerRun",
            { min: 1, max: 500 },
        );

        // --- Import ---
        new Setting(containerEl).setName("Import").setHeading();
        this.toggle(
            "Import from Google on startup",
            "Pull events and tasks when Obsidian starts. Additions-only: existing notes are not overwritten and nothing is filed to orphaned/.",
            "importOnStartup",
        );
        this.toggle(
            "Import only configured calendar",
            "Only pull events from the default calendar above (off = every visible calendar).",
            "importOnlyDefaultCalendar",
        );
        this.toggle(
            "Import only configured task list",
            "Only pull tasks from the task list above (off = every task list).",
            "importOnlyDefaultTaskList",
        );
        this.number(
            "Import window — days past",
            "How many days of past calendar events to import. Recurring events are expanded, so a wide window pulls a lot of notes.",
            "importPastDays",
            { min: 0, max: 3650 },
        );
        this.number(
            "Import window — days ahead",
            "How many days of upcoming calendar events to import.",
            "importFutureDays",
            { min: 0, max: 3650 },
        );
        new Setting(containerEl)
            .setName("Recurring event filter")
            .setDesc(
                "Allowlist: import only recurring events whose title matches. Blocklist: import every recurring event except matches. One-off events are always imported.",
            )
            .addDropdown((d) =>
                d
                    .addOption("allow", "Allowlist")
                    .addOption("block", "Blocklist")
                    .setValue(this.plugin.settings.recurringEventFilterMode)
                    .onChange(async (v) => {
                        this.plugin.settings.recurringEventFilterMode = v as RecurringFilterMode;
                        this.plugin.scheduleSaveSettings();
                    }),
            );
        this.list(
            "Recurring event titles",
            "One title per line (use * as a wildcard, e.g. Weekly*). Empty allowlist imports no recurring events; empty blocklist imports all of them.",
            "recurringEventFilters",
            "Weekly 1:1\nStandup*",
        );

        // --- Vault layout ---
        new Setting(containerEl).setName("Vault layout").setHeading();
        this.text(
            "Events folder",
            "Folder kept in sync with Google Calendar. Filed notes live in its archive/ and orphaned/ subfolders.",
            "eventsFolder",
            {
                normalize: normalizeVaultPath,
                validate: (v) => (v.trim() === "" ? "Required" : null),
            },
        );
        this.text(
            "Tasks folder",
            "Folder kept in sync with Google Tasks. Filed notes live in its overdue/, completed/ and orphaned/ subfolders.",
            "tasksFolder",
            {
                normalize: normalizeVaultPath,
                validate: (v) => (v.trim() === "" ? "Required" : null),
            },
        );

        // --- Lifecycle ---
        new Setting(containerEl).setName("Lifecycle").setHeading();
        this.toggle(
            "Auto-archive past events",
            "Move past events to the archive folder daily (also files completed tasks immediately).",
            "autoArchiveEnabled",
        );
        this.toggle(
            "Auto-close linked tasks on archive",
            "Complete tasks listed in an event's `tasks` field when it archives.",
            "autoCloseTasksOnArchive",
        );
        this.number(
            "Archive after days past",
            "Days after an event's date before it is archived.",
            "autoArchiveDaysPast",
            { min: 0, max: 365 },
        );

        // --- Reset ---
        new Setting(containerEl)
            .setName("Reset to defaults")
            .setDesc("Restore every non-credential setting to its default value.")
            .addButton((b) =>
                b.setButtonText("Reset").onClick(async () => {
                    const { clientId, clientSecret, redirectUri } = this.plugin.settings;
                    this.plugin.settings = {
                        ...DEFAULT_SETTINGS,
                        clientId,
                        clientSecret,
                        redirectUri,
                    };
                    await this.plugin.saveSettings();
                    this.display();
                    new Notice("Google sync: settings reset (credentials kept).");
                }),
            );
    }
}
