# Google Calendar & Tasks Sync for Obsidian

Keep your Obsidian notes in sync with **Google Calendar** and **Google Tasks** — on desktop and mobile.

This plugin is for people who like planning in Markdown but still want their calendar and task list available everywhere Google works.

## What it syncs

- 📅 Notes in **`events/`** become Google Calendar events.
- ✅ Notes in **`tasks/`** become Google Tasks.
- Editing a synced note updates Google.
- Deleting or renaming a synced note updates Google.
- Google events/tasks can be imported into your vault.
- Past events and old tasks can be tidied into archive/overdue/completed folders.

## Important sync model

This is intentionally conservative so it does not destroy local edits:

- **Obsidian → Google:** automatic while Obsidian is open, if the matching sync-on-create/modify/delete settings are enabled.
- **Google → Obsidian:** manual via **Import events and tasks from Google**.
- **Google → Obsidian on startup:** optional and off by default. When enabled, it only creates new missing notes and does **not** overwrite existing notes.

If you need a full two-way merge workflow, test carefully with a spare calendar/list first.

## Install

### From Obsidian Community Plugins

After the plugin is accepted into the community directory:

1. Open Obsidian.
2. Go to **Settings → Community plugins**.
3. Turn off **Restricted mode** if needed.
4. Select **Browse**.
5. Search for **Google Calendar and Tasks Sync**.
6. Select **Install**, then **Enable**.

### Manual install while waiting for community review

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest GitHub release.
2. In your vault, create:

    ```text
    .obsidian/plugins/google-sync/
    ```

3. Put the three downloaded files in that folder.
4. Restart Obsidian.
5. Go to **Settings → Community plugins** and enable **Google Calendar and Tasks Sync**.

## First-time setup

The plugin needs your own Google OAuth client. This avoids any shared hosted backend and keeps Google tokens in your vault’s local plugin data.

Follow the full guide here:

- [Google setup guide](docs/google-setup.md)

Short version:

1. Create or choose a Google Cloud project.
2. Enable **Google Calendar API** and **Google Tasks API**.
3. Configure the OAuth consent screen.
4. Host the tiny redirect bridge page included in this repo.
5. Create a **Web application** OAuth client.
6. Paste the client ID, client secret, and bridge URL into the plugin settings.
7. Run **Connect to Google** from Obsidian’s command palette.
8. Run **Validate setup**.

For iPhone/iPad setup and checks, use:

- [iOS checklist](docs/ios-checklist.md)

## Optional: Templater workflow (recommended)

If you use the **Templater** community plugin, you can auto-insert valid event/task frontmatter when creating new notes.

- Full guide: [Templater setup](docs/templater-setup.md)
- Quick install link: `obsidian://show-plugin?id=templater-obsidian`
- One-command scaffold:

```bash
./scripts/setup-templater.sh /path/to/your/vault --configure-templater
```

This creates event/task templates and can auto-configure Templater’s template folder + trigger-on-create setting.

## Commands

Open Obsidian’s command palette and search for these commands:

- **Connect to Google** — sign in once and store Google tokens in the plugin data file.
- **Sync now** — push matching Obsidian notes to Google.
- **Import events and tasks from Google** — pull Google items into your vault. By default it only imports the configured calendar and task list to avoid vault spam.
- **Run lifecycle scan** — move past events to `events/archive/`, overdue tasks to `tasks/overdue/`, and completed tasks to `tasks/completed/`.
- **Test connection** — quick Google connectivity check.
- **Validate setup** — checks OAuth settings, Google connection, selected calendar, and selected task list.
- **Disconnect from Google** — remove stored Google tokens.

## Folder layout

The defaults are:

```text
events/
events/archive/
tasks/
tasks/overdue/
tasks/completed/
```

You can change the folder names in plugin settings before you start syncing.

## Event note example

Create a Markdown file under `events/`:

```yaml
---
title: Coffee with Alex
date: 2026-06-02T10:00
end: 2026-06-02T11:00
timezone: Pacific/Auckland
location: Wellington
attendees:
    - alex@example.com
---
Notes for myself stay here, in Obsidian.
```

After syncing, the plugin writes a `googleId` field into the frontmatter. Leave that field alone; it is how the plugin knows which Google event belongs to the note.

## Task note example

Create a Markdown file under `tasks/`:

```yaml
---
title: Buy milk
due: 2026-06-01
completed: false
---
Optional task notes go here.
```

Set `completed: true` and sync to mark the task completed in Google Tasks.

## Privacy and safety

- The plugin talks directly to Google Calendar and Google Tasks using Obsidian’s `requestUrl` API.
- It does not include analytics or telemetry.
- Google OAuth tokens are stored by Obsidian in the plugin’s vault-local `data.json`.
- Your OAuth client secret is also stored in plugin settings. Treat the vault’s `.obsidian/plugins/google-sync/data.json` as private.
- The plugin only manages notes inside the configured event/task folders.
- Startup Google import is off by default and additions-only when enabled.

## Troubleshooting

- Run **Validate setup** first. It gives the clearest checklist of what is missing.
- If login does not return to Obsidian, check that your Google OAuth redirect URI exactly matches your hosted bridge URL.
- If a note does not sync, check that it is under the configured `events/` or `tasks/` folder and has the required frontmatter fields.
- If times look wrong, add an explicit `timezone` such as `Pacific/Auckland`.
- Test with a spare Google calendar/task list before using important real data.

More developer and test notes:

- [Development guide](docs/development.md)
- [Google setup guide](docs/google-setup.md)
- [iOS checklist](docs/ios-checklist.md)
