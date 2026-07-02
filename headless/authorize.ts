import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as nodeSleep } from "node:timers/promises";
import { DEFAULT_SCOPES, GoogleAuth } from "../src/google/auth";
import { nodeFetchHttp } from "./transport";
import { FileTokenStore } from "./token-store";
import { loadConfig, readPluginData } from "./config";

/**
 * One-time interactive OAuth bootstrap for the headless sync.
 *
 *   node authorize.cjs --config /etc/gsync/config.json
 *     Opens Google's consent page; a loopback listener on
 *     http://127.0.0.1:<loopbackPort>/callback (register it once as an extra redirect
 *     URI on your existing Google OAuth client) completes PKCE and writes the token
 *     file. Run this on a desktop, then copy the token file to the server — the
 *     refresh token keeps the install alive indefinitely.
 *
 *   node authorize.cjs --config <cfg> --from-plugin-data <vault>/<config-dir>/plugins/google-sync/data.json
 *     Skips the browser flow and copies the Obsidian plugin's existing tokens instead.
 */

interface Args {
    config: string;
    fromPluginData?: string;
}

function parseArgs(argv: string[]): Args {
    const args: Args = { config: "" };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--config") args.config = argv[++i] ?? "";
        else if (a === "--from-plugin-data") args.fromPluginData = argv[++i] ?? "";
        else if (a === "--help" || a === "-h") {
            console.log("usage: authorize --config <gsync.json> [--from-plugin-data <data.json>]");
            process.exit(0);
        } else {
            console.error(`unknown argument: ${a}`);
            process.exit(2);
        }
    }
    if (!args.config) {
        console.error("required: --config <gsync.json>");
        process.exit(2);
    }
    return args;
}

/** Best-effort: open the system browser; printing the URL is the reliable path. */
function tryOpenBrowser(url: string): void {
    const cmd =
        process.platform === "darwin"
            ? ["open", url]
            : process.platform === "win32"
              ? ["cmd", "/c", "start", "", url.replace(/&/g, "^&")]
              : ["xdg-open", url];
    const command = cmd[0];
    if (!command) return;
    try {
        spawn(command, cmd.slice(1), { stdio: "ignore", detached: true }).unref();
    } catch {
        // fine — the URL is printed below
    }
}

async function main(): Promise<number> {
    const args = parseArgs(process.argv.slice(2));
    const config = await loadConfig(args.config, { requireVault: false });
    const store = new FileTokenStore(config.tokenFile);

    if (args.fromPluginData) {
        const data = await readPluginData(args.fromPluginData);
        if (!data.tokens?.refreshToken) {
            console.error(
                "The plugin data.json has no refresh token — connect the plugin first, or use the browser flow.",
            );
            return 1;
        }
        await store.save(data.tokens);
        console.log(`Tokens copied to ${config.tokenFile}`);
        return 0;
    }

    if (!config.settings.clientId || !config.settings.clientSecret) {
        console.error(
            "Set settings.clientId and settings.clientSecret in the config (or GSYNC_CLIENT_ID/GSYNC_CLIENT_SECRET).",
        );
        return 1;
    }

    const redirectUri = `http://127.0.0.1:${config.loopbackPort}/callback`;
    const retry = { sleep: nodeSleep };
    const auth = new GoogleAuth(
        nodeFetchHttp,
        () => ({
            clientId: config.settings.clientId,
            clientSecret: config.settings.clientSecret,
            redirectUri,
            scopes: DEFAULT_SCOPES,
        }),
        store,
        Date.now,
        retry,
    );
    const { url } = await auth.beginAuth();

    const done = new Promise<number>((resolve) => {
        const server = createServer((req, res) => {
            const reqUrl = new URL(req.url ?? "/", `http://127.0.0.1:${config.loopbackPort}`);
            if (reqUrl.pathname !== "/callback") {
                res.writeHead(404).end();
                return;
            }
            const finish = (status: number, message: string, code: number) => {
                res.writeHead(status, { "content-type": "text/html" });
                res.end(`<html><body><p>${message}</p></body></html>`);
                server.close(() => resolve(code));
            };
            const error = reqUrl.searchParams.get("error");
            const code = reqUrl.searchParams.get("code");
            const state = reqUrl.searchParams.get("state");
            if (error) {
                console.error(`Google returned an error: ${error}`);
                finish(400, "Authorization failed — you can close this tab.", 1);
                return;
            }
            if (!code || !state) {
                finish(400, "Missing code/state — you can close this tab.", 1);
                return;
            }
            auth.completeAuth(code, state)
                .then(() => {
                    console.log(`Authorized. Tokens written to ${config.tokenFile}`);
                    console.log(
                        "If the sync runs on another machine, copy that file there (chmod 600).",
                    );
                    finish(
                        200,
                        "Connected — you can close this tab and return to the terminal.",
                        0,
                    );
                })
                .catch((e: Error) => {
                    console.error(`Token exchange failed: ${e.message}`);
                    finish(500, "Token exchange failed — see the terminal.", 1);
                });
        });
        server.listen(config.loopbackPort, "127.0.0.1", () => {
            console.log(`Listening on ${redirectUri}`);
            console.log(
                `\nMake sure ${redirectUri} is registered as a redirect URI on your Google OAuth client, then open:\n\n${url}\n`,
            );
            tryOpenBrowser(url);
        });
        // Don't hang forever if the user walks away.
        const timeout = setTimeout(
            () => {
                console.error("Timed out after 10 minutes.");
                server.close(() => resolve(1));
            },
            10 * 60 * 1000,
        );
        timeout.unref();
    });

    return done;
}

main()
    .then((code) => process.exit(code))
    .catch((e) => {
        console.error(`fatal: ${(e as Error).stack ?? String(e)}`);
        process.exit(1);
    });
