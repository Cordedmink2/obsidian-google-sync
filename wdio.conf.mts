import * as path from "path";
import { parseObsidianVersions } from "wdio-obsidian-service";
import { env } from "process";

// wdio-obsidian-service downloads + caches sandboxed Obsidian builds here (arm64 on this
// box). Kept inside the project and git-ignored.
const cacheDir = path.resolve(".obsidian-cache");

// Plugin is isDesktopOnly, so we only run desktop e2e. Default to a single recent build
// for a fast smoke run; widen via OBSIDIAN_VERSIONS (space-separated appVersion/installerVersion).
const defaultVersions = "latest/latest";
const desktopVersions = await parseObsidianVersions(env.OBSIDIAN_VERSIONS ?? defaultVersions, {
    cacheDir,
});
if (env.CI) {
    // Printed so .github/workflows can use it as a cache key.
    console.log("obsidian-cache-key:", JSON.stringify(desktopVersions));
}

// Flags required to launch Electron/Chromium headlessly on a server (no display / sandbox).
// @wdio/xvfb (auto-wired into @wdio/local-runner) supplies the virtual display.
const headlessArgs = ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"];

export const config: WebdriverIO.Config = {
    runner: "local",
    framework: "mocha",

    specs: ["./test/specs/**/*.e2e.ts"],

    // Keep parallelism low on this single-board host; raise with WDIO_MAX_INSTANCES.
    maxInstances: Number(env.WDIO_MAX_INSTANCES || 1),

    capabilities: [
        // Desktop.
        ...desktopVersions.map<WebdriverIO.Capabilities>(([appVersion, installerVersion]) => ({
            browserName: "obsidian",
            "wdio:obsidianOptions": {
                appVersion,
                installerVersion,
                plugins: ["."],
                vault: "test/vaults/simple",
            },
            "goog:chromeOptions": {
                args: headlessArgs,
            },
        })),
        // Emulated mobile: real desktop Obsidian running the mobile UI with
        // Platform.isMobile === true. This is the only automatable proxy for iOS/Android
        // on a headless Linux box; final iOS validation is manual on a real device.
        // Skip with E2E_MOBILE=0.
        ...(env.E2E_MOBILE === "0"
            ? []
            : desktopVersions.map<WebdriverIO.Capabilities>(([appVersion, installerVersion]) => ({
                  browserName: "obsidian",
                  "wdio:obsidianOptions": {
                      appVersion,
                      installerVersion,
                      emulateMobile: true,
                      plugins: ["."],
                      vault: "test/vaults/simple",
                  },
                  "goog:chromeOptions": {
                      args: headlessArgs,
                      mobileEmulation: { deviceMetrics: { width: 390, height: 844 } },
                  },
              }))),
    ],

    services: ["obsidian"],
    // obsidian-reporter wraps spec-reporter but shows the Obsidian version per test.
    reporters: ["obsidian"],

    mochaOpts: {
        ui: "bdd",
        timeout: 60 * 1000,
    },
    waitforInterval: 250,
    waitforTimeout: 5 * 1000,
    logLevel: "warn",

    cacheDir: cacheDir,

    injectGlobals: false, // import describe/expect etc explicitly to make eslint happy
};
