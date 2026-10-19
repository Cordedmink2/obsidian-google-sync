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
    if (r.skipped.pullOnly > 0) held.push(`${r.skipped.pullOnly} pull-only (never pushed)`);
    if (r.skipped.unlinked > 0) {
        held.push(`${r.skipped.unlinked} not linked to Google (no googleId)`);
    }
    if (r.blocked.length > 0) {
        held.push(
            `${r.blocked.length} held by the mass-update guard (limit ${r.limit}; use Push pending updates (confirmed))`,
        );
    }
    if (r.failed > 0) held.push(`${r.failed} failed (the reason is in the notice above)`);

    const nothingSent = r.synced === 0 && r.failed === 0 && r.blocked.length === 0;
    const head = nothingSent ? NOTHING_TO_PUSH : `Google sync: pushed ${r.synced} update(s).`;
    if (held.length === 0) return head;
    return `${head.replace(/\.$/, "")}. Not pushed: ${held.join("; ")}.`;
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
        detail: p.veto ? `BLOCKED: ${p.veto}` : p.changedKeys.join(", ") || "Meet link request",
    }));
}
