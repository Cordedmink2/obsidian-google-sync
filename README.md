# Google Calendar and Tasks Sync

Sync Google Calendar events and Google Tasks into an Obsidian vault, then push edits back to existing Google items.

Google remains the source of truth for whether an event or task exists. The plugin imports and updates notes, but it does not create or delete items in Google.

## What it does

- Imports Google Calendar events into `events/`.
- Imports Google Tasks into `tasks/`.
- Updates Google when you edit an imported note that has a `googleId`.
- Moves old events, overdue tasks, completed tasks, and confirmed Google-side deletions into archive folders instead of deleting local notes.

## Sync model

- **Google to Obsidian:** imports create or update notes.
- **Obsidian to Google:** edits to linked notes patch the existing Google item.
- **Local-only notes:** notes without `googleId` are never pushed to Google.
- **Deletions:** deleting or renaming a note never deletes anything in Google. If Google deletes an item, the note is moved to `orphaned/` on import.
- **Opt out per note:** set `syncDirection: pull-only` to prevent local edits from pushing.

Pushes are diff-based and checked against the last imported state. Large batches require explicit confirmation with **Push pending updates (confirmed)**. Use **Preview pending Google updates** for a dry run.

## Install

### Community plugin

1. Open **Settings → Community plugins** in Obsidian.
2. Turn off **Restricted mode** if needed.
3. Select **Browse**.
4. Search for **Google Calendar and Tasks Sync**.
5. Select **Install**, then **Enable**.

### Manual install

Download `main.js`, `manifest.json`, and `styles.css` from the latest GitHub release and place them in:

```text
.obsidian/plugins/google-sync/
```

Restart Obsidian and enable the plugin.

## First-time setup

The plugin uses your own Google OAuth client. Tokens and settings stay in your vault's local plugin data.

Full guide: [Google setup guide](https://github.com/Cordedmink2/obsidian-google-sync/blob/main/docs/google-setup.md)

Essential steps:

1. Create or choose a Google Cloud project.
2. Enable the Google Calendar API and Google Tasks API.
3. Configure the OAuth consent screen.
4. Host the redirect bridge page from this repo.
5. Create a **Web application** OAuth client.
6. Paste the client ID, client secret, and bridge URL into plugin settings.
7. Run **Connect to Google**.
8. Run **Validate setup**.

For iPhone and iPad, use the [iOS checklist](https://github.com/Cordedmink2/obsidian-google-sync/blob/main/docs/ios-checklist.md).

## Import settings

Importing is bounded so a vault is not filled with old or recurring events.

- **Days past / days ahead:** event import window. Defaults: 7 days past, 90 days ahead.
- **Recurring event filter:** allowlist or blocklist recurring event titles. One-off events are always imported.
- **Recurring event titles:** one title per line. `*` works as a wildcard.

These settings only affect imports from Google.

## Commands

Search for these commands in Obsidian's command palette:

- **Connect to Google**
- **Import events and tasks from Google**
- **Sync now**
- **Preview pending Google updates**
- **Push pending updates (confirmed)**
- **Run lifecycle scan**
- **Test connection**
- **Validate setup**
- **Disconnect from Google**

## Folder layout

Default folders:

```text
events/
events/archive/
events/orphaned/
tasks/
tasks/overdue/
tasks/completed/
tasks/orphaned/
```

Change folder names in settings before first sync if you want a different layout.

## Note format

Imported notes use YAML frontmatter. Keep the `googleId` field; it links the note to Google.

Event example:

```yaml
---
title: Coffee with Alex
date: 2026-06-02T10:00
end: 2026-06-02T11:00
timezone: Pacific/Auckland
location: Wellington
status: confirmed
googleId: example-event-id
---
Notes stay in Obsidian.
```

Task example:

```yaml
---
title: Buy milk
due: 2026-06-01
completed: false
notes: 2% organic, two cartons
googleId: example-task-id
---
Local note body stays in Obsidian.
```

The body of a task note is not synced. The `notes` frontmatter field maps to Google Tasks details.

## Templater workflow

Optional guide: [Templater setup](https://github.com/Cordedmink2/obsidian-google-sync/blob/main/docs/templater-setup.md)

Folder mappings:

- `events` → `templates/google-sync/event-template.md`
- `tasks` → `templates/google-sync/task-template.md`

Smoke test helpers:

```bash
./scripts/verify-setup.sh /path/to/your/vault
./scripts/bootstrap-sample-notes.sh /path/to/your/vault
```

## Privacy and safety

- Google requests are made directly through Obsidian's `requestUrl` API.
- There is no analytics or telemetry.
- Tokens and OAuth settings are stored in `.obsidian/plugins/google-sync/data.json`.
- Treat that file as private.
- The plugin only manages notes in the configured event and task folders.
- Startup import is off by default and additions-only when enabled.

See [PRIVACY.md](https://github.com/Cordedmink2/obsidian-google-sync/blob/main/PRIVACY.md) and [SECURITY.md](https://github.com/Cordedmink2/obsidian-google-sync/blob/main/SECURITY.md).

## Troubleshooting

- Run **Validate setup** first.
- If login does not return to Obsidian, check that your OAuth redirect URI exactly matches the hosted bridge URL.
- If a note does not sync, check that it is in the configured folder and has `googleId`.
- If event times look wrong, set `timezone`, for example `Pacific/Auckland`.
- Test with a spare Google calendar or task list before syncing important data.

## Headless sync

The same sync engine can run without Obsidian for server or cron use. It can import notes, push edits, run lifecycle filing, and commit the vault to git.

Build with:

```bash
npm run build:headless
```

Guide: [headless sync](https://github.com/Cordedmink2/obsidian-google-sync/blob/main/docs/headless.md)

## Developer notes

- [Development guide](https://github.com/Cordedmink2/obsidian-google-sync/blob/main/docs/development.md)
- [Contributing](https://github.com/Cordedmink2/obsidian-google-sync/blob/main/CONTRIBUTING.md)

The Obsidian plugin runtime is the published `main.js` bundle. The `headless/` TypeScript files are Node-only tooling and are not loaded by Obsidian.
