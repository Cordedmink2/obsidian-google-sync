import { App, TFile, normalizePath } from "obsidian";
import { GoogleCalendarClient } from "../google/calendar";
import { GoogleTasksClient } from "../google/tasks";
import { GoogleSyncSettings } from "../settings";
import { GoogleEvent, GoogleTask } from "../types";
import { readFrontmatter, upsertMarkdownFile, writeFrontmatter } from "../io";
import { remoteEventToNote, remoteTaskToNote } from "./mapper";

export interface ImportCounts {
    events: number;
    tasks: number;
    failed: number;
}

function slugify(value: string): string {
    const slug = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60);
    return slug || "untitled";
}

function pathFor(folder: string, id: string | undefined, title: string | undefined, fallback: string): string {
    const name = slugify(`${title || fallback}-${id || "new"}`);
    return normalizePath(`${folder}/${name}.md`);
}

async function findByGoogleId(app: App, folder: string, googleId: string | undefined): Promise<TFile | null> {
    if (!googleId) return null;
    for (const file of app.vault.getMarkdownFiles()) {
        if (!normalizePath(file.path).startsWith(`${normalizePath(folder)}/`)) continue;
        const fm = await readFrontmatter(app, file);
        if (fm.googleId === googleId) return file;
    }
    return null;
}

export class GoogleImporter {
    constructor(
        private readonly app: App,
        private readonly calendar: GoogleCalendarClient,
        private readonly tasks: GoogleTasksClient,
        private readonly settings: () => GoogleSyncSettings,
    ) {}

    async importAll(): Promise<ImportCounts> {
        const counts: ImportCounts = { events: 0, tasks: 0, failed: 0 };
        await this.importEvents(counts);
        await this.importTasks(counts);
        return counts;
    }

    private async importEvents(counts: ImportCounts): Promise<void> {
        const calendarIds = await this.calendarIds();
        for (const calendarId of calendarIds) {
            const { items } = await this.calendar.listEvents(calendarId);
            for (const event of items) await this.upsertEvent(calendarId, event, counts);
        }
    }

    private async calendarIds(): Promise<string[]> {
        const s = this.settings();
        if (s.importOnlyDefaultCalendar) return [s.defaultCalendarId];
        const calendars = await this.calendar.listCalendars();
        const ids = calendars.map((c) => c.id).filter((id): id is string => !!id);
        if (!ids.includes(s.defaultCalendarId)) ids.unshift(s.defaultCalendarId);
        return Array.from(new Set(ids));
    }

    private async upsertEvent(
        calendarId: string,
        event: GoogleEvent,
        counts: ImportCounts,
    ): Promise<void> {
        try {
            if (event.status === "cancelled") return;
            const fm = remoteEventToNote(event, calendarId);
            const existing = await findByGoogleId(this.app, this.settings().eventsFolder, event.id);
            if (existing) await writeFrontmatter(this.app, existing, fm);
            else await upsertMarkdownFile(
                this.app,
                pathFor(this.settings().eventsFolder, event.id, event.summary, "event"),
                fm,
            );
            counts.events++;
        } catch (e) {
            counts.failed++;
            console.error("[google-sync] failed to import event", event.id, e);
        }
    }

    private async importTasks(counts: ImportCounts): Promise<void> {
        const taskListIds = await this.taskListIds();
        for (const taskListId of taskListIds) {
            const tasks = await this.tasks.listTasks(taskListId);
            for (const task of tasks) await this.upsertTask(taskListId, task, counts);
        }
    }

    private async taskListIds(): Promise<string[]> {
        const s = this.settings();
        if (s.importOnlyDefaultTaskList) return [s.taskListId];
        const lists = await this.tasks.listTaskLists();
        const ids = lists.map((l) => l.id).filter((id): id is string => !!id);
        if (s.taskListId && !ids.includes(s.taskListId)) ids.unshift(s.taskListId);
        return Array.from(new Set(ids));
    }

    private async upsertTask(taskListId: string, task: GoogleTask, counts: ImportCounts): Promise<void> {
        try {
            const fm = remoteTaskToNote(task, taskListId);
            const existing = await findByGoogleId(this.app, this.settings().tasksFolder, task.id);
            if (existing) await writeFrontmatter(this.app, existing, fm);
            else await upsertMarkdownFile(
                this.app,
                pathFor(this.settings().tasksFolder, task.id, task.title, "task"),
                fm,
            );
            counts.tasks++;
        } catch (e) {
            counts.failed++;
            console.error("[google-sync] failed to import task", task.id, e);
        }
    }
}
