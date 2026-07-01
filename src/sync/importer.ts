import { GoogleCalendarClient } from "../google/calendar";
import { GoogleTasksClient } from "../google/tasks";
import { GoogleSyncSettings } from "../settings-data";
import { GoogleEvent, GoogleTask } from "../types";
import { VaultPort } from "../vault/port";
import { basenameOf, normalizeVaultPath } from "../vault/paths";
import { unusedPath } from "../vault/unused-path";
import { mergeManagedFrontmatter, remoteEventToNote, remoteTaskToNote } from "./mapper";
import { isEventAllowed } from "./recurrence";
import { BaselineStore, GoogleBody, projectRemoteBody } from "./baseline";
import { OrphanScanner, SeenRemoteItems, emptySeen } from "./orphans";

export interface ImportCounts {
    events: number;
    tasks: number;
    failed: number;
    /** Notes whose Google item was confirmed deleted, filed into orphaned/. */
    orphaned: number;
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
    return normalizeVaultPath(`${folder}/${titlePart}-${idPart}.md`);
}

async function pathFor(
    port: VaultPort,
    folder: string,
    id: string | undefined,
    title: string | undefined,
    fallback: string,
): Promise<string> {
    return unusedPath(port, basePathFor(folder, id, title, fallback));
}

/**
 * One folder scan up front builds the googleId → path index every upsert consults,
 * instead of re-scanning the folder per imported item. First match wins (same as the
 * old scan order); notes created during the run are added by the upserts.
 */
async function indexByGoogleId(port: VaultPort, folder: string): Promise<Map<string, string>> {
    const index = new Map<string, string>();
    for (const ref of await port.listMarkdown([folder])) {
        const gid = (await port.readFrontmatter(ref.path)).googleId;
        if (typeof gid === "string" && gid && !index.has(gid)) index.set(gid, ref.path);
    }
    return index;
}

export class GoogleImporter {
    constructor(
        private readonly port: VaultPort,
        private readonly calendar: GoogleCalendarClient,
        private readonly tasks: GoogleTasksClient,
        private readonly settings: () => GoogleSyncSettings,
        /** Called with each note path the importer creates or rewrites, so the caller can
         * suppress the resulting vault events from echoing back into sync. */
        private readonly onTouch: (path: string) => void = () => {},
        /** Imported notes seed their sync baseline with the remote body, so a later edit
         * diffs against exactly what Google held at import time. */
        private readonly baselines?: BaselineStore,
    ) {}

    async importAll(options: ImportOptions = {}): Promise<ImportCounts> {
        const counts: ImportCounts = { events: 0, tasks: 0, failed: 0, orphaned: 0 };
        const window = this.eventWindow();
        const seen = emptySeen(window.timeMin, window.timeMax);
        // Events and tasks are imported independently: a failure in one phase must not
        // abort the other, nor prevent the caller from running the lifecycle afterwards.
        try {
            await this.importEvents(counts, options, seen, window);
            seen.eventsComplete = true;
        } catch (e) {
            counts.failed++;
            console.error("[google-sync] event import failed", e);
        }
        try {
            await this.importTasks(counts, options, seen);
            seen.tasksComplete = true;
        } catch (e) {
            counts.failed++;
            console.error("[google-sync] task import failed", e);
        }
        // Startup (createOnly) imports stay additions-only; full imports also file notes
        // whose Google item was deleted into orphaned/ (confirmed via direct GET).
        if (!options.createOnly) {
            const scanner = new OrphanScanner(this.port, this.calendar, this.tasks, this.settings);
            counts.orphaned = await scanner.scan(seen);
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

    private async importEvents(
        counts: ImportCounts,
        options: ImportOptions,
        seen: SeenRemoteItems,
        window: { timeMin: string; timeMax: string },
    ): Promise<void> {
        const calendarIds = await this.calendarIds();
        const index = await indexByGoogleId(this.port, this.settings().eventsFolder);
        for (const calendarId of calendarIds) {
            const { items } = await this.calendar.listEvents(calendarId, window);
            for (const event of items) {
                if (event.status === "cancelled") {
                    // showDeleted listings report deletions as cancelled instances.
                    if (event.id) seen.cancelledEventIds.add(event.id);
                    continue;
                }
                if (event.id) seen.eventIds.add(event.id);
                await this.upsertEvent(calendarId, event, counts, options, index);
            }
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
        index: Map<string, string>,
    ): Promise<void> {
        try {
            const s = this.settings();
            if (!isEventAllowed(event, s.recurringEventFilterMode, s.recurringEventFilters)) return;
            const fm = remoteEventToNote(event, calendarId);
            const existing = event.id ? index.get(event.id) : undefined;
            if (existing) {
                if (options.createOnly) return;
                const merged = mergeManagedFrontmatter(
                    await this.port.readFrontmatter(existing),
                    fm,
                    "event",
                );
                await this.port.writeFrontmatter(existing, merged);
                this.onTouch(existing);
                await this.baselines?.set(existing, projectRemoteBody(event as GoogleBody, "event"));
            } else {
                const path = await pathFor(
                    this.port,
                    s.eventsFolder,
                    event.id,
                    event.summary,
                    "event",
                );
                await this.port.upsertMarkdown(path, fm);
                this.onTouch(path);
                if (event.id) index.set(event.id, path);
                await this.baselines?.set(path, projectRemoteBody(event as GoogleBody, "event"));
            }
            counts.events++;
        } catch (e) {
            counts.failed++;
            console.error("[google-sync] failed to import event", event.id, e);
        }
    }

    private async importTasks(
        counts: ImportCounts,
        options: ImportOptions,
        seen: SeenRemoteItems,
    ): Promise<void> {
        const taskListIds = await this.taskListIds();
        const index = await indexByGoogleId(this.port, this.settings().tasksFolder);
        for (const taskListId of taskListIds) {
            const tasks = await this.tasks.listTasks(taskListId);
            // Google lists subtasks after their parent (position order), so a map of
            // already-seen id -> note basename lets a subtask link back to its parent.
            const basenameById = new Map<string, string>();
            for (const task of tasks) {
                if (task.id) seen.taskIds.add(task.id);
                const parentBasename = task.parent ? basenameById.get(task.parent) : undefined;
                const basename = await this.upsertTask(
                    taskListId,
                    task,
                    counts,
                    options,
                    parentBasename,
                    index,
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
        parentBasename: string | undefined,
        index: Map<string, string>,
    ): Promise<string | undefined> {
        try {
            const fm = remoteTaskToNote(task, taskListId, parentBasename);
            const existing = task.id ? index.get(task.id) : undefined;
            if (existing) {
                if (options.createOnly) return basenameOf(existing);
                const merged = mergeManagedFrontmatter(
                    await this.port.readFrontmatter(existing),
                    fm,
                    "task",
                );
                await this.port.writeFrontmatter(existing, merged);
                this.onTouch(existing);
                await this.baselines?.set(existing, projectRemoteBody(task as GoogleBody, "task"));
                counts.tasks++;
                return basenameOf(existing);
            }
            const path = await pathFor(
                this.port,
                this.settings().tasksFolder,
                task.id,
                task.title,
                "task",
            );
            await this.port.upsertMarkdown(path, fm);
            this.onTouch(path);
            if (task.id) index.set(task.id, path);
            await this.baselines?.set(path, projectRemoteBody(task as GoogleBody, "task"));
            counts.tasks++;
            return basenameOf(path);
        } catch (e) {
            counts.failed++;
            console.error("[google-sync] failed to import task", task.id, e);
            return undefined;
        }
    }
}
