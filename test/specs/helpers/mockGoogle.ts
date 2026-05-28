import { browser } from "@wdio/globals";

export interface MockCall {
    method: string;
    url: string;
    body?: string;
}

/**
 * Self-contained (serialized into the Obsidian renderer): installs a recording fake
 * transport at window.__gsyncHttp + an e2e flag. The plugin's late-bound transport picks
 * it up, so no real network happens. All references are local — no imports.
 */
function install(): void {
    const w = window as unknown as {
        __gsyncE2E?: boolean;
        __gsyncHttp?: unknown;
        __gsyncCalls?: MockCall[];
    };
    const calls: MockCall[] = [];
    let seq = 0;
    w.__gsyncE2E = true;
    w.__gsyncCalls = calls;
    w.__gsyncHttp = (req: { url: string; method?: string; body?: string }) => {
        const method = req.method ?? "GET";
        calls.push({ method, url: req.url, body: req.body });
        const headers: Record<string, string> = {};
        const ok = (json: unknown, status = 200) =>
            Promise.resolve({ status, headers, text: JSON.stringify(json), json });
        if (method === "DELETE")
            return Promise.resolve({ status: 204, headers, text: "", json: undefined });
        if (req.url.includes("/calendarList"))
            return ok({ items: [{ id: "primary", primary: true }] });
        if (req.url.includes("oauth2.googleapis.com/token"))
            return ok({ access_token: "e2e", expires_in: 3600, refresh_token: "rt" });
        if (method === "POST") return ok({ id: `mock-${++seq}` });
        if (method === "PATCH") return ok({ id: "patched" });
        return ok({});
    };
}

/** Runs in the renderer: seed a fake token + set a task list so sync is enabled. */
async function seedAndConfigure({ app }: { app: unknown }): Promise<void> {
    const plugin = (app as { plugins: { plugins: Record<string, unknown> } }).plugins.plugins[
        "google-sync"
    ] as {
        settings: { taskListId: string };
        saveSettings(): Promise<void>;
        e2eSeedToken(): Promise<void>;
    };
    await plugin.e2eSeedToken();
    plugin.settings.taskListId = "L1";
    await plugin.saveSettings();
}

/** Install the mock, seed a token, and configure the plugin for e2e. */
export async function setupGoogleSyncMock(): Promise<void> {
    await browser.executeObsidian(install);
    await browser.executeObsidian(seedAndConfigure);
}

export async function getMockCalls(): Promise<MockCall[]> {
    return browser.executeObsidian(
        () => (window as unknown as { __gsyncCalls?: MockCall[] }).__gsyncCalls ?? [],
    );
}

export async function resetMockCalls(): Promise<void> {
    await browser.executeObsidian(() => {
        const calls = (window as unknown as { __gsyncCalls?: MockCall[] }).__gsyncCalls;
        if (calls) calls.length = 0;
    });
}
