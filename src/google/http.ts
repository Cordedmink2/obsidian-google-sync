/**
 * Minimal HTTP abstraction so every Google call goes through one injectable function.
 * Production uses Obsidian's requestUrl (see transport.ts); tests and e2e inject a fake to
 * stay deterministic and credential-free. This file is intentionally free of any `obsidian`
 * import so it (and everything that depends only on it) is unit-testable under Node/tsx.
 */
export interface HttpRequest {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    contentType?: string;
}

export interface HttpResponse {
    status: number;
    headers: Record<string, string>;
    text: string;
    json: unknown;
}

export type HttpFn = (req: HttpRequest) => Promise<HttpResponse>;

/** Thrown, before anything is sent, when a request could create or delete Google data. */
export class UnsafeRequestError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "UnsafeRequestError";
    }
}

const TOKEN_ENDPOINT = { host: "oauth2.googleapis.com", path: /^\/token$/ };
const TASKS_MOVE = {
    host: "tasks.googleapis.com",
    path: /^\/tasks\/v1\/lists\/[^/]+\/tasks\/[^/]+\/move$/,
};

function isAllowedPost(url: string): boolean {
    let u: URL;
    try {
        u = new URL(url);
    } catch {
        return false;
    }
    if (u.protocol !== "https:") return false;
    return [TOKEN_ENDPOINT, TASKS_MOVE].some(
        (r) => u.hostname === r.host && r.path.test(u.pathname),
    );
}

const GUARDED = Symbol.for("google-sync.guardedHttp");

/**
 * Defence in depth for the one-way contract: this plugin never creates or deletes Google
 * data. Wraps a transport so any DELETE, and any POST other than the OAuth token endpoint
 * and Tasks `/move` (which only repositions an existing task), throws before sending.
 * PATCH (including the Meet `conferenceData.createRequest`) and GET are unaffected.
 */
export function guardHttp(inner: HttpFn): HttpFn {
    if ((inner as unknown as Record<symbol, unknown>)[GUARDED]) return inner;
    const guarded: HttpFn = (req) => {
        const method = (req.method ?? "GET").toUpperCase();
        if (method === "DELETE") {
            return Promise.reject(
                new UnsafeRequestError(
                    `Refusing DELETE ${req.url}: this plugin never deletes Google data.`,
                ),
            );
        }
        if (method === "POST" && !isAllowedPost(req.url)) {
            return Promise.reject(
                new UnsafeRequestError(
                    `Refusing POST ${req.url}: this plugin never creates Google data.`,
                ),
            );
        }
        return inner(req);
    };
    (guarded as unknown as Record<symbol, unknown>)[GUARDED] = true;
    return guarded;
}

/** Parse a JSON body, tolerating empty/non-JSON payloads (e.g. error pages, 204s). */
export function parseJson(text: string): unknown {
    try {
        return text ? JSON.parse(text) : undefined;
    } catch {
        return undefined;
    }
}

export interface RetryOptions {
    retries?: number; // max retries after the first attempt (default 4)
    baseDelayMs?: number; // default 500
    maxDelayMs?: number; // default 16000
    sleep?: (ms: number) => Promise<void>; // injectable for tests
    random?: () => number; // injectable jitter for tests
}

/** Parse a Retry-After header (delta-seconds or HTTP-date) into milliseconds, if present. */
export function parseRetryAfter(
    headers: Record<string, string>,
    now: number = Date.now(),
): number | undefined {
    const raw = headers["retry-after"] ?? headers["Retry-After"];
    if (!raw) return undefined;
    const secs = Number(raw);
    if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
    const date = Date.parse(raw);
    if (Number.isFinite(date)) return Math.max(0, date - now);
    return undefined;
}

/**
 * Run an HTTP call with exponential backoff + jitter. Retries on 429 and 5xx (and thrown
 * network errors), honoring Retry-After. Returns the last response on exhaustion; rethrows
 * the last network error if every attempt threw.
 */
export async function withRetry(
    fn: () => Promise<HttpResponse>,
    opts: RetryOptions = {},
): Promise<HttpResponse> {
    const retries = opts.retries ?? 4;
    const base = opts.baseDelayMs ?? 500;
    const max = opts.maxDelayMs ?? 16000;
    const sleep =
        opts.sleep ??
        ((ms: number) =>
            new Promise((resolve, reject) => {
                if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
                    window.setTimeout(resolve, ms);
                    return;
                }
                reject(
                    new Error(
                        "Retry sleep is unavailable outside Obsidian; pass RetryOptions.sleep.",
                    ),
                );
            }));
    const random = opts.random ?? Math.random;

    let attempt = 0;
    for (;;) {
        let res: HttpResponse | undefined;
        try {
            res = await fn();
            if (res.status !== 429 && res.status < 500) return res;
        } catch (err) {
            if (attempt >= retries) throw err;
        }
        if (res && attempt >= retries) return res;

        const backoff = Math.min(max, base * 2 ** attempt) + random() * base;
        const delay = res ? (parseRetryAfter(res.headers) ?? backoff) : backoff;
        await sleep(delay);
        attempt++;
    }
}
