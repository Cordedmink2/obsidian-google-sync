/**
 * Pure wording for push/preview feedback (D5). No `obsidian` import, so it stays
 * unit-testable. Every outcome the user needs to understand is spelled out in the notice
 * itself — nothing is explained only in the console.
 */
import type { PendingChange, SyncRunResult } from "./router";

export const NOTHING_TO_PUSH = "Google sync: everything is up to date — nothing to push.";

/** One notice for a finished push run: what was sent, and a count per reason the rest was not. */
export function formatPushNotice(r: SyncRunResult): string {
    const held: string[] = [];
    if (r.skipped.pullOnly > 0) held.push(`${r.skipped.pullOnly} pull-only`);
    if (r.skipped.unlinked > 0) {
        held.push(`${r.skipped.unlinked} not linked to Google (no googleId)`);
    }
    if (r.blocked.length > 0) {
        held.push(
            `${r.blocked.length} held by the mass-update guard (limit ${r.limit}; use Push pending updates (confirmed))`,
        );
    }
    if (r.failed > 0) held.push(`${r.failed} failed`);

    const nothingSent = r.synced === 0 && r.failed === 0 && r.blocked.length === 0;
    // "Up to date" is only honest when nothing was left behind; otherwise say what was.
    const head = !nothingSent
        ? `Google sync: pushed ${r.synced} update(s).`
        : held.length === 0
          ? NOTHING_TO_PUSH
          : "Google sync: nothing to push.";
    const tail = held.length ? ` Not pushed: ${held.join("; ")}.` : "";
    const why = r.failures.length ? ` ${r.failures.join(" ")}` : "";
    return `${head}${tail}${why}`;
}

/** Heading for the preview modal. */
export function pendingHeading(n: number): string {
    return `${n} ${n === 1 ? "note" : "notes"} would be pushed.`;
}

/** Notice for a finished import. Says plainly when Google had nothing to give. */
export function formatImportNotice(
    c: { events: number; tasks: number; failed: number; orphaned: number; errors: string[] },
    suffix: string,
): string {
    if (c.failed > 0) {
        return `Google sync: imported ${c.events} event(s), ${c.tasks} task(s), ${c.failed} failed${c.errors.length ? ` (${c.errors.join("; ")})` : ""}.${suffix}`;
    }
    if (c.events === 0 && c.tasks === 0 && c.orphaned === 0 && suffix === "") {
        return "Google sync: nothing to import — no events or tasks found in your import window.";
    }
    return `Google sync: imported ${c.events} event(s) and ${c.tasks} task(s).${suffix}`;
}

export interface PendingLine {
    path: string;
    detail: string;
    blocked: boolean;
}

/** One row per pending note for the preview modal. */
export function formatPendingLines(pending: PendingChange[]): PendingLine[] {
    return pending.map((p) => ({
        path: p.path,
        blocked: !!p.veto,
        detail: p.veto
            ? `BLOCKED: ${p.veto}`
            : `changes: ${p.changedKeys.join(", ") || "Meet link request"}`,
    }));
}
