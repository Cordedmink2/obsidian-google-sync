import { App, Notice, TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
import { GoogleSyncSettings } from "../settings";
import { GoogleCalendarClient, WriteEventOptions } from "../google/calendar";
import { GoogleTasksClient } from "../google/tasks";
import { detectKind, isManagedSubpath, validateEvent, validateTask } from "./frontmatter";
import { eventToGoogle, taskToGoogle } from "./mapper";
import { linkToBasename } from "./lifecycle-plan";
import { readFrontmatter, writeFrontmatterKey } from "../io";
import { EventFrontmatter, GoogleEvent, NoteKind } from "../types";

interface RemoteRef {
    kind: NoteKind;
    googleId: string;
    container: string; // calendarId for events, taskListId for tasks
}

/**
 * Turns vault changes into Google Calendar/Tasks operations. Holds a path -> remote-id
 * index (rebuilt from frontmatter on load) so deletes can target the right Google object
 * after the note is gone.
 */
export class SyncRouter {
    private index = new Map<string, RemoteRef>();

    constructor(
        private readonly app: App,
        private readonly calendar: GoogleCalendarClient,
        private readonly tasks: GoogleTasksClient,
        private readonly settings: () => GoogleSyncSettings,
        private readonly notify: (msg: string) => void = (m) => {
            new Notice(m);
        },
        /** Called when the router writes a googleId back into a note, so the caller can
         * suppress the resulting modify event from echoing back into sync. */
        private readonly onTouch: (path: string) => void = () => {},
    ) {}

    /** The note kind to sync for this path, or null if it should be ignored. */
    syncKind(path: string): NoteKind | null {
        const s = this.settings();
        if (isManagedSubpath(path, s.eventsFolder, s.tasksFolder)) return null;
        return detectKind(path, s.eventsFolder, s.tasksFolder);
    }

    /** Rebuild the path -> remote-id index from frontmatter (fast: uses metadataCache). */
    buildIndex(): void {
        this.index.clear();
        const s = this.settings();
        for (const file of scopedMarkdownFiles(this.app, [s.eventsFolder, s.tasksFolder])) {
            const kind = this.syncKind(file.path);
            if (!kind) continue;
            const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
            const googleId: unknown = fm?.googleId;
            if (typeof googleId !== "string" || !googleId) continue;
            const container =
                kind === "event"
                    ? (fm?.calendarId as string) || s.defaultCalendarId
                    : (fm?.tasklist as string) || s.taskListId;
            this.index.set(file.path, { kind, googleId, container });
        }
    }

    async syncFile(file: TFile): Promise<void> {
        const kind = this.syncKind(file.path);
        if (!kind) return;
        const fm = await readFrontmatter(this.app, file);
        if (kind === "event") await this.syncEvent(file, fm);
        else await this.syncTask(file, fm);
    }

    private async syncEvent(file: TFile, fm: Record<string, unknown>): Promise<void> {
        const v = validateEvent(fm);
        if (!v.ok || !v.value) {
            this.notify(`google-sync: ${file.name}: ${v.errors.join("; ")}`);
            return;
        }
        const s = this.settings();
        const calendarId = v.value.calendarId || s.defaultCalendarId;
        const body = eventToGoogle(v.value, s.defaultTimezone);
        const opts = this.eventWriteOptions(v.value, body);
        if (v.value.googleId) {
            const patched = await this.calendar.patchEvent(calendarId, v.value.googleId, body, opts);
            await this.writeMeetLinkBack(file, v.value, patched);
            this.index.set(file.path, {
                kind: "event",
                googleId: v.value.googleId,
                container: calendarId,
            });
        } else {
            const created = await this.calendar.insertEvent(calendarId, body, opts);
            if (created.id) {
                await writeFrontmatterKey(this.app, file, "googleId", created.id);
                this.onTouch(file.path);
                await this.writeMeetLinkBack(file, v.value, created);
                this.index.set(file.path, {
                    kind: "event",
                    googleId: created.id,
                    container: calendarId,
                });
            }
        }
    }

    /**
     * Derive insert/patch query params from the event, and — when the note asks for a
     * Google Meet link it doesn't have yet — attach a conferenceData create request.
     */
    private eventWriteOptions(value: EventFrontmatter, body: GoogleEvent): WriteEventOptions {
        const opts: WriteEventOptions = {};
        const wantsMeet = value.conferencing === true || value.conferencing === "hangoutsMeet";
        if (wantsMeet && !value.meetLink) {
            body.conferenceData = {
                createRequest: {
                    requestId: crypto.randomUUID(),
                    conferenceSolutionKey: { type: "hangoutsMeet" },
                },
            };
            opts.conferenceDataVersion = 1;
        } else if (value.meetLink || value.conferencing) {
            // Ask Google to round-trip existing conference data on update.
            opts.conferenceDataVersion = 1;
        }
        if (Array.isArray(body.attachments) && body.attachments.length) {
            opts.supportsAttachments = true;
        }
        return opts;
    }

    /** Persist a newly minted Meet link back into the note (managed, read-only). */
    private async writeMeetLinkBack(
        file: TFile,
        value: EventFrontmatter,
        result: GoogleEvent,
    ): Promise<void> {
        const link =
            result.hangoutLink ??
            result.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri;
        if (!link || value.meetLink === link) return;
        await writeFrontmatterKey(this.app, file, "meetLink", link);
        this.onTouch(file.path);
    }

    private async syncTask(file: TFile, fm: Record<string, unknown>): Promise<void> {
        const v = validateTask(fm);
        if (!v.ok || !v.value) {
            this.notify(`google-sync: ${file.name}: ${v.errors.join("; ")}`);
            return;
        }
        const s = this.settings();
        const taskListId = v.value.tasklist || s.taskListId;
        if (!taskListId) {
            this.notify("google-sync: set a task list ID in settings before syncing tasks.");
            return;
        }
        const body = taskToGoogle(v.value, s.defaultTimezone);
        const parentId = this.resolveParentGoogleId(v.value.parent, file.path);
        if (v.value.googleId) {
            await this.tasks.patchTask(taskListId, v.value.googleId, body);
            // parent can't be changed via patch — move handles (re)nesting.
            if (parentId) await this.tasks.moveTask(taskListId, v.value.googleId, { parent: parentId });
            this.index.set(file.path, {
                kind: "task",
                googleId: v.value.googleId,
                container: taskListId,
            });
        } else {
            const created = await this.tasks.insertTask(
                taskListId,
                body,
                parentId ? { parent: parentId } : {},
            );
            if (created.id) {
                await writeFrontmatterKey(this.app, file, "googleId", created.id);
                this.onTouch(file.path);
                this.index.set(file.path, {
                    kind: "task",
                    googleId: created.id,
                    container: taskListId,
                });
            }
        }
    }

    /**
     * Resolve a task note's `parent` wikilink/basename to the parent task's Google id,
     * so it can be nested as a subtask. Returns undefined when there's no parent, the
     * link doesn't resolve, or the parent hasn't been pushed to Google yet (no googleId).
     */
    private resolveParentGoogleId(parent: unknown, fromPath: string): string | undefined {
        if (typeof parent !== "string" || parent.trim() === "") return undefined;
        const dest = this.app.metadataCache.getFirstLinkpathDest(
            linkToBasename(parent),
            fromPath,
        );
        if (!dest) return undefined;
        const gid: unknown = this.app.metadataCache.getFileCache(dest)?.frontmatter?.googleId;
        return typeof gid === "string" && gid ? gid : undefined;
    }

    /** Delete the Google object for a (now-removed) note path, if we know its id. */
    async handleDelete(path: string): Promise<void> {
        const ref = this.index.get(path);
        if (!ref) return;
        if (ref.kind === "event") await this.calendar.deleteEvent(ref.container, ref.googleId);
        else await this.tasks.deleteTask(ref.container, ref.googleId);
        this.index.delete(path);
    }

    /** Track a rename so a later delete still resolves, then re-sync the new path. */
    async handleRename(file: TFile, oldPath: string): Promise<void> {
        const ref = this.index.get(oldPath);
        if (ref) {
            this.index.delete(oldPath);
            this.index.set(file.path, ref);
        }
        await this.syncFile(file);
    }

    /**
     * Sync every event/task note in scope. One failing note doesn't abort the rest — errors
     * are isolated and counted so a single bad note or transient Google error is survivable.
     */
    async syncAll(): Promise<{ synced: number; failed: number }> {
        let synced = 0;
        let failed = 0;
        const s = this.settings();
        for (const file of scopedMarkdownFiles(this.app, [s.eventsFolder, s.tasksFolder])) {
            if (!this.syncKind(file.path)) continue;
            try {
                await this.syncFile(file);
                synced++;
            } catch (e) {
                failed++;
                this.notify(`google-sync: ${file.name}: ${(e as Error).message}`);
            }
        }
        return { synced, failed };
    }
}

function scopedMarkdownFiles(app: App, roots: string[]): TFile[] {
    const out: TFile[] = [];
    const seen = new Set<string>();

    const visit = (node: TAbstractFile): void => {
        if (node instanceof TFile) {
            if (node.extension === "md" && !seen.has(node.path)) {
                seen.add(node.path);
                out.push(node);
            }
            return;
        }
        if (node instanceof TFolder) {
            for (const child of node.children) visit(child);
        }
    };

    for (const root of roots) {
        const normalized = normalizePath(root).replace(/\/+$/, "");
        const node = app.vault.getAbstractFileByPath(normalized);
        if (!node) continue;
        visit(node);
    }

    return out;
}
