const ROOT_CONTAINER_IDS = new Set([
  "toolbar_____",
  "menu________",
  "unfiled_____",
  "mobile______",
]);

const MAX_RESULTS = 20;

let index = [];
let tree = { children: {} };
let matches = [];
let selectedIndex = 0;

const queryEl = document.getElementById("query");
const resultsEl = document.getElementById("results");

function walk(node, pathSoFar, out) {
  if (node.url) {
    const path = [...pathSoFar, node.title].join("/");
    out.push({ path, url: node.url });
    return;
  }
  if (!node.children) return; // separator or empty node

  const nextPath = ROOT_CONTAINER_IDS.has(node.id)
    ? pathSoFar
    : node.title
    ? [...pathSoFar, node.title]
    : pathSoFar;

  for (const child of node.children) {
    walk(child, nextPath, out);
  }
}


// Builds a nested structure mirroring the bookmark folder hierarchy, keyed by
// lowercased segment name, for Tab-completion of one path segment at a time.
// Root-container folders (toolbar/menu/unfiled/mobile) are transparent, same
// as in walk() above.
function buildTreeNode(node, treeNode) {
  if (!node.children) return; // bookmark leaf or separator, nothing to recurse into

  for (const child of node.children) {
    if (ROOT_CONTAINER_IDS.has(child.id)) {
      buildTreeNode(child, treeNode);
      continue;
    }
    if (!child.title) continue;

    const key = child.title.toLowerCase();
    if (!treeNode.children[key]) {
      treeNode.children[key] = { name: child.title, children: {}, url: null };
    }
    const childTreeNode = treeNode.children[key];
    if (child.url) {
      childTreeNode.url = child.url;
    } else {
      buildTreeNode(child, childTreeNode);
    }
  }
}

async function loadBookmarks() {
  const roots = await browser.bookmarks.getTree();
  const flatIndex = [];
  walk(roots[0], [], flatIndex);
  const treeRoot = { children: {} };
  buildTreeNode(roots[0], treeRoot);
  return { flatIndex, treeRoot };
}

function findTreeNode(segments) {
  let cur = tree;
  for (const seg of segments) {
    cur = cur.children[seg.toLowerCase()];
    if (!cur) return null;
  }
  return cur;
}

function completePathSegment(value) {
  const lastSlash = value.lastIndexOf("/");
  const prefixPath = lastSlash === -1 ? "" : value.slice(0, lastSlash);
  const partial = lastSlash === -1 ? value : value.slice(lastSlash + 1);
  const segments = prefixPath === "" ? [] : prefixPath.split("/");

  const node = findTreeNode(segments);
  if (!node) return null;

  const partialLower = partial.toLowerCase();
  const matchingKeys = Object.keys(node.children).filter((k) =>
    k.startsWith(partialLower)
  );
  if (matchingKeys.length === 0) return null;

  if (matchingKeys.length === 1) {
    const only = node.children[matchingKeys[0]];
    let completed = only.name;
    if (Object.keys(only.children).length > 0) completed += "/";
    const newValue = (prefixPath === "" ? "" : prefixPath + "/") + completed;
    return newValue === value ? null : newValue;
  }

  // Multiple candidates: complete to their longest common prefix, like shell tab-completion.
  const names = matchingKeys.map((k) => node.children[k].name);
  let lcp = names[0];
  for (const name of names.slice(1)) {
    let i = 0;
    while (
      i < lcp.length &&
      i < name.length &&
      lcp[i].toLowerCase() === name[i].toLowerCase()
    ) {
      i++;
    }
    lcp = lcp.slice(0, i);
  }
  if (lcp.length <= partial.length) return null;
  return (prefixPath === "" ? "" : prefixPath + "/") + lcp;
}

function score(entry, needle) {
  const haystack = entry.path.toLowerCase();
  const idx = haystack.indexOf(needle);
  if (idx === -1) return null;

  let s = 0;
  if (haystack === needle) s += 1000;
  if (idx === 0 || haystack[idx - 1] === "/") s += 50;
  s -= idx * 2;
  s -= haystack.length * 0.01;
  return s;
}

function filterAndSort(entries, rawQuery) {
  const needle = rawQuery.trim().toLowerCase();
  if (!needle) return [];

  const scored = [];
  for (const entry of entries) {
    const sc = score(entry, needle);
    if (sc !== null) scored.push({ entry, sc });
  }
  scored.sort((a, b) => b.sc - a.sc);
  return scored.slice(0, MAX_RESULTS).map((x) => x.entry);
}

function render() {
  resultsEl.innerHTML = "";
  matches.forEach((m, i) => {
    const li = document.createElement("li");
    li.textContent = m.path;
    if (i === selectedIndex) li.classList.add("selected");
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      navigate(m.url);
    });
    resultsEl.appendChild(li);
  });
}

function navigate(url) {
  location.replace(url);
}

queryEl.addEventListener("input", () => {
  matches = filterAndSort(index, queryEl.value);
  selectedIndex = 0;
  render();
});

queryEl.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") {
    if (matches.length > 0) {
      selectedIndex = Math.min(selectedIndex + 1, matches.length - 1);
      render();
    }
    e.preventDefault();
  } else if (e.key === "ArrowUp") {
    if (matches.length > 0) {
      selectedIndex = Math.max(selectedIndex - 1, 0);
      render();
    }
    e.preventDefault();
  } else if (e.key === "Enter") {
    if (matches.length > 0) {
      navigate(matches[selectedIndex].url);
    }
    e.preventDefault();
  } else if (e.key === "Tab") {
    const completed = completePathSegment(queryEl.value);
    if (completed !== null) {
      queryEl.value = completed;
      queryEl.dispatchEvent(new Event("input"));
    }
    e.preventDefault();
  }
});

window.addEventListener("DOMContentLoaded", () => {
  queryEl.focus();
});
window.addEventListener("focus", () => {
  queryEl.focus();
});

loadBookmarks().then(({ flatIndex, treeRoot }) => {
  index = flatIndex;
  tree = treeRoot;
});
