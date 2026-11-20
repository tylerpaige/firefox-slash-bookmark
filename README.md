# /bookmark

Keyboard-first bookmarks for Waterfox, in one extension:

- **New tab page**: type a bookmark's folder path (`further/jira`) or its
  keyword (`ft/jira`) and press Enter to go there.
- **Bookmark editor**: a replacement for the add/edit bookmark dialog with the
  **keyword** field that Firefox's star dialog leaves out, plus title, folder,
  tags and URL. It fills in the folder and tags from the keyword using your
  existing conventions.

## Usage

### New tab

Open a new tab and start typing. Results match on folder path
(`FURTHER/Jira`) and on keyword (`ft/jira`), with the keyword shown on the
right. <kbd>↑</kbd>/<kbd>↓</kbd> choose a result and <kbd>enter</kbd> opens it
in the current tab, which keeps the tab's container (e.g. one opened via Easy
Container Shortcuts). <kbd>tab</kbd> completes one segment at a time. Folder
paths are tried first, then keywords (`ft/gi` → `ft/git`).

If focus lands in the address bar, press <kbd>esc</kbd> or <kbd>f6</kbd> to
move it to the page.

Vimium and Tridactyl can't do this. Content scripts can't run on Firefox's
native `about:newtab`, and an extension's new-tab URL can't take focus away
from the address bar. Firefox's new-tab *override*
(`chrome_url_overrides.newtab` in `manifest.json`) uses a separate code path
that doesn't have this problem (see
[bugzilla 1372996](https://bugzilla.mozilla.org/show_bug.cgi?id=1372996)).

### Bookmark editor

**<kbd>alt</kbd>+<kbd>shift</kbd>+<kbd>d</kbd>** (or the toolbar button) opens
the editor for the current page. If the page is already bookmarked, it edits
that bookmark.

| Field   | What it does |
| ------- | ------------ |
| Keyword | Focused first. Lists existing keywords that start with what you've typed. <kbd>tab</kbd> completes the current segment shell-style (`ft/gi` → `ft/git`). Warns if the keyword already belongs to another URL. |
| Title   | Pre-filled with the page title. |
| Folder  | A path like `toolbar/FURTHER` or `other`. Matches by substring (`furt` → `toolbar/FURTHER`). If you type a path that doesn't exist, the folders are created on save. Without a root, the path goes under the toolbar (`LMNA/git` → `toolbar/LMNA/git`). |
| Tags    | Comma-separated, with completion from your existing tags. |
| URL     | Editable. If you change it, the keyword and tags move to the new URL. |

Keys: <kbd>enter</kbd> saves, <kbd>esc</kbd> cancels, <kbd>↑</kbd>/<kbd>↓</kbd>
pick a suggestion, <kbd>tab</kbd> completes (or moves to the next field when
there's nothing to complete), and <kbd>⌘</kbd>+<kbd>shift</kbd>+<kbd>⌫</kbd>
deletes the bookmark.

### Suggestions learned from your bookmarks

Until you edit them directly, **folder** and **tags** follow the keyword as you
type:

- **Folder:** taken from where your other bookmarks with the same keyword
  prefix live (`ft/…` → `toolbar/FURTHER`). If no bookmarks share the prefix
  yet, it looks for a folder whose name the client segment abbreviates
  (`lmna` → `toolbar/LMNA`).
- **Tags:** your keyword's segments, spelled out the way you've tagged them
  before. The extension learns that `act` means `actions`, `v` means
  `releases`, `sd` means `support`, `ec` means `economy`, and so on, so
  `lmna/git/be/act` suggests `lmna, git, be, actions`.

This applies to new bookmarks, and also to bookmarks that look freshly made
with the native star dialog (sitting loose in Other Bookmarks, or untagged).
So pressing <kbd>⌘</kbd>+<kbd>d</kbd> out of habit and then
<kbd>alt</kbd>+<kbd>shift</kbd>+<kbd>d</kbd> works too.

### Manager

**<kbd>alt</kbd>+<kbd>shift</kbd>+<kbd>b</kbd>** (or "Manage all bookmarks" in
the popup) opens a full-page list of every bookmark with its keyword, folder
and tags. Type to filter. <kbd>alt</kbd>+<kbd>k</kbd> shows only bookmarks
without a keyword, and <kbd>alt</kbd>+<kbd>t</kbd> shows only bookmarks without
tags. <kbd>↑</kbd>/<kbd>↓</kbd> and <kbd>enter</kbd> open the same editor. It's
meant for back-filling keywords onto existing bookmarks.

You can change both shortcuts in `about:addons` → gear icon → Manage Extension
Shortcuts.

## How it works (and why it needs Waterfox)

The WebExtension `bookmarks` API can't read or write keywords or tags
([bugzilla 1225916](https://bugzilla.mozilla.org/show_bug.cgi?id=1225916)).
This extension includes a small **WebExtension Experiment**
(`experiments/places-meta/`) that calls Firefox's internal Places code
(`PlacesUtils.keywords`, `PlacesUtils.tagging`), the same code the native
dialog uses.

Experiments only load in builds that don't enforce add-on signing. Waterfox is
one of them: it ships `xpinstall.signatures.required = false` and
`extensions.experiments.enabled = true` by default. Release Firefox doesn't
allow experiments, so this won't run there. Developer Edition, Nightly and
unbranded builds would run it.

Keywords and tags belong to a URL, not to a bookmark, the same as in Firefox
itself. If you delete a bookmark or change its URL and no other bookmark has
that URL, the old URL's keyword and tags are cleared.

## Install

This extension replaces the separate `bookmark-newtab` extension
(`firefox-bookmark-searcher`). Uninstall that one first, or the two new-tab
overrides will compete.

No signing needed:

```
npm install
npm run build
```

Then in Waterfox, go to `about:addons` → gear icon → **Install Add-on From
File…** and choose the `.xpi` in `web-ext-artifacts/`. For changes, bump `version` in
`manifest.json`, rebuild and reinstall.

For development, `npm run run` launches Waterfox with a throwaway profile and
the extension loaded. You can also load `manifest.json` as a temporary add-on
from `about:debugging`.

`npm run lint` reports `MANIFEST_FIELD_PRIVILEGED` for `experiment_apis`. That
only matters for publishing on addons.mozilla.org, so you can ignore it.
