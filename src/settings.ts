import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import GoogleSyncPlugin from "./main";
import { CalendarListEntry } from "./google/calendar";
import { TaskListEntry } from "./google/tasks";

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
    syncOnCreate: boolean;
    syncOnModify: boolean;
    syncOnDelete: boolean;
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
    syncOnCreate: true,
    syncOnModify: true,
    syncOnDelete: true,
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

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // --- Google account ---
        new Setting(containerEl).setName("Google account").setHeading();

        const status = new Setting(containerEl)
            .setName("Connection")
            .setDesc("Checking…")
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
        void this.plugin
            .isConnected()
            .then((c) => status.setDesc(c ? "Connected to Google." : "Not connected."));

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
        this.toggle("Sync on create", "Push new notes to Google.", "syncOnCreate");
        this.toggle("Sync on modify", "Push edits to Google.", "syncOnModify");
        this.toggle(
            "Sync on delete",
            "Delete the Google item when a note is deleted.",
            "syncOnDelete",
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
        new Setting(containerEl)
            .setName("Archive after days past")
            .setDesc("Days after an event's date before it is archived.")
            .addText((t) =>
                t
                    .setValue(String(this.plugin.settings.autoArchiveDaysPast))
                    .onChange(async (value) => {
                        const n = Number(value);
                        this.plugin.settings.autoArchiveDaysPast = Number.isFinite(n) ? n : 1;
                        this.plugin.scheduleSaveSettings();
                    }),
            );
    }
}
