import {
  completeKeywordSegment,
  DEFAULT_FOLDER,
  deleteBookmark,
  folderExists,
  normalizeFolderPath,
  rankFolders,
  saveBookmark,
  suggestFolder,
  suggestTags,
} from "./library.js";

const MAX_SUGGESTIONS = 8;
const IS_MAC = navigator.platform.startsWith("Mac");

// Keyboard model, shared by every field:
//   Tab        completes the partial value when there's an obvious completion
//              (or accepts the arrow-selected suggestion), otherwise moves on.
//   ↑ / ↓      select a suggestion; Enter accepts it.
//   Enter      saves.  Esc cancels.  Mod+Shift+Backspace deletes.
//
// `target` is { bookmark } to edit an existing bookmark or { url, title } for
// a new one. `onDone(result)` gets "saved", "deleted" or "cancelled".
export function createEditor(container, lib, target, { onDone }) {
  const existing = target.bookmark ?? null;
  const fields = {};
  // Folder and tags follow the keyword until the user edits them directly.
  // That's on for new bookmarks, and for ones that look freshly made with
  // the native star dialog (loose in "other", or untagged).
  let folderFollowsKeyword = !existing || (existing.folderPath === DEFAULT_FOLDER && !existing.keyword);
  let tagsFollowKeyword = !existing || existing.tags.length === 0;

  // A fresh root per editor, so listeners don't pile up when the manager
  // reuses one container.
  const root = el("div", { className: "editor" });
  container.replaceChildren(root);

  root.append(el("h1", {}, existing ? "Edit bookmark" : "New bookmark"));

  const form = el("form", { autocomplete: "off" });
  root.append(form);

  fields.keyword = addField(form, "keyword", "Keyword", {
    placeholder: "client/thing",
    suggest(value) {
      if (!value) return [];
      return lib.keywords
        .filter((k) => k.keyword.startsWith(value) && k.url !== fields.url.input.value)
        .map((k) => ({ value: k.keyword, label: k.keyword, detail: k.title }));
    },
    complete: (value) => completeKeywordSegment(value, lib.keywords.map((k) => k.keyword)),
    note(value) {
      const clash = lib.keywords.find(
        (k) => k.keyword === value && k.url !== fields.url.input.value
      );
      return clash
        ? { text: `Already used by “${clash.title}” — saving moves it here`, warn: true }
        : null;
    },
  });

  fields.title = addField(form, "title", "Title", {});

  fields.folder = addField(form, "folder", "Folder", {
    placeholder: DEFAULT_FOLDER,
    suggest: (value) =>
      rankFolders(value, lib).map((f) => ({ value: f.path, label: f.path })),
    complete(value) {
      if (!value.trim() || folderExists(normalizeFolderPath(value, lib), lib)) return null;
      return rankFolders(value, lib)[0]?.path ?? null;
    },
    note(value) {
      const path = normalizeFolderPath(value, lib);
      if (!folderExists(path, lib) && path !== DEFAULT_FOLDER) {
        return { text: `New folder: ${path}`, warn: true };
      }
      if (folderFollowsKeyword && value) return { text: "Suggested from keyword" };
      return null;
    },
  });

  fields.tags = addField(form, "tags", "Tags", {
    placeholder: "comma, separated",
    suggest(value) {
      const { done, partial } = splitTags(value);
      const needle = partial.toLowerCase();
      if (!needle) return [];
      const taken = new Set(done.map((t) => t.toLowerCase()));
      return lib.tags
        .filter((t) => t.name.toLowerCase().includes(needle) && !taken.has(t.name.toLowerCase()))
        .sort((a, b) =>
          Number(b.name.toLowerCase().startsWith(needle)) -
          Number(a.name.toLowerCase().startsWith(needle))
        )
        .map((t) => ({ value: t.name, label: t.name, detail: String(t.count) }));
    },
    apply(item, value) {
      return [...splitTags(value).done, item.value].join(", ") + ", ";
    },
    complete(value) {
      const { partial } = splitTags(value);
      const top = this.suggest(value)[0];
      if (!top || top.value.toLowerCase() === partial.toLowerCase()) return null;
      return this.apply(top, value);
    },
    note: (value) =>
      tagsFollowKeyword && value ? { text: "Suggested from keyword" } : null,
  });

  fields.url = addField(form, "url", "URL", {});

  const status = el("p", { className: "status" });
  const actions = el("div", { className: "actions" });
  const mod = IS_MAC ? "⌘" : "Ctrl";
  actions.append(
    el("span", { className: "hint" },
      `↵ save · esc cancel · tab complete${existing ? ` · ${mod}⇧⌫ delete` : ""}`)
  );
  if (existing) {
    const del = el("button", { type: "button", className: "danger" }, "Delete");
    del.addEventListener("click", remove);
    actions.append(del);
  }
  const saveBtn = el("button", { type: "submit" }, "Save");
  actions.append(saveBtn);
  form.append(status, actions);

  // --- Initial values ---

  const initial = existing ?? { title: target.title ?? "", url: target.url ?? "", keyword: "", tags: [], folderPath: DEFAULT_FOLDER };
  fields.keyword.input.value = initial.keyword;
  fields.title.input.value = initial.title;
  fields.url.input.value = initial.url;
  fields.folder.input.value = initial.folderPath;
  fields.tags.input.value = initial.tags.join(", ");
  if (initial.keyword) followKeyword();
  for (const f of Object.values(fields)) f.refreshNote();

  // --- Behaviour ---

  function followKeyword() {
    const keyword = fields.keyword.input.value;
    if (folderFollowsKeyword) {
      fields.folder.input.value = suggestFolder(keyword, lib) ?? initial.folderPath;
      fields.folder.refreshNote();
    }
    if (tagsFollowKeyword) {
      fields.tags.input.value = suggestTags(keyword, lib).join(", ");
      fields.tags.refreshNote();
    }
  }

  fields.keyword.input.addEventListener("input", () => {
    const input = fields.keyword.input;
    // Firefox lowercases keywords, and a space would end the keyword in the
    // address bar, so normalize as the user types.
    const cleaned = input.value.toLowerCase().replace(/\s+/g, "");
    if (cleaned !== input.value) {
      const pos = input.selectionStart - (input.value.length - cleaned.length);
      input.value = cleaned;
      input.setSelectionRange(pos, pos);
    }
    followKeyword();
  });
  fields.folder.input.addEventListener("input", () => {
    folderFollowsKeyword = false;
    fields.folder.refreshNote();
  });
  fields.tags.input.addEventListener("input", () => {
    tagsFollowKeyword = false;
    fields.tags.refreshNote();
  });
  fields.url.input.addEventListener("input", () => fields.keyword.refreshNote());

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    save();
  });

  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onDone("cancelled");
    } else if (
      existing &&
      e.key === "Backspace" &&
      e.shiftKey &&
      (IS_MAC ? e.metaKey : e.ctrlKey)
    ) {
      e.preventDefault();
      remove();
    }
  });

  let busy = false;
  async function run(action, result) {
    if (busy) return;
    busy = true;
    status.textContent = "";
    status.classList.remove("error");
    try {
      await action();
      onDone(result);
    } catch (err) {
      status.textContent = err.message;
      status.classList.add("error");
    } finally {
      busy = false;
    }
  }

  function save() {
    const url = fields.url.input.value.trim();
    if (!url) {
      status.textContent = "URL is required";
      status.classList.add("error");
      return;
    }
    run(
      () =>
        saveBookmark(lib, existing, {
          title: fields.title.input.value.trim() || url,
          url,
          folder: fields.folder.input.value,
          keyword: fields.keyword.input.value,
          tags: splitTags(fields.tags.input.value + ",").done,
        }),
      "saved"
    );
  }

  function remove() {
    run(() => deleteBookmark(existing), "deleted");
  }

  return {
    focus() {
      fields.keyword.input.focus();
      fields.keyword.input.select();
    },
  };
}

// --- Fields --------------------------------------------------------------------

function addField(form, name, label, behaviour) {
  const input = el("input", {
    id: `field-${name}`,
    name,
    spellcheck: false,
    placeholder: behaviour.placeholder ?? "",
  });
  const note = el("div", { className: "note" });
  const list = el("ul", { className: "suggestions", hidden: true });
  const row = el("div", { className: "field" },
    el("label", { htmlFor: input.id }, label),
    el("div", { className: "control" }, input, list, note)
  );
  form.append(row);

  const field = { input, refreshNote, behaviour };
  let items = [];
  let selected = -1;

  function refreshNote() {
    const n = behaviour.note?.(input.value);
    note.textContent = n?.text ?? "";
    note.classList.toggle("warn", Boolean(n?.warn));
  }

  function renderList() {
    list.replaceChildren(
      ...items.map((item, i) => {
        const li = el("li", { className: i === selected ? "selected" : "" },
          el("span", { className: "label" }, item.label),
          item.detail ? el("span", { className: "detail" }, item.detail) : ""
        );
        li.addEventListener("mousedown", (e) => {
          e.preventDefault();
          accept(item);
        });
        return li;
      })
    );
    list.hidden = items.length === 0;
  }

  function refreshList() {
    items = document.activeElement === input && behaviour.suggest
      ? behaviour.suggest(input.value).slice(0, MAX_SUGGESTIONS)
      : [];
    selected = -1;
    renderList();
  }

  function setValue(value) {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function accept(item) {
    setValue(behaviour.apply ? behaviour.apply(item, input.value) : item.value);
  }

  input.addEventListener("input", () => {
    refreshList();
    refreshNote();
  });
  input.addEventListener("focus", refreshList);
  input.addEventListener("blur", () => {
    items = [];
    renderList();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!items.length) return;
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      selected = Math.max(-1, Math.min(items.length - 1, selected + step));
      renderList();
    } else if (e.key === "Enter" && selected >= 0) {
      e.preventDefault();
      accept(items[selected]);
    } else if (e.key === "Tab" && !e.shiftKey) {
      const next = selected >= 0
        ? (behaviour.apply ? behaviour.apply(items[selected], input.value) : items[selected].value)
        : behaviour.complete?.call(behaviour, input.value);
      if (next != null && next !== input.value) {
        e.preventDefault();
        setValue(next);
      }
    } else if (e.key === "Escape" && selected >= 0) {
      e.stopPropagation();
      e.preventDefault();
      selected = -1;
      renderList();
    }
  });

  return field;
}

// "ft, git, rel" -> { done: ["ft", "git"], partial: "rel" }
function splitTags(value) {
  const parts = value.split(",");
  const partial = parts.pop().trim();
  return { done: parts.map((t) => t.trim()).filter(Boolean), partial };
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}
