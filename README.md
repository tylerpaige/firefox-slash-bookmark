# bookmark-newtab

A Firefox new-tab override that lets you type a bookmark's folder path (e.g.
`further/jira`) and hit Enter to jump straight to it, in the current tab —
which keeps whatever container the tab was already opened in (e.g. via
Easy Container Shortcuts).

## Why

Vimium/Tridactyl can't do this: content scripts can't run on Firefox's native
`about:newtab`, and even extension-provided new-tab URLs can't grab focus away
from the address bar. Firefox's native new-tab *override* mechanism
(`chrome_url_overrides.newtab` in `manifest.json`) is a separate, working code
path that doesn't have this problem (see
[bugzilla 1372996](https://bugzilla.mozilla.org/show_bug.cgi?id=1372996)).

## Try it (dev / temporary install)

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. "Load Temporary Add-on" → select `manifest.json` in this directory.
3. Open a new tab (plain `cmd+t`, or a container tab via Easy Container
   Shortcuts). Type a path from your real bookmarks and hit Enter.

Temporary installs are wiped when Firefox restarts — see below for a
permanent install.

### Spike

`spike/` is a minimal 2-file test of the core focus-stealing assumption,
kept for reference / future regression-checking. Load it the same way via
`about:debugging` if you ever need to re-validate the assumption on a new
Firefox version.

## Permanent install (self-distribution / unlisted signing)

1. Create a free account at <https://addons.mozilla.org/developers/>.
2. `npm install`
3. `npm run lint`
4. Generate an API key/secret at
   <https://addons.mozilla.org/developers/addon/api/key/>, then:
   ```
   npx web-ext sign --api-key=$AMO_JWT_ISSUER --api-secret=$AMO_JWT_SECRET --channel=unlisted
   ```
5. Install the signed `.xpi` from `web-ext-artifacts/` by dragging it onto a
   Firefox window, or via `about:addons` → gear icon → "Install Add-on From
   File…".
6. Any future change requires bumping `version` in `manifest.json` and
   re-running the sign step.

Keep your AMO API key/secret out of this repo (env vars, or a local
gitignored file).
