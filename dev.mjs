// Локальный сервер: статика из public/ + та же функция, что на Vercel.
// Запуск: node dev.mjs  →  http://localhost:3000
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

// .env читаем сами: забытый флаг --env-file выглядит как «ключ не подключён»,
// хотя ключ лежит на месте. Флаг по-прежнему работает, просто больше не нужен.
const envFile = new URL("./.env", import.meta.url);
if (!process.env.ANTHROPIC_API_KEY && existsSync(envFile)) process.loadEnvFile(envFile);

// Импорт после загрузки .env: обработчик создаёт клиента на старте модуля.
const { default: handler } = await import("./api/analyze.js");

const TYPES = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", svg: "image/svg+xml" };

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/api/analyze") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    try {
      req.body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    } catch {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Тело запроса не разобралось как JSON." }));
      return;
    }
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(o)); };
    await handler(req, res);
    return;
  }

  const path = url.pathname.endsWith("/") ? url.pathname + "index.html" : url.pathname;
  try {
    const body = await readFile(new URL("./public" + path, import.meta.url));
    // no-store: иначе браузер держит старую страницу и правки «не появляются»
    res.writeHead(200, {
      "Content-Type": TYPES[path.split(".").pop()] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Такой страницы нет");
  }
}).listen(3000, () => {
  const key = process.env.ANTHROPIC_API_KEY ? "ключ найден" : "КЛЮЧА НЕТ — впиши его в .env, иначе разбор не пойдёт";
  console.log(`Открой http://localhost:3000 — ${key}. Каждый разбор ~$0.26`);
});
