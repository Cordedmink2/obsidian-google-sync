import { describe, it } from "mocha";
import { expect } from "chai";
import { HttpResponse, parseRetryAfter, withRetry } from "../../src/google/http";

function resp(status: number, headers: Record<string, string> = {}): HttpResponse {
    return { status, headers, text: "", json: undefined };
}

// No-op sleep that records how many times (and how long) we backed off.
function recordingSleep() {
    const delays: number[] = [];
    return {
        delays,
        sleep: async (ms: number) => {
            delays.push(ms);
        },
    };
}

const noJitter = () => 0;

describe("parseRetryAfter", () => {
    it("parses delta-seconds", () => {
        expect(parseRetryAfter({ "retry-after": "2" })).to.equal(2000);
    });
    it("parses an HTTP-date relative to now", () => {
        const now = Date.parse("2026-01-01T00:00:00Z");
        const at = new Date(now + 5000).toUTCString();
        expect(parseRetryAfter({ "retry-after": at }, now)).to.be.closeTo(5000, 1000);
    });
    it("returns undefined when absent", () => {
        expect(parseRetryAfter({})).to.equal(undefined);
    });
});

describe("withRetry", () => {
    it("returns immediately on success without sleeping", async () => {
        const { delays, sleep } = recordingSleep();
        const res = await withRetry(async () => resp(200), { sleep, random: noJitter });
        expect(res.status).to.equal(200);
        expect(delays).to.have.length(0);
    });

    it("does not retry a non-429 4xx", async () => {
        const { delays, sleep } = recordingSleep();
        let calls = 0;
        const res = await withRetry(
            async () => {
                calls++;
                return resp(404);
            },
            { sleep, random: noJitter },
        );
        expect(res.status).to.equal(404);
        expect(calls).to.equal(1);
        expect(delays).to.have.length(0);
    });

    it("retries on 429 then succeeds", async () => {
        const { delays, sleep } = recordingSleep();
        const statuses = [429, 429, 200];
        let i = 0;
        const res = await withRetry(async () => resp(statuses[i++] ?? 200), {
            sleep,
            random: noJitter,
        });
        expect(res.status).to.equal(200);
        expect(delays).to.have.length(2);
    });

    it("honors Retry-After over computed backoff", async () => {
        const { delays, sleep } = recordingSleep();
        const seq = [resp(429, { "retry-after": "3" }), resp(200)];
        let i = 0;
        await withRetry(async () => seq[i++] ?? resp(200), {
            sleep,
            random: noJitter,
            baseDelayMs: 500,
        });
        expect(delays[0]).to.equal(3000);
    });

    it("retries on 5xx and gives up returning the last response", async () => {
        const { delays, sleep } = recordingSleep();
        let calls = 0;
        const res = await withRetry(
            async () => {
                calls++;
                return resp(503);
            },
            { sleep, random: noJitter, retries: 2 },
        );
        expect(res.status).to.equal(503);
        expect(calls).to.equal(3); // initial + 2 retries
        expect(delays).to.have.length(2);
    });

    it("retries thrown network errors then succeeds", async () => {
        const { delays, sleep } = recordingSleep();
        let i = 0;
        const res = await withRetry(
            async () => {
                if (i++ === 0) throw new Error("network down");
                return resp(200);
            },
            { sleep, random: noJitter },
        );
        expect(res.status).to.equal(200);
        expect(delays).to.have.length(1);
    });

    it("rethrows the last error if every attempt throws", async () => {
        const { sleep } = recordingSleep();
        let err: unknown;
        try {
            await withRetry(
                async () => {
                    throw new Error("always down");
                },
                { sleep, random: noJitter, retries: 1 },
            );
        } catch (e) {
            err = e;
        }
        expect(err).to.be.instanceOf(Error);
        expect((err as Error).message).to.equal("always down");
    });

    it("requires an injected sleep outside Obsidian when a retry is needed", async () => {
        let err: unknown;
        try {
            await withRetry(async () => resp(429), {
                retries: 1,
                baseDelayMs: 0,
                maxDelayMs: 0,
                random: noJitter,
            });
        } catch (e) {
            err = e;
        }
        expect(err).to.be.instanceOf(Error);
        expect((err as Error).message).to.contain("pass RetryOptions.sleep");
    });
});
