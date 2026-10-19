/**
 * Stateful, fail-loud fake of the Google Calendar v3 + Tasks v1 + OAuth token endpoints.
 *
 * `createGoogleMock` is deliberately ONE self-contained function (no imports, no outer
 * references): unit tests call it directly under Node, and the E2E helper ships its source
 * into the Obsidian renderer via `Function.prototype.toString`.
 *
 * Realism it provides, and that the old hard-coded mock did not:
 *   - unknown routes answer 501 AND are recorded in `unknown` (the run then fails);
 *   - PATCH / move mutate state, so later GETs see the change;
 *   - paging: events 250/page (max 2500), tasks 20/page (max 100), calendars/lists 100,
 *     with nextPageToken / pageToken / maxResults and a final nextSyncToken;
 *   - events: singleEvents/showDeleted/timeMin/timeMax, status "cancelled";
 *   - tasks: showCompleted/showHidden, `deleted:true` and `hidden` tasks;
 *   - 404 / 410 for removed items, 404 for ids that never existed;
 *   - Meet creation through PATCH conferenceData.createRequest;
 *   - per-route error injection (401/403/404/410/429+Retry-After/5xx) and malformed JSON.
 */
export interface MockCall {
    method: string;
    url: string;
    body?: string;
}

export interface MockErrorRule {
    /** Regular-expression source matched against the full request URL. */
    match: string;
    method?: string;
    status: number;
    /** Seconds, sent as the Retry-After header. */
    retryAfter?: number;
    /** Answer 2xx with a body that is not JSON (status is then used as given, e.g. 200). */
    malformed?: boolean;
    /** How many times the rule fires before it stops (default: forever). */
    times?: number;
}

export interface MockFixture {
    calendars: { id: string; summary?: string; primary?: boolean }[];
    /** Events by calendar id. */
    events: Record<string, Record<string, unknown>[]>;
    taskLists: { id: string; title?: string }[];
    /** Tasks by task list id, in position order. */
    tasks: Record<string, Record<string, unknown>[]>;
    /** Items answered with 404/410 instead of a resource, e.g. {"primary/ev1": 410}. */
    removedEvents?: Record<string, number>;
    removedTasks?: Record<string, number>;
    errors?: MockErrorRule[];
}

export interface MockHandle {
    http: (req: {
        url: string;
        method?: string;
        body?: string;
        headers?: Record<string, string>;
    }) => Promise<{ status: number; headers: Record<string, string>; text: string; json: unknown }>;
    calls: MockCall[];
    /** Requests that matched no known route. Any entry is a test failure. */
    unknown: MockCall[];
    state: MockFixture;
}

export function createGoogleMock(fixture: MockFixture): MockHandle {
    const state: MockFixture = JSON.parse(JSON.stringify(fixture)) as MockFixture;
    const calls: MockCall[] = [];
    const unknown: MockCall[] = [];
    const fired = new Map<number, number>();
    let meetSeq = 0;

    type Json = Record<string, unknown>;
    const EVENTS_PAGE = 250;
    const EVENTS_MAX = 2500;
    const TASKS_PAGE = 20;
    const TASKS_MAX = 100;
    const LIST_PAGE = 100;

    const respond = (status: number, body: unknown, headers: Record<string, string> = {}) => {
        const text = body === undefined ? "" : JSON.stringify(body);
        return Promise.resolve({ status, headers, text, json: body });
    };
    const errorBody = (status: number, message: string) => ({
        error: { code: status, message, errors: [{ message, reason: "mock" }] },
    });
    const fail = (status: number, message: string) => respond(status, errorBody(status, message));

    const page = <T>(
        all: T[],
        params: URLSearchParams,
        defaultSize: number,
        maxSize: number,
    ): { items: T[]; nextPageToken?: string } => {
        const asked = Number(params.get("maxResults"));
        const size = Math.min(maxSize, asked > 0 ? asked : defaultSize);
        const token = params.get("pageToken");
        let start = 0;
        if (token) {
            if (!/^page:\d+$/.test(token)) throw new Error(`bad pageToken ${token}`);
            start = Number(token.slice(5));
        }
        const items = all.slice(start, start + size);
        const next = start + size < all.length ? `page:${start + size}` : undefined;
        return next ? { items, nextPageToken: next } : { items };
    };

    const startMs = (e: Json): number => {
        const s = e.start as { dateTime?: string; date?: string } | undefined;
        const v = s?.dateTime ?? s?.date;
        return v ? Date.parse(v) : NaN;
    };
    const endMs = (e: Json): number => {
        const s = (e.end ?? e.start) as { dateTime?: string; date?: string } | undefined;
        const v = s?.dateTime ?? s?.date;
        return v ? Date.parse(v) : NaN;
    };

    const injected = (method: string, url: string) => {
        const rules = state.errors ?? [];
        for (let i = 0; i < rules.length; i++) {
            const r = rules[i] as MockErrorRule;
            if (r.method && r.method.toUpperCase() !== method) continue;
            if (!new RegExp(r.match).test(url)) continue;
            const n = fired.get(i) ?? 0;
            if (r.times !== undefined && n >= r.times) continue;
            fired.set(i, n + 1);
            return r;
        }
        return undefined;
    };

    const findEvent = (cal: string, id: string): Json | undefined =>
        (state.events[cal] ?? []).find((e) => e.id === id);
    const findTask = (list: string, id: string): Json | undefined =>
        (state.tasks[list] ?? []).find((t) => t.id === id);

    const mergePatch = (target: Json, patch: Json) => {
        for (const [k, v] of Object.entries(patch)) {
            if (v === null) delete target[k];
            else target[k] = v;
        }
        target.updated = new Date().toISOString();
        target.etag = `"${Math.random().toString(36).slice(2, 10)}"`;
    };

    const handle = (method: string, rawUrl: string, bodyText?: string) => {
        const url = new URL(rawUrl);
        const params = url.searchParams;
        const path = url.pathname;
        // Only the token endpoint is form-encoded; every other write body is JSON.
        let body: Json = {};
        if (bodyText && url.hostname !== "oauth2.googleapis.com")
            body = JSON.parse(bodyText) as Json;
        let m: RegExpMatchArray | null;

        if (url.hostname === "oauth2.googleapis.com" && path === "/token" && method === "POST") {
            return respond(200, {
                access_token: "e2e",
                expires_in: 3600,
                refresh_token: "rt",
                token_type: "Bearer",
            });
        }
        if (url.hostname === "bridge.example" && method === "GET") {
            return respond(200, "bridge");
        }

        if (url.hostname === "www.googleapis.com" && path.startsWith("/calendar/v3/")) {
            const p = path.slice("/calendar/v3".length);
            if (method === "GET" && p === "/users/me/calendarList") {
                const items = state.calendars.map((c) => ({
                    kind: "calendar#calendarListEntry",
                    accessRole: c.primary ? "owner" : "reader",
                    ...c,
                }));
                return respond(200, {
                    kind: "calendar#calendarList",
                    ...page(items, params, LIST_PAGE, LIST_PAGE),
                });
            }
            if (method === "GET" && (m = p.match(/^\/calendars\/([^/]+)\/events$/))) {
                const cal = decodeURIComponent(m[1] as string);
                if (!state.events[cal]) return fail(404, `Not Found: calendar ${cal}`);
                const removed = state.removedEvents ?? {};
                let items = state.events[cal].filter((e) => !(`${cal}/${String(e.id)}` in removed));
                if (params.get("showDeleted") !== "true")
                    items = items.filter((e) => e.status !== "cancelled");
                const min = params.get("timeMin");
                const max = params.get("timeMax");
                // Google keeps cancelled stubs in the listing without a usable window
                // check; live events must overlap [timeMin, timeMax).
                items = items.filter((e) => {
                    if (e.status === "cancelled") return true;
                    if (min && !(endMs(e) > Date.parse(min))) return false;
                    if (max && !(startMs(e) < Date.parse(max))) return false;
                    return true;
                });
                const pg = page(items, params, EVENTS_PAGE, EVENTS_MAX);
                return respond(200, {
                    kind: "calendar#events",
                    summary: cal,
                    timeZone: "Pacific/Auckland",
                    ...pg,
                    ...(pg.nextPageToken ? {} : { nextSyncToken: `sync-${items.length}` }),
                });
            }
            if ((m = p.match(/^\/calendars\/([^/]+)\/events\/([^/]+)$/))) {
                const cal = decodeURIComponent(m[1] as string);
                const id = decodeURIComponent(m[2] as string);
                const gone = (state.removedEvents ?? {})[`${cal}/${id}`];
                if (gone)
                    return fail(gone, gone === 410 ? "Resource has been deleted" : "Not Found");
                const ev = findEvent(cal, id);
                if (method === "GET") {
                    return ev ? respond(200, ev) : fail(404, "Not Found");
                }
                if (method === "PATCH") {
                    if (!ev) return fail(404, "Not Found");
                    const cd = body.conferenceData as
                        | { createRequest?: { requestId?: string } }
                        | undefined;
                    const patch: Json = { ...body };
                    if (cd?.createRequest) {
                        meetSeq++;
                        const link = "https://meet.google.com/e2e-link";
                        patch.conferenceData = {
                            conferenceId: `e2e-conf-${meetSeq}`,
                            conferenceSolution: {
                                key: { type: "hangoutsMeet" },
                                name: "Google Meet",
                            },
                            entryPoints: [
                                {
                                    entryPointType: "video",
                                    uri: link,
                                    label: "meet.google.com/e2e-link",
                                },
                            ],
                            createRequest: {
                                ...cd.createRequest,
                                status: { statusCode: "success" },
                            },
                        };
                        patch.hangoutLink = link;
                    }
                    mergePatch(ev, patch);
                    return respond(200, ev);
                }
            }
        }

        if (url.hostname === "tasks.googleapis.com" && path.startsWith("/tasks/v1/")) {
            const p = path.slice("/tasks/v1".length);
            if (method === "GET" && p === "/users/@me/lists") {
                const items = state.taskLists.map((l) => ({ kind: "tasks#taskList", ...l }));
                return respond(200, {
                    kind: "tasks#taskLists",
                    ...page(items, params, LIST_PAGE, LIST_PAGE),
                });
            }
            if (method === "GET" && (m = p.match(/^\/lists\/([^/]+)\/tasks$/))) {
                const list = decodeURIComponent(m[1] as string);
                if (!state.tasks[list]) return fail(404, `Task list not found: ${list}`);
                const removed = state.removedTasks ?? {};
                let items = state.tasks[list].filter(
                    (t) => !(`${list}/${String(t.id)}` in removed) && t.deleted !== true,
                );
                if (params.get("showCompleted") === "false")
                    items = items.filter((t) => t.status !== "completed");
                if (params.get("showHidden") !== "true")
                    items = items.filter((t) => t.hidden !== true);
                return respond(200, {
                    kind: "tasks#tasks",
                    ...page(items, params, TASKS_PAGE, TASKS_MAX),
                });
            }
            if (method === "POST" && (m = p.match(/^\/lists\/([^/]+)\/tasks\/([^/]+)\/move$/))) {
                const list = decodeURIComponent(m[1] as string);
                const id = decodeURIComponent(m[2] as string);
                const t = findTask(list, id);
                if (!t) return fail(404, "Not Found");
                const parent = params.get("parent");
                if (parent) t.parent = parent;
                else delete t.parent;
                t.updated = new Date().toISOString();
                return respond(200, t);
            }
            if ((m = p.match(/^\/lists\/([^/]+)\/tasks\/([^/]+)$/))) {
                const list = decodeURIComponent(m[1] as string);
                const id = decodeURIComponent(m[2] as string);
                const gone = (state.removedTasks ?? {})[`${list}/${id}`];
                if (gone)
                    return fail(gone, gone === 410 ? "Resource has been deleted" : "Not Found");
                const t = findTask(list, id);
                if (method === "GET") return t ? respond(200, t) : fail(404, "Not Found");
                if (method === "PATCH") {
                    if (!t) return fail(404, "Not Found");
                    mergePatch(t, body);
                    if (body.status === "completed") t.completed = new Date().toISOString();
                    if (body.status === "needsAction") delete t.completed;
                    return respond(200, t);
                }
            }
        }

        const call = { method, url: rawUrl, body: bodyText };
        unknown.push(call);
        return fail(501, `mock: no route for ${method} ${rawUrl}`);
    };

    const http: MockHandle["http"] = (req) => {
        const method = (req.method ?? "GET").toUpperCase();
        calls.push({ method, url: req.url, body: req.body });
        const rule = injected(method, req.url);
        if (rule) {
            const headers: Record<string, string> = {};
            if (rule.retryAfter !== undefined) headers["retry-after"] = String(rule.retryAfter);
            if (rule.malformed) {
                return Promise.resolve({
                    status: rule.status,
                    headers,
                    text: '{"items": [ {"id": "trunc',
                    json: undefined,
                });
            }
            return respond(
                rule.status,
                errorBody(rule.status, `mock injected ${rule.status}`),
                headers,
            );
        }
        try {
            return handle(method, req.url, req.body);
        } catch (e) {
            unknown.push({ method, url: req.url, body: req.body });
            return fail(500, `mock crashed: ${(e as Error).message}`);
        }
    };

    return { http, calls, unknown, state };
}
