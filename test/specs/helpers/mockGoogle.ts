import { browser } from "@wdio/globals";
import { createGoogleMock, MockCall, MockErrorRule, MockFixture } from "./mockEngine";
import { defaultFixture } from "./fixtures";
import "./invariantHook";

export type { MockCall, MockErrorRule, MockFixture };

/**
 * Installs the stateful fake Google (see mockEngine.ts) at window.__gsyncHttp. Two logs:
 *   __gsyncCalls  - resettable, for per-test assertions;
 *   __gsyncAudit  - append-only, read by the global invariant hook (invariantHook.ts).
 * Self-contained when serialized into the renderer: only its arguments are used.
 */
function install(_ctx: unknown, engineSource: string, fixtureJson: string): void {
    const w = window as unknown as Record<string, unknown>;
    // tsx may emit keepNames helpers inside the serialized engine source.
    if (typeof w.__name !== "function") w.__name = (f: unknown) => f;
    // Test-only: evaluates our own mock engine source (mockEngine.ts) inside the renderer.
    /* eslint-disable @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call */
    const create = new Function(`return (${engineSource})`)() as (f: unknown) => {
        http: (r: { url: string; method?: string; body?: string }) => Promise<unknown>;
        unknown: MockCall[];
        state: unknown;
    };
    const mock = create(JSON.parse(fixtureJson));
    /* eslint-enable @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call */
    const calls: MockCall[] = [];
    const audit: MockCall[] = [];
    w.__gsyncE2E = true;
    w.__gsyncCalls = calls;
    w.__gsyncAudit = audit;
    w.__gsyncAuditCursor = 0;
    w.__gsyncUnknown = mock.unknown;
    w.__gsyncUnknownCursor = 0;
    w.__gsyncMock = mock;
    w.__gsyncHttp = (req: { url: string; method?: string; body?: string }) => {
        const entry = { method: (req.method ?? "GET").toUpperCase(), url: req.url, body: req.body };
        calls.push(entry);
        audit.push(entry);
        return mock.http(req);
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
export async function setupGoogleSyncMock(fixture?: MockFixture): Promise<void> {
    const fx = fixture ?? defaultFixture(new Date());
    await browser.executeObsidian(install, createGoogleMock.toString(), JSON.stringify(fx));
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

/** Mark an event as removed from Google: GET answers 404 or 410. */
export async function removeEventInGoogle(
    calendarId: string,
    id: string,
    status: 404 | 410 = 410,
): Promise<void> {
    await browser.executeObsidian(
        (_c, cal: string, eid: string, st: number) => {
            const mock = (window as unknown as { __gsyncMock: { state: MockFixture } }).__gsyncMock;
            mock.state.removedEvents = {
                ...(mock.state.removedEvents ?? {}),
                [`${cal}/${eid}`]: st,
            };
        },
        calendarId,
        id,
        status,
    );
}

/** Replace an event in Google with a cancelled stub (what showDeleted listings return). */
export async function cancelEventInGoogle(calendarId: string, id: string): Promise<void> {
    await browser.executeObsidian(
        (_c, cal: string, eid: string) => {
            const mock = (window as unknown as { __gsyncMock: { state: MockFixture } }).__gsyncMock;
            const list = mock.state.events[cal] ?? [];
            const i = list.findIndex((e) => e.id === eid);
            const stub = { kind: "calendar#event", id: eid, status: "cancelled" };
            if (i >= 0) list[i] = stub;
            else list.push(stub);
        },
        calendarId,
        id,
    );
}

/** Mark a task deleted in Google (`deleted: true`; hidden from the listing, GET still answers). */
export async function deleteTaskInGoogle(listId: string, id: string): Promise<void> {
    await browser.executeObsidian(
        (_c, list: string, tid: string) => {
            const mock = (window as unknown as { __gsyncMock: { state: MockFixture } }).__gsyncMock;
            const t = (mock.state.tasks[list] ?? []).find((x) => x.id === tid);
            if (t) t.deleted = true;
        },
        listId,
        id,
    );
}

/** Task is removed entirely: GET answers 404 or 410. */
export async function removeTaskInGoogle(
    listId: string,
    id: string,
    status: 404 | 410 = 404,
): Promise<void> {
    await browser.executeObsidian(
        (_c, list: string, tid: string, st: number) => {
            const mock = (window as unknown as { __gsyncMock: { state: MockFixture } }).__gsyncMock;
            mock.state.removedTasks = {
                ...(mock.state.removedTasks ?? {}),
                [`${list}/${tid}`]: st,
            };
        },
        listId,
        id,
        status,
    );
}

export async function setMockErrors(rules: MockErrorRule[]): Promise<void> {
    await browser.executeObsidian((_c, json: string) => {
        const mock = (window as unknown as { __gsyncMock: { state: MockFixture } }).__gsyncMock;
        mock.state.errors = JSON.parse(json) as MockErrorRule[];
    }, JSON.stringify(rules));
}
