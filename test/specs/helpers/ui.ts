/* eslint-disable @typescript-eslint/await-thenable -- wdio element chainables are awaited on purpose */
import { browser } from "@wdio/globals";
import * as fs from "fs";
import * as path from "path";

/**
 * Real-UI driving helpers for click-through specs: the command palette is opened with the
 * keyboard, filtered by typing, and run with Enter; settings controls are found by their
 * visible label and clicked. No plugin method is called from these helpers.
 */
export const SHOT_ROOT = process.env.GSYNC_SHOTS ?? path.resolve("test-results", "screenshots");

let shotIndex = 0;
let shotPlatform = "desktop";

export async function startShots(firstIndex = 0): Promise<void> {
    shotIndex = firstIndex;
    shotPlatform = await browser.execute(() =>
        document.body.classList.contains("is-mobile") ? "mobile" : "desktop",
    );
    fs.mkdirSync(path.join(SHOT_ROOT, shotPlatform), { recursive: true });
    mainHandle = await browser.getWindowHandle();
    await browser.executeObsidian(() => window.focus());
}

export function resetShotIndex(n = 0): void {
    shotIndex = n;
}

/** Save NN-step.png under screenshots/<desktop|mobile>/. Returns the file path. */
export async function shot(step: string): Promise<string> {
    shotIndex++;
    const file = path.join(
        SHOT_ROOT,
        shotPlatform,
        `${String(shotIndex).padStart(2, "0")}-${step}.png`,
    );
    await browser.saveScreenshot(file);
    return file;
}

export async function platform(): Promise<string> {
    return shotPlatform;
}

/** Close any open modal / palette / settings overlay. */
export async function dismissOverlays(): Promise<void> {
    for (let i = 0; i < 3; i++) {
        const open = await browser.execute(
            () => !!document.querySelector(".modal-container, .prompt"),
        );
        if (!open) return;
        await browser.keys(["Escape"]);
        await browser.pause(150);
    }
}

/** Open the command palette (keyboard), type the command name, press Enter. */
export async function runCommand(name: string, opts: { shotName?: string } = {}): Promise<void> {
    await dismissOverlays();
    await browser.execute(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await browser.keys(["Control", "p"]);
    const input = await browser.$(".prompt-input");
    await input.waitForDisplayed({ timeout: 5000 });
    await input.setValue(name);
    // First suggestion must be the command we typed, or the test fails loudly.
    await browser.waitUntil(
        async () => {
            const first = await browser.execute(
                () => document.querySelector(".suggestion-item.is-selected")?.textContent ?? "",
            );
            return first.includes(name);
        },
        { timeout: 5000, timeoutMsg: `palette never selected "${name}"` },
    );
    if (opts.shotName) await shot(opts.shotName);
    await browser.keys(["Enter"]);
}

let mainHandle = "";

/** Switch to the main workspace window (desktop opens Settings in its own window). */
export async function useMain(): Promise<void> {
    if (mainHandle) await browser.switchToWindow(mainHandle);
}

async function handles(): Promise<string[]> {
    return browser.getWindowHandles();
}

/** Texts of currently visible notices, in whichever window shows them. Leaves the current window unchanged. */
export async function notices(): Promise<string[]> {
    const current = await browser.getWindowHandle();
    const out: string[] = [];
    for (const h of await handles()) {
        await browser.switchToWindow(h);
        out.push(
            ...(await browser.execute(() =>
                Array.from(document.querySelectorAll(".notice")).map((n) => n.textContent ?? ""),
            )),
        );
    }
    await browser.switchToWindow(current);
    return out;
}

/** Wait for a notice containing `text`; returns the full notice text. */
export async function waitForNotice(text: string, timeout = 15000): Promise<string> {
    let found = "";
    await browser.waitUntil(
        async () => {
            found = (await notices()).find((n) => n.includes(text)) ?? "";
            return found !== "";
        },
        {
            timeout,
            interval: 150,
            timeoutMsg: `no notice containing "${text}"; saw: ${JSON.stringify(await notices())}`,
        },
    );
    // Obsidian slides notices in; let the animation finish so screenshots show the full text.
    await browser.pause(700);
    return found;
}

export async function clearNotices(): Promise<void> {
    const current = await browser.getWindowHandle();
    for (const h of await handles()) {
        await browser.switchToWindow(h);
        await browser.execute(() =>
            document.querySelectorAll(".notice").forEach((n) => n.remove()),
        );
    }
    await browser.switchToWindow(current);
}

/**
 * Open Settings → this plugin's tab. The palette's "Open settings" is tried first (it works
 * on emulated mobile); on desktop Obsidian 1.14 it does nothing under automation, so the
 * settings window is opened with app.setting.open() — Obsidian chrome, not plugin code. On
 * desktop Settings is a separate OS window, so the driver is switched to it. Everything
 * inside the plugin's tab is then driven with real clicks.
 */
export async function openSettings(): Promise<void> {
    await dismissOverlays();
    await runCommand("Open settings");
    await browser.pause(700);
    const before = (await handles()).length;
    const inline = await browser.execute(() => !!document.querySelector(".modal.mod-settings"));
    if (!inline && before === 1) {
        await browser.executeObsidian(({ app }) => {
            window.focus();
            (app as unknown as { setting: { open(): void } }).setting.open();
        });
        await browser.pause(800);
    }
    const all = await handles();
    if (all.length > 1) {
        for (const h of all) {
            await browser.switchToWindow(h);
            if ((await browser.getTitle()).startsWith("Settings")) break;
        }
    }
    await browser.$(".modal.mod-settings").waitForDisplayed({ timeout: 8000 });
    // Select this plugin's tab by clicking its entry in the settings sidebar.
    await browser.execute(() => {
        const items = Array.from(document.querySelectorAll<HTMLElement>(".vertical-tab-nav-item"));
        items.find((t) => /google/i.test(t.textContent ?? ""))?.scrollIntoView();
    });
    const tab = await browser.$(
        '//div[contains(@class,"vertical-tab-nav-item")][contains(translate(.,"GOOGLE","google"),"google")]',
    );
    if (await tab.isExisting()) await tab.click();
    else {
        // Mobile lists settings as a drill-down; fall back to Obsidian's own tab opener.
        await browser.executeObsidian(({ app }) => {
            (app as unknown as { setting: { openTabById(id: string): void } }).setting.openTabById(
                "google-sync",
            );
        });
    }
    await browser.waitUntil(
        async () =>
            await browser.execute(() =>
                Array.from(document.querySelectorAll(".setting-item-name")).some(
                    (n) => n.textContent?.trim() === "OAuth client ID",
                ),
            ),
        { timeout: 8000, timeoutMsg: "plugin settings tab did not render" },
    );
    await browser.pause(300);
}

/** Close Settings (desktop: close its window and return to the main one). */
export async function closeSettings(): Promise<void> {
    await useMain();
    await browser.executeObsidian(({ app }) => {
        (app as unknown as { setting: { close(): void } }).setting.close();
    });
    await browser.pause(400);
    await useMain();
}

/** Click the button `buttonText` inside the settings row named `settingName`. */
export async function clickSettingButton(settingName: string, buttonText: string): Promise<void> {
    const ok = await browser.execute(
        (n: string, b: string) => {
            const row = Array.from(document.querySelectorAll(".setting-item")).find(
                (r) => r.querySelector(".setting-item-name")?.textContent?.trim() === n,
            );
            const btn = Array.from(row?.querySelectorAll("button") ?? []).find(
                (x) => x.textContent?.trim() === b,
            );
            if (!btn) return false;
            btn.scrollIntoView({ block: "center" });
            return true;
        },
        settingName,
        buttonText,
    );
    if (!ok) throw new Error(`no button "${buttonText}" in setting "${settingName}"`);
    const el = await browser.$(
        `//div[contains(@class,"setting-item")][.//div[contains(@class,"setting-item-name") and normalize-space(.)="${settingName}"]]//button[normalize-space(.)="${buttonText}"]`,
    );
    await el.click();
}

/** Scroll the named setting row into view (for screenshots). */
export async function scrollToSetting(settingName: string): Promise<void> {
    await browser.execute((n: string) => {
        Array.from(document.querySelectorAll(".setting-item"))
            .find((r) => r.querySelector(".setting-item-name")?.textContent?.trim() === n)
            ?.scrollIntoView({ block: "center" });
    }, settingName);
    await browser.pause(150);
}

/** Create or overwrite a note through the vault (test setup — the thing under test is the UI). */
export async function writeNote(notePath: string, content: string): Promise<void> {
    await browser.executeObsidian(
        async ({ app, obsidian }, p: string, c: string) => {
            const dir = p.split("/").slice(0, -1).join("/");
            if (dir && !app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir);
            const f = app.vault.getAbstractFileByPath(p);
            if (f instanceof obsidian.TFile) await app.vault.modify(f, c);
            else await app.vault.create(p, c);
        },
        notePath,
        content,
    );
}

export async function readNote(notePath: string): Promise<string | null> {
    return browser.executeObsidian(async ({ app, obsidian }, p: string) => {
        const f = app.vault.getAbstractFileByPath(p);
        return f instanceof obsidian.TFile ? await app.vault.read(f) : null;
    }, notePath);
}

export async function removeNotes(prefix: string): Promise<void> {
    await browser.executeObsidian(async ({ app, obsidian }, pre: string) => {
        for (const f of app.vault.getFiles()) {
            if (f.path.startsWith(pre) && f instanceof obsidian.TFile) await app.vault.delete(f);
        }
    }, prefix);
}

/** JS scroll: WebDriver's own scrollIntoView is unsupported on emulated mobile. */
async function reveal(el: unknown): Promise<void> {
    await browser.execute((e: HTMLElement) => e.scrollIntoView({ block: "center" }), el as never);
}

const rowXpath = (name: string): string =>
    `//div[contains(@class,"setting-item")][.//div[contains(@class,"setting-item-name") and normalize-space(.)="${name}"]]`;

/** Type into the text/number field of a settings row (real keystrokes), then wait out the save debounce. */
export async function typeSetting(settingName: string, value: string): Promise<void> {
    const input = await browser.$(`${rowXpath(settingName)}//input[not(@type="checkbox")]`);
    await reveal(input);
    await input.click();
    await browser.keys(["Control", "a"]);
    await browser.keys(["Backspace"]);
    await input.setValue(value);
    await browser.pause(900);
}

/** Choose an option of the dropdown in a settings row by its visible text. */
export async function chooseSetting(settingName: string, optionText: string): Promise<void> {
    const sel = await browser.$(`${rowXpath(settingName)}//select`);
    await reveal(sel);
    await sel.selectByVisibleText(optionText);
    await browser.pause(900);
}

/** Click the toggle of a settings row (a <label> in current Obsidian, a <div> in 1.6.x). */
export async function clickToggle(settingName: string): Promise<void> {
    const t = await browser.$(`${rowXpath(settingName)}//*[contains(@class,"checkbox-container")]`);
    await reveal(t);
    await t.click();
    await browser.pause(900);
}

export async function isToggleOn(settingName: string): Promise<boolean> {
    return await browser.execute((x: string) => {
        const row = document.evaluate(x, document, null, 9, null)
            .singleNodeValue as HTMLElement | null;
        return !!row?.querySelector(".checkbox-container.is-enabled");
    }, rowXpath(settingName));
}

export async function settingValue(settingName: string): Promise<string> {
    return await browser.execute((x: string) => {
        const row = document.evaluate(x, document, null, 9, null)
            .singleNodeValue as HTMLElement | null;
        const el = row?.querySelector(
            "input:not([type=checkbox]), select, textarea",
        ) as HTMLInputElement | null;
        return el?.value ?? "";
    }, rowXpath(settingName));
}

/** Text of the open preview modal (empty when none). */
export async function modalText(): Promise<string> {
    return await browser.execute(
        () => document.querySelector(".modal-container .modal")?.textContent ?? "",
    );
}

/** Read the plugin's saved data.json (what a reload would see). */
export async function readSavedSettings(): Promise<Record<string, unknown>> {
    return browser.executeObsidian(async ({ app }) => {
        const raw = await app.vault.adapter.read(
            `${app.vault.configDir}/plugins/google-sync/data.json`,
        );
        return JSON.parse(raw) as Record<string, unknown>;
    });
}

/** Path of the note whose frontmatter has this googleId (the importer names files from the title). */
export async function findNoteByGoogleId(googleId: string): Promise<string | null> {
    return browser.executeObsidian(async ({ app }, id: string) => {
        for (const f of app.vault.getMarkdownFiles()) {
            const c = await app.vault.read(f);
            if (new RegExp(`googleId:\\s*"?${id}"?\\s*$`, "m").test(c)) return f.path;
        }
        return null;
    }, googleId);
}

/** Test setup (not under test): turn off the debounced push-on-edit so edits only go out via the command. */
export async function disableAutoPush(): Promise<void> {
    await browser.executeObsidian(async ({ app }) => {
        const plugin = (app as unknown as { plugins: { plugins: Record<string, unknown> } }).plugins
            .plugins["google-sync"] as {
            settings: Record<string, unknown>;
            saveSettings(): Promise<void>;
        };
        plugin.settings.syncOnModify = false;
        await plugin.saveSettings();
    });
}

/** A real plugin reload: disable then enable through Obsidian's plugin manager. */
export async function reloadPlugin(): Promise<void> {
    await browser.executeObsidian(async ({ app }) => {
        const plugins = (
            app as unknown as {
                plugins: {
                    disablePlugin(id: string): Promise<void>;
                    enablePlugin(id: string): Promise<void>;
                };
            }
        ).plugins;
        await plugins.disablePlugin("google-sync");
        await plugins.enablePlugin("google-sync");
    });
    await browser.pause(800);
}
