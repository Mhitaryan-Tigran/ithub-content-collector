import keywords from "../../keywords.json";

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

function isAllowed(url) {
  return Object.values(keywords).some((list) => list.includes(url));
}

async function download(url) {
  if (!url || !isAllowed(url)) {
    return json({ error: "Этот адрес не входит в список разрешённых" }, 400);
  }
  let upstream;
  try {
    upstream = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "User-Agent": "IThub-Collector/1.0", "Accept-Encoding": "identity" }, redirect: "follow" });
  } catch (error) {
    const message = error.name === "TimeoutError" ? "Сайт не ответил за 15 секунд" : `Не удалось скачать страницу: ${error.message}`;
    return json({ error: message }, 504);
  }
  if (!upstream.ok) {
    return json({ error: `Сайт ответил ошибкой ${upstream.status}` }, 502);
  }
  const encoded = upstream.headers.has("content-encoding");
  const length = encoded ? 0 : Number(upstream.headers.get("content-length")) || 0;
  if (length > MAX_BYTES) {
    return json({ error: `Страница слишком большая: ${(length / 1048576).toFixed(1)} МБ` }, 413);
  }
  const chunks = [];
  let received = 0;
  try {
    for await (const chunk of upstream.body) {
      received += chunk.byteLength;
      if (received > MAX_BYTES) {
        return json({ error: "Страница больше 5 МБ" }, 413);
      }
      chunks.push(chunk);
    }
  } catch (error) {
    return json({ error: `Не удалось скачать страницу: ${error.message}` }, 504);
  }
  const headers = new Headers({
    "Content-Type": upstream.headers.get("content-type") || "text/plain; charset=utf-8",
    "X-Source-Url": encodeURI(upstream.url),
    "Access-Control-Expose-Headers": "X-Content-Length, X-Source-Url",
  });
  headers.set("X-Content-Length", String(received));
  return new Response(new Blob(chunks).stream(), { headers });
}

export async function onRequestGet({ request, params }) {
  const parts = params.path || [];
  if (parts.length === 1 && parts[0] === "keywords") {
    return json(Object.keys(keywords));
  }
  if (parts.length === 2 && parts[0] === "keywords") {
    const word = decodeURIComponent(parts[1]).trim().toLowerCase();
    const urls = keywords[word];
    if (!urls) {
      return json({ error: `По ключевому слову «${parts[1]}» ничего не найдено`, available: Object.keys(keywords) }, 404);
    }
    return json({ keyword: word, urls });
  }
  if (parts.length === 1 && parts[0] === "download") {
    return download(new URL(request.url).searchParams.get("url"));
  }
  return json({ error: "Такого адреса нет" }, 404);
}
