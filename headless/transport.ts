import { HttpFn, parseJson } from "../src/google/http";

/** Production transport for headless runs: Node's global HTTP client (Node >= 18). */
const nodeHttpClient: typeof fetch = fetch;

export const nodeFetchHttp: HttpFn = async (req) => {
    const headers: Record<string, string> = { ...(req.headers ?? {}) };
    if (req.contentType) headers["content-type"] = req.contentType;
    const res = await nodeHttpClient(req.url, {
        method: req.method ?? "GET",
        headers,
        body: req.body,
    });
    const text = await res.text();
    const outHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
        outHeaders[key] = value;
    });
    return { status: res.status, headers: outHeaders, text, json: parseJson(text) };
};
