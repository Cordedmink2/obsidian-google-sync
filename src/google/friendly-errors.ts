import { GoogleApiError } from "./api";

/**
 * Turn a Google API failure into a sentence a user can act on. The raw error text carries the
 * request line and full URL, which wraps mid-word in a notice and says nothing about what to
 * do. Pure (no `obsidian` import).
 */
export function describeGoogleError(e: unknown): string {
    if (!(e instanceof GoogleApiError)) return e instanceof Error ? e.message : String(e);
    const s = e.status;
    if (s >= 200 && s < 300) {
        return "Google sent an unreadable (malformed) response. Try again in a few minutes.";
    }
    if (s === 401) {
        return "Google rejected the sign-in (401). Run Connect to Google to sign in again.";
    }
    if (s === 403) {
        return "Google refused access (403). Check that the Calendar and Tasks APIs are enabled and the scopes were granted.";
    }
    if (s === 404 || s === 410) return `Google no longer has this item (${s}).`;
    if (s === 429) return "Google is rate-limiting requests (429). Wait a minute, then try again.";
    if (s >= 500) return `Google is temporarily unavailable (${s}). Try again in a few minutes.`;
    return `Google returned an error (${s}).`;
}
