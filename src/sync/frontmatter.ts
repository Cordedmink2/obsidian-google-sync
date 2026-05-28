import { EventFrontmatter, NoteKind, TaskFrontmatter } from "../types";

function trimSlashes(s: string): string {
    return s.replace(/^\/+|\/+$/g, "");
}

/** Classify a vault path as an event or task note by its top-level folder. */
export function detectKind(
    path: string,
    eventsFolder: string,
    tasksFolder: string,
): NoteKind | null {
    const p = trimSlashes(path);
    const ev = trimSlashes(eventsFolder);
    const tk = trimSlashes(tasksFolder);
    if (ev && (p === ev || p.startsWith(ev + "/"))) return "event";
    if (tk && (p === tk || p.startsWith(tk + "/"))) return "task";
    return null;
}

/** Lifecycle subfolders that hold already-moved notes and should not be synced on change. */
const MANAGED_SUBFOLDERS = ["archive", "overdue", "completed"];

export function isManagedSubpath(path: string, eventsFolder: string, tasksFolder: string): boolean {
    const p = trimSlashes(path);
    for (const base of [trimSlashes(eventsFolder), trimSlashes(tasksFolder)]) {
        if (!base) continue;
        for (const sub of MANAGED_SUBFOLDERS) {
            if (p.startsWith(`${base}/${sub}/`)) return true;
        }
    }
    return false;
}

export interface ValidationResult<T> {
    ok: boolean;
    value?: T;
    errors: string[];
}

function requireTitle(fm: Record<string, unknown>, errors: string[]): void {
    if (typeof fm.title !== "string" || fm.title.trim() === "") {
        errors.push("`title` is required");
    }
}

/** Validate a parsed event frontmatter object. Extra keys are preserved. */
export function validateEvent(fm: Record<string, unknown>): ValidationResult<EventFrontmatter> {
    const errors: string[] = [];
    requireTitle(fm, errors);
    if (fm.date == null) errors.push("`date` is required");
    else if (typeof fm.date !== "string") errors.push("`date` must be a string");
    if (fm.end != null && typeof fm.end !== "string") errors.push("`end` must be a string");
    if (errors.length) return { ok: false, errors };
    return { ok: true, value: fm as EventFrontmatter, errors: [] };
}

/** Validate a parsed task frontmatter object. Extra keys are preserved. */
export function validateTask(fm: Record<string, unknown>): ValidationResult<TaskFrontmatter> {
    const errors: string[] = [];
    requireTitle(fm, errors);
    if (fm.due != null && typeof fm.due !== "string") errors.push("`due` must be a string");
    if (fm.completed != null && typeof fm.completed !== "boolean") {
        errors.push("`completed` must be a boolean");
    }
    if (errors.length) return { ok: false, errors };
    return { ok: true, value: fm as TaskFrontmatter, errors: [] };
}
