import { HttpFn, parseJson } from "../src/google/http";

/**
 * Production transport for headless runs: Node's global fetch (Node >= 18).
 *
 * This file is part of the Node-only headless tooling — it is never bundled into the
 * plugin's main.js (enforced by scripts/check-runtime-bundle.mjs), so using fetch here
 * is fine; the plugin itself uses Obsidian's requestUrl (src/google/transport.ts).
 *
 * `globalThis.fetch` is resolved at call time so a test preload
 * (scripts/headless-mock-fetch.cjs) can swap it out before the first request.
 */
export const nodeFetchHttp: HttpFn = async (req) => {
    const headers: Record<string, string> = { ...(req.headers ?? {}) };
    if (req.contentType) headers["content-type"] = req.contentType;
    const res = await globalThis.fetch(req.url, {
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
