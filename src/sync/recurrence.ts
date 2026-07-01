import { GoogleEvent } from "../types";

/**
 * Recurring-event allowlist. Pure (no `obsidian` import) so it's unit-testable under Node.
 *
 * With `singleEvents: true`, the Calendar API expands a recurring series into one event per
 * occurrence — a daily standup becomes hundreds of notes. A title filter lets the user control
 * which series import. One-off events are never filtered. The filter runs in one of two modes:
 *
 *   - "allow" (allowlist): import a recurring event only if its title matches a pattern. An
 *     empty list imports NO recurring events.
 *   - "block" (blocklist): import every recurring event except those whose title matches a
 *     pattern. An empty list imports ALL recurring events.
 */

export type RecurringFilterMode = "allow" | "block";

/** An expanded occurrence carries recurringEventId; an unexpanded series carries recurrence. */
export function isRecurringEvent(event: GoogleEvent): boolean {
    if (typeof event.recurringEventId === "string" && event.recurringEventId) return true;
    return Array.isArray(event.recurrence) && event.recurrence.length > 0;
}

/** Compiled patterns, cached — an import calls the filter once per expanded occurrence. */
const compiledPatterns = new Map<string, RegExp>();

/** Compile a user pattern to an anchored, case-insensitive matcher where `*` is a wildcard. */
function patternToRegExp(pattern: string): RegExp {
    const cached = compiledPatterns.get(pattern);
    if (cached) return cached;
    // The settings list stays small; the bound just guards against unbounded growth.
    if (compiledPatterns.size > 200) compiledPatterns.clear();
    const body = pattern
        .trim()
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&") // escape regex metachars (but not `*`)
        .replace(/\*/g, ".*"); // `*` becomes a wildcard
    const re = new RegExp(`^${body}$`, "i");
    compiledPatterns.set(pattern, re);
    return re;
}

/**
 * Decide whether an event should be imported given the recurring-event title filter.
 * Non-recurring events always pass. For recurring events, a title match means "import" in
 * "allow" mode and "skip" in "block" mode.
 */
export function isEventAllowed(
    event: GoogleEvent,
    mode: RecurringFilterMode,
    filters: string[],
): boolean {
    if (!isRecurringEvent(event)) return true;
    const patterns = filters.map((p) => p.trim()).filter((p) => p.length > 0);
    const title = (event.summary ?? "").trim();
    const matched = patterns.some((p) => patternToRegExp(p).test(title));
    return mode === "block" ? !matched : matched;
}
