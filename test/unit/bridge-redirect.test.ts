import { describe, it } from "mocha";
import { expect } from "chai";
import { computeBridgeRedirect } from "../../bridge/redirect.js";

describe("bridge redirect", () => {
    it("forwards code+state to obsidian://google-sync", () => {
        const r = computeBridgeRedirect("?code=abc123&state=xyz789");
        expect(r.target).to.equal("obsidian://google-sync?code=abc123&state=xyz789");
    });

    it("percent-encodes code and state so reserved chars survive the obsidian:// hop", () => {
        const r = computeBridgeRedirect("?code=a/b%2Bc&state=hello%20world");
        expect(r.target).to.equal(
            "obsidian://google-sync?code=" +
                encodeURIComponent("a/b+c") +
                "&state=" +
                encodeURIComponent("hello world"),
        );
    });

    it("forwards error param verbatim (encoded) when Google returns an error", () => {
        const r = computeBridgeRedirect("?error=access_denied");
        expect(r.target).to.equal("obsidian://google-sync?error=access_denied");
    });

    it("prefers error over a partially-populated code/state response", () => {
        const r = computeBridgeRedirect("?error=invalid_scope&code=ignored");
        expect(r.target).to.equal("obsidian://google-sync?error=invalid_scope");
    });

    it("returns null target + user-facing message when no params are present", () => {
        const r = computeBridgeRedirect("");
        expect(r.target).to.equal(null);
        if (r.target === null) {
            expect(r.message).to.match(/missing authorization code/i);
        }
    });

    it("returns null target when state is missing (code alone is unusable)", () => {
        const r = computeBridgeRedirect("?code=abc");
        expect(r.target).to.equal(null);
    });

    it("returns null target when code is missing", () => {
        const r = computeBridgeRedirect("?state=xyz");
        expect(r.target).to.equal(null);
    });

    it("tolerates null/undefined input (callers may forget the leading '?')", () => {
        expect(computeBridgeRedirect(null).target).to.equal(null);
        expect(computeBridgeRedirect(undefined).target).to.equal(null);
        expect(computeBridgeRedirect("code=a&state=b").target).to.equal(
            "obsidian://google-sync?code=a&state=b",
        );
    });
});
