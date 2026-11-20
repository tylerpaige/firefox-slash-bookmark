import { createEditor } from "./src/editor.js";
import { loadLibrary, suggestTags } from "./src/library.js";

// Full-page list of every bookmark, for back-filling keywords and tags.
// Type to filter, ↑/↓ to pick a row, Enter to edit it.

const filterEl = document.getElementById("filter");
const noKeywordEl = document.getElementById("no-keyword");
const noTagsEl = document.getElementById("no-tags");
const countEl = document.getElementById("count");
const rowsEl = document.getElementById("rows");
const dialog = document.getElementById("dialog");
const editorEl = document.getElementById("editor");

let lib = null;
let visible = [];
let selectedIndex = 0;

function matchesFilter(b, needle) {
  if (noKeywordEl.checked && b.keyword) return false;
  if (noTagsEl.checked && b.tags.length) return false;
  if (!needle) return true;
  return [b.keyword, b.title, b.folderPath, b.url, ...b.tags].some((s) =>
    s.toLowerCase().includes(needle)
  );
}

function render() {
  const needle = filterEl.value.trim().toLowerCase();
  visible = lib.bookmarks
    .filter((b) => matchesFilter(b, needle))
    .sort((a, b) =>
      a.folderPath.localeCompare(b.folderPath) ||
      (a.keyword || "￿").localeCompare(b.keyword || "￿") ||
      a.title.localeCompare(b.title)
    );
  selectedIndex = Math.min(selectedIndex, Math.max(visible.length - 1, 0));
  countEl.textContent = `${visible.length} of ${lib.bookmarks.length}`;

  rowsEl.replaceChildren(
    ...visible.map((b, i) => {
      const tr = document.createElement("tr");
      if (i === selectedIndex) tr.className = "selected";
      const suggested = !b.tags.length && b.keyword ? suggestTags(b.keyword, lib) : [];
      tr.append(
        cell(b.keyword || "—", b.keyword ? "keyword" : "keyword empty"),
        cell(b.title, "title", b.url),
        cell(b.folderPath, "folder"),
        suggested.length
          ? cell(suggested.join(", "), "tags empty", "Suggested from keyword")
          : cell(b.tags.join(", "), "tags")
      );
      tr.addEventListener("click", () => {
        selectedIndex = i;
        edit(b);
      });
      return tr;
    })
  );
  rowsEl.children[selectedIndex]?.scrollIntoView({ block: "nearest" });
}

function cell(text, className, title) {
  const td = document.createElement("td");
  td.textContent = text;
  td.className = className;
  if (title) td.title = title;
  return td;
}

function edit(bookmark) {
  dialog.showModal();
  const editor = createEditor(editorEl, lib, { bookmark }, {
    async onDone(result) {
      dialog.close();
      if (result !== "cancelled") lib = await loadLibrary();
      render();
      filterEl.focus();
    },
  });
  editor.focus();
}

// The editor handles Escape itself; stop the dialog from also closing on it.
dialog.addEventListener("cancel", (e) => e.preventDefault());

filterEl.addEventListener("input", () => {
  selectedIndex = 0;
  render();
});

for (const toggle of [noKeywordEl, noTagsEl]) {
  toggle.addEventListener("change", () => {
    selectedIndex = 0;
    render();
    filterEl.focus();
  });
}

document.addEventListener("keydown", (e) => {
  if (dialog.open) return;
  if (e.altKey && (e.code === "KeyK" || e.code === "KeyT")) {
    e.preventDefault();
    const toggle = e.code === "KeyK" ? noKeywordEl : noTagsEl;
    toggle.checked = !toggle.checked;
    toggle.dispatchEvent(new Event("change"));
  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const step = e.key === "ArrowDown" ? 1 : -1;
    selectedIndex = Math.max(0, Math.min(visible.length - 1, selectedIndex + step));
    render();
  } else if (e.key === "Enter" && visible[selectedIndex]) {
    e.preventDefault();
    edit(visible[selectedIndex]);
  }
});

loadLibrary()
  .then((loaded) => {
    lib = loaded;
    render();
    filterEl.focus();
  })
  .catch((err) => {
    countEl.textContent = err.message;
    countEl.classList.add("error");
  });
