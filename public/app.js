const STORAGE_KEY = "collector.items";
const $ = (id) => document.getElementById(id);
let current = null;

function toast(message, ok = false) {
  const el = $("toast");
  el.textContent = message;
  el.className = ok ? "toast ok" : "toast";
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 4500);
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1048576).toFixed(2)} МБ`;
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
    toast("Не хватает места в LocalStorage: удалите старые страницы");
    return false;
  }
}

function titleOf(item) {
  if (item.type.includes("html")) {
    const match = item.content.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (match && match[1].trim()) return new DOMParser().parseFromString(match[1], "text/html").body.textContent.trim();
  }
  return item.url.replace(/^https?:\/\//, "");
}

function renderItems() {
  const items = loadItems();
  const list = $("items");
  if (!items.length) {
    list.innerHTML = '<li class="empty">Пока ничего не сохранено</li>';
  } else {
    list.replaceChildren(...items.map((item) => {
      const li = document.createElement("li");
      li.dataset.id = item.id;
      li.classList.toggle("active", item.id === current);
      li.innerHTML = `<div><div class="title"></div><div class="sub"></div></div><button class="del" title="Удалить">×</button>`;
      li.querySelector(".title").textContent = item.title;
      li.querySelector(".sub").textContent = `${item.keyword} · ${formatSize(item.size)} · ${new Date(item.savedAt).toLocaleString("ru-RU")}`;
      return li;
    }));
  }
  const used = new Blob([localStorage.getItem(STORAGE_KEY) || ""]).size;
  $("quota").textContent = `Занято в LocalStorage: ${formatSize(used)} из ~5 МБ`;
}

function show(item) {
  current = item.id;
  $("viewer-title").textContent = item.title;
  $("viewer-meta").textContent = `${item.url} · ${formatSize(item.size)}`;
  $("placeholder").hidden = true;
  if (item.type.includes("html")) {
    $("text").hidden = true;
    $("frame").hidden = false;
    $("frame").srcdoc = item.content.replace(/<head([^>]*)>/i, `<head$1><base href="${item.url}">`);
  } else {
    $("frame").hidden = true;
    $("text").hidden = false;
    $("text").textContent = item.content;
  }
  renderItems();
}

async function api(path) {
  const response = await fetch(path);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Ошибка ${response.status}`);
  return data;
}

async function loadChips() {
  try {
    const words = await api("/api/keywords");
    $("chips").replaceChildren(...words.map((w) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = w;
      b.onclick = () => {
        $("word").value = w;
        search(w);
      };
      return b;
    }));
  } catch {
    $("chips").textContent = "";
  }
}

async function search(word) {
  if (!navigator.onLine) return toast("Нет подключения к интернету — доступны только сохранённые страницы");
  $("urls").innerHTML = '<li class="empty">Ищем…</li>';
  try {
    const data = await api(`/api/keywords/${encodeURIComponent(word)}`);
    $("urls").replaceChildren(...data.urls.map((url) => {
      const li = document.createElement("li");
      li.textContent = url;
      li.onclick = () => download(url, data.keyword, li);
      return li;
    }));
  } catch (error) {
    $("urls").innerHTML = '<li class="empty">Ничего не найдено</li>';
    toast(error.message);
  }
}

async function download(url, keyword, li) {
  if (!navigator.onLine) return toast("Нет подключения к интернету");
  document.querySelectorAll(".urls li").forEach((el) => el.classList.toggle("active", el === li));
  const bar = $("bar");
  $("progress").hidden = false;
  bar.style.width = "0";
  bar.parentElement.classList.remove("indeterminate");
  $("percent").textContent = "Соединение…";
  $("size").textContent = "";
  $("speed").textContent = "";
  try {
    const response = await fetch(`/api/download?url=${encodeURIComponent(url)}`);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Ошибка ${response.status}`);
    }
    const total = Number(response.headers.get("X-Content-Length")) || 0;
    const type = response.headers.get("Content-Type") || "text/plain";
    if (!total) bar.parentElement.classList.add("indeterminate");
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
      $("size").textContent = total ? `${formatSize(received)} из ${formatSize(total)}` : formatSize(received);
      $("speed").textContent = seconds > 0.1 ? `${formatSize(received / seconds)}/с` : "";
      if (total) {
        const percent = Math.min(100, Math.round((received / total) * 100));
        bar.style.width = `${percent}%`;
        $("percent").textContent = `${percent}%`;
      } else {
        $("percent").textContent = "Загрузка…";
      }
    }
    bar.parentElement.classList.remove("indeterminate");
    bar.style.width = "100%";
    $("percent").textContent = "100%";
    const content = new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
    const item = { id: crypto.randomUUID(), url, keyword, type, size: received, savedAt: Date.now(), content };
    item.title = titleOf(item);
    const items = [item, ...loadItems().filter((i) => i.url !== url)];
    if (saveItems(items)) {
      toast(`Сохранено: ${item.title}`, true);
      show(item);
    }
  } catch (error) {
    bar.parentElement.classList.remove("indeterminate");
    $("percent").textContent = "Ошибка";
    toast(error.message === "Failed to fetch" ? "Сервер недоступен" : error.message);
  }
}

$("search").addEventListener("submit", (event) => {
  event.preventDefault();
  search($("word").value.trim());
});

$("items").addEventListener("click", (event) => {
  const li = event.target.closest("li[data-id]");
  if (!li) return;
  const items = loadItems();
  if (event.target.classList.contains("del")) {
    saveItems(items.filter((i) => i.id !== li.dataset.id));
    if (current === li.dataset.id) {
      current = null;
      $("frame").hidden = true;
      $("text").hidden = true;
      $("placeholder").hidden = false;
      $("viewer-title").textContent = "Просмотр";
      $("viewer-meta").textContent = "";
    }
    return renderItems();
  }
  const item = items.find((i) => i.id === li.dataset.id);
  if (item) show(item);
});

function updateNet() {
  $("net").textContent = navigator.onLine ? "онлайн" : "офлайн";
  $("net").classList.toggle("off", !navigator.onLine);
}
window.addEventListener("online", updateNet);
window.addEventListener("offline", updateNet);

$("frame").hidden = true;
updateNet();
renderItems();
loadChips();
