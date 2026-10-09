// Admin console: a small hash-routed app over the /api endpoints.
//   #/            pages list (drag to reorder the navbar)
//   #/pages/new   create a page
//   #/pages/:id   edit a page and its modules
// Sortable (drag and drop) and Quill (rich text) are loaded as globals before this module.

const MODULE_LABELS = {
  heading: "Main header",
  subheading: "Subsection header",
  text: "Text",
  image: "Image",
};
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = "image/jpeg,image/png,image/gif,image/webp,image/avif";

const app = document.getElementById("app");
const toastEl = document.getElementById("toast");

// ---------------------------------------------------------------------------
// Helpers

/** Creates an element. Props: class, text, on<Event> handlers, attributes. */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "value") node.value = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function slugify(text) {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 80)
    .replace(/^-+|-+$/g, "");
}

async function apiFetch(path, { method = "GET", json, body } = {}) {
  const headers = { "x-requested-with": "nmb-admin" };
  if (json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(json);
  }
  const res = await fetch(`/api${path}`, { method, headers, body, credentials: "same-origin" });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON error page; fall through to the generic message.
  }
  if (res.status === 401) {
    throw new Error(
      "Your session has expired. Open /admin in a new tab and log in, then come back and try again — " +
        "your unsaved changes here are kept.",
    );
  }
  if (!res.ok) throw new Error(data?.error ?? `Something went wrong (error ${res.status}).`);
  return data;
}

let toastTimer;
function toast(message, kind = "success") {
  toastEl.textContent = message;
  toastEl.className = `toast toast-${kind}`;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), kind === "error" ? 6000 : 2500);
}

function dragHandle(label) {
  return el("button", { type: "button", class: "drag-handle", "aria-label": label, title: "Drag to reorder" }, "⠿");
}

/** Moves an item up or down within its list (keyboard-friendly alternative to dragging). */
function moveItem(item, direction) {
  const sibling = direction < 0 ? item.previousElementSibling : item.nextElementSibling;
  if (!sibling) return false;
  if (direction < 0) sibling.before(item);
  else sibling.after(item);
  return true;
}

// ---------------------------------------------------------------------------
// Unsaved-changes tracking and routing

let dirty = false;
let changeCount = 0; // lets a save tell whether edits were made while it was in flight
let currentHash = location.hash;
let ignoreNextHashChange = false;

function markDirty() {
  dirty = true;
  changeCount += 1;
}

window.addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});

window.addEventListener("hashchange", () => {
  if (ignoreNextHashChange) {
    ignoreNextHashChange = false;
    return;
  }
  if (dirty && !confirm("You have unsaved changes. Leave this page and discard them?")) {
    ignoreNextHashChange = true;
    location.hash = currentHash;
    return;
  }
  dirty = false;
  route();
});

async function route() {
  currentHash = location.hash;
  const editMatch = currentHash.match(/^#\/pages\/(new|\d+)$/);
  try {
    if (editMatch) await showEditor(editMatch[1] === "new" ? null : Number(editMatch[1]));
    else await showPagesList();
  } catch (err) {
    app.replaceChildren(
      el("div", { class: "alert alert-error", role: "alert" }, err.message),
      el("p", {}, el("a", { href: "#/" }, "Back to all pages")),
    );
  }
  window.scrollTo(0, 0);
  // Move focus into the new view (announcing it to screen readers) unless the view focused a field itself.
  if (!app.contains(document.activeElement)) app.querySelector("h1")?.focus({ preventScroll: true });
}

// ---------------------------------------------------------------------------
// Pages list

/** Renders the pages list. `refresh` re-renders in place (no "Loading…" flash). */
async function showPagesList({ refresh = false } = {}) {
  if (!refresh) app.replaceChildren(el("p", { class: "muted" }, "Loading…"));
  const { pages } = await apiFetch("/pages");

  const list = el("ul", { class: "page-list" });

  /** Saves the list's current order; `focusSelector` names the control to keep focused after re-rendering. */
  async function saveOrder(focusSelector) {
    const ids = [...list.children].map((item) => Number(item.dataset.id));
    try {
      await apiFetch("/pages/order", { method: "PUT", json: { ids } });
      toast("Navbar order saved");
    } catch (err) {
      toast(err.message, "error");
    }
    await showPagesList({ refresh: true }); // refresh the "Home" badge and addresses
    if (focusSelector) app.querySelector(focusSelector)?.focus();
  }

  for (const [index, page] of pages.entries()) {
    const item = el(
      "li",
      { class: "page-item", "data-id": page.id },
      dragHandle(`Reorder ${page.nav_title}`),
      el(
        "div",
        { class: "page-info" },
        el(
          "div",
          { class: "page-nav-title" },
          page.nav_title,
          index === 0 ? el("span", { class: "badge" }, "Home") : null,
        ),
        el("div", { class: "page-meta" }, page.page_title, " · ", el("code", {}, index === 0 ? "/" : `/${page.slug}`)),
      ),
      el(
        "div",
        { class: "item-actions" },
        el("button", {
          type: "button",
          class: "button button-icon",
          "aria-label": `Move ${page.nav_title} up`,
          "data-move": "up",
          title: "Move up",
          text: "↑",
          onClick: () => moveItem(item, -1) && saveOrder(`[data-id="${page.id}"] [data-move="up"]`),
        }),
        el("button", {
          type: "button",
          class: "button button-icon",
          "aria-label": `Move ${page.nav_title} down`,
          "data-move": "down",
          title: "Move down",
          text: "↓",
          onClick: () => moveItem(item, 1) && saveOrder(`[data-id="${page.id}"] [data-move="down"]`),
        }),
        el("a", { class: "button", href: `#/pages/${page.id}` }, "Edit"),
        el("a", { class: "button", href: index === 0 ? "/" : `/${page.slug}`, target: "_blank", rel: "noopener" }, "View"),
        el("button", {
          type: "button",
          class: "button button-danger",
          text: "Delete",
          onClick: async () => {
            if (!confirm(`Delete the page "${page.nav_title}"? This can't be undone.`)) return;
            try {
              await apiFetch(`/pages/${page.id}`, { method: "DELETE" });
              toast(`Deleted "${page.nav_title}"`);
              await showPagesList();
            } catch (err) {
              toast(err.message, "error");
            }
          },
        }),
      ),
    );
    list.append(item);
  }

  app.replaceChildren(
    el(
      "div",
      { class: "view-header" },
      el("h1", { tabindex: "-1" }, "Pages"),
      el("a", { class: "button button-primary", href: "#/pages/new" }, "+ New page"),
    ),
    pages.length
      ? el("p", { class: "muted" }, "Drag pages (or use the arrows) to set their order in the navbar. The first page is the home page.")
      : el("p", { class: "empty" }, "No pages yet. Create your first page to get started."),
    list,
  );

  Sortable.create(list, { handle: ".drag-handle", animation: 150, onEnd: (evt) => evt.oldIndex !== evt.newIndex && saveOrder() });
}

// ---------------------------------------------------------------------------
// Module cards

/** Each card maps to a function that reads its current module data. */
const cardReaders = new WeakMap();

let fieldCount = 0;

/** A labelled form field; `control` is what's shown (the input itself, or a wrapper around it). */
function field(text, input, hint, control = input) {
  input.id ||= `field-${++fieldCount}`;
  const hintEl = hint ? el("span", { class: "field-hint", id: `${input.id}-hint` }, hint) : null;
  if (hintEl) input.setAttribute("aria-describedby", hintEl.id);
  return el("div", { class: "field" }, el("label", { class: "field-label", for: input.id }, text), control, hintEl);
}

function buildHeadingBody(card, module) {
  const input = el("input", {
    type: "text",
    class: `heading-input heading-input-${module.type}`,
    maxlength: "300",
    placeholder: module.type === "heading" ? "Main header text" : "Subsection header text",
    "aria-label": MODULE_LABELS[module.type],
    value: module.data?.text ?? "",
    onInput: markDirty,
  });
  cardReaders.set(card, () => ({ type: module.type, data: { text: input.value } }));
  return { body: input, focus: () => input.focus() };
}

function buildTextBody(card, module) {
  const container = el("div", { class: "text-editor" });
  let quill;
  cardReaders.set(card, () => ({ type: "text", data: { delta: quill.getContents() } }));
  return {
    body: container,
    // Quill needs its container to be in the document before it starts.
    init() {
      quill = new Quill(container, {
        theme: "snow",
        placeholder: "Write something…",
        formats: ["bold", "italic", "link", "list"],
        modules: {
          toolbar: [["bold", "italic", "link"], [{ list: "ordered" }, { list: "bullet" }], ["clean"]],
          // Let Tab move focus to the next control instead of typing a tab character.
          keyboard: { bindings: { tab: null, "remove tab": null, indent: null, outdent: null } },
        },
      });
      if (module.data?.delta) quill.setContents(module.data.delta, "silent");
      quill.on("text-change", (_delta, _old, source) => source === "user" && markDirty());
    },
    focus: () => quill?.focus(),
  };
}

function buildImageBody(card, module) {
  let key = module.data?.key ?? "";
  const preview = el("div", { class: "image-preview" });
  const status = el("p", { class: "upload-status", role: "status" });
  // Opened through chooseButton; hidden so it isn't an extra, unlabeled tab stop.
  const fileInput = el("input", { type: "file", accept: IMAGE_TYPES, hidden: true });
  const chooseButton = el("button", { type: "button", class: "button", onClick: () => fileInput.click() });
  const alt = el("input", { type: "text", maxlength: "300", value: module.data?.alt ?? "", onInput: markDirty });
  const caption = el("input", { type: "text", maxlength: "500", value: module.data?.caption ?? "", onInput: markDirty });

  function showPreview() {
    preview.replaceChildren(key ? el("img", { src: `/media/${key}`, alt: "" }) : el("div", { class: "image-placeholder" }, "No image chosen yet"));
    chooseButton.textContent = key ? "Replace image…" : "Choose image…";
  }

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      status.textContent = "That image is larger than 10 MB. Please choose a smaller one.";
      status.className = "upload-status form-error";
      return;
    }
    const form = new FormData();
    form.append("file", file);
    status.textContent = `Uploading ${file.name}…`;
    status.className = "upload-status";
    chooseButton.disabled = true;
    try {
      const result = await apiFetch("/uploads", { method: "POST", body: form });
      key = result.key;
      if (!alt.value.trim()) alt.value = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
      status.textContent = "Uploaded. Remember to save the page.";
      markDirty();
      showPreview();
    } catch (err) {
      status.textContent = err.message;
      status.className = "upload-status form-error";
    } finally {
      chooseButton.disabled = false;
    }
  });

  showPreview();
  cardReaders.set(card, () => ({ type: "image", data: { key, alt: alt.value, caption: caption.value } }));
  return {
    body: el(
      "div",
      { class: "image-module" },
      preview,
      el("div", { class: "image-fields" }, el("div", {}, chooseButton, fileInput), status,
        field("Alt text", alt, "Describes the image for people using screen readers."),
        field("Caption (optional)", caption),
      ),
    ),
    focus: () => chooseButton.focus(),
  };
}

function hasContent(card) {
  const { type, data } = cardReaders.get(card)();
  if (type === "text") return data.delta.ops.some((op) => typeof op.insert === "string" && op.insert.trim());
  if (type === "image") return Boolean(data.key);
  return Boolean(data.text.trim());
}

/** Appends a module card to the list and returns a function that focuses it. */
function addModuleCard(list, module) {
  const card = el("li", { class: `module-card module-${module.type}` });
  const builders = { heading: buildHeadingBody, subheading: buildHeadingBody, text: buildTextBody, image: buildImageBody };
  const { body, init, focus } = builders[module.type](card, module);
  const label = MODULE_LABELS[module.type];

  card.append(
    el(
      "div",
      { class: "module-header" },
      dragHandle(`Reorder ${label} module`),
      el("span", { class: "module-label" }, label),
      el(
        "div",
        { class: "item-actions" },
        el("button", { type: "button", class: "button button-icon", "aria-label": "Move up", title: "Move up", text: "↑", onClick: () => moveItem(card, -1) && markDirty() }),
        el("button", { type: "button", class: "button button-icon", "aria-label": "Move down", title: "Move down", text: "↓", onClick: () => moveItem(card, 1) && markDirty() }),
        el("button", {
          type: "button",
          class: "button button-icon button-danger",
          "aria-label": `Remove ${label} module`,
          title: "Remove",
          text: "✕",
          onClick: () => {
            if (hasContent(card) && !confirm(`Remove this ${label.toLowerCase()} module?`)) return;
            card.remove();
            markDirty();
          },
        }),
      ),
    ),
    el("div", { class: "module-body" }, body),
  );
  list.append(card);
  init?.();
  return focus;
}

// ---------------------------------------------------------------------------
// Page editor

async function showEditor(id) {
  app.replaceChildren(el("p", { class: "muted" }, "Loading…"));
  let page = null;
  let modules = [];
  if (id) ({ page, modules } = await apiFetch(`/pages/${id}`));

  let pageId = id;
  let slugEdited = Boolean(id);

  const errorBox = el("div", { class: "alert alert-error", role: "alert", hidden: true });
  const pageTitle = el("input", { type: "text", required: true, maxlength: "200", value: page?.page_title ?? "", onInput: markDirty });
  const navTitle = el("input", { type: "text", required: true, maxlength: "60", value: page?.nav_title ?? "" });
  const slug = el("input", { type: "text", maxlength: "80", value: page?.slug ?? "", spellcheck: "false" });

  navTitle.addEventListener("input", () => {
    if (!slugEdited) slug.value = slugify(navTitle.value);
    markDirty();
  });
  slug.addEventListener("input", () => {
    slugEdited = true;
    markDirty();
  });
  slug.addEventListener("blur", () => (slug.value = slugify(slug.value)));

  const list = el("ul", { class: "module-list" });
  for (const module of modules) addModuleCard(list, module);
  Sortable.create(list, { handle: ".drag-handle", animation: 150, onEnd: (evt) => evt.oldIndex !== evt.newIndex && markDirty() });

  const addButtons = Object.entries(MODULE_LABELS).map(([type, label]) =>
    el("button", {
      type: "button",
      class: "button",
      text: `+ ${label}`,
      onClick: () => {
        const data = type === "text" ? {} : type === "image" ? { key: "", alt: "", caption: "" } : { text: "" };
        const focus = addModuleCard(list, { type, data });
        markDirty();
        list.lastElementChild.scrollIntoView({ behavior: "smooth", block: "center" });
        focus();
      },
    }),
  );

  const viewLink = el("a", { class: "button", target: "_blank", rel: "noopener", hidden: !pageId }, "View page");
  const saveButton = el("button", { type: "submit", class: "button button-primary" }, "Save page");

  function updateViewLink() {
    viewLink.href = `/${slug.value}`;
    viewLink.hidden = !pageId;
  }
  updateViewLink();

  let saving = false;

  async function save() {
    if (saving) return; // e.g. Ctrl+S pressed twice
    saving = true;
    errorBox.hidden = true;
    const payload = {
      page_title: pageTitle.value,
      nav_title: navTitle.value,
      slug: slug.value,
      modules: [...list.children].map((card) => cardReaders.get(card)()),
    };
    const changesAtSave = changeCount;
    saveButton.disabled = true;
    saveButton.textContent = "Saving…";
    try {
      const result = pageId
        ? await apiFetch(`/pages/${pageId}`, { method: "PUT", json: payload })
        : await apiFetch("/pages", { method: "POST", json: payload });
      // The user may have left this editor while the save was running; leave the new view alone.
      if (!form.isConnected) {
        toast(`Saved "${result.page.nav_title}"`);
        return;
      }
      // Edits typed while the save was in flight still need saving.
      dirty = changeCount !== changesAtSave;
      if (!pageId) {
        pageId = result.page.id;
        heading.textContent = "Edit page";
        // Update the address without triggering a re-render.
        history.replaceState(null, "", `#/pages/${pageId}`);
        currentHash = location.hash;
      }
      if (slug.value === payload.slug) slug.value = result.page.slug;
      slugEdited = true;
      updateViewLink();
      toast("Page saved");
    } catch (err) {
      if (!form.isConnected) {
        toast(`Not saved: ${err.message}`, "error");
        return;
      }
      errorBox.textContent = err.message;
      errorBox.hidden = false;
      errorBox.scrollIntoView({ behavior: "smooth", block: "center" });
      toast("Not saved — see the message above", "error");
    } finally {
      saving = false;
      saveButton.disabled = false;
      saveButton.textContent = "Save page";
    }
  }

  const heading = el("h1", { tabindex: "-1" }, pageId ? "Edit page" : "New page");
  const form = el(
    "form",
    { class: "editor", novalidate: true, onSubmit: (event) => (event.preventDefault(), save()) },
    errorBox,
    el(
      "section",
      { class: "panel page-fields" },
      field("Page title", pageTitle, "The big heading at the top of the page, also shown in the browser tab."),
      field("Navbar title", navTitle, "The short name shown in the navbar."),
      field(
        "Web address",
        slug,
        "Lowercase letters, numbers and dashes. Filled in from the navbar title until you change it.",
        el("div", { class: "slug-field" }, el("span", { class: "slug-prefix", "aria-hidden": "true" }, `${location.host}/`), slug),
      ),
    ),
    el(
      "section",
      { class: "modules" },
      el("h2", {}, "Content"),
      el("p", { class: "muted" }, "Modules appear on the page from top to bottom. Drag the ⠿ handle (or use the arrows) to reorder them."),
      list,
      el("div", { class: "add-module" }, el("span", { class: "add-module-label" }, "Add module:"), addButtons),
    ),
    el("div", { class: "save-bar" }, saveButton, viewLink),
  );

  app.replaceChildren(el("p", {}, el("a", { href: "#/" }, "← All pages")), heading, form);

  form.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "s") {
      event.preventDefault();
      save();
    }
  });

  if (!pageId) pageTitle.focus();
}

route();
