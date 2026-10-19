import { HttpFn, HttpResponse, RetryOptions, guardHttp, withRetry } from "./http";

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

/** Append the defined entries as an encoded query string. */
export function addQuery(
    url: string,
    params: Record<string, string | number | boolean | undefined>,
): string {
    const enc = encodeURIComponent;
    const query = Object.entries(params)
        .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
        .map(([key, value]) => `${enc(key)}=${enc(String(value))}`)
        .join("&");
    return query ? `${url}?${query}` : url;
}

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
    const send = guardHttp(http);
    const token = await getToken();
    const res: HttpResponse = await withRetry(
        () =>
            send({
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
