const STORAGE_KEY = "collector.items";
const QUOTA = 5 * 1024 * 1024;
const $ = (id) => document.getElementById(id);
const state = { current: null, keyword: null, busy: new Set() };

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1).replace(".", ",")} КБ`;
  return `${(bytes / 1048576).toFixed(2).replace(".", ",")} МБ`;
}

function formatDate(ms) {
  return new Date(ms).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function icon(name) {
  return `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

function ring(percent) {
  const spin = percent == null;
  const offset = spin ? "" : ` style="stroke-dashoffset:${62.83 * (1 - percent / 100)}"`;
  return `<svg class="ring${spin ? " spin" : ""}" viewBox="0 0 24 24" aria-hidden="true"><circle class="track" cx="12" cy="12" r="10"/><circle class="value" cx="12" cy="12" r="10"${offset}/></svg>`;
}

function hud(text, action) {
  const el = $("hud");
  const button = $("hud-action");
  $("hud-text").textContent = text;
  button.hidden = !action;
  if (action) {
    button.textContent = action.label;
    button.onclick = () => {
      action.run();
      el.hidden = true;
    };
  }
  el.hidden = true;
  void el.offsetWidth;
  el.hidden = false;
  clearTimeout(hud.timer);
  hud.timer = setTimeout(() => (el.hidden = true), action ? 6000 : 3000);
}

function loadItems() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveItems(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    return true;
  } catch {
    return false;
  }
}

function titleOf(content, type, url) {
  if (type.includes("html")) {
    const match = content.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (match && match[1].trim()) return new DOMParser().parseFromString(match[1], "text/html").body.textContent.trim();
  }
  return url.replace(/^https?:\/\//, "");
}

function splitUrl(url) {
  try {
    const u = new URL(url);
    return { host: u.hostname.replace(/^www\./, ""), path: decodeURIComponent(u.pathname + u.search).replace(/^\/$/, "главная страница") };
  } catch {
    return { host: url, path: "" };
  }
}

function rowButton({ glyph, title, sub, trail, current }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "row";
  if (current) button.setAttribute("aria-current", "true");
  button.innerHTML = `<span class="glyph">${icon(glyph)}</span><span class="text"><span class="title"></span><span class="sub"></span></span><span class="trail">${trail || ""}</span>`;
  button.querySelector(".title").textContent = title;
  button.querySelector(".sub").textContent = sub;
  return button;
}

function renderLibrary(fresh) {
  const items = loadItems();
  const list = $("library");
  list.replaceChildren(...items.map((item) => {
    const li = document.createElement("li");
    const row = rowButton({ glyph: "doc", title: item.title, sub: `${item.keyword} · ${formatSize(item.size)} · ${formatDate(item.savedAt)}`, current: item.id === state.current });
    row.dataset.id = item.id;
    row.setAttribute("aria-label", `${item.title}, ${formatSize(item.size)}. Delete — удалить`);
    if (item.id === fresh) row.classList.add("enter");
    li.append(row);
    return li;
  }));
  $("library-empty").hidden = items.length > 0;
  $("library-count").textContent = items.length || "";
  const used = items.length ? new Blob([localStorage.getItem(STORAGE_KEY) || ""]).size : 0;
  const ratio = Math.min(1, used / QUOTA);
  $("meter").style.width = `${Math.max(ratio * 100, used ? 1 : 0)}%`;
  $("meter").parentElement.classList.toggle("high", ratio > 0.85);
  $("quota").textContent = used ? `${formatSize(used)} из ~5 МБ в хранилище браузера` : "Хранилище браузера пусто";
}

function show(item, push = true) {
  state.current = item.id;
  $("toolbar").hidden = false;
  $("page").hidden = false;
  $("empty").hidden = true;
  $("reader-title").textContent = item.title;
  $("reader-meta").textContent = `${splitUrl(item.url).host} · ${formatSize(item.size)} · сохранено ${formatDate(item.savedAt)}`;
  $("reader-open").href = item.url;
  if (item.type.includes("html")) {
    $("text").hidden = true;
    $("frame").hidden = false;
    $("frame").srcdoc = item.content.replace(/<head([^>]*)>/i, `<head$1><base href="${item.url}">`);
  } else {
    $("frame").hidden = true;
    $("text").hidden = false;
    $("text").textContent = item.content;
  }
  const page = $("page");
  page.style.animation = "none";
  void page.offsetWidth;
  page.style.animation = "";
  if (push) $("app").classList.add("reading");
  renderLibrary();
}

function closeReader() {
  state.current = null;
  $("toolbar").hidden = true;
  $("page").hidden = true;
  $("empty").hidden = false;
  $("frame").removeAttribute("srcdoc");
  $("app").classList.remove("reading");
  renderLibrary();
}

function remove(id) {
  const items = loadItems();
  const index = items.findIndex((i) => i.id === id);
  if (index === -1) return;
  const [item] = items.splice(index, 1);
  saveItems(items);
  if (state.current === id) closeReader();
  else renderLibrary();
  refreshSources();
  hud(`«${item.title}» удалена`, {
    label: "Отменить",
    run: () => {
      const now = loadItems();
      now.splice(Math.min(index, now.length), 0, item);
      if (saveItems(now)) {
        renderLibrary(item.id);
        refreshSources();
      }
    },
  });
}

async function api(path) {
  const response = await fetch(path);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Сервер ответил ошибкой ${response.status}`);
  return data;
}

async function loadTokens() {
  try {
    const words = await api("/api/keywords");
    $("tokens").replaceChildren(...words.map((w) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = w;
      b.setAttribute("aria-pressed", "false");
      b.onclick = () => {
        $("word").value = w;
        search(w);
      };
      return b;
    }));
  } catch {
    $("tokens").replaceChildren();
  }
}

function markToken(word) {
  for (const b of $("tokens").children) b.setAttribute("aria-pressed", String(b.textContent === word));
}

function sourceRow(url) {
  const saved = loadItems().find((i) => i.url === url);
  const { host, path } = splitUrl(url);
  const row = rowButton({
    glyph: "doc",
    title: host,
    sub: saved ? `В библиотеке · ${formatSize(saved.size)}` : path,
    trail: saved ? icon("check") : icon("down"),
  });
  row.dataset.url = url;
  row.title = url;
  row.setAttribute("aria-label", saved ? `${url}, уже в библиотеке — открыть` : `${url} — скачать и сохранить`);
  if (saved) row.querySelector(".trail").classList.add("done");
  return row;
}

function refreshSources() {
  for (const row of $("sources").querySelectorAll(".row[data-url]")) {
    if (!state.busy.has(row.dataset.url)) row.replaceWith(sourceRow(row.dataset.url));
  }
}

async function search(word) {
  word = word.trim();
  if (!word) return $("word").focus();
  markToken(word.toLowerCase());
  const note = $("sources-note");
  note.classList.remove("error");
  if (!navigator.onLine) {
    note.textContent = "Поиск недоступен без сети. Сохранённые страницы — в библиотеке ниже.";
    $("sources").replaceChildren();
    return;
  }
  const skeleton = setTimeout(() => {
    note.hidden = true;
    $("sources").replaceChildren(...[0, 1, 2].map(() => Object.assign(document.createElement("li"), { className: "skeleton" })));
  }, 150);
  try {
    const data = await api(`/api/keywords/${encodeURIComponent(word)}`);
    clearTimeout(skeleton);
    state.keyword = data.keyword;
    note.hidden = false;
    note.textContent = `«${data.keyword}» — ${data.urls.length} ${plural(data.urls.length, "страница", "страницы", "страниц")}. Нажмите, чтобы сохранить.`;
    $("sources").replaceChildren(...data.urls.map((url) => {
      const li = document.createElement("li");
      const row = sourceRow(url);
      row.classList.add("enter");
      li.append(row);
      return li;
    }));
  } catch (error) {
    clearTimeout(skeleton);
    note.hidden = false;
    note.classList.add("error");
    note.textContent = error.message === "Failed to fetch" ? "Сервер недоступен. Проверьте подключение и попробуйте ещё раз." : error.message;
    $("sources").replaceChildren();
  }
}

function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

async function download(row) {
  const url = row.dataset.url;
  const keyword = state.keyword;
  const saved = loadItems().find((i) => i.url === url);
  if (saved) return show(saved);
  if (state.busy.has(url)) return;
  const sub = row.querySelector(".sub");
  const trail = row.querySelector(".trail");
  const fail = (message) => {
    state.busy.delete(url);
    row.setAttribute("aria-busy", "false");
    sub.className = "sub error";
    sub.textContent = `${message} Нажмите, чтобы повторить.`;
    trail.className = "trail failed";
    trail.innerHTML = icon("retry");
  };
  if (!navigator.onLine) return fail("Нет сети.");
  state.busy.add(url);
  row.setAttribute("aria-busy", "true");
  sub.className = "sub";
  sub.textContent = "Соединение…";
  trail.className = "trail";
  trail.innerHTML = ring(null);
  try {
    const response = await fetch(`/api/download?url=${encodeURIComponent(url)}`);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Сервер ответил ошибкой ${response.status}`);
    }
    const total = Number(response.headers.get("X-Content-Length")) || 0;
    const type = response.headers.get("Content-Type") || "text/plain";
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    const started = performance.now();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      const seconds = (performance.now() - started) / 1000;
      const speed = seconds > 0.15 ? ` · ${formatSize(received / seconds)}/с` : "";
      if (total) {
        const percent = Math.min(100, Math.round((received / total) * 100));
        trail.innerHTML = ring(percent);
        sub.textContent = `${percent}% · ${formatSize(received)} из ${formatSize(total)}${speed}`;
      } else {
        sub.textContent = `${formatSize(received)}${speed}`;
      }
    }
    const content = new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
    const item = { id: crypto.randomUUID(), url, keyword, type, size: received, savedAt: Date.now(), content };
    item.title = titleOf(content, type, url);
    if (!saveItems([item, ...loadItems().filter((i) => i.url !== url)])) {
      return fail(`Не хватает места в хранилище (${formatSize(received)}). Удалите что-нибудь из библиотеки.`);
    }
    state.busy.delete(url);
    row.replaceWith(sourceRow(url));
    renderLibrary(item.id);
    if (matchMedia("(min-width: 821px)").matches) show(item, false);
    hud(`Сохранено: ${item.title}`);
  } catch (error) {
    fail(error.message === "Failed to fetch" ? "Сервер недоступен." : `${error.message}.`.replace(/\.\.$/, "."));
  }
}

function moveFocus(list, step) {
  const rows = [...list.querySelectorAll(".row")];
  const index = rows.indexOf(document.activeElement);
  if (index === -1) return;
  rows[Math.max(0, Math.min(rows.length - 1, index + step))].focus();
}

$("search").addEventListener("submit", (event) => {
  event.preventDefault();
  search($("word").value);
});

$("sources").addEventListener("click", (event) => {
  const row = event.target.closest(".row[data-url]");
  if (row) download(row);
});

$("library").addEventListener("click", (event) => {
  const row = event.target.closest(".row[data-id]");
  const item = row && loadItems().find((i) => i.id === row.dataset.id);
  if (item) show(item);
});

for (const list of [$("sources"), $("library")]) {
  list.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(list, event.key === "ArrowDown" ? 1 : -1);
    }
    const row = event.target.closest(".row[data-id]");
    if (row && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault();
      remove(row.dataset.id);
    }
  });
}

$("reader-delete").addEventListener("click", () => state.current && remove(state.current));
$("back").addEventListener("click", () => $("app").classList.remove("reading"));
$("empty-action").addEventListener("click", () => $("word").focus());

document.addEventListener("keydown", (event) => {
  const typing = /INPUT|TEXTAREA/.test(document.activeElement.tagName);
  if (event.key === "/" && !typing) {
    event.preventDefault();
    $("word").focus();
    $("word").select();
  }
  if (event.key === "Escape") {
    if (typing) document.activeElement.blur();
    else $("app").classList.remove("reading");
  }
});

function updateNet() {
  $("offline").hidden = navigator.onLine;
  $("word").disabled = !navigator.onLine;
  $("word").placeholder = navigator.onLine ? "Ключевое слово" : "Поиск недоступен без сети";
}
window.addEventListener("online", updateNet);
window.addEventListener("offline", updateNet);

updateNet();
renderLibrary();
loadTokens();
