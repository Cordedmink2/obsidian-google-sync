# Release notes — v0.3.14

## Google auth setup improvements 🚀

This release makes the biggest change to onboarding since the plugin was first released: the Google auth setup guides and in-app tools have been completely overhauled to reduce confusion for non-technical users.

### What changed

**New beginner-friendly setup guide**
`docs/google-setup-simple.md` — a plain-language guide for people who don't use Google Cloud or GitHub regularly. Uses simple step-by-step instructions, direct links to the pages you need, and no developer jargon.

The existing `docs/google-setup.md` is now the advanced reference guide, with a header pointing beginners to the simpler version.

**In-app setup help**
- "Setup help" section with both **Open simple guide** and **Advanced guide** buttons.
- **Open Google setup pages** button that opens all four Google Cloud console pages in one click (projects, APIs, audience, clients).
- **Test bridge URL** button that checks if your redirect bridge page is live and serving the right content *before* you attempt authentication.
- **Open bridge URL** and **Copy bridge URL** buttons under the redirect URI field.
- Validated OAuth Client ID field that warns if the value doesn't look like a Google credential.
- Validated redirect URI field that trims whitespace and checks for HTTPS.

**Better error messages**
- Google OAuth errors (`redirect_uri_mismatch`, `invalid_client`, `access_denied`, etc.) now show specific, actionable advice instead of a raw error code.
- The **Validate setup** command gives clearer feedback on what's missing.

**One-file bridge**
Added `docs/bridge-one-file.html` — a self-contained static bridge page. Instead of forking the whole repo, you can publish this single file as `index.html` on any HTTPS static host.

**Updated iOS checklist**
Fixed incorrect documentation about event/task deletion.

### Before upgrading
No breaking changes. Your existing settings, OAuth client, and bridge page will continue to work exactly as before.

### After upgrading
Open **Settings → Google Calendar and Tasks Sync** to see the new setup help buttons. If you ever need to help someone else set up the plugin, point them to `docs/google-setup-simple.md`.
