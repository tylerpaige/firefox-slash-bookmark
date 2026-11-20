// Loads every bookmark together with its keyword and tags, and learns the
// user's naming conventions from them so new bookmarks can be pre-filled.

// Root containers get short names so folder paths stay typeable
// ("toolbar/FURTHER" rather than "Bookmarks Toolbar/FURTHER").
export const ROOT_NAMES = {
  toolbar_____: "toolbar",
  menu________: "menu",
  unfiled_____: "other",
  mobile______: "mobile",
};
const ROOT_IDS = Object.fromEntries(
  Object.entries(ROOT_NAMES).map(([id, name]) => [name, id])
);

export const DEFAULT_FOLDER = "other";
// A folder typed without a root ("LMNA/git") is created under the toolbar.
const DEFAULT_NEW_FOLDER_ROOT = "toolbar";

export async function loadLibrary() {
  if (!browser.placesMeta) {
    throw new Error(
      "The placesMeta experiment API isn't available. This browser must allow " +
        "WebExtension experiments (Waterfox and unbranded/Developer Edition " +
        "Firefox builds do; release Firefox doesn't)."
    );
  }
  const [[root], meta] = await Promise.all([
    browser.bookmarks.getTree(),
    browser.placesMeta.getAll(),
  ]);

  const keywordsByUrl = groupBy(meta.keywords, "url", "keyword");
  const tagsByUrl = groupBy(meta.tags, "url", "tag");

  const folders = [];
  const bookmarks = [];
  const walk = (node, path) => {
    for (const child of node.children ?? []) {
      if (child.type === "folder") {
        const childPath = path
          ? `${path}/${child.title}`
          : ROOT_NAMES[child.id] ?? child.title;
        folders.push({ id: child.id, path: childPath });
        walk(child, childPath);
      } else if (child.type === "bookmark") {
        bookmarks.push({
          id: child.id,
          parentId: child.parentId,
          folderPath: path,
          title: child.title,
          url: child.url,
          keyword: keywordsByUrl.get(child.url)?.[0] ?? "",
          tags: tagsByUrl.get(child.url) ?? [],
        });
      }
    }
  };
  walk(root, "");

  const titleByUrl = new Map(bookmarks.map((b) => [b.url, b.title]));
  const tagCounts = new Map();
  for (const { tag } of meta.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);

  return {
    folders,
    bookmarks,
    folderByPath: new Map(folders.map((f) => [f.path.toLowerCase(), f])),
    keywords: meta.keywords
      .map((k) => ({ ...k, title: titleByUrl.get(k.url) || k.url }))
      .sort((a, b) => a.keyword.localeCompare(b.keyword)),
    tags: [...tagCounts]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    aliases: learnAliases(bookmarks),
    folderVotes: learnFolderVotes(bookmarks),
  };
}

function groupBy(rows, key, valueKey) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row[key])) map.set(row[key], []);
    map.get(row[key]).push(row[valueKey]);
  }
  return map;
}

export function keywordSegments(keyword) {
  return keyword.split("/").filter(Boolean);
}

// --- Tag suggestions -------------------------------------------------------
//
// Tags tend to be the keyword's segments spelled out: ft/git/be/act is tagged
// ft, git, be, actions. Pair each segment of every keyworded bookmark with
// one of its tags, then remember the most common tag for each segment.

function isAbbreviationOf(abbr, word) {
  if (abbr[0] !== word[0]) return false;
  let i = 0;
  for (const ch of word) if (ch === abbr[i]) i++;
  return i === abbr.length;
}

function alignSegmentsToTags(segments, tags) {
  const pairs = [];
  let segs = [...segments];
  let rest = [...tags];
  const take = (matches) => {
    segs = segs.filter((s) => {
      const t = rest.find((t) => matches(s, t.toLowerCase()));
      if (t === undefined) return true;
      pairs.push([s, t]);
      rest = rest.filter((x) => x !== t);
      return false;
    });
  };
  take((s, t) => s === t);
  take(isAbbreviationOf);
  // ft/jira/sd tagged ft, jira, support: the one leftover of each must pair up.
  if (segs.length === 1 && rest.length === 1) pairs.push([segs[0], rest[0]]);
  return pairs;
}

function learnAliases(bookmarks) {
  const votes = new Map(); // segment -> Map(tag -> count)
  for (const b of bookmarks) {
    if (!b.keyword || !b.tags.length) continue;
    for (const [seg, tag] of alignSegmentsToTags(keywordSegments(b.keyword), b.tags)) {
      if (!votes.has(seg)) votes.set(seg, new Map());
      const counts = votes.get(seg);
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return new Map([...votes].map(([seg, counts]) => [seg, argmax(counts)]));
}

export function suggestTags(keyword, lib) {
  const tags = keywordSegments(keyword).map((seg) => lib.aliases.get(seg) ?? seg);
  return [...new Set(tags)];
}

// --- Folder suggestions ----------------------------------------------------
//
// For each keyword prefix ("ft", "ft/git", ...) count which folders its
// bookmarks live in. Bookmarks sitting loose in "other" are ignored, since
// that's where unorganized bookmarks land anyway.

function learnFolderVotes(bookmarks) {
  const votes = new Map(); // keyword prefix -> Map(folderPath -> count)
  for (const b of bookmarks) {
    if (!b.keyword || b.folderPath === DEFAULT_FOLDER) continue;
    const segs = keywordSegments(b.keyword);
    for (let i = 1; i < segs.length; i++) {
      const prefix = segs.slice(0, i).join("/");
      if (!votes.has(prefix)) votes.set(prefix, new Map());
      const counts = votes.get(prefix);
      counts.set(b.folderPath, (counts.get(b.folderPath) ?? 0) + 1);
    }
  }
  return votes;
}

export function suggestFolder(keyword, lib) {
  const segs = keywordSegments(keyword);
  for (let i = segs.length - 1; i >= 1; i--) {
    const counts = lib.folderVotes.get(segs.slice(0, i).join("/"));
    if (counts) return argmax(counts);
  }
  // No keyworded bookmarks share this prefix yet: fall back to a folder whose
  // name the client segment abbreviates (lmna -> LMNA, ft -> FURTHER),
  // preferring shallow folders so "toolbar/LMNA" beats "toolbar/Archive/LMNA".
  const client = segs.length > 1 ? segs[0] : null;
  if (!client || client.length < 2) return null;
  const candidates = lib.folders.filter((f) => {
    const name = f.path.split("/").at(-1).toLowerCase();
    return name === client || isAbbreviationOf(client, name);
  });
  candidates.sort(
    (a, b) =>
      a.path.split("/").length - b.path.split("/").length ||
      a.path.length - b.path.length
  );
  return candidates[0]?.path ?? null;
}

function argmax(counts) {
  let best = null;
  let bestCount = -1;
  for (const [key, count] of counts) {
    if (count > bestCount) [best, bestCount] = [key, count];
  }
  return best;
}

// --- Folder paths ------------------------------------------------------------

// "LMNA/git" -> "toolbar/LMNA/git"; "" -> "other". Matches existing folders
// case-insensitively so the stored casing wins.
export function normalizeFolderPath(input, lib) {
  const segs = input.split("/").map((s) => s.trim()).filter(Boolean);
  if (!segs.length) return DEFAULT_FOLDER;
  if (!(segs[0].toLowerCase() in ROOT_IDS)) segs.unshift(DEFAULT_NEW_FOLDER_ROOT);
  segs[0] = segs[0].toLowerCase();
  const path = segs.join("/");
  return lib.folderByPath.get(path.toLowerCase())?.path ?? path;
}

export function folderExists(path, lib) {
  return lib.folderByPath.has(path.toLowerCase());
}

// Returns the folder id for `path`, creating any missing folders on the way.
async function ensureFolder(path, lib) {
  const [rootName, ...segs] = path.split("/");
  let parentId = ROOT_IDS[rootName];
  let current = rootName;
  for (const seg of segs) {
    current += `/${seg}`;
    let folder = lib.folderByPath.get(current.toLowerCase());
    if (!folder) {
      const created = await browser.bookmarks.create({ parentId, title: seg });
      folder = { id: created.id, path: current };
      lib.folders.push(folder);
      lib.folderByPath.set(current.toLowerCase(), folder);
    }
    parentId = folder.id;
  }
  return parentId;
}

export function rankFolders(query, lib) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const scored = [];
  for (const folder of lib.folders) {
    const hay = folder.path.toLowerCase();
    const idx = hay.indexOf(needle);
    if (idx === -1) continue;
    let score = -idx * 2 - hay.length * 0.01;
    if (hay === needle) score += 1000;
    if (idx === 0 || hay[idx - 1] === "/") score += 50;
    scored.push({ folder, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.folder);
}

// --- Writes ------------------------------------------------------------------

// Keywords and tags belong to the URL, not the bookmark, so once no bookmark
// is left for a URL they're cleared too.
async function clearOrphanedUrl(url) {
  const remaining = await browser.bookmarks.search({ url }).catch(() => []);
  if (remaining.length) return;
  await browser.placesMeta.setKeyword(url, "");
  await browser.placesMeta.setTags(url, []);
}

export async function saveBookmark(lib, existing, { title, url, folder, keyword, tags }) {
  const parentId = await ensureFolder(normalizeFolderPath(folder, lib), lib);
  if (existing) {
    if (title !== existing.title || url !== existing.url) {
      await browser.bookmarks.update(existing.id, { title, url });
    }
    if (parentId !== existing.parentId) {
      await browser.bookmarks.move(existing.id, { parentId });
    }
  } else {
    await browser.bookmarks.create({ parentId, title, url });
  }
  await browser.placesMeta.setKeyword(url, keyword);
  await browser.placesMeta.setTags(url, tags);
  if (existing && existing.url !== url) await clearOrphanedUrl(existing.url);
}

export async function deleteBookmark(existing) {
  await browser.bookmarks.remove(existing.id);
  await clearOrphanedUrl(existing.url);
}
