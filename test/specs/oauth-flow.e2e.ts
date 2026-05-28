import { browser, expect } from "@wdio/globals";
import { before, describe, it } from "mocha";
import { setupGoogleSyncMock } from "./helpers/mockGoogle";

/**
 * End-to-end OAuth happy path: connect() builds the auth URL, the bridge would
 * normally hand back code+state via obsidian://google-sync, and the plugin's
 * protocol handler should exchange the code for a token.
 *
 * We simulate the browser hop by capturing the state from window.open(authUrl)
 * and calling the plugin's protocol handler directly with a fake code + the
 * captured state. The mock HTTP transport returns a valid token response.
 *
 * This closes the last untested user-facing code path between
 *   Connect to Google → bridge → onOAuthCallback → tokens saved.
 */

interface PluginShape {
    settings: { clientId: string; clientSecret: string; redirectUri: string };
    saveSettings(): Promise<void>;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    isConnectedSync(): boolean;
    onOAuthCallback(params: Record<string, string>): Promise<void>;
}

describe("OAuth callback flow (mocked Google)", function () {
    this.timeout(20 * 1000);

    before(async () => {
        await setupGoogleSyncMock();
    });

    it("connect() → protocol handler with matching state → tokens persisted", async () => {
        const r = await browser.executeObsidian(async ({ app }) => {
            const plugin = (
                app as unknown as {
                    plugins: { plugins: Record<string, PluginShape> };
                }
            ).plugins.plugins["google-sync"];
            if (!plugin) return { ok: false as const, reason: "no plugin" };

            // Start from a known-disconnected state so the assertion is meaningful.
            await plugin.disconnect();

            // Capture the URL connect() opens in the browser — that contains the state
            // we'd see in Google's redirect.
            const origOpen = window.open.bind(window);
            let capturedUrl: string | null = null;
            window.open = (url?: string | URL | null) => {
                if (url) capturedUrl = String(url);
                return null;
            };
            try {
                await plugin.connect();
            } finally {
                window.open = origOpen;
            }
            if (!capturedUrl) return { ok: false as const, reason: "connect() did not call window.open" };

            const u = new URL(capturedUrl);
            const state = u.searchParams.get("state");
            const clientId = u.searchParams.get("client_id");
            if (!state) return { ok: false as const, reason: "auth URL missing state" };

            // Hand the plugin's protocol handler a matching code+state — same shape
            // bridge/index.html would forward via obsidian://google-sync.
            await plugin.onOAuthCallback({ code: "test-auth-code-xyz", state });

            // Verify the token exchange happened against the mock + tokens are saved.
            const calls = (
                window as unknown as { __gsyncCalls?: { method: string; url: string }[] }
            ).__gsyncCalls;
            const tokenCall = calls?.find((c) =>
                c.url.includes("oauth2.googleapis.com/token"),
            );
            return {
                ok: true as const,
                clientId,
                connected: plugin.isConnectedSync(),
                tokenCallSeen: !!tokenCall,
                tokenCallMethod: tokenCall?.method,
            };
        });

        if (!r.ok) throw new Error(`oauth flow: ${r.reason}`);
        expect(r.connected).toBe(true);
        expect(r.tokenCallSeen).toBe(true);
        expect(r.tokenCallMethod).toBe("POST");
        expect(r.clientId).toBe("e2e-client");
    });

    it("protocol handler rejects a mismatched state (CSRF guard)", async () => {
        const r = await browser.executeObsidian(async ({ app }) => {
            const plugin = (
                app as unknown as {
                    plugins: { plugins: Record<string, PluginShape> };
                }
            ).plugins.plugins["google-sync"];
            if (!plugin) return { ok: false as const, reason: "no plugin" };

            await plugin.disconnect();
            const origOpen = window.open.bind(window);
            window.open = () => null;
            try {
                await plugin.connect();
            } finally {
                window.open = origOpen;
            }

            // Wrong state — completeAuth should refuse, no token saved.
            await plugin.onOAuthCallback({
                code: "test-auth-code-xyz",
                state: "wrong-state-attacker",
            });
            return { ok: true as const, connected: plugin.isConnectedSync() };
        });
        if (!r.ok) throw new Error(`csrf guard: ${r.reason}`);
        expect(r.connected).toBe(false);
    });

    it("protocol handler with error param does not silently grant a token", async () => {
        const r = await browser.executeObsidian(async ({ app }) => {
            const plugin = (
                app as unknown as {
                    plugins: { plugins: Record<string, PluginShape> };
                }
            ).plugins.plugins["google-sync"];
            if (!plugin) return { ok: false as const, reason: "no plugin" };

            await plugin.disconnect();
            await plugin.onOAuthCallback({ error: "access_denied" });
            return { ok: true as const, connected: plugin.isConnectedSync() };
        });
        if (!r.ok) throw new Error(`error param: ${r.reason}`);
        expect(r.connected).toBe(false);
    });
});
