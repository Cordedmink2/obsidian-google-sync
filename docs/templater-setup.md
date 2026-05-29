# Templater setup for Google Sync

If you use the **Templater** community plugin, you can standardize new event/task notes so they always include the frontmatter fields Google Sync expects.

> [!WARNING]
> **Do not combine folder templates on your `events`/`tasks` folders with "Trigger Templater on new file creation" if you use _Import from Google_ (including import-on-startup).**
>
> When Google Sync imports an event/task it creates a note in those folders. With trigger-on-creation enabled, Templater immediately rewrites that note from the template — overwriting the real `title`/`date`/body with the template's defaults. You end up with notes that say `title: Event title`, dated whatever the template hardcodes, even though the file was a real imported event.
>
> Google Sync (0.1.12+) suppresses the sync events from its own writes, so this no longer pushes the clobbered note **back** to Google and corrupts your calendar. But Templater will still mangle the **local** note. If you import from Google, choose one:
>
> - **Turn off** "Trigger Templater on new file creation", or
> - **Remove** the `events`/`tasks` folder-template mappings (apply templates manually to notes you author), or
> - Only enable folder templates if you never use Import from Google.
>
> The folder-template workflow below is intended for vaults where you **author** events/tasks locally and push them up — not for pulling them down.

## Install Templater

- In Obsidian: **Settings → Community plugins → Browse**
- Search for **Templater** and install/enable it
- Quick link (opens in Obsidian): `obsidian://show-plugin?id=templater-obsidian`

## Fast setup (scripted)

From this repo, run:

```bash
./scripts/setup-templater.sh /path/to/your/vault
```

This creates (if missing):

- `templates/google-sync/event-template.md`
- `templates/google-sync/task-template.md`
- `templates/google-sync/README.md`
- `events/`
- `tasks/`

Optional: also configure Templater plugin defaults in your vault:

```bash
./scripts/setup-templater.sh /path/to/your/vault --configure-templater
```

That flag updates (or creates) this file:

- `.obsidian/plugins/templater-obsidian/data.json`

with:

- `templates_folder: "templates"`
- `trigger_on_file_creation: true`

## Smoke-test commands (recommended)

After setup, run:

```bash
./scripts/verify-setup.sh /path/to/your/vault
./scripts/bootstrap-sample-notes.sh /path/to/your/vault
```

Then in Obsidian:

1. Run **Sync now**.
2. Confirm the sample event/task appear in Google.
3. (Optional) Mark the sample task `completed: true` and sync again.

## Manual setup (no script)

1. Create folder: `templates/google-sync/`
2. Add templates:
    - `event-template.md`
    - `task-template.md`
3. In **Templater settings**:
    - Template folder location: `templates`
    - Trigger Templater on new file creation: On
4. In **Templater → Folder Templates** (important mapping step):
    - Map `events` → `templates/google-sync/event-template.md`
    - Map `tasks` → `templates/google-sync/task-template.md`
5. In **Google Sync settings**:
    - Events folder: `events`
    - Tasks folder: `tasks`

## Example template content

### `event-template.md`

```yaml
---
title: <% tp.file.title %>
date: <% tp.date.now("YYYY-MM-DD[T]09:00") %>
end: <% tp.date.now("YYYY-MM-DD[T]10:00") %>
timezone: Pacific/Auckland
location:
description:
status: confirmed
visibility: default
eventType: meeting
color:
guestsCanInviteOthers: true
guestsCanModify: false
guestsCanSeeOtherGuests: true
reminders:
    useDefault: false
    overrides:
        - method: popup
          minutes: 10
attendees:
    required:
        -
    optional:
        -
---
Notes:
    -
```

### `task-template.md`

```yaml
---
title: <% tp.file.title %>
due: <% tp.date.now("YYYY-MM-DD") %>
completed: false
---
Notes:
    -
```

## Screenshot walkthrough

Add these screenshots to make onboarding click-by-click:

1. `docs/assets/templater/templater-settings.png` — Templater settings with:
    - Template folder location = `templates`
    - Trigger on new file creation = On
2. `docs/assets/templater/folder-templates-mapping.png` — Folder Templates mappings:
    - `events` → `templates/google-sync/event-template.md`
    - `tasks` → `templates/google-sync/task-template.md`
3. `docs/assets/templater/google-sync-folders.png` — Google Sync settings showing:
    - Events folder = `events`
    - Tasks folder = `tasks`

Reference them in docs once captured:

```md
![Templater settings](assets/templater/templater-settings.png)
![Folder template mappings](assets/templater/folder-templates-mapping.png)
![Google Sync folder settings](assets/templater/google-sync-folders.png)
```

## Notes

- The script does **not** overwrite existing template files.
- You can change timezone/defaults after generation.
- If your Google Sync folders are different, update both plugin settings and your template workflow to match.
