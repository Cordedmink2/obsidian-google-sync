import { existsSync, nodePath, os } from "./node-runtime";
import { DEFAULT_SCOPES, GoogleAuth } from "../src/google/auth";
import { GoogleCalendarClient, WriteEventOptions } from "../src/google/calendar";
import { GoogleTasksClient } from "../src/google/tasks";
import { GoogleApiError } from "../src/google/api";
import { eventToGoogle, taskToGoogle } from "../src/sync/mapper";
import { validateEvent, validateTask } from "../src/sync/frontmatter";
import { EventFrontmatter, GoogleEvent, GoogleTask, TaskFrontmatter } from "../src/types";
import { nodeFetchHttp } from "./transport";
import { FileTokenStore } from "./token-store";
import { HeadlessConfig, loadConfig } from "./config";

/**
 * Agent-facing CLI for Google Calendar + Tasks: create, read, and update — never delete.
 * JSON in (--json or stdin), JSON out, non-zero exit + JSON error on failure, so AI
 * agents can drive it and self-correct. Shares the headless config + token file with the
 * sync script. Input uses the same field vocabulary as the plugin's note frontmatter
 * (title/date/end/allDay/timezone/attendees/recurrence/conferencing/reminders/…), or raw
 * Google API bodies with --raw.
 *
 *   google --config <gsync.json> <group> <command> [args] [flags]
 *
 * Groups/commands:
 *   calendars list
 *   tasklists list
 *   events    list|get <id>|create|update <id>
 *   tasks     list|get <id>|create|update <id>|complete <id>|uncomplete <id>|move <id>
 */

const USAGE = `usage: google --config <gsync.json> <group> <command> [id] [flags]

  calendars list
  tasklists list

  events list     [--calendar <id>] [--days-past N] [--days-ahead N]
  events get      <eventId> [--calendar <id>]
  events create   --json '<event>' [--calendar <id>] [--send-updates all|externalOnly|none] [--raw]
  events update   <eventId> --json '<fields>' [--calendar <id>] [--send-updates ...] [--raw]

  tasks list      [--tasklist <id>]
  tasks get       <taskId> [--tasklist <id>]
  tasks create    --json '<task>' [--tasklist <id>] [--parent <taskId>] [--previous <taskId>]
  tasks update    <taskId> --json '<fields>' [--tasklist <id>] [--raw]
  tasks complete  <taskId> [--tasklist <id>]
  tasks uncomplete <taskId> [--tasklist <id>]
  tasks move      <taskId> [--tasklist <id>] [--parent <taskId>] [--previous <taskId>]

  --json -        read the JSON body from stdin
  --raw           send the JSON as a raw Google API body (skip frontmatter-style mapping)

There are no delete commands by design.`;

interface Flags {
    config: string;
    json?: string;
    calendar?: string;
    tasklist?: string;
    parent?: string;
    previous?: string;
    sendUpdates?: string;
    daysPast?: number;
    daysAhead?: number;
    raw: boolean;
}

interface Parsed {
    group: string;
    command: string;
    id?: string;
    flags: Flags;
}

function fail(message: string, body?: unknown, status?: number): never {
    console.error(JSON.stringify({ error: { message, status, body } }, null, 2));
    process.exit(1);
}

function parseArgs(argv: string[]): Parsed {
    const flags: Flags = { config: "", raw: false };
    const positional: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i] as string;
        if (a === "--config") flags.config = argv[++i] ?? "";
        else if (a === "--json") flags.json = argv[++i] ?? "";
        else if (a === "--calendar") flags.calendar = argv[++i];
        else if (a === "--tasklist") flags.tasklist = argv[++i];
        else if (a === "--parent") flags.parent = argv[++i];
        else if (a === "--previous") flags.previous = argv[++i];
        else if (a === "--send-updates") flags.sendUpdates = argv[++i];
        else if (a === "--days-past") flags.daysPast = Number(argv[++i]);
        else if (a === "--days-ahead") flags.daysAhead = Number(argv[++i]);
        else if (a === "--raw") flags.raw = true;
        else if (a === "--help" || a === "-h") {
            console.log(USAGE);
            process.exit(0);
        } else if (a.startsWith("--")) fail(`unknown flag: ${a}`);
        else positional.push(a);
    }
    // --config > $GSYNC_CONFIG > ~/.config/gsync/gsync.json
    if (!flags.config && process.env.GSYNC_CONFIG) flags.config = process.env.GSYNC_CONFIG;
    if (!flags.config) {
        const fallback = nodePath.join(os.homedir(), ".config", "gsync", "gsync.json");
        if (existsSync(fallback)) flags.config = fallback;
    }
    if (!flags.config) {
        fail(
            "no config found — pass --config <gsync.json>, set GSYNC_CONFIG, or create ~/.config/gsync/gsync.json",
        );
    }
    const [group, command, id] = positional;
    if (!group || !command) fail(`missing command\n${USAGE}`);
    return { group, command, id, flags };
}

async function readJsonInput(flags: Flags): Promise<Record<string, unknown>> {
    let raw = flags.json;
    if (raw === "-" || raw === undefined) {
        raw = await new Promise<string>((resolve, reject) => {
            let data = "";
            process.stdin.setEncoding("utf8");
            process.stdin.on("data", (chunk: string) => {
                data += chunk;
            });
            process.stdin.on("end", () => resolve(data));
            process.stdin.on("error", reject);
        });
    }
    if (!raw || !raw.trim()) fail("a JSON body is required (--json '<...>' or pipe via stdin)");
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            fail("the JSON body must be an object");
        }
        return parsed as Record<string, unknown>;
    } catch (e) {
        return fail(`invalid JSON: ${(e as Error).message}`);
    }
}

function output(value: unknown): void {
    console.log(JSON.stringify(value, null, 2));
}

/** Map frontmatter-style event input to a Google body (+ Meet request when asked). */
function eventBody(
    input: Record<string, unknown>,
    config: HeadlessConfig,
    requireComplete: boolean,
): { body: GoogleEvent; opts: WriteEventOptions } {
    if (requireComplete) {
        const v = validateEvent(input);
        if (!v.ok) fail(`invalid event: ${v.errors.join("; ")}`);
    } else if (input.date == null && input.end == null && input.title == null) {
        // partial update with no mapped basics is fine
    }
    const fm = input as EventFrontmatter;
    const body = eventToGoogle(fm, config.settings.defaultTimezone);
    if (input.title == null) delete body.summary;
    const opts: WriteEventOptions = {};
    const wantsMeet = fm.conferencing === true || fm.conferencing === "hangoutsMeet";
    if (wantsMeet) {
        body.conferenceData = {
            createRequest: {
                requestId: crypto.randomUUID(),
                conferenceSolutionKey: { type: "hangoutsMeet" },
            },
        };
        opts.conferenceDataVersion = 1;
    }
    if (Array.isArray(body.attachments) && body.attachments.length) {
        opts.supportsAttachments = true;
    }
    return { body, opts };
}

/** Map frontmatter-style task input to a Google body. */
function taskBody(
    input: Record<string, unknown>,
    config: HeadlessConfig,
    requireComplete: boolean,
): GoogleTask {
    if (requireComplete) {
        const v = validateTask(input);
        if (!v.ok) fail(`invalid task: ${v.errors.join("; ")}`);
    }
    const body = taskToGoogle(input as TaskFrontmatter, config.settings.defaultTimezone);
    if (input.title == null) delete body.title;
    if (input.completed == null && input.status == null) delete body.status;
    return body;
}

async function main(): Promise<void> {
    const { group, command, id, flags } = parseArgs(process.argv.slice(2));
    const config = await loadConfig(flags.config, { requireVault: false });
    const auth = new GoogleAuth(
        nodeFetchHttp,
        () => ({
            clientId: config.settings.clientId,
            clientSecret: config.settings.clientSecret,
            redirectUri: `http://127.0.0.1:${config.loopbackPort}/callback`,
            scopes: DEFAULT_SCOPES,
        }),
        new FileTokenStore(config.tokenFile),
    );
    if (!(await auth.isConnected())) {
        fail(`not authorized — run: authorize --config ${flags.config}`);
    }
    const tokenProvider = () => auth.getAccessToken();
    const calendar = new GoogleCalendarClient(nodeFetchHttp, tokenProvider);
    const tasks = new GoogleTasksClient(nodeFetchHttp, tokenProvider);
    const calendarId = flags.calendar || config.settings.defaultCalendarId;
    const taskListId = flags.tasklist || config.settings.taskListId;
    const writeOpts: WriteEventOptions = flags.sendUpdates
        ? { sendUpdates: flags.sendUpdates }
        : {};

    const key = `${group} ${command}`;
    switch (key) {
        case "calendars list": {
            output(await calendar.listCalendars());
            return;
        }
        case "tasklists list": {
            output(await tasks.listTaskLists());
            return;
        }
        case "events list": {
            const dayMs = 24 * 60 * 60 * 1000;
            const past = flags.daysPast ?? config.settings.importPastDays;
            const ahead = flags.daysAhead ?? config.settings.importFutureDays;
            const { items } = await calendar.listEvents(calendarId, {
                timeMin: new Date(Date.now() - Math.max(0, past) * dayMs).toISOString(),
                timeMax: new Date(Date.now() + Math.max(0, ahead) * dayMs).toISOString(),
            });
            output(items);
            return;
        }
        case "events get": {
            if (!id) fail("usage: events get <eventId>");
            output(await calendar.getEvent(calendarId, id));
            return;
        }
        case "events create": {
            const input = await readJsonInput(flags);
            const { body, opts } = flags.raw
                ? { body: input as GoogleEvent, opts: {} }
                : eventBody(input, config, true);
            output(await calendar.insertEvent(calendarId, body, { ...opts, ...writeOpts }));
            return;
        }
        case "events update": {
            if (!id) fail("usage: events update <eventId> --json '<fields>'");
            const input = await readJsonInput(flags);
            const { body, opts } = flags.raw
                ? { body: input as GoogleEvent, opts: {} }
                : eventBody(input, config, false);
            output(await calendar.patchEvent(calendarId, id, body, { ...opts, ...writeOpts }));
            return;
        }
        case "tasks list": {
            output(await tasks.listTasks(taskListId));
            return;
        }
        case "tasks get": {
            if (!id) fail("usage: tasks get <taskId>");
            output(await tasks.getTask(taskListId, id));
            return;
        }
        case "tasks create": {
            const input = await readJsonInput(flags);
            const body = flags.raw ? (input as GoogleTask) : taskBody(input, config, true);
            output(
                await tasks.insertTask(taskListId, body, {
                    parent: flags.parent,
                    previous: flags.previous,
                }),
            );
            return;
        }
        case "tasks update": {
            if (!id) fail("usage: tasks update <taskId> --json '<fields>'");
            const input = await readJsonInput(flags);
            const body = flags.raw ? (input as GoogleTask) : taskBody(input, config, false);
            output(await tasks.patchTask(taskListId, id, body));
            return;
        }
        case "tasks complete": {
            if (!id) fail("usage: tasks complete <taskId>");
            output(await tasks.patchTask(taskListId, id, { status: "completed" }));
            return;
        }
        case "tasks uncomplete": {
            if (!id) fail("usage: tasks uncomplete <taskId>");
            output(await tasks.patchTask(taskListId, id, { status: "needsAction" }));
            return;
        }
        case "tasks move": {
            if (!id) fail("usage: tasks move <taskId> [--parent <id>] [--previous <id>]");
            output(
                await tasks.moveTask(taskListId, id, {
                    parent: flags.parent,
                    previous: flags.previous,
                }),
            );
            return;
        }
        default:
            fail(`unknown command: ${key}\n${USAGE}`);
    }
}

main().catch((e) => {
    if (e instanceof GoogleApiError) fail(e.message, e.body, e.status);
    fail((e as Error).message);
});
