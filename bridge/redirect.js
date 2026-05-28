// Pure logic for the OAuth redirect bridge. Loaded by bridge/index.html via
// <script type="module"> and exercised by test/unit/bridge-redirect.test.ts.
// Keep dependency-free and side-effect-free so it works both in a browser
// module and when imported from Node tests.

/**
 * @param {string | null | undefined} search - window.location.search ("?code=...&state=...")
 * @returns {{ target: string } | { target: null, message: string }}
 */
export function computeBridgeRedirect(search) {
    const p = new URLSearchParams(search || "");
    const error = p.get("error");
    const code = p.get("code");
    const state = p.get("state");
    if (error) {
        return { target: "obsidian://google-sync?error=" + encodeURIComponent(error) };
    }
    if (code && state) {
        return {
            target:
                "obsidian://google-sync?code=" +
                encodeURIComponent(code) +
                "&state=" +
                encodeURIComponent(state),
        };
    }
    return {
        target: null,
        message: "Missing authorization code. Please retry from Obsidian.",
    };
}
