import { describe, it } from "mocha";
import { expect } from "chai";
import {
    CALENDAR_SCOPE,
    GoogleAuth,
    OAuthConfig,
    TASKS_SCOPE,
    TokenSet,
    TokenStore,
    buildAuthUrl,
    codeChallenge,
    exchangeCode,
    generateCodeVerifier,
    refreshAccessToken,
} from "../../src/google/auth";
import { fakeHttp, jsonResp, noWaitRetry } from "./helpers/fakeHttp";

const config: OAuthConfig = {
    clientId: "cid",
    clientSecret: "secret",
    redirectUri: "https://bridge.example/callback",
    scopes: [CALENDAR_SCOPE, TASKS_SCOPE],
};

function memStore(initial: TokenSet | null = null) {
    let current = initial;
    const store: TokenStore = {
        load: async () => current,
        save: async (t) => {
            current = t;
        },
    };
    return { store, get: () => current };
}

describe("PKCE", () => {
    it("matches the RFC 7636 challenge vector", async () => {
        const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        expect(await codeChallenge(verifier)).to.equal(
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        );
    });

    it("generates a 43-char url-safe verifier", () => {
        const v = generateCodeVerifier();
        expect(v).to.have.length(43);
        expect(v).to.match(/^[A-Za-z0-9\-_]+$/);
    });

    it("builds an auth URL with the expected params", async () => {
        const url = new URL(await buildAuthUrl(config, "verifier123", "state456"));
        const p = url.searchParams;
        expect(p.get("client_id")).to.equal("cid");
        expect(p.get("redirect_uri")).to.equal("https://bridge.example/callback");
        expect(p.get("response_type")).to.equal("code");
        expect(p.get("code_challenge_method")).to.equal("S256");
        expect(p.get("access_type")).to.equal("offline");
        expect(p.get("state")).to.equal("state456");
        expect(p.get("scope")).to.contain("calendar");
    });
});

describe("token exchange", () => {
    it("exchanges an auth code for tokens", async () => {
        const { calls, fn } = fakeHttp([
            jsonResp(200, { access_token: "at", expires_in: 3600, refresh_token: "rt" }),
        ]);
        const tokens = await exchangeCode(
            fn,
            config,
            "the-code",
            "the-verifier",
            () => 1000,
            noWaitRetry,
        );
        expect(tokens.accessToken).to.equal("at");
        expect(tokens.refreshToken).to.equal("rt");
        expect(tokens.expiresAt).to.equal(1000 + 3600 * 1000);

        const body = new URLSearchParams(calls[0]?.body ?? "");
        expect(body.get("grant_type")).to.equal("authorization_code");
        expect(body.get("code")).to.equal("the-code");
        expect(body.get("code_verifier")).to.equal("the-verifier");
        expect(body.get("client_secret")).to.equal("secret");
        expect(calls[0]?.contentType).to.equal("application/x-www-form-urlencoded");
    });

    it("keeps the old refresh token when refresh response omits one", async () => {
        const { fn } = fakeHttp([jsonResp(200, { access_token: "at2", expires_in: 3600 })]);
        const tokens = await refreshAccessToken(fn, config, "old-rt", () => 0, noWaitRetry);
        expect(tokens.accessToken).to.equal("at2");
        expect(tokens.refreshToken).to.equal("old-rt");
    });
});

describe("GoogleAuth", () => {
    it("returns a still-valid token without hitting the network", async () => {
        const { store } = memStore({
            accessToken: "good",
            expiresAt: 10 * 60_000,
            refreshToken: "rt",
        });
        const { calls, fn } = fakeHttp([]);
        const auth = new GoogleAuth(
            fn,
            () => config,
            store,
            () => 0,
            noWaitRetry,
        );
        expect(await auth.getAccessToken()).to.equal("good");
        expect(calls).to.have.length(0);
    });

    it("refreshes an expired token and persists the result", async () => {
        const mem = memStore({ accessToken: "old", expiresAt: 0, refreshToken: "rt" });
        const { fn } = fakeHttp([jsonResp(200, { access_token: "fresh", expires_in: 3600 })]);
        const auth = new GoogleAuth(
            fn,
            () => config,
            mem.store,
            () => 1_000_000,
            noWaitRetry,
        );
        expect(await auth.getAccessToken()).to.equal("fresh");
        expect(mem.get()?.accessToken).to.equal("fresh");
    });

    it("throws when not connected", async () => {
        const { store } = memStore(null);
        const { fn } = fakeHttp([]);
        const auth = new GoogleAuth(
            fn,
            () => config,
            store,
            () => 0,
            noWaitRetry,
        );
        let err: unknown;
        try {
            await auth.getAccessToken();
        } catch (e) {
            err = e;
        }
        expect(err).to.be.instanceOf(Error);
    });

    it("rejects a completeAuth with a mismatched state", async () => {
        const { store } = memStore(null);
        const { fn } = fakeHttp([jsonResp(200, { access_token: "at", expires_in: 3600 })]);
        const auth = new GoogleAuth(
            fn,
            () => config,
            store,
            () => 0,
            noWaitRetry,
        );
        await auth.beginAuth();
        let err: unknown;
        try {
            await auth.completeAuth("code", "wrong-state");
        } catch (e) {
            err = e;
        }
        expect(err).to.be.instanceOf(Error);
    });

    it("clears tokens and asks to reconnect when refresh fails", async () => {
        const mem = memStore({ accessToken: "old", expiresAt: 0, refreshToken: "revoked" });
        const { fn } = fakeHttp([jsonResp(400, { error: "invalid_grant" })]);
        const auth = new GoogleAuth(
            fn,
            () => config,
            mem.store,
            () => 1_000_000,
            noWaitRetry,
        );
        let err: unknown;
        try {
            await auth.getAccessToken();
        } catch (e) {
            err = e;
        }
        expect(err).to.be.instanceOf(Error);
        expect((err as Error).message).to.contain("reconnect");
        expect(mem.get()).to.equal(null);
    });

    it("prepare() builds a consent URL synchronously that completeAuth accepts", async () => {
        const mem = memStore(null);
        const { fn } = fakeHttp([jsonResp(200, { access_token: "at", expires_in: 3600 })]);
        const auth = new GoogleAuth(
            fn,
            () => config,
            mem.store,
            () => 0,
            noWaitRetry,
        );
        expect(auth.isPrepared()).to.equal(false);
        await auth.prepare();
        expect(auth.isPrepared()).to.equal(true);

        // Synchronous (no await) — this is what runs inside the iOS user-gesture.
        const { url, state } = auth.authUrlFromPrepared();
        expect(url).to.contain("code_challenge=");
        expect(url).to.contain("code_challenge_method=S256");
        expect(new URL(url).searchParams.get("state")).to.equal(state);

        // The PKCE verifier behind that challenge still completes the handshake.
        await auth.completeAuth("the-code", state);
        expect(mem.get()?.accessToken).to.equal("at");
    });

    it("prepare() is idempotent — a second call keeps the same state", async () => {
        const auth = new GoogleAuth(fakeHttp().fn, () => config, memStore().store, () => 0);
        await auth.prepare();
        const first = auth.authUrlFromPrepared().state;
        await auth.prepare();
        expect(auth.authUrlFromPrepared().state).to.equal(first);
    });

    it("authUrlFromPrepared() throws when nothing was prepared", () => {
        const auth = new GoogleAuth(fakeHttp().fn, () => config, memStore().store, () => 0);
        expect(() => auth.authUrlFromPrepared()).to.throw(/prepared/i);
    });

    it("completes auth and stores tokens on matching state", async () => {
        const mem = memStore(null);
        const { fn } = fakeHttp([
            jsonResp(200, { access_token: "at", expires_in: 3600, refresh_token: "rt" }),
        ]);
        const auth = new GoogleAuth(
            fn,
            () => config,
            mem.store,
            () => 0,
            noWaitRetry,
        );
        const { state } = await auth.beginAuth();
        await auth.completeAuth("the-code", state);
        expect(mem.get()?.accessToken).to.equal("at");
        expect(await auth.isConnected()).to.equal(true);
    });
});
