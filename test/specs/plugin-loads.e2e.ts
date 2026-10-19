import { browser, expect } from "@wdio/globals";
import "./helpers/invariantHook";
import { describe, it } from "mocha";

/**
 * Baseline e2e: launch a real (sandboxed, headless) Obsidian with this plugin installed
 * via wdio.conf's `plugins: ["."]` and assert it loads and enables cleanly. Feature-level
 * e2e (folder watching, mapping to Google objects) builds on this in the next phase.
 */
describe("google-sync plugin", function () {
    it("is installed and enabled", async function () {
        const state = await browser.executeObsidian(({ app }) => {
            // app.plugins is an internal API not present in the public typings.
            const plugins = (
                app as unknown as {
                    plugins: {
                        enabledPlugins: Set<string>;
                        plugins: Record<string, unknown>;
                    };
                }
            ).plugins;
            return {
                enabled: plugins.enabledPlugins.has("google-sync"),
                loaded: !!plugins.plugins["google-sync"],
            };
        });

        expect(state.enabled).toBe(true);
        expect(state.loaded).toBe(true);
    });
});
