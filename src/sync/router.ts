import { GoogleSyncSettings } from "../settings-data";
import { GoogleCalendarClient, WriteEventOptions } from "../google/calendar";
import { GoogleTasksClient } from "../google/tasks";
import { detectKind, isManagedSubpath, validateEvent, validateTask } from "./frontmatter";
import { eventToGoogle, taskToGoogle } from "./mapper";
import { linkToBasename } from "./lifecycle-plan";
import { BaselineStore, GoogleBody, diffBody, projectRemoteBody, vetPatch } from "./baseline";
import { VaultPort } from "../vault/port";
import { EventFrontmatter, GoogleEvent, NoteKind } from "../types";

function isPullOnly(fm: Record<string, unknown>): boolean {
    return fm.syncDirection === "pull-only" || fm.googleSyncDirection === "pull-only";
}

function noteName(path: string): string {
    return path.split("/").pop() ?? path;
}

/** A vetted, ready-to-send update for one note. */
export interface PlannedPatch {
    path: string;
    kind: NoteKind;
    /** calendarId for events, taskListId for tasks. */
    container: string;
    googleId: string;
    /** Only the changed fields (cleared fields are null). */
    patch: GoogleBody;
    /** The full mapped body — becomes the new baseline after a successful push. */
    body: GoogleBody;
    event?: EventFrontmatter;
}

export interface PendingChange {
    path: string;
    changedKeys: string[];
    veto?: string;
}

export interface SyncRunResult {
    synced: number;
    failed: number;
    /** Paths held back by the mass-update guard (run again confirmed to push them). */
    blocked: string[];
}

/** Rolling window for the per-note (debounced edit) mass-update guard. */
const PATCH_WINDOW_MS = 60_000;

/**
 * Pushes vault note edits to Google as minimal updates — and nothing else. Sync is
 * one-way for existence (no creates, no deletes; a note without `googleId` is local-only)
 * and diff-based for content: each note's last-pushed/imported body is kept as a baseline,
 * only fields that changed against it are PATCHed, and a note with no baseline is diffed
 * against a fresh GET of the remote item. Patches that look like template clobbers
 * (placeholder title, mass field clearing) are vetoed, and more than `maxPatchesPerRun`
 * pending updates trip a circuit breaker that requires explicit confirmation.
 * No `obsidian` import — runs in the plugin and headless.
 */
export class SyncRouter {
    private recentPatches: number[] = [];

    constructor(
        private readonly port: VaultPort,
        private readonly calendar: GoogleCalendarClient,
        private readonly tasks: GoogleTasksClient,
        private readonly settings: () => GoogleSyncSettings,
        private readonly baselines: BaselineStore,
        private readonly notify: (msg: string) => void = () => {},
        /** Called when the router writes a key back into a note (e.g. meetLink), so the
         * caller can suppress the resulting modify event from echoing back into sync. */
        private readonly onTouch: (path: string) => void = () => {},
        private readonly now: () => number = Date.now,
    ) {}

    /** The note kind to sync for this path, or null if it should be ignored. */
    syncKind(path: string): NoteKind | null {
        const s = this.settings();
        if (isManagedSubpath(path, s.eventsFolder, s.tasksFolder)) return null;
        return detectKind(path, s.eventsFolder, s.tasksFolder);
    }

    /** Sync a single note (debounced vault-edit path), guarded by a rolling-window breaker. */
    async syncPath(path: string): Promise<void> {
        const plan = await this.planPath(path);
        if (!plan) return;
        const max = this.maxPatchesPerRun();
        const cutoff = this.now() - PATCH_WINDOW_MS;
        this.recentPatches = this.recentPatches.filter((t) => t > cutoff);
        if (this.recentPatches.length >= max) {
            this.notify(
                `Google sync: mass-update guard — ${this.recentPatches.length} updates in the last minute; skipped ${noteName(path)}. Run "Push pending updates (confirmed)" to push everything.`,
            );
            return;
        }
        await this.apply(plan);
        this.recentPatches.push(this.now());
    }

    /**
     * Push every pending change in scope. When more than maxPatchesPerRun notes have
     * pending updates and `confirmed` is not set, nothing is sent — the run reports the
     * blocked paths instead, so a runaway template/script can't fan out across Google.
     */
    async syncAll(options: { confirmed?: boolean } = {}): Promise<SyncRunResult> {
        const result: SyncRunResult = { synced: 0, failed: 0, blocked: [] };
        const plans: PlannedPatch[] = [];
        const parentIds = new Map<string, string | undefined>();
        for (const ref of await this.port.listMarkdown(this.scopeRoots())) {
            if (!this.syncKind(ref.path)) continue;
            try {
                const plan = await this.planPath(ref.path, { parentIds });
                if (plan) plans.push(plan);
            } catch (e) {
                result.failed++;
                this.notify(`Google sync: ${noteName(ref.path)}: ${(e as Error).message}`);
            }
        }
        if (!options.confirmed && plans.length > this.maxPatchesPerRun()) {
            result.blocked = plans.map((p) => p.path);
            this.notify(
                `Google sync: mass-update guard — ${plans.length} notes have pending updates (limit ${this.maxPatchesPerRun()}). Nothing was sent. Run "Push pending updates (confirmed)" if this is intentional.`,
            );
            return result;
        }
        for (const plan of plans) {
            try {
                await this.apply(plan);
                result.synced++;
            } catch (e) {
                result.failed++;
                this.notify(`Google sync: ${noteName(plan.path)}: ${(e as Error).message}`);
            }
        }
        return result;
    }

    /** Dry run: what would be pushed, per note, without calling Google's write endpoints. */
    async previewAll(): Promise<PendingChange[]> {
        const out: PendingChange[] = [];
        const parentIds = new Map<string, string | undefined>();
        for (const ref of await this.port.listMarkdown(this.scopeRoots())) {
            if (!this.syncKind(ref.path)) continue;
            try {
                const plan = await this.planPath(ref.path, { collectVetoed: out, parentIds });
                if (plan) out.push({ path: plan.path, changedKeys: Object.keys(plan.patch) });
            } catch (e) {
                out.push({ path: ref.path, changedKeys: [], veto: (e as Error).message });
            }
        }
        return out;
    }

    private scopeRoots(): string[] {
        const s = this.settings();
        return [s.eventsFolder, s.tasksFolder];
    }

    private maxPatchesPerRun(): number {
        const n = this.settings().maxPatchesPerRun;
        return Number.isFinite(n) && n > 0 ? n : 10;
    }

    /**
     * Compute the pending update for a note, or null when there is nothing to send:
     * out of scope, pull-only, not linked to Google, invalid, unchanged, or vetoed.
     */
    private async planPath(
        path: string,
        options: {
            collectVetoed?: PendingChange[];
            /** Per-run basename → googleId cache for parent resolution (see syncAll/previewAll). */
            parentIds?: Map<string, string | undefined>;
        } = {},
    ): Promise<PlannedPatch | null> {
        const kind = this.syncKind(path);
        if (!kind) return null;
        const fm = await this.port.readFrontmatter(path);
        if (isPullOnly(fm)) return null;
        const plan =
            kind === "event"
                ? await this.planEvent(path, fm)
                : await this.planTask(path, fm, options.parentIds);
        if (!plan) return null;
        const baseline = (await this.baselines.get(path)) ?? (await this.fetchRemoteBaseline(plan));
        const patch = diffBody(baseline, plan.body);
        if (!patch) {
            // Up to date — but an unfulfilled Meet request still needs an (empty) patch
            // carrying the conferenceData create request.
            const wantsMeet =
                plan.event &&
                (plan.event.conferencing === true || plan.event.conferencing === "hangoutsMeet") &&
                !plan.event.meetLink;
            if (wantsMeet) return plan;
            // Refresh the baseline so later diffs start from here.
            await this.baselines.set(path, plan.body);
            return null;
        }
        const veto = vetPatch(patch, baseline, kind);
        if (!veto.ok) {
            const msg = `Google sync: ${noteName(path)}: ${veto.reason} — not pushed. Re-import to restore the note from Google.`;
            options.collectVetoed?.push({ path, changedKeys: Object.keys(patch), veto: veto.reason });
            this.notify(msg);
            return null;
        }
        return { ...plan, patch };
    }

    /** First contact for a note with no stored baseline: diff against the live remote item. */
    private async fetchRemoteBaseline(plan: PlannedPatch): Promise<GoogleBody> {
        const remote =
            plan.kind === "event"
                ? await this.calendar.getEvent(plan.container, plan.googleId)
                : await this.tasks.getTask(plan.container, plan.googleId);
        return projectRemoteBody(remote as GoogleBody, plan.kind);
    }

    private async planEvent(
        path: string,
        fm: Record<string, unknown>,
    ): Promise<PlannedPatch | null> {
        const v = validateEvent(fm);
        if (!v.ok || !v.value) {
            this.notify(`Google sync: ${noteName(path)}: ${v.errors.join("; ")}`);
            return null;
        }
        // One-way: notes without a googleId stay local until an import links them.
        if (!v.value.googleId) return null;
        const s = this.settings();
        const body = eventToGoogle(v.value, s.defaultTimezone) as GoogleBody;
        return {
            path,
            kind: "event",
            container: v.value.calendarId || s.defaultCalendarId,
            googleId: v.value.googleId,
            patch: {},
            body,
            event: v.value,
        };
    }

    private async planTask(
        path: string,
        fm: Record<string, unknown>,
        parentIds?: Map<string, string | undefined>,
    ): Promise<PlannedPatch | null> {
        const v = validateTask(fm);
        if (!v.ok || !v.value) {
            this.notify(`Google sync: ${noteName(path)}: ${v.errors.join("; ")}`);
            return null;
        }
        // One-way: notes without a googleId stay local until an import links them.
        if (!v.value.googleId) return null;
        const s = this.settings();
        const taskListId = v.value.tasklist || s.taskListId;
        if (!taskListId) {
            this.notify("Google sync: set a task list ID in settings before syncing tasks.");
            return null;
        }
        const body = taskToGoogle(v.value, s.defaultTimezone) as GoogleBody;
        // `parent` participates in the diff (so re-nesting is detected) but is sent via
        // the move endpoint, not the PATCH body — see apply().
        const parentId = await this.resolveParentGoogleId(v.value.parent, parentIds);
        if (parentId) body.parent = parentId;
        return {
            path,
            kind: "task",
            container: taskListId,
            googleId: v.value.googleId,
            patch: {},
            body,
        };
    }

    private async apply(plan: PlannedPatch): Promise<void> {
        if (plan.kind === "event") await this.applyEvent(plan);
        else await this.applyTask(plan);
        await this.baselines.set(plan.path, plan.body);
    }

    private async applyEvent(plan: PlannedPatch): Promise<void> {
        const value = plan.event as EventFrontmatter;
        const patch = { ...plan.patch } as GoogleEvent;
        const opts = this.eventWriteOptions(value, patch);
        const patched = await this.calendar.patchEvent(plan.container, plan.googleId, patch, opts);
        await this.writeMeetLinkBack(plan.path, value, patched);
    }

    private async applyTask(plan: PlannedPatch): Promise<void> {
        const patch = { ...plan.patch };
        const parentChanged = "parent" in patch;
        const parentId = patch.parent;
        delete patch.parent;
        if (Object.keys(patch).length) {
            await this.tasks.patchTask(plan.container, plan.googleId, patch);
        }
        // parent can't be changed via patch — move handles (re)nesting; a cleared
        // parent (null) promotes the task back to top level.
        if (parentChanged) {
            await this.tasks.moveTask(
                plan.container,
                plan.googleId,
                typeof parentId === "string" && parentId ? { parent: parentId } : {},
            );
        }
    }

    /**
     * Derive patch query params from the event, and — when the note asks for a
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
        path: string,
        value: EventFrontmatter,
        result: GoogleEvent,
    ): Promise<void> {
        const link =
            result.hangoutLink ??
            result.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri;
        if (!link || value.meetLink === link) return;
        await this.port.writeFrontmatterKey(path, "meetLink", link);
        this.onTouch(path);
    }

    /**
     * Resolve a task note's `parent` wikilink/basename to the parent task's Google id,
     * so it can be nested as a subtask. Returns undefined when there's no parent, the
     * link doesn't resolve to a task note, or the parent isn't linked to Google yet.
     */
    private async resolveParentGoogleId(
        parent: unknown,
        cache?: Map<string, string | undefined>,
    ): Promise<string | undefined> {
        if (typeof parent !== "string" || parent.trim() === "") return undefined;
        const target = linkToBasename(parent);
        if (!target) return undefined;
        // Bulk runs (syncAll/previewAll) share a cache so the tasks folder is scanned at
        // most once per distinct parent, not once per subtask.
        if (cache?.has(target)) return cache.get(target);
        let resolved: string | undefined;
        const s = this.settings();
        for (const ref of await this.port.listMarkdown([s.tasksFolder])) {
            if (ref.basename !== target) continue;
            const gid: unknown = (await this.port.readFrontmatter(ref.path)).googleId;
            if (typeof gid === "string" && gid) {
                resolved = gid;
                break;
            }
        }
        cache?.set(target, resolved);
        return resolved;
    }
}
