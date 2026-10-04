const express = require("express");
const path = require("path");
const keywords = require("./keywords.json");

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15000;

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/keywords", (request, response) => {
  response.json(Object.keys(keywords));
});

app.get("/api/keywords/:word", (request, response) => {
  const word = request.params.word.trim().toLowerCase();
  const urls = keywords[word];
  if (!urls) {
    return response.status(404).json({ error: `По ключевому слову «${request.params.word}» ничего не найдено`, available: Object.keys(keywords) });
  }
  response.json({ keyword: word, urls });
});

function isAllowed(url) {
  return Object.values(keywords).some((list) => list.includes(url));
}

app.get("/api/download", async (request, response) => {
  const url = request.query.url;
  if (!url || !isAllowed(url)) {
    return response.status(400).json({ error: "Этот адрес не входит в список разрешённых" });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "IThub-Collector/1.0", "Accept-Encoding": "identity" }, redirect: "follow" });
    if (!upstream.ok) {
      clearTimeout(timer);
      return response.status(502).json({ error: `Сайт ответил ошибкой ${upstream.status}` });
    }
    const length = Number(upstream.headers.get("content-length")) || 0;
    if (length > MAX_BYTES) {
      clearTimeout(timer);
      return response.status(413).json({ error: `Страница слишком большая: ${(length / 1048576).toFixed(1)} МБ` });
    }
    response.setHeader("Content-Type", upstream.headers.get("content-type") || "text/plain; charset=utf-8");
    response.setHeader("X-Source-Url", encodeURI(upstream.url));
    response.setHeader("Access-Control-Expose-Headers", "X-Content-Length, X-Source-Url");
    if (length) {
      response.setHeader("Content-Length", length);
      response.setHeader("X-Content-Length", length);
    }
    let received = 0;
    for await (const chunk of upstream.body) {
      received += chunk.length;
      if (received > MAX_BYTES) {
        controller.abort();
        response.destroy(new Error("Превышен размер"));
        break;
      }
      response.write(chunk);
    }
    clearTimeout(timer);
    response.end();
  } catch (error) {
    clearTimeout(timer);
    if (response.headersSent) return response.destroy(error);
    const message = error.name === "AbortError" ? "Сайт не ответил за 15 секунд" : `Не удалось скачать страницу: ${error.message}`;
    response.status(504).json({ error: message });
  }
});

app.use((request, response) => {
  response.status(404).json({ error: "Такого адреса нет" });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Сборщик контента: http://localhost:${PORT}`));
}

module.exports = app;
