import { HttpFn, HttpRequest, HttpResponse } from "../../../src/google/http";

export function jsonResp(status: number, body: unknown = {}): HttpResponse {
    return { status, headers: {}, text: JSON.stringify(body), json: body };
}

export function emptyResp(status: number): HttpResponse {
    return { status, headers: {}, text: "", json: undefined };
}

/** Fake HttpFn that records requests and returns queued responses (default 200 {}). */
export function fakeHttp(queue: HttpResponse[] = []) {
    const calls: HttpRequest[] = [];
    const fn: HttpFn = async (req) => {
        calls.push(req);
        return queue.shift() ?? jsonResp(200);
    };
    return { calls, fn };
}

/** Retry options that don't actually sleep or jitter — for deterministic tests. */
export const noWaitRetry = { sleep: async () => {}, random: () => 0 };

export const token = async () => "test-token";
