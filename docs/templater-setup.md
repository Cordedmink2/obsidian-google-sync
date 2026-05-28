# Templater setup for Google Sync

If you use the **Templater** community plugin, you can standardize new event/task notes so they always include the frontmatter fields Google Sync expects.

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

## Manual setup (no script)

1. Create folder: `templates/google-sync/`
2. Add templates:
   - `event-template.md`
   - `task-template.md`
3. In **Templater settings**:
   - Template folder location: `templates`
   - Trigger Templater on new file creation: On
4. In **Google Sync settings**:
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
attendees:
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

## Notes

- The script does **not** overwrite existing template files.
- You can change timezone/defaults after generation.
- If your Google Sync folders are different, update both plugin settings and your template workflow to match.
