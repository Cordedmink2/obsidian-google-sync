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
            return ok({
                items: [
                    { id: "primary", primary: true },
                    { id: "secondary", summary: "Secondary calendar" },
                ],
            });
        if (method === "GET" && req.url.includes("/calendars/primary/events"))
            return ok({
                items: [
                    {
                        id: "import-event-1",
                        summary: "Imported appointment",
                        start: {
                            dateTime: "2026-06-02T09:00:00+12:00",
                            timeZone: "Pacific/Auckland",
                        },
                        end: {
                            dateTime: "2026-06-02T10:00:00+12:00",
                            timeZone: "Pacific/Auckland",
                        },
                    },
                    {
                        id: "past-import-event-1",
                        summary: "Past imported appointment",
                        start: {
                            dateTime: "2026-01-02T09:00:00+13:00",
                            timeZone: "Pacific/Auckland",
                        },
                        end: {
                            dateTime: "2026-01-02T10:00:00+13:00",
                            timeZone: "Pacific/Auckland",
                        },
                    },
                ],
                nextSyncToken: "sync-token",
            });
        if (method === "GET" && req.url.includes("/calendars/secondary/events"))
            return ok({
                items: [
                    {
                        id: "secondary-event-1",
                        summary: "Secondary appointment",
                        start: {
                            dateTime: "2026-06-03T09:00:00+12:00",
                            timeZone: "Pacific/Auckland",
                        },
                        end: {
                            dateTime: "2026-06-03T10:00:00+12:00",
                            timeZone: "Pacific/Auckland",
                        },
                    },
                ],
            });
        if (req.url.includes("/users/@me/lists"))
            return ok({
                items: [
                    { id: "@default", title: "My Tasks" },
                    { id: "L1", title: "Test list" },
                ],
            });
        if (method === "GET" && req.url.includes("/lists/%40default/tasks"))
            return ok({
                items: [
                    {
                        id: "default-import-task-1",
                        title: "Default list task",
                        due: "2026-06-01T00:00:00.000Z",
                        status: "needsAction",
                    },
                ],
            });
        if (method === "GET" && req.url.includes("/lists/L1/tasks"))
            return ok({
                items: [
                    {
                        id: "import-task-1",
                        title: "Imported task",
                        due: "2026-06-01T00:00:00.000Z",
                        status: "needsAction",
                    },
                    {
                        id: "late-import-task-1",
                        title: "Late imported task",
                        due: "2026-01-01T00:00:00.000Z",
                        status: "needsAction",
                    },
                ],
            });
        if (req.url.includes("oauth2.googleapis.com/token"))
            return ok({ access_token: "e2e", expires_in: 3600, refresh_token: "rt" });
        if (req.url.includes("conferenceDataVersion=") && (method === "POST" || method === "PATCH"))
            return ok({ id: `mock-${++seq}`, hangoutLink: "https://meet.google.com/e2e-link" });
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
        settings: Record<string, unknown>;
        saveSettings(): Promise<void>;
        e2eSeedToken(): Promise<void>;
    };
    await plugin.e2eSeedToken();
    plugin.settings.clientId = "e2e-client";
    plugin.settings.clientSecret = "e2e-secret";
    plugin.settings.redirectUri = "https://bridge.example/callback";
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
