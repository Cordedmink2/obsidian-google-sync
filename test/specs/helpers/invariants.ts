import type { MockCall } from "./mockEngine";

/**
 * The one-way contract as a predicate over recorded mock traffic. Pure (no wdio, no
 * obsidian) so unit tests and the E2E hook share it.
 *
 * Forbidden: any DELETE; any POST except the OAuth token endpoint and Tasks `/move`.
 * Matches calendar AND tasks item URLs (and anything else) by looking only at method + path.
 */
const ALLOWED_POSTS = [
    /^https:\/\/oauth2\.googleapis\.com\/token(\?|$)/,
    /^https:\/\/tasks\.googleapis\.com\/tasks\/v1\/lists\/[^/?]+\/tasks\/[^/?]+\/move(\?|$)/,
];

export function isForbiddenCall(call: MockCall): boolean {
    const method = call.method.toUpperCase();
    if (method === "DELETE") return true;
    if (method === "POST") return !ALLOWED_POSTS.some((re) => re.test(call.url));
    return false;
}

export function forbiddenCalls(calls: MockCall[]): MockCall[] {
    return calls.filter(isForbiddenCall);
}

/** Throws a readable error if the traffic broke the one-way contract or hit an unknown route. */
export function assertTrafficInvariants(calls: MockCall[], unknown: MockCall[]): void {
    const bad = forbiddenCalls(calls);
    if (bad.length)
        throw new Error(
            `One-way invariant broken: forbidden Google call(s): ${bad
                .map((c) => `${c.method} ${c.url}`)
                .join("; ")}`,
        );
    if (unknown.length)
        throw new Error(
            `Mock received request(s) it has no route for: ${unknown
                .map((c) => `${c.method} ${c.url}`)
                .join("; ")}`,
        );
}
