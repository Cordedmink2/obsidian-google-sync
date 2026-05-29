import { App, TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
import { GoogleCalendarClient } from "../google/calendar";
import { GoogleTasksClient } from "../google/tasks";
import { GoogleSyncSettings } from "../settings";
import { GoogleEvent, GoogleTask } from "../types";
import { readFrontmatter, upsertMarkdownFile, writeFrontmatter } from "../io";
import { mergeManagedFrontmatter, remoteEventToNote, remoteTaskToNote } from "./mapper";
import { isEventAllowed } from "./recurrence";

export interface ImportCounts {
    events: number;
    tasks: number;
    failed: number;
}

export interface ImportOptions {
    /** Create missing notes only. Existing googleId matches are left untouched. */
    createOnly?: boolean;
}

function slugify(value: string, maxLength: number): string {
    const slug = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, maxLength);
    return slug.replace(/-+$/g, "") || "untitled";
}

function basePathFor(
    folder: string,
    id: string | undefined,
    title: string | undefined,
    fallback: string,
): string {
    const titlePart = slugify(title || fallback, 50);
    const idPart = id ? slugify(id, 80) : "new";
    return normalizePath(`${folder}/${titlePart}-${idPart}.md`);
}

/** The note name (no folder, no .md) for a vault path. */
function basenameOf(path: string): string {
    return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}

async function unusedPath(app: App, preferredPath: string): Promise<string> {
    const normalized = normalizePath(preferredPath);
    if (!app.vault.getAbstractFileByPath(normalized)) return normalized;

    const dot = normalized.lastIndexOf(".");
    const stem = dot === -1 ? normalized : normalized.slice(0, dot);
    const ext = dot === -1 ? "" : normalized.slice(dot);
    for (let i = 2; i < 1000; i++) {
        const candidate = `${stem}-${i}${ext}`;
        if (!app.vault.getAbstractFileByPath(candidate)) return candidate;
    }
    throw new Error(`Could not find an unused import path for ${normalized}`);
}

async function pathFor(
    app: App,
    folder: string,
    id: string | undefined,
    title: string | undefined,
    fallback: string,
): Promise<string> {
    return unusedPath(app, basePathFor(folder, id, title, fallback));
}

async function findByGoogleId(
    app: App,
    folder: string,
    googleId: string | undefined,
): Promise<TFile | null> {
    if (!googleId) return null;
    for (const file of scopedMarkdownFiles(app, folder)) {
        if (!normalizePath(file.path).startsWith(`${normalizePath(folder)}/`)) continue;
        const fm = await readFrontmatter(app, file);
        if (fm.googleId === googleId) return file;
    }
    return null;
}

function scopedMarkdownFiles(app: App, root: string): TFile[] {
    const out: TFile[] = [];
    const normalizedRoot = normalizePath(root).replace(/\/+$/, "");
    const start = app.vault.getAbstractFileByPath(normalizedRoot);
    if (!start) return out;

    const visit = (node: TAbstractFile): void => {
        if (node instanceof TFile) {
            if (node.extension === "md") out.push(node);
            return;
        }
        if (node instanceof TFolder) {
            for (const child of node.children) visit(child);
        }
    };

    visit(start);
    return out;
}

export class GoogleImporter {
    constructor(
        private readonly app: App,
        private readonly calendar: GoogleCalendarClient,
        private readonly tasks: GoogleTasksClient,
        private readonly settings: () => GoogleSyncSettings,
        /** Called with each note path the importer creates or rewrites, so the caller can
         * suppress the resulting vault events from echoing back into sync. */
        private readonly onTouch: (path: string) => void = () => {},
    ) {}

    async importAll(options: ImportOptions = {}): Promise<ImportCounts> {
        const counts: ImportCounts = { events: 0, tasks: 0, failed: 0 };
        // Events and tasks are imported independently: a failure in one phase must not
        // abort the other, nor prevent the caller from running the lifecycle afterwards.
        try {
            await this.importEvents(counts, options);
        } catch (e) {
            counts.failed++;
            console.error("[google-sync] event import failed", e);
        }
        try {
            await this.importTasks(counts, options);
        } catch (e) {
            counts.failed++;
            console.error("[google-sync] task import failed", e);
        }
        return counts;
    }

    /** Bounded RFC3339 time window so recurring events aren't expanded across all of history. */
    private eventWindow(): { timeMin: string; timeMax: string } {
        const s = this.settings();
        const dayMs = 24 * 60 * 60 * 1000;
        const now = Date.now();
        return {
            timeMin: new Date(now - Math.max(0, s.importPastDays) * dayMs).toISOString(),
            timeMax: new Date(now + Math.max(0, s.importFutureDays) * dayMs).toISOString(),
        };
    }

    private async importEvents(counts: ImportCounts, options: ImportOptions): Promise<void> {
        const calendarIds = await this.calendarIds();
        const window = this.eventWindow();
        for (const calendarId of calendarIds) {
            const { items } = await this.calendar.listEvents(calendarId, window);
            for (const event of items) await this.upsertEvent(calendarId, event, counts, options);
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
        options: ImportOptions,
    ): Promise<void> {
        try {
            if (event.status === "cancelled") return;
            const s = this.settings();
            if (!isEventAllowed(event, s.recurringEventFilterMode, s.recurringEventFilters)) return;
            const fm = remoteEventToNote(event, calendarId);
            const existing = await findByGoogleId(this.app, s.eventsFolder, event.id);
            if (existing) {
                if (options.createOnly) return;
                const merged = mergeManagedFrontmatter(
                    await readFrontmatter(this.app, existing),
                    fm,
                    "event",
                );
                await writeFrontmatter(this.app, existing, merged);
                this.onTouch(existing.path);
            } else {
                const path = await pathFor(
                    this.app,
                    s.eventsFolder,
                    event.id,
                    event.summary,
                    "event",
                );
                await upsertMarkdownFile(this.app, path, fm);
                this.onTouch(path);
            }
            counts.events++;
        } catch (e) {
            counts.failed++;
            console.error("[google-sync] failed to import event", event.id, e);
        }
    }

    private async importTasks(counts: ImportCounts, options: ImportOptions): Promise<void> {
        const taskListIds = await this.taskListIds();
        for (const taskListId of taskListIds) {
            const tasks = await this.tasks.listTasks(taskListId);
            // Google lists subtasks after their parent (position order), so a map of
            // already-seen id -> note basename lets a subtask link back to its parent.
            const basenameById = new Map<string, string>();
            for (const task of tasks) {
                const parentBasename = task.parent
                    ? basenameById.get(task.parent)
                    : undefined;
                const basename = await this.upsertTask(
                    taskListId,
                    task,
                    counts,
                    options,
                    parentBasename,
                );
                if (task.id && basename) basenameById.set(task.id, basename);
            }
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

    /** Returns the note basename (without extension) so subtasks can link to it. */
    private async upsertTask(
        taskListId: string,
        task: GoogleTask,
        counts: ImportCounts,
        options: ImportOptions,
        parentBasename?: string,
    ): Promise<string | undefined> {
        try {
            const fm = remoteTaskToNote(task, taskListId, parentBasename);
            const existing = await findByGoogleId(this.app, this.settings().tasksFolder, task.id);
            if (existing) {
                if (options.createOnly) return existing.basename;
                const merged = mergeManagedFrontmatter(
                    await readFrontmatter(this.app, existing),
                    fm,
                    "task",
                );
                await writeFrontmatter(this.app, existing, merged);
                this.onTouch(existing.path);
                counts.tasks++;
                return existing.basename;
            }
            const path = await pathFor(
                this.app,
                this.settings().tasksFolder,
                task.id,
                task.title,
                "task",
            );
            await upsertMarkdownFile(this.app, path, fm);
            this.onTouch(path);
            counts.tasks++;
            return basenameOf(path);
        } catch (e) {
            counts.failed++;
            console.error("[google-sync] failed to import task", task.id, e);
            return undefined;
        }
    }
}
