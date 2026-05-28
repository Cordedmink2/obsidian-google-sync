import { HttpFn, HttpResponse, RetryOptions, withRetry } from "./http";

/** A non-2xx Google API response. `body` is the parsed error payload when available. */
export class GoogleApiError extends Error {
    constructor(
        readonly status: number,
        message: string,
        readonly body?: unknown,
    ) {
        super(message);
        this.name = "GoogleApiError";
    }
}

/** Supplies a currently-valid OAuth access token (refreshing as needed). */
export type TokenProvider = () => Promise<string>;

export interface ApiCall {
    method: string;
    url: string;
    body?: unknown;
}

/**
 * Shared Google REST call: attach bearer auth, JSON-encode the body, retry transient
 * failures (via withRetry), and throw GoogleApiError on non-2xx. Returns the parsed JSON
 * (undefined for empty 2xx like 204).
 */
export async function apiCall(
    http: HttpFn,
    getToken: TokenProvider,
    retry: RetryOptions,
    { method, url, body }: ApiCall,
): Promise<unknown> {
    const token = await getToken();
    const res: HttpResponse = await withRetry(
        () =>
            http({
                url,
                method,
                headers: { Authorization: `Bearer ${token}` },
                contentType: body !== undefined ? "application/json" : undefined,
                body: body !== undefined ? JSON.stringify(body) : undefined,
            }),
        retry,
    );
    if (res.status < 200 || res.status >= 300) {
        throw new GoogleApiError(
            res.status,
            `${method} ${url} -> ${res.status}`,
            res.json ?? res.text,
        );
    }
    return res.json;
}
