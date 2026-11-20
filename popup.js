import { createEditor } from "./src/editor.js";
import { loadLibrary } from "./src/library.js";

const container = document.getElementById("editor");

document.getElementById("open-manager").addEventListener("click", (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
  window.close();
});

async function init() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const lib = await loadLibrary();
  // A URL can be bookmarked more than once; edit the first copy.
  const matches = lib.bookmarks.filter((b) => b.url === tab.url);
  const editor = createEditor(
    container,
    lib,
    matches.length ? { bookmark: matches[0] } : { url: tab.url, title: tab.title },
    { onDone: () => window.close() }
  );
  if (matches.length > 1) {
    const note = document.createElement("p");
    note.className = "status";
    note.textContent = `Also bookmarked in: ${matches.slice(1).map((b) => b.folderPath).join(", ")}`;
    container.querySelector("h1").after(note);
  }
  editor.focus();
}

init().catch((err) => {
  const p = document.createElement("p");
  p.className = "status error";
  p.textContent = err.message;
  container.replaceChildren(p);
});
