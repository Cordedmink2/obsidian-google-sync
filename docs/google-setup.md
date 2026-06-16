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
- A free **GitHub account** if you want the no-code bridge-hosting path below. If you already know how to publish a tiny static web page, you can use that instead.

## Choose your setup path

### Path A — simplest, no-code setup (recommended for most people)

Use GitHub Pages to host the tiny return page for you. You do not write code or run commands. You click through Google Cloud, click through GitHub, paste three values into Obsidian, then connect.

Use Path A if you think “OAuth client”, “redirect URI”, or “static host” sounds unfamiliar.

### Path B — advanced / bring your own host

If you are comfortable with static hosting, publish the bridge yourself on Cloudflare Pages, Netlify, your own website, or any HTTPS host. You can either upload the repo’s `bridge/` folder or publish the single-file bridge at [`docs/bridge-one-file.html`](bridge-one-file.html) as `index.html`.

Use Path B if you want more control over the bridge URL or already have hosting.

The Google Cloud steps are the same for both paths. The only difference is how you get your **Redirect bridge URL**.

## Fast exact-match checklist

Before you click **Connect**, make sure these five things are true:

- The Google OAuth client type is **Web application** (not Desktop app).
- The **Google Calendar API** and **Google Tasks API** are both enabled in the same project.
- Your Google account is listed under **Audience → Test users** while the app is in Testing mode.
- Your bridge URL opens in a browser and uses `https://`.
- The bridge URL is copied **exactly** into both Google Cloud and Obsidian, including any trailing slash.

Google's console labels change over time. If you do not see the older **APIs & Services → OAuth consent screen** or **Credentials** pages, look for **Google Auth Platform → Branding**, **Audience**, **Data access**, and **Clients** instead.

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

1. Go to **APIs & Services → OAuth consent screen**. If Google shows the newer layout, use **Google Auth Platform → Branding** first.
2. Choose **External**, then continue. (Workspace users with an internal app can pick **Internal**.)
3. Fill in the required fields — an app name and your email are enough.
4. Open **Audience** (or **Test users** in the older screen) and **add your own Google email address**.
5. Open **Data access** / scopes if prompted and confirm the Calendar and Tasks scopes below are present.
6. Save.

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

### Path A: GitHub Pages (free, no command line)

GitHub calls your own copy of a project a “fork”. In this step, you make your own copy so GitHub can host the tiny return page for you.

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

### Path B: use another HTTPS host

Use this if you already know how to publish a static `index.html` file. If that sounds unfamiliar, use Path A above instead.

Upload everything inside the `bridge/` folder to any HTTPS static host (Cloudflare Pages, Netlify, your own site, etc.) and use the resulting `https://…` address as your bridge URL.

If your host is easiest with one file, copy [`docs/bridge-one-file.html`](bridge-one-file.html), publish it as `index.html`, and use that public `https://…/` address as your bridge URL. It is the same bridge logic in a single self-contained file.

✅ **Done when:** opening your bridge URL in a browser loads a page (it'll say it's missing a code — that's expected).

## Step 5 — Create the OAuth client (your two values)

1. Go to **APIs & Services → Credentials**. In the newer UI, use **Google Auth Platform → Clients**.
2. Click **Create credentials → OAuth client ID** or **Create client**.
3. **Application type: Web application.** Do not choose **Desktop app** for this bridge setup.
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
> If you use **Import from Google** or import-on-startup, do **not** use Templater folder-template auto-runs on Google Sync's managed `events`/`tasks` folders. Templater cannot distinguish notes you create from notes Google Sync imports, so it can overwrite imported notes. Use manual template insertion, or automatic templates in separate draft folders. The [Templater setup](templater-setup.md) guide explains the safe options.

---

## If something goes wrong

Run **Validate setup** first. It checks the local fields and, once connected, checks the chosen calendar and task list.

| Error or symptom | What it usually means | Fix |
| --- | --- | --- |
| `Error 400: redirect_uri_mismatch` | The bridge URL in Google's OAuth client is not an exact match for the plugin setting. | Copy the same bridge URL into Google Cloud and Obsidian. Check `https://`, path, and trailing slash. Confirm the OAuth client type is **Web application**. |
| `access_denied` or “app has not completed verification” | Your app is in Testing mode and your account is not allowed to log in. | Add your Google address under **Audience → Test users**. |
| `invalid_client` | Wrong Client ID/secret, or values copied from a different OAuth client. | Reopen **Google Auth Platform → Clients** and copy the Client ID and secret from the same **Web application** client. |
| `invalid_grant` | The sign-in attempt expired, was already used, or the session was revoked. | Run **Connect to Google** again. |
| Obsidian does not reopen after approval | The bridge loaded, but the `obsidian://google-sync` deep link did not open Obsidian. | Open your bridge URL directly to confirm it loads. Make sure Obsidian is installed and allowed to open `obsidian://` links, especially on iOS. |
| Validate setup cannot find the calendar or task list | The selected calendar/list ID is not visible to this Google account. | Start with `primary` and `@default`; after a basic sync works, use the dropdown pickers in settings. |
| Event times look wrong | The timezone is missing or incorrect. | Add a `timezone` field to the note, or set **Default timezone** correctly in settings. |

### Screenshot checklist for this guide

If you are improving these docs, screenshots should show:

1. Google Cloud project picker and **New project**.
2. API Library search results for **Google Calendar API** and **Google Tasks API**.
3. Google Auth Platform **Branding** required fields.
4. **Audience → Test users** with the user's email added.
5. **Data access** showing the Calendar and Tasks scopes.
6. **Clients** / **Credentials** creating an OAuth client.
7. OAuth client type set to **Web application**.
8. **Authorized redirect URIs** containing the exact bridge URL.
9. GitHub **Settings → Pages** and **Actions → Deploy OAuth bridge to Pages**.
10. The successful GitHub Pages URL.
11. Obsidian plugin settings with Client ID, Client secret, and Redirect bridge URL.
12. Google consent page, successful bridge return, and Obsidian's connected notice.
13. A `redirect_uri_mismatch` screenshot annotated with the exact-match checklist.

## Privacy reminders

- Your tokens and Client secret live only in the plugin's vault-local `data.json`.
- Never publish, share, or commit `.obsidian/plugins/google-sync/data.json`.
- The plugin sends data nowhere except Google and your own redirect page during sign-in. No telemetry.
