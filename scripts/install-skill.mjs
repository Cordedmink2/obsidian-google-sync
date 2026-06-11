#!/usr/bin/env node
/**
 * Install the google-tasks-calendar agent skill into AI agent skill directories —
 * Claude Code, Codex, OpenClaw, Hermes, or any SKILL.md-compatible agent. Works on
 * Windows, macOS, and Linux; Node >= 18; no dependencies.
 *
 *   node scripts/install-skill.mjs              # install into every detected agent
 *   node scripts/install-skill.mjs --list       # show detected agents and exit
 *   node scripts/install-skill.mjs --target DIR # install into DIR (repeatable);
 *                                               # e.g. a repo's .agents/skills or .claude/skills
 *
 * Run `npm run build:headless` first — the skill bundles dist/headless/cli.cjs and
 * authorize.cjs so the installed copy is fully self-contained.
 */
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const SKILL_NAME = "google-tasks-calendar";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_SRC = path.join(ROOT, "skill", SKILL_NAME);
// source bundle -> name inside the skill's scripts/ (SKILL.md references google.cjs)
const BUNDLES = [
    { src: path.join(ROOT, "dist", "headless", "cli.cjs"), as: "google.cjs" },
    { src: path.join(ROOT, "dist", "headless", "authorize.cjs"), as: "authorize.cjs" },
];

/** Known agent homes -> their skills directory. Installed into when the home exists. */
function knownAgents() {
    const home = os.homedir();
    return [
        { name: "Claude Code", home: path.join(home, ".claude"), skills: path.join(home, ".claude", "skills") },
        { name: "Codex", home: path.join(home, ".codex"), skills: path.join(home, ".codex", "skills") },
        { name: "OpenClaw", home: path.join(home, ".openclaw"), skills: path.join(home, ".openclaw", "skills") },
        { name: "Hermes", home: path.join(home, ".hermes"), skills: path.join(home, ".hermes", "skills") },
        // Cross-agent open standard (https://agentskills.io): personal variant.
        { name: "Agent Skills standard", home: path.join(home, ".agents"), skills: path.join(home, ".agents", "skills") },
    ];
}

function parseArgs(argv) {
    const args = { targets: [], list: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--target") {
            const t = argv[++i];
            if (!t) die("--target needs a directory");
            args.targets.push(path.resolve(t));
        } else if (a === "--list") args.list = true;
        else if (a === "--help" || a === "-h") {
            console.log("usage: install-skill.mjs [--list] [--target <skills-dir>]...");
            process.exit(0);
        } else die(`unknown argument: ${a}`);
    }
    return args;
}

function die(msg) {
    console.error(`error: ${msg}`);
    process.exit(1);
}

async function copyDir(src, dest) {
    await fs.mkdir(dest, { recursive: true });
    for (const entry of await fs.readdir(src, { withFileTypes: true })) {
        const from = path.join(src, entry.name);
        const to = path.join(dest, entry.name);
        if (entry.isDirectory()) await copyDir(from, to);
        else await fs.copyFile(from, to);
    }
}

async function installInto(skillsDir) {
    const dest = path.join(skillsDir, SKILL_NAME);
    await fs.rm(dest, { recursive: true, force: true }); // idempotent re-install
    await copyDir(SKILL_SRC, dest);
    const scriptsDir = path.join(dest, "scripts");
    await fs.mkdir(scriptsDir, { recursive: true });
    for (const bundle of BUNDLES) {
        await fs.copyFile(bundle.src, path.join(scriptsDir, bundle.as));
    }
    return dest;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (!existsSync(SKILL_SRC)) die(`skill source missing: ${SKILL_SRC}`);
    for (const bundle of BUNDLES) {
        if (!existsSync(bundle.src)) {
            die(`missing ${path.relative(ROOT, bundle.src)} — run: npm run build:headless`);
        }
    }

    const detected = knownAgents().filter((a) => existsSync(a.home));
    if (args.list) {
        if (!detected.length) console.log("no known agent homes detected");
        for (const a of detected) console.log(`${a.name}: ${a.skills}`);
        return;
    }

    const targets = args.targets.length ? args.targets : detected.map((a) => a.skills);
    if (!targets.length) {
        die(
            "no agent installations detected (looked for ~/.claude, ~/.codex, ~/.openclaw, ~/.hermes, ~/.agents). Use --target <skills-dir>.",
        );
    }

    for (const target of targets) {
        const dest = await installInto(target);
        console.log(`installed -> ${dest}`);
    }

    console.log(`
Next steps (one time):
  1. Create ~/.config/gsync/gsync.json with your Google OAuth client id/secret and
     task list id (see docs/headless.md in this repo for the full reference).
  2. Register http://127.0.0.1:8765/callback as a redirect URI on that OAuth client.
  3. Authorize once:
       node <skills-dir>/${SKILL_NAME}/scripts/authorize.cjs --config ~/.config/gsync/gsync.json

Agents will discover the skill automatically; it never deletes Google data.`);
}

main().catch((e) => die(e.stack ?? String(e)));
