import { browser } from "@wdio/globals";
import { afterEach } from "mocha";
import { assertTrafficInvariants } from "./invariants";
import type { MockCall } from "./mockEngine";

/**
 * D3: global E2E invariant. Every spec imports this file for its side effect, which
 * registers a root-level afterEach. After every test, the append-only audit log of mock
 * traffic (which specs cannot reset) is checked for forbidden calls (any DELETE, any POST
 * other than the token endpoint and Tasks /move) and for requests to routes the mock does
 * not know. A violation fails the test that caused it, on desktop and emulated mobile.
 */
afterEach(async function () {
    const traffic = await browser.executeObsidian(() => {
        const w = window as unknown as {
            __gsyncAudit?: MockCall[];
            __gsyncAuditCursor?: number;
            __gsyncUnknown?: MockCall[];
            __gsyncUnknownCursor?: number;
        };
        const audit = w.__gsyncAudit ?? [];
        const unknown = w.__gsyncUnknown ?? [];
        const from = w.__gsyncAuditCursor ?? 0;
        const ufrom = w.__gsyncUnknownCursor ?? 0;
        w.__gsyncAuditCursor = audit.length;
        w.__gsyncUnknownCursor = unknown.length;
        return { calls: audit.slice(from), unknown: unknown.slice(ufrom) };
    });
    assertTrafficInvariants(traffic.calls, traffic.unknown);
});
