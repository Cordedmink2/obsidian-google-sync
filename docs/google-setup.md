# Google setup guide

This guide walks through the one-time Google setup for **Google Calendar and Tasks Sync**.

The plugin uses **your own Google OAuth client**. There is no shared backend service for your calendar/task data: Obsidian talks directly to Google, and OAuth tokens are stored in your vault’s local plugin data.

## What you need before starting

- A Google account.
- Access to <https://console.cloud.google.com/>.
- A place to host one tiny static redirect page, such as GitHub Pages, Cloudflare Pages, Netlify, or any static web host.
- Obsidian installed on desktop first. Do the initial setup on desktop, then use the same settings on phone/tablet.

## 1. Create or choose a Google Cloud project

1. Open <https://console.cloud.google.com/>.
2. Use the project picker at the top of the page.
3. Create a new project or select an existing personal project.

## 2. Enable the Google APIs

1. Go to **APIs & Services → Library**.
2. Search for **Google Calendar API** and select **Enable**.
3. Search for **Google Tasks API** and select **Enable**.

## 3. Configure the OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**.
2. Choose **External** unless you are using a Google Workspace internal app.
3. Fill in the required app name/contact fields.
4. Add your Google account under **Test users**.

You can keep the app in Google’s **Testing** mode for personal use. That avoids a public Google verification process, but only listed test users can sign in.

The plugin requests these scopes when you sign in:

```text
https://www.googleapis.com/auth/calendar
https://www.googleapis.com/auth/tasks
```

## 4. Host the redirect bridge

Google requires an HTTPS redirect URL for a web OAuth client. Obsidian itself uses an `obsidian://` deep link, so this repo includes a tiny static bridge page that forwards Google’s one-time code back to Obsidian.

The bridge files are in:

```text
bridge/index.html
bridge/redirect.js
```

### Easiest option: GitHub Pages

If you are using your own fork/repo:

1. In GitHub, open **Settings → Pages**.
2. Set **Source** to **GitHub Actions**.
3. Run the included **Deploy OAuth bridge to Pages** workflow, or push to trigger it if configured.
4. Copy the published Pages URL.

The URL will look similar to:

```text
https://YOUR-USER.github.io/obsidian-google-sync/
```

Use that exact URL as your **redirect bridge URL**.

### Other static hosts

Upload the contents of `bridge/` to any HTTPS static host and use the resulting public URL.

The bridge does not contain your Google secret and cannot use the authorization code by itself. It only redirects the browser to Obsidian with the code.

## 5. Create the OAuth client

1. Go to **APIs & Services → Credentials**.
2. Select **Create credentials → OAuth client ID**.
3. Application type: **Web application**.
4. Under **Authorized redirect URIs**, add your bridge URL exactly.
5. Create the client.
6. Copy the **Client ID** and **Client secret**.

## 6. Configure Obsidian

In Obsidian, go to **Settings → Google Calendar and Tasks Sync** and fill in:

- **OAuth client ID** — from Google Cloud.
- **OAuth client secret** — from Google Cloud.
- **Redirect bridge URL** — the hosted bridge URL from step 4.
- **Default calendar ID** — use `primary` unless you want a specific calendar.
- **Task list ID** — use `@default` unless you want a specific Google Tasks list.
- **Default timezone** — an IANA timezone such as `Pacific/Auckland`.

Then run these commands from the command palette:

1. **Connect to Google**.
2. Approve the consent screen in the browser.
3. Return to Obsidian when the bridge opens the `obsidian://google-sync` link.
4. Run **Validate setup**.
5. Run **Test connection**.

## Optional: Templater workflow (recommended)

To create clean event/task notes quickly, you can pair this plugin with the **Templater** community plugin.

- Install link: `obsidian://show-plugin?id=templater-obsidian`
- Setup guide: [Templater setup](templater-setup.md)
- Scripted scaffold:

```bash
./scripts/setup-templater.sh /path/to/your/vault --configure-templater
```

This gives you prebuilt event/task templates and can auto-configure Templater’s template folder + trigger-on-create behavior.

Then add the folder mappings in Obsidian:
- `events` → `templates/google-sync/event-template.md`
- `tasks` → `templates/google-sync/task-template.md`

## 7. Test with safe data first

Before syncing important real calendars/tasks:

1. Create a spare Google calendar or task list.
2. Configure the plugin to use that calendar/list.
3. Create one test event note in `events/`.
4. Create one test task note in `tasks/`.
5. Run **Sync now**.
6. Confirm the event/task appears in Google.
7. Try **Import events and tasks from Google** and confirm notes are created in the vault.

## Phone setup

Once desktop works, sync/copy the plugin settings and files to your phone via Obsidian Sync, iCloud, git, or your normal vault sync method. Then follow:

- [iOS checklist](ios-checklist.md)

## Privacy notes

- Tokens and the OAuth client secret are stored in the plugin’s vault-local `data.json`.
- Do not publish or share `.obsidian/plugins/google-sync/data.json`.
- Do not commit a real `data.json` to git.
- The plugin has no telemetry and does not send data anywhere except Google Calendar/Tasks and your redirect bridge during sign-in.

## Common problems

### Google says redirect URI mismatch

The URL in Google Cloud must exactly match the plugin setting and hosted bridge URL, including trailing slash.

### Obsidian does not reopen after login

Open the bridge URL directly in a browser and confirm the page loads. On iOS, make sure Obsidian is installed and can open `obsidian://` links.

### Validate setup cannot find the calendar or task list

Use `primary` and `@default` first. Once that works, use the settings pickers to select a specific calendar or task list.

### Times are off

Add a `timezone` field to event notes or set **Default timezone** correctly in settings.
