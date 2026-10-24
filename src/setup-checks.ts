/**
 * Pure setup/credential validation helpers shared by the settings tab and the
 * Validate setup command. No `obsidian` import so they stay unit-testable and
 * mobile-safe.
 */

/** D6: said in Validate setup and in the README setup section (a unit test keeps them equal). */
export const OWN_CLIENT_NOTE =
    "This plugin needs its own Google OAuth client; do not reuse another plugin's client.";

/** Google OAuth client IDs always end in this suffix. */
export function isLikelyClientId(value: string): boolean {
    return /\.apps\.googleusercontent\.com$/.test(value.trim());
}

/** Trim surrounding whitespace a paste can drag in. */
export function normalizeRedirectUri(value: string): string {
    return value.trim();
}

/** A non-blocking warning about a redirect bridge URL, or null when it looks fine. */
export function redirectUriWarning(value: string): string | null {
    const v = value.trim();
    if (v === "") return null;
    if (!v.startsWith("https://")) return "Must be an https:// URL (Google requires it)";
    return null;
}

/** Verify that a fetched HTTP response body looks like a valid bridge page. Returns a human-readable check result. */
export function checkBridgeResponse(
    status: number,
    body: string,
): { ok: boolean; message: string } {
    if (status < 200 || status >= 300) {
        return {
            ok: false,
            message: `Bridge returned HTTP ${status} (expected 200). Check that the URL is correct and the page is live.`,
        };
    }
    if (body.includes("obsidian://google-sync")) {
        return { ok: true, message: "Bridge URL ok — the page is live and ready." };
    }
    return {
        ok: false,
        message:
            "Bridge URL responded, but the page does not look like the expected bridge. Did you upload the correct file?",
    };
}

export type CheckLevel = "ok" | "warn" | "fail";

export interface SetupCheck {
    level: CheckLevel;
    label: string;
}

/** Render a check as a `[ok]` / `[!]` / `[--]` line for command output. */
export function formatCheck(c: SetupCheck): string {
    const mark = c.level === "ok" ? "[ok]" : c.level === "warn" ? "[!]" : "[--]";
    return `${mark} ${c.label}`;
}

/**
 * Inspect the three OAuth credential fields and return an actionable check per
 * field — the offline part of Validate setup (no network).
 */
export function checkCredentialFields(s: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
}): SetupCheck[] {
    const checks: SetupCheck[] = [];

    const clientId = s.clientId.trim();
    if (!clientId) {
        checks.push({
            level: "fail",
            label: "OAuth client ID missing — paste it from Google Cloud → Clients",
        });
    } else if (!isLikelyClientId(clientId)) {
        checks.push({
            level: "warn",
            label: "OAuth client ID looks unusual — it should end in .apps.googleusercontent.com",
        });
    } else {
        checks.push({ level: "ok", label: "OAuth client ID set" });
    }

    checks.push(
        s.clientSecret.trim()
            ? { level: "ok", label: "OAuth client secret set" }
            : {
                  level: "fail",
                  label: "OAuth client secret missing — copy it from the same OAuth client",
              },
    );

    const redirect = s.redirectUri.trim();
    if (!redirect) {
        checks.push({
            level: "fail",
            label: "Redirect bridge URL missing — host the bridge page and paste its URL",
        });
    } else if (!redirect.startsWith("https://")) {
        checks.push({
            level: "warn",
            label: "Redirect bridge URL should start with https:// (Google requires it)",
        });
    } else {
        checks.push({ level: "ok", label: "Redirect bridge URL set" });
    }

    return checks;
}
