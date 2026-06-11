import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import GoogleSyncPlugin from "./main";
import { CalendarListEntry } from "./google/calendar";
import { TaskListEntry } from "./google/tasks";
import { RecurringFilterMode } from "./sync/recurrence";

export interface GoogleSyncSettings {
    // OAuth (BYO Google "Web application" client + self-hosted bridge redirect)
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    // Vault layout
    eventsFolder: string;
    tasksFolder: string;
    // Google targets
    defaultCalendarId: string;
    taskListId: string;
    defaultTimezone: string;
    // Behavior
    syncOnModify: boolean;
    importOnStartup: boolean;
    importOnlyDefaultCalendar: boolean;
    importOnlyDefaultTaskList: boolean;
    importPastDays: number;
    importFutureDays: number;
    recurringEventFilterMode: RecurringFilterMode;
    recurringEventFilters: string[];
    autoArchiveEnabled: boolean;
    autoArchiveDaysPast: number;
    autoCloseTasksOnArchive: boolean;
}

function systemTimezone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
        return "UTC";
    }
}

export const DEFAULT_SETTINGS: GoogleSyncSettings = {
    clientId: "",
    clientSecret: "",
    redirectUri: "",
    eventsFolder: "events",
    tasksFolder: "tasks",
    defaultCalendarId: "primary",
    taskListId: "@default",
    defaultTimezone: systemTimezone(),
    syncOnModify: true,
    importOnStartup: false,
    importOnlyDefaultCalendar: true,
    importOnlyDefaultTaskList: true,
    importPastDays: 7,
    importFutureDays: 90,
    recurringEventFilterMode: "allow",
    recurringEventFilters: [],
    autoArchiveEnabled: true,
    autoArchiveDaysPast: 1,
    autoCloseTasksOnArchive: true,
};

export class GoogleSyncSettingTab extends PluginSettingTab {
    plugin: GoogleSyncPlugin;
    private calendars: CalendarListEntry[] = [];
    private taskLists: TaskListEntry[] = [];

    constructor(app: App, plugin: GoogleSyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    hide(): void {
        // Flush any in-flight debounced save before the tab is torn down so a fast
        // close-after-typing doesn't lose the last few keystrokes.
        void this.plugin.flushPendingSettingsSave();
    }

    /**
     * Render a setting as a dropdown when options have been loaded from Google, otherwise a
     * text field plus a "Load from Google" button (which fetches, then re-renders).
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
                for (const o of options) d.addOption(o.id, o.label);
                d.setValue(this.plugin.settings[key]).onChange(async (v) => {
                    this.plugin.settings[key] = v;
                    this.plugin.scheduleSaveSettings();
                });
            });
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

    private text(
        name: string,
        desc: string,
        key: keyof GoogleSyncSettings,
        placeholder = "",
    ): void {
        new Setting(this.containerEl)
            .setName(name)
            .setDesc(desc)
            .addText((t) =>
                t
                    .setPlaceholder(placeholder)
                    .setValue(String(this.plugin.settings[key] ?? ""))
                    .onChange(async (value) => {
                        (this.plugin.settings[key] as unknown) = value;
                        this.plugin.scheduleSaveSettings();
                    }),
            );
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
        key: "importPastDays" | "importFutureDays" | "autoArchiveDaysPast",
        fallback: number,
    ): void {
        new Setting(this.containerEl)
            .setName(name)
            .setDesc(desc)
            .addText((t) =>
                t.setValue(String(this.plugin.settings[key])).onChange(async (value) => {
                    const n = Number(value);
                    this.plugin.settings[key] = Number.isFinite(n) && n >= 0 ? n : fallback;
                    this.plugin.scheduleSaveSettings();
                }),
            );
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

        // --- Google account ---
        new Setting(containerEl).setName("Google account").setHeading();

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
            .setDesc(connected ? "Connected to Google." : "Not connected.")
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

        // --- Google API credentials ---
        new Setting(containerEl).setName("Google API credentials").setHeading();
        this.text("OAuth client ID", "From your Google Cloud OAuth client.", "clientId");
        this.text("OAuth client secret", "From your Google Cloud OAuth client.", "clientSecret");
        this.text(
            "Redirect bridge URL",
            "Your hosted bridge page, also set as the redirect URI in Google Cloud.",
            "redirectUri",
            "https://your-bridge.example/callback",
        );

        // --- Vault layout ---
        new Setting(containerEl).setName("Vault layout").setHeading();
        this.text("Events folder", "Folder mirrored to Google Calendar.", "eventsFolder");
        this.text("Tasks folder", "Folder mirrored to Google Tasks.", "tasksFolder");

        // --- Google targets ---
        new Setting(containerEl).setName("Google targets").setHeading();
        this.picker(
            "Default calendar",
            "Calendar to sync events into.",
            "defaultCalendarId",
            this.calendars.map((c) => ({ id: c.id, label: c.summary ?? c.id })),
            async () => {
                this.calendars = await this.plugin.listCalendars();
            },
        );
        this.picker(
            "Task list",
            "Google Tasks list to sync into.",
            "taskListId",
            this.taskLists.map((t) => ({ id: t.id, label: t.title ?? t.id })),
            async () => {
                this.taskLists = await this.plugin.listTaskLists();
            },
        );
        this.text("Default timezone", "IANA timezone for notes without one.", "defaultTimezone");

        // --- Behavior ---
        new Setting(containerEl).setName("Behavior").setHeading();
        this.toggle(
            "Push local edits to Google",
            "Update the Google item when a note that already has a googleId is edited. New notes and deletions never touch Google.",
            "syncOnModify",
        );
        this.toggle(
            "Import from Google on startup",
            "When enabled, pull configured Google Calendar events and Google Tasks when Obsidian starts. Off by default.",
            "importOnStartup",
        );
        this.toggle(
            "Import only configured calendar",
            "When importing from Google, only pull events from the default calendar above.",
            "importOnlyDefaultCalendar",
        );
        this.toggle(
            "Import only configured task list",
            "When importing from Google, only pull tasks from the task list above.",
            "importOnlyDefaultTaskList",
        );
        this.number(
            "Import window — days past",
            "How many days of past calendar events to import. Recurring events are expanded, so a wide window pulls a lot of notes.",
            "importPastDays",
            7,
        );
        this.number(
            "Import window — days ahead",
            "How many days of upcoming calendar events to import.",
            "importFutureDays",
            90,
        );
        new Setting(containerEl)
            .setName("Recurring event filter")
            .setDesc(
                "Allowlist: import only recurring events whose title matches. Blocklist: import every recurring event except matches.",
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
            "One title per line (use * as a wildcard, e.g. Weekly*). Matched against recurring event titles for the filter above; one-off events are always imported. Empty allowlist imports no recurring events; empty blocklist imports all of them.",
            "recurringEventFilters",
            "Weekly 1:1\nStandup*",
        );
        this.toggle(
            "Auto-archive past events",
            "Move past events to an archive folder daily.",
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
            1,
        );
    }
}
