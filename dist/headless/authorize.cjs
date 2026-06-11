#!/usr/bin/env node
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// headless/authorize.ts
var http = __toESM(require("node:http"));
var import_node_process = __toESM(require("node:process"));
var import_node_child_process = require("node:child_process");

// src/google/http.ts
function parseJson(text) {
  try {
    return text ? JSON.parse(text) : void 0;
  } catch {
    return void 0;
  }
}
function parseRetryAfter(headers, now = Date.now()) {
  const raw = headers["retry-after"] ?? headers["Retry-After"];
  if (!raw) return void 0;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1e3);
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return void 0;
}
async function withRetry(fn, opts = {}) {
  const retries = opts.retries ?? 4;
  const base = opts.baseDelayMs ?? 500;
  const max = opts.maxDelayMs ?? 16e3;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;
  let attempt = 0;
  for (; ; ) {
    let res;
    try {
      res = await fn();
      if (res.status !== 429 && res.status < 500) return res;
    } catch (err) {
      if (attempt >= retries) throw err;
    }
    if (res && attempt >= retries) return res;
    const backoff = Math.min(max, base * 2 ** attempt) + random() * base;
    const delay = res ? parseRetryAfter(res.headers) ?? backoff : backoff;
    await sleep(delay);
    attempt++;
  }
}

// src/google/api.ts
var GoogleApiError = class extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
    this.name = "GoogleApiError";
  }
};

// src/google/auth.ts
var AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
var TOKEN_URL = "https://oauth2.googleapis.com/token";
var CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
var TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";
var DEFAULT_SCOPES = [CALENDAR_SCOPE, TASKS_SCOPE];
function base64url(bytes) {
  const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = bytes[i] << 16 | bytes[i + 1] << 8 | bytes[i + 2];
    out += table[n >> 18 & 63];
    out += table[n >> 12 & 63];
    out += table[n >> 6 & 63];
    out += table[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += table[n >> 18 & 63];
    out += table[n >> 12 & 63];
  } else if (rem === 2) {
    const n = bytes[i] << 16 | bytes[i + 1] << 8;
    out += table[n >> 18 & 63];
    out += table[n >> 12 & 63];
    out += table[n >> 6 & 63];
  }
  return out;
}
function generateCodeVerifier() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}
function generateState() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}
async function codeChallenge(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}
function buildAuthUrlWithChallenge(config, challenge, state) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: config.scopes.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    prompt: "consent"
  });
  return `${AUTH_URL}?${params.toString()}`;
}
function toTokenSet(json, nowMs, fallbackRefresh) {
  const j = json ?? {};
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? fallbackRefresh,
    expiresAt: nowMs + (j.expires_in ?? 3600) * 1e3,
    scope: j.scope,
    tokenType: j.token_type
  };
}
async function postToken(http2, params, retry) {
  const res = await withRetry(
    () => http2({
      url: TOKEN_URL,
      method: "POST",
      contentType: "application/x-www-form-urlencoded",
      body: new URLSearchParams(params).toString()
    }),
    retry
  );
  if (res.status < 200 || res.status >= 300) {
    throw new GoogleApiError(
      res.status,
      `token endpoint -> ${res.status}`,
      res.json ?? res.text
    );
  }
  return res.json;
}
async function exchangeCode(http2, config, code, verifier, now = Date.now, retry = {}) {
  const json = await postToken(
    http2,
    {
      grant_type: "authorization_code",
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code_verifier: verifier
    },
    retry
  );
  return toTokenSet(json, now());
}
async function refreshAccessToken(http2, config, refreshToken, now = Date.now, retry = {}) {
  const json = await postToken(
    http2,
    {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret
    },
    retry
  );
  return toTokenSet(json, now(), refreshToken);
}
var EXPIRY_SKEW_MS = 6e4;
var GoogleAuth = class {
  constructor(http2, config, store, now = Date.now, retry = {}) {
    this.http = http2;
    this.config = config;
    this.store = store;
    this.now = now;
    this.retry = retry;
  }
  /** Build the consent URL and remember the PKCE verifier + state for completion. */
  async beginAuth() {
    const verifier = generateCodeVerifier();
    const state = generateState();
    const challenge = await codeChallenge(verifier);
    this.pending = { verifier, state, challenge };
    const url = buildAuthUrlWithChallenge(this.config(), challenge, state);
    return { url, state };
  }
  /**
   * Pre-compute PKCE material (the async part of beginAuth) so the consent URL
   * can later be built synchronously via {@link authUrlFromPrepared}. iOS only
   * honours window.open during the synchronous user-gesture stack, so the
   * settings tab calls this ahead of the click.
   */
  async prepare() {
    if (this.pending?.challenge) return;
    const verifier = generateCodeVerifier();
    const state = generateState();
    const challenge = await codeChallenge(verifier);
    if (this.pending?.challenge) return;
    this.pending = { verifier, state, challenge };
  }
  /** True once {@link prepare} has stashed a challenge ready for a sync open. */
  isPrepared() {
    return !!this.pending?.challenge;
  }
  /** Synchronously build the consent URL from prepared material. Gesture-safe. */
  authUrlFromPrepared() {
    if (!this.pending?.challenge) throw new Error("No prepared auth");
    const url = buildAuthUrlWithChallenge(
      this.config(),
      this.pending.challenge,
      this.pending.state
    );
    return { url, state: this.pending.state };
  }
  /** Called by the obsidian:// handler. Verifies state, exchanges code, persists tokens. */
  async completeAuth(code, state) {
    if (!this.pending) throw new Error("No auth in progress");
    if (state !== this.pending.state) throw new Error("OAuth state mismatch");
    const tokens = await exchangeCode(
      this.http,
      this.config(),
      code,
      this.pending.verifier,
      this.now,
      this.retry
    );
    this.pending = void 0;
    await this.store.save(tokens);
  }
  async isConnected() {
    const t = await this.store.load();
    return !!t?.refreshToken || !!t && t.expiresAt > this.now();
  }
  async signOut() {
    this.pending = void 0;
    await this.store.save(null);
  }
  /** Return a valid access token, refreshing when expired. Throws if not connected. */
  async getAccessToken() {
    const tokens = await this.store.load();
    if (!tokens) throw new Error("Not connected to Google");
    if (tokens.expiresAt - EXPIRY_SKEW_MS > this.now()) return tokens.accessToken;
    if (!tokens.refreshToken) {
      await this.store.save(null);
      throw new Error("Google session expired \u2014 reconnect via Connect to Google.");
    }
    let refreshed;
    try {
      refreshed = await refreshAccessToken(
        this.http,
        this.config(),
        tokens.refreshToken,
        this.now,
        this.retry
      );
    } catch (e) {
      await this.store.save(null);
      throw new Error(
        `Google session expired \u2014 reconnect via Connect to Google. (${e.message})`
      );
    }
    await this.store.save(refreshed);
    return refreshed.accessToken;
  }
};

// headless/transport.ts
var nodeFetchHttp = async (req) => {
  const headers = { ...req.headers ?? {} };
  if (req.contentType) headers["content-type"] = req.contentType;
  const res = await fetch(req.url, {
    method: req.method ?? "GET",
    headers,
    body: req.body
  });
  const text = await res.text();
  const outHeaders = {};
  res.headers.forEach((value, key) => {
    outHeaders[key] = value;
  });
  return { status: res.status, headers: outHeaders, text, json: parseJson(text) };
};

// headless/token-store.ts
var import_node_fs = require("node:fs");
var nodePath = __toESM(require("node:path"));
var FileTokenStore = class {
  constructor(file) {
    this.file = file;
  }
  async load() {
    try {
      const raw = await import_node_fs.promises.readFile(this.file, "utf8");
      return JSON.parse(raw);
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }
  async save(tokens) {
    if (!tokens) {
      await import_node_fs.promises.unlink(this.file).catch(() => void 0);
      return;
    }
    await import_node_fs.promises.mkdir(nodePath.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await import_node_fs.promises.writeFile(tmp, JSON.stringify(tokens, null, 2), { mode: 384 });
    await import_node_fs.promises.rename(tmp, this.file);
  }
};

// headless/config.ts
var import_node_fs2 = require("node:fs");
var nodePath2 = __toESM(require("node:path"));

// src/settings-data.ts
function systemTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
var DEFAULT_SETTINGS = {
  clientId: "",
  clientSecret: "",
  redirectUri: "",
  eventsFolder: "events",
  tasksFolder: "tasks",
  defaultCalendarId: "primary",
  taskListId: "@default",
  defaultTimezone: systemTimezone(),
  syncOnModify: true,
  maxPatchesPerRun: 10,
  importOnStartup: false,
  importOnlyDefaultCalendar: true,
  importOnlyDefaultTaskList: true,
  importPastDays: 7,
  importFutureDays: 90,
  recurringEventFilterMode: "allow",
  recurringEventFilters: [],
  autoArchiveEnabled: true,
  autoArchiveDaysPast: 1,
  autoCloseTasksOnArchive: true
};

// headless/config.ts
var DEFAULT_GIT = {
  enabled: true,
  remote: "origin",
  branch: "",
  authorName: "google-sync",
  authorEmail: "google-sync@localhost"
};
async function loadConfig(file, options = {}) {
  const requireVault = options.requireVault ?? true;
  const configDir = nodePath2.dirname(nodePath2.resolve(file));
  let raw;
  try {
    raw = JSON.parse(await import_node_fs2.promises.readFile(file, "utf8"));
  } catch (e) {
    throw new Error(`Could not read config ${file}: ${e.message}`);
  }
  if (requireVault && (typeof raw.vaultPath !== "string" || !raw.vaultPath)) {
    throw new Error(`Config ${file} must set "vaultPath"`);
  }
  const settings = {
    ...DEFAULT_SETTINGS,
    ...raw.settings ?? {}
  };
  if (process.env.GSYNC_CLIENT_SECRET) settings.clientSecret = process.env.GSYNC_CLIENT_SECRET;
  if (process.env.GSYNC_CLIENT_ID) settings.clientId = process.env.GSYNC_CLIENT_ID;
  const vaultPath = typeof raw.vaultPath === "string" && raw.vaultPath ? nodePath2.resolve(configDir, raw.vaultPath) : "";
  const tokenFile = nodePath2.resolve(
    configDir,
    typeof raw.tokenFile === "string" && raw.tokenFile ? raw.tokenFile : "gsync-tokens.json"
  );
  if (vaultPath && tokenFile.startsWith(vaultPath + nodePath2.sep)) {
    throw new Error(
      `tokenFile must live outside the vault (it would be committed and pushed): ${tokenFile}`
    );
  }
  const loopbackPort = Number(raw.loopbackPort ?? 8765);
  if (!Number.isInteger(loopbackPort) || loopbackPort < 1 || loopbackPort > 65535) {
    throw new Error(`Invalid loopbackPort: ${String(raw.loopbackPort)}`);
  }
  return {
    vaultPath,
    tokenFile,
    settings,
    git: { ...DEFAULT_GIT, ...raw.git ?? {} },
    loopbackPort
  };
}
async function readPluginData(dataJsonPath) {
  return JSON.parse(await import_node_fs2.promises.readFile(dataJsonPath, "utf8"));
}

// headless/authorize.ts
function parseArgs(argv) {
  const args = { config: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config") args.config = argv[++i] ?? "";
    else if (a === "--from-plugin-data") args.fromPluginData = argv[++i] ?? "";
    else if (a === "--help" || a === "-h") {
      console.log("usage: authorize --config <gsync.json> [--from-plugin-data <data.json>]");
      import_node_process.default.exit(0);
    } else {
      console.error(`unknown argument: ${a}`);
      import_node_process.default.exit(2);
    }
  }
  if (!args.config) {
    console.error("required: --config <gsync.json>");
    import_node_process.default.exit(2);
  }
  return args;
}
function tryOpenBrowser(url) {
  const cmd = import_node_process.default.platform === "darwin" ? ["open", url] : import_node_process.default.platform === "win32" ? ["cmd", "/c", "start", "", url.replace(/&/g, "^&")] : ["xdg-open", url];
  try {
    (0, import_node_child_process.spawn)(cmd[0], cmd.slice(1), { stdio: "ignore", detached: true }).unref();
  } catch {
  }
}
async function main() {
  const args = parseArgs(import_node_process.default.argv.slice(2));
  const config = await loadConfig(args.config, { requireVault: false });
  const store = new FileTokenStore(config.tokenFile);
  if (args.fromPluginData) {
    const data = await readPluginData(args.fromPluginData);
    if (!data.tokens?.refreshToken) {
      console.error(
        "The plugin data.json has no refresh token \u2014 connect the plugin first, or use the browser flow."
      );
      return 1;
    }
    await store.save(data.tokens);
    console.log(`Tokens copied to ${config.tokenFile}`);
    return 0;
  }
  if (!config.settings.clientId || !config.settings.clientSecret) {
    console.error(
      "Set settings.clientId and settings.clientSecret in the config (or GSYNC_CLIENT_ID/GSYNC_CLIENT_SECRET)."
    );
    return 1;
  }
  const redirectUri = `http://127.0.0.1:${config.loopbackPort}/callback`;
  const auth = new GoogleAuth(
    nodeFetchHttp,
    () => ({
      clientId: config.settings.clientId,
      clientSecret: config.settings.clientSecret,
      redirectUri,
      scopes: DEFAULT_SCOPES
    }),
    store
  );
  const { url } = await auth.beginAuth();
  const done = new Promise((resolve2) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url ?? "/", `http://127.0.0.1:${config.loopbackPort}`);
      if (reqUrl.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const finish = (status, message, code2) => {
        res.writeHead(status, { "content-type": "text/html" });
        res.end(`<html><body><p>${message}</p></body></html>`);
        server.close(() => resolve2(code2));
      };
      const error = reqUrl.searchParams.get("error");
      const code = reqUrl.searchParams.get("code");
      const state = reqUrl.searchParams.get("state");
      if (error) {
        console.error(`Google returned an error: ${error}`);
        finish(400, "Authorization failed \u2014 you can close this tab.", 1);
        return;
      }
      if (!code || !state) {
        finish(400, "Missing code/state \u2014 you can close this tab.", 1);
        return;
      }
      auth.completeAuth(code, state).then(() => {
        console.log(`Authorized. Tokens written to ${config.tokenFile}`);
        console.log(
          "If the sync runs on another machine, copy that file there (chmod 600)."
        );
        finish(200, "Connected \u2014 you can close this tab and return to the terminal.", 0);
      }).catch((e) => {
        console.error(`Token exchange failed: ${e.message}`);
        finish(500, "Token exchange failed \u2014 see the terminal.", 1);
      });
    });
    server.listen(config.loopbackPort, "127.0.0.1", () => {
      console.log(`Listening on ${redirectUri}`);
      console.log(
        `
Make sure ${redirectUri} is registered as a redirect URI on your Google OAuth client, then open:

${url}
`
      );
      tryOpenBrowser(url);
    });
    setTimeout(
      () => {
        console.error("Timed out after 10 minutes.");
        server.close(() => resolve2(1));
      },
      10 * 60 * 1e3
    ).unref();
  });
  return done;
}
main().then((code) => import_node_process.default.exit(code)).catch((e) => {
  console.error(`fatal: ${e.stack ?? String(e)}`);
  import_node_process.default.exit(1);
});
