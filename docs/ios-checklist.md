# iOS and iPadOS checklist

Use this checklist before relying on the plugin on your phone. Automated tests cover desktop and an emulated mobile Obsidian environment; this checklist is for a real iPhone/iPad with real Obsidian and Google.

## Install on iPhone/iPad

After the plugin is accepted into the Obsidian community directory:

1. Open Obsidian on iOS/iPadOS.
2. Go to **Settings → Community plugins**.
3. Select **Browse**.
4. Search for **Google Calendar and Tasks Sync**.
5. Select **Install**, then **Enable**.

For manual beta testing before community approval, sync these files into your vault at `.obsidian/plugins/google-sync/`:

```text
main.js
manifest.json
styles.css
```

Then restart Obsidian and enable the plugin under **Settings → Community plugins**.

## Setup prerequisites

- [ ] The vault opens normally on the phone.
- [ ] Community plugins are enabled.
- [ ] The plugin is enabled.
- [ ] The same OAuth client ID, client secret, and redirect bridge URL are entered as on desktop.
- [ ] The redirect bridge URL is reachable in Safari.
- [ ] The default calendar/task list settings are correct.

See [google-setup.md](google-setup.md) for the full Google setup.

## Authentication path

This is the most important mobile-specific flow.

- [ ] Run **Connect to Google** from the command palette.
- [ ] Safari or the system browser opens the Google consent page.
- [ ] Approve access.
- [ ] The bridge page opens an `obsidian://google-sync` link.
- [ ] Obsidian reopens.
- [ ] Obsidian shows **Connected to Google.**
- [ ] **Test connection** reports OK.
- [ ] Force-quit and reopen Obsidian.
- [ ] **Test connection** still reports OK, proving tokens persisted.

## Event sync tests

Use a spare calendar for the first run.

- [ ] Create `events/mobile-test.md` with:

    ```yaml
    ---
    title: Mobile test event
    date: 2026-06-02T10:00
    end: 2026-06-02T10:30
    timezone: Pacific/Auckland
    ---
    ```

- [ ] Run **Push updates to Google**.
- [ ] Confirm the event appears in Google Calendar at the right time.
- [ ] Confirm the note now has a `googleId` frontmatter field.
- [ ] Change the title in Obsidian and run **Push updates to Google** again.
- [ ] Confirm Google Calendar updated the existing event instead of creating a duplicate.
- [ ] Try an all-day event with `allDay: true`.
- [ ] Delete the test note and confirm the Google event is **not** deleted. This plugin intentionally never deletes Google events or tasks.

## Task sync tests

Use a spare Google Tasks list for the first run.

- [ ] Create `tasks/mobile-test.md` with:

    ```yaml
    ---
    title: Mobile test task
    due: 2026-06-03
    completed: false
    ---
    Notes from iPhone.
    ```

- [ ] Run **Push updates to Google**.
- [ ] Confirm the task appears in Google Tasks.
- [ ] Confirm the note now has a `googleId` frontmatter field.
- [ ] Set `completed: true` and run **Push updates to Google** again.
- [ ] Confirm Google Tasks marks it complete.

## Google import tests

- [ ] Create one test event directly in Google Calendar.
- [ ] Create one test task directly in Google Tasks.
- [ ] Run **Import events and tasks from Google** in Obsidian.
- [ ] Confirm the event note appears under `events/`.
- [ ] Confirm the task note appears under `tasks/`.
- [ ] Enable **Import from Google on startup** only if you want startup imports.
- [ ] Reopen Obsidian and confirm only new missing Google items are added; existing imported notes should not be overwritten during startup import.

## Lifecycle tests

- [ ] Create a past event and run **Run lifecycle scan**.
- [ ] Confirm it moves to `events/archive/`.
- [ ] Create an overdue incomplete task and run **Run lifecycle scan**.
- [ ] Confirm it moves to `tasks/overdue/`.
- [ ] Create a completed task and run **Run lifecycle scan**.
- [ ] Confirm it moves to `tasks/completed/`.

## Network checks

- [ ] Repeat **Test connection** on Wi‑Fi.
- [ ] Repeat **Test connection** on cellular.
- [ ] Confirm no repeated Google rate-limit errors appear.

## What is expected on mobile

- The plugin uses Obsidian’s mobile-safe `requestUrl` API for Google calls.
- It uses Obsidian’s Vault API for file writes, not Node filesystem APIs.
- It is marked `isDesktopOnly: false` in `manifest.json`.
- OAuth uses a hosted HTTPS bridge plus `obsidian://google-sync` deep link.

## If something fails

- Run **Validate setup** and fix any missing setting first.
- Check that your bridge URL exactly matches the Google Cloud OAuth redirect URI.
- Reconnect with **Disconnect from Google**, then **Connect to Google**.
- Test on a spare calendar/task list before using real data.
