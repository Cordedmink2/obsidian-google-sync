# Google setup guide

This is the one-time setup that lets **Google Calendar and Tasks Sync** talk to your Google account.

It looks long, but most steps are a few clicks. Plan for about **15–20 minutes**, do it **once on a desktop computer**, and you won't have to repeat it — your phone just reuses the same settings later.

## Why there are extra steps

This plugin has **no shared server**. Obsidian talks straight to Google using a Google "app" that **you** own, and your login tokens stay in your own vault. That's more private, but it means you create that Google app yourself. These steps are just that.

## The whole thing in plain English

You will:

1. Create a free **Google Cloud project** (a container for your app).
2. Turn on the **Calendar** and **Tasks** APIs.
3. Say **who is allowed to log in** (just you).
4. Put a tiny **redirect page** online (this is the only fiddly step — there's a one-click path below).
5. Create an **OAuth client** and copy two values: a **Client ID** and a **Client secret**.
6. Paste those into the plugin and click **Connect**.

### A few words you'll see

- **OAuth client** — your Google app's identity. Comes as a **Client ID** (public) and **Client secret** (keep private).
- **Redirect / bridge page** — after you approve access in your browser, Google needs a web address to send you back to. Obsidian can't be a web address directly, so this little page catches Google's response and bounces it into Obsidian.
- **Scopes** — the permissions you're granting. This plugin asks for Calendar and Tasks access, nothing else.

## Before you start

- A Google account.
- A computer with Obsidian and this plugin installed.
- A free **GitHub account** (used for the easiest redirect-page option below). If you'd rather use another host, that works too.

---

## Step 1 — Create a Google Cloud project

1. Go to <https://console.cloud.google.com/>.
2. Click the **project picker** at the top of the page.
3. Click **New Project**, give it any name (e.g. `Obsidian Sync`), and create it.
4. Make sure that new project is **selected** in the picker before continuing.

✅ **Done when:** the project name shows at the top of the console.

## Step 2 — Turn on the two Google APIs

1. In the left menu, go to **APIs & Services → Library**.
2. Search **Google Calendar API**, open it, click **Enable**.
3. Go back to the Library, search **Google Tasks API**, open it, click **Enable**.

✅ **Done when:** both APIs show **API Enabled** with a green check.

## Step 3 — Say who can log in

1. Go to **APIs & Services → OAuth consent screen**.
2. Choose **External**, then continue. (Workspace users with an internal app can pick **Internal**.)
3. Fill in the required fields — an app name and your email are enough.
4. Find **Test users** and **add your own Google email address**.
5. Save.

You can leave the app in **Testing** mode forever for personal use. That skips Google's public review — the only catch is that **only the test users you listed can log in**, which is exactly what you want.

> The plugin requests only these permissions:
>
> ```text
> https://www.googleapis.com/auth/calendar
> https://www.googleapis.com/auth/tasks
> ```

✅ **Done when:** your email is listed under **Test users**.

## Step 4 — Put the redirect page online

This is the only tricky part — take your time, it's a one-time thing.

The plugin includes a tiny page (in the `bridge/` folder) that does one job: catch Google's reply and hand it back to Obsidian. It contains **no secrets** and can't do anything on its own.

### Easiest path: GitHub Pages (free, no command line)

1. Open this project on GitHub and click **Fork** (top-right) to make your own copy.
2. In **your fork**, go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions**.
4. Go to the **Actions** tab, find **Deploy OAuth bridge to Pages**, and click **Run workflow** (on the `main` branch).
5. Wait for it to finish (about a minute), then reopen **Settings → Pages** — your live address is shown there.

It will look like this — **copy it exactly, including the trailing slash**:

```text
https://YOUR-USERNAME.github.io/obsidian-google-sync/
```

This is your **Redirect bridge URL**. Keep it handy for Steps 5 and 6.

### Prefer a different host?

Upload everything inside the `bridge/` folder to any HTTPS static host (Cloudflare Pages, Netlify, your own site, etc.) and use the resulting `https://…` address as your bridge URL.

✅ **Done when:** opening your bridge URL in a browser loads a page (it'll say it's missing a code — that's expected).

## Step 5 — Create the OAuth client (your two values)

1. Go to **APIs & Services → Credentials**.
2. Click **Create credentials → OAuth client ID**.
3. **Application type: Web application.**
4. Under **Authorized redirect URIs**, click **Add URI** and paste your bridge URL from Step 4 — **exactly**, including the trailing slash.
5. Click **Create**.
6. A box pops up with your **Client ID** and **Client secret**. Copy both somewhere safe for the next step.

✅ **Done when:** you have a Client ID and a Client secret copied down.

## Step 6 — Put it all into Obsidian

In Obsidian, open **Settings → Google Calendar and Tasks Sync** and fill in:

- **OAuth client ID** — from Step 5.
- **OAuth client secret** — from Step 5.
- **Redirect bridge URL** — from Step 4 (must match exactly).
- **Default calendar ID** — leave as `primary` for now.
- **Task list ID** — leave as `@default` for now.
- **Default timezone** — your IANA timezone, e.g. `Pacific/Auckland`.

Then, from the command palette (Ctrl/Cmd-P):

1. Run **Connect to Google**.
2. Approve access in the browser that opens.
3. The bridge page sends you back to Obsidian automatically.
4. Run **Validate setup** — it checks each piece and tells you what (if anything) is missing.
5. Run **Test connection** for a final all-clear.

✅ **Done when:** **Validate setup** reports everything is OK.

---

## Step 7 — Try it safely first

Before pointing it at your real calendar, do a dry run:

1. Create a spare Google calendar or task list, and select it in the plugin settings.
2. Add one test note in your `events/` folder and one in `tasks/`.
3. Run **Sync now** and confirm they appear in Google.
4. Run **Import events and tasks from Google** and confirm notes appear in your vault.

When you're happy, switch the plugin back to your real calendar/list.

## Setting up your phone

Once desktop works, get the same vault (including the plugin's settings) onto your phone via Obsidian Sync, iCloud, git, or however you sync — then follow the [iOS checklist](ios-checklist.md). You do **not** repeat the Google Cloud steps.

## Optional: faster note creation with Templater

To get clean event/task notes with one click, pair this with the **Templater** community plugin.

- Install link: `obsidian://show-plugin?id=templater-obsidian`
- Setup guide: [Templater setup](templater-setup.md)

> [!WARNING]
> If you use **Import from Google** (or import-on-startup), do **not** combine Templater folder templates on `events`/`tasks` with "trigger on new file creation" — it overwrites imported notes. The [Templater setup](templater-setup.md) guide explains the safe options.

---

## If something goes wrong

### "redirect_uri_mismatch"

Your bridge URL must be **identical** in all three places: the Google OAuth client, the plugin setting, and the page that's actually live — **including the trailing slash**. Copy-paste the same string everywhere.

### Obsidian doesn't reopen after you approve access

Open your bridge URL directly in a browser to confirm it loads. Make sure Obsidian is installed and can open `obsidian://` links (especially on iOS).

### "access_denied" or it won't let you log in

Your Google account must be listed under **Test users** (Step 3) while the app is in Testing mode.

### Validate setup can't find the calendar or task list

Start with `primary` and `@default`. Once a basic sync works, use the dropdown pickers in settings to choose a specific calendar or list.

### Event times look wrong

Add a `timezone` field to the note, or set **Default timezone** correctly in settings.

## Privacy reminders

- Your tokens and Client secret live only in the plugin's vault-local `data.json`.
- Never publish, share, or commit `.obsidian/plugins/google-sync/data.json`.
- The plugin sends data nowhere except Google and your own redirect page during sign-in. No telemetry.
