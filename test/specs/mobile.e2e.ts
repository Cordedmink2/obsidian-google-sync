import { browser, expect } from "@wdio/globals";
import "./helpers/invariantHook";
import { describe, it } from "mocha";

/**
 * Mobile coverage via wdio-obsidian-service "emulate mobile": real desktop Obsidian
 * with the mobile UI and Platform.isMobile === true. Runs against every capability, so
 * it skips on the desktop capability and only asserts on the emulated-mobile one. Real
 * iOS-device validation is manual (this box can't run the iOS app).
 */
describe("google-sync on mobile (emulated)", function () {
    it("loads and enables with Platform.isMobile", async function (this: { skip(): void }) {
        const { isMobile, enabled } = await browser.executeObsidian(({ app, obsidian }) => {
            const plugins = (app as unknown as { plugins: { enabledPlugins: Set<string> } })
                .plugins;
            return {
                isMobile: obsidian.Platform.isMobile,
                enabled: plugins.enabledPlugins.has("google-sync"),
            };
        });

        if (!isMobile) {
            this.skip();
        }
        expect(enabled).toBe(true);
    });
});
