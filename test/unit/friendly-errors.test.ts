import { describe, it } from "mocha";
import { expect } from "chai";
import { GoogleApiError } from "../../src/google/api";
import { describeGoogleError } from "../../src/google/friendly-errors";

const err = (status: number) =>
    new GoogleApiError(status, `GET https://www.googleapis.com/calendar/v3/x?y=1 -> ${status}`);

describe("describeGoogleError (no raw HTTP in notices)", () => {
    it("401 tells the user to reconnect", () => {
        const m = describeGoogleError(err(401));
        expect(m).to.contain("401");
        expect(m).to.match(/Connect to Google/);
        expect(m).to.not.match(/https?:|GET /);
    });
    it("403 points at APIs and scopes", () => {
        expect(describeGoogleError(err(403))).to.match(/403.*(API|scope)/);
    });
    it("429 says to wait", () => {
        expect(describeGoogleError(err(429))).to.match(/429.*(wait|rate)/i);
    });
    it("5xx says Google is unavailable and to retry", () => {
        const m = describeGoogleError(err(503));
        expect(m).to.contain("503");
        expect(m).to.match(/unavailable/);
        expect(m).to.match(/try again/i);
        expect(m).to.not.match(/https?:|GET /);
    });
    it("a 2xx with an unreadable body says the response was malformed", () => {
        const m = describeGoogleError(
            new GoogleApiError(
                200,
                "GET https://x -> 200 but the response body was empty or malformed (unreadable JSON)",
            ),
        );
        expect(m).to.match(/malformed/);
        expect(m).to.not.match(/https?:|GET /);
    });
    it("other statuses still never print a URL", () => {
        expect(describeGoogleError(err(418))).to.not.match(/https?:|GET /);
    });
    it("passes ordinary errors through unchanged", () => {
        expect(describeGoogleError(new Error("Google session expired"))).to.equal(
            "Google session expired",
        );
    });
});
