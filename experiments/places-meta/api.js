"use strict";

/* global ExtensionAPI, ChromeUtils */

// Privileged ("experiment") side of the extension. The WebExtension bookmarks
// API has no access to keywords or tags (bugzilla 1225916), so this talks to
// Places directly — the same calls Firefox's own bookmark dialog makes.
//
// `var` rather than `const`: experiment scripts can share a global with other
// API scripts, and a duplicate `const` would be a redeclaration error.

var { PlacesUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/PlacesUtils.sys.mjs"
);
var { ExtensionError } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionUtils.sys.mjs"
);

var KEYWORDS_SQL = `
  SELECT k.keyword, h.url
  FROM moz_keywords k
  JOIN moz_places h ON h.id = k.place_id`;

// Tags are folders under the tags root; each tagged URL is a child bookmark.
var TAGS_SQL = `
  SELECT t.title AS tag, h.url
  FROM moz_bookmarks b
  JOIN moz_bookmarks t ON t.id = b.parent
  JOIN moz_places h ON h.id = b.fk
  WHERE t.parent = (SELECT id FROM moz_bookmarks WHERE guid = :tagsGuid)
  ORDER BY b.id`;

// Errors thrown from the parent process reach the extension as "An unexpected
// error occurred" unless they're ExtensionErrors.
function exposeErrors(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      throw new ExtensionError(e?.message ?? String(e));
    }
  };
}

this.placesMeta = class extends ExtensionAPI {
  getAPI() {
    return {
      placesMeta: {
        getAll: exposeErrors(async () => {
          const db = await PlacesUtils.promiseDBConnection();
          const [keywordRows, tagRows] = await Promise.all([
            db.executeCached(KEYWORDS_SQL),
            db.executeCached(TAGS_SQL, {
              tagsGuid: PlacesUtils.bookmarks.tagsGuid,
            }),
          ]);
          return {
            keywords: keywordRows.map((r) => ({
              keyword: r.getResultByName("keyword"),
              url: r.getResultByName("url"),
            })),
            tags: tagRows.map((r) => ({
              tag: r.getResultByName("tag"),
              url: r.getResultByName("url"),
            })),
          };
        }),

        setKeyword: exposeErrors(async (url, keyword) => {
          keyword = keyword.trim().toLowerCase();
          const existing = [];
          await PlacesUtils.keywords.fetch({ url }, (e) => existing.push(e));
          for (const entry of existing) {
            if (entry.keyword !== keyword) {
              await PlacesUtils.keywords.remove(entry.keyword);
            }
          }
          if (keyword && !existing.some((e) => e.keyword === keyword)) {
            // insert() reassigns the keyword if another URL already has it.
            await PlacesUtils.keywords.insert({ keyword, url });
          }
        }),

        setTags: exposeErrors(async (url, tags) => {
          const uri = PlacesUtils.toURI(url);
          const wanted = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
          const wantedLower = wanted.map((t) => t.toLowerCase());
          const current = PlacesUtils.tagging.getTagsForURI(uri);
          const currentLower = current.map((t) => t.toLowerCase());

          const toRemove = current.filter(
            (t) => !wantedLower.includes(t.toLowerCase())
          );
          if (toRemove.length) PlacesUtils.tagging.untagURI(uri, toRemove);

          // Re-tagging an existing tag with different casing renames it, which
          // matches what Firefox's own dialog does.
          const toAdd = wanted.filter(
            (t, i) => !currentLower.includes(wantedLower[i]) || !current.includes(t)
          );
          if (toAdd.length) PlacesUtils.tagging.tagURI(uri, toAdd);
        }),
      },
    };
  }
};
