/**
 * Preload for smoke-testing the headless bundle without real network:
 *   node --require ./scripts/headless-mock-fetch.cjs dist/headless/sync.cjs --config ...
 * Serves a tiny fake Google API from globalThis.fetch.
 */
const calls = [];

globalThis.fetch = async (url, init = {}) => {
    const method = init.method || "GET";
    calls.push({ method, url: String(url), body: init.body });
    const json = (body, status = 200) =>
        new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
        });

    const u = String(url);
    if (method === "GET" && u.includes("/calendars/primary/events") && !u.match(/events\/[^?]+$/)) {
        // Fixed timestamps so repeated runs are byte-identical (idempotence assertions).
        const day = 24 * 3600_000;
        const base = new Date(Math.floor(Date.now() / day) * day + 30 * day);
        return json({
            items: [
                {
                    id: "smoke-ev-1",
                    summary: "Smoke meeting",
                    start: { dateTime: base.toISOString() },
                    end: { dateTime: new Date(base.getTime() + 3600_000).toISOString() },
                },
            ],
        });
    }
    if (method === "GET" && u.match(/\/calendars\/[^/]+\/events\/smoke-ev-gone/)) {
        return json({ error: { message: "Not Found" } }, 404);
    }
    if (method === "GET" && u.includes("/lists/") && u.includes("/tasks") && !u.match(/tasks\/[^?]+$/)) {
        // Day-quantized future due date: stable within a day (idempotence assertions),
        // never in the past (a past due would file the note to overdue/ mid-test).
        const day = 24 * 3600_000;
        const due = new Date(Math.floor(Date.now() / day) * day + 30 * day);
        return json({
            items: [
                {
                    id: "smoke-task-1",
                    title: "Smoke task",
                    status: "needsAction",
                    due: due.toISOString(),
                },
            ],
        });
    }
    if (method === "PATCH") return json({ id: "patched", ...JSON.parse(init.body || "{}") });
    if (method === "POST" && u.includes("oauth2"))
        return json({ access_token: "fresh", expires_in: 3600, refresh_token: "rt" });
    if (method === "POST") {
        // Echo the body back (like Google does) so CLI smoke tests can assert the mapping.
        const echoed = init.body ? JSON.parse(init.body) : {};
        const meet = u.includes("conferenceDataVersion=")
            ? { hangoutLink: "https://meet.google.com/mock-link" }
            : {};
        return json({ id: "created-1", ...echoed, ...meet });
    }
    return json({});
};
