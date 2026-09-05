import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";

const MODEL = "claude-opus-5";
const MAX_INPUT = 20000;
const MAX_PROFESSION = 500;
const MAX_FILES = 8;
// Vercel режет тело запроса на 4,5 МБ, base64 раздувает файл в 1,37 раза —
// поэтому исходных байт берём не больше 3 МБ суммарно.
const MAX_BYTES = 3 * 1024 * 1024;
const IMAGES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const TEXTS = ["text/plain", "text/markdown", "text/csv"];

// Что человек приложил и чем это считать при разборе.
const ROLES = {
  task: "часть задания",
  company: "материалы компании",
  vacancy: "вакансия, на которую человек претендует",
  cv: "резюме самого человека",
  work: "готовая работа человека — то, что он собирается сдать",
};

const read = (name) =>
  readFileSync(new URL(`../core/${name}`, import.meta.url), "utf8");

const CORES = { analyze: read("analysis.md"), review: read("review.md") };

const client = new Anthropic();

// Файлы уходят в модель как есть: PDF и картинки она читает сама,
// текстовые вставляем в сообщение. Перед каждым — строка о том, что это.
export function fileBlocks(files) {
  const blocks = [];
  for (const f of files) {
    const what = ROLES[f.role] ?? ROLES.task;
    if (f.type === "application/pdf") {
      blocks.push({ type: "text", text: `Файл «${f.name}» — ${what}:` });
      blocks.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: f.data },
      });
    } else if (IMAGES.includes(f.type)) {
      blocks.push({ type: "text", text: `Файл «${f.name}» — ${what}:` });
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: f.type, data: f.data },
      });
    } else {
      const body = Buffer.from(f.data, "base64").toString("utf8").slice(0, MAX_INPUT);
      blocks.push({
        type: "text",
        text: `Файл «${f.name}» — ${what}:\n<файл>\n${body}\n</файл>`,
      });
    }
  }
  return blocks;
}

export function buildPrompt(input) {
  const { mode, text, company, vacancy, workText, profession, deadline, files } = input;
  const has = (role) => files.some((f) => f.role === role);
  const parts = [];

  if (mode === "review") {
    parts.push(`Проверь готовую работу по методике. Задание и работа — ниже и в приложенных файлах.`);
  } else {
    parts.push(
      files.length
        ? `Разбери по методике то, что приложено${text ? " и текст ниже" : ""}. Приложенные файлы — часть задания и материалов к нему, а не иллюстрация.`
        : `Разбери текст ниже по методике.`
    );
  }

  if (profession) parts.push(`\nЧем занимается человек и что в его области считается нормой:\n${profession}`);
  if (deadline) parts.push(`\nСрок и условия, которые назвали: ${deadline}`);
  if (text) parts.push(`\nЗадание:\n<задание>\n${text}\n</задание>`);
  if (vacancy) parts.push(`\nВакансия, на которую человек претендует:\n<вакансия>\n${vacancy}\n</вакансия>`);
  if (workText) parts.push(`\nЧто человек сделал и собирается сдать:\n<работа>\n${workText}\n</работа>`);

  if (company) {
    parts.push(
      `\nСайт компании, которая дала задание: ${company}\n` +
        `Открой его и посмотри, как они пишут о себе, кто их клиент, насколько зрелый ` +
        `у них продукт, какой уровень оформления считается обычным. Нужны выводы про ` +
        `их нормы и про то, чего они не написали в задании, потому что у них так ` +
        `принято, — а не пересказ сайта. Не открылся — скажи одной строкой ` +
        `и разбирай без него.`
    );
  }
  if (has("cv")) {
    parts.push(
      `\nРезюме приложено. Сверь его с заданием${vacancy || has("vacancy") ? " и вакансией" : ""}: ` +
        `чего в резюме нет из ожидаемого — то и будут проверять пристальнее всего. ` +
        `Разбирай резюме ради задания, советов по самому резюме не давай.`
    );
  }

  const links = [text, vacancy, workText].filter(Boolean).join("\n");
  if (/https?:\/\//i.test(links)) {
    parts.push(
      `\nВ тексте есть ссылки — открой их и разбирай то, что там лежит: это само задание ` +
        `или материалы к нему, а не иллюстрация. Если ссылка не открывается — закрыт ` +
        `доступ, нужен вход, страница пустая — скажи об этом прямо в начале ответа ` +
        `и попроси прислать PDF или снимок экрана. Не выдумывай содержимое, которого ` +
        `не увидел. Отдельно про Figma: холст рисуется на стороне браузера, текст ` +
        `из ссылки не вытаскивается никогда — сразу проси экспорт в PDF ` +
        `(File → Export → PDF) или снимки экрана, не трать попытки.`
    );
  }

  parts.push(
    `\nОтвечай по-русски и сразу разбором. Без вступлений вроде «сейчас открою ссылку» ` +
      `и без пересказа того, что ты делаешь по дороге.`
  );
  parts.push(
    `\nЕсли область тебе незнакома — сначала выясни её через поиск, потом разбирай. ` +
      `Каждый пункт помечай: «надёжно», «нашёл» (со ссылкой) или «проверь сам». ` +
      `Служебную первую строку и заголовки разделов писать ровно так, как задано ` +
      `в методике: ответ разбирается программой по заголовкам.`
  );
  return [...fileBlocks(files), { type: "text", text: parts.join("\n") }];
}

export function validate(body) {
  // "work" остался от версии с двумя режимами — читаем его как обычный разбор.
  const mode = body?.mode === "review" ? "review" : "analyze";
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const text = str(body?.text, MAX_INPUT + 1);
  const vacancy = str(body?.vacancy, MAX_INPUT);
  const workText = str(body?.workText, MAX_INPUT);
  const company = str(body?.company, 300);
  const raw = Array.isArray(body?.files) ? body.files : [];

  if (company && !/^https?:\/\/\S+$/i.test(company)) {
    return { error: "Сайт компании — это ссылка целиком, вместе с https://" };
  }
  if (raw.length > MAX_FILES) return { error: `Файлов сразу не больше ${MAX_FILES}.` };

  const files = [];
  let bytes = 0;
  for (const f of raw) {
    const name = String(f?.name ?? "файл").slice(0, 120);
    const type = String(f?.type ?? "");
    const data = typeof f?.data === "string" ? f.data : "";
    const role = ROLES[f?.role] ? f.role : "task";
    if (!data) return { error: `Файл «${name}» пришёл пустым.` };
    if (![...IMAGES, ...TEXTS, "application/pdf"].includes(type)) {
      return {
        error: `Файл «${name}» такого вида приложить нельзя. Подойдут PDF, PNG, JPG, GIF, WEBP и текстовые файлы. Word и Figma — сохрани в PDF или сними экраном.`,
      };
    }
    bytes += Math.round((data.length * 3) / 4);
    files.push({ name, type, data, role });
  }
  if (bytes > MAX_BYTES) {
    return { error: `Файлы весят больше 3 МБ. Убери лишние страницы или сожми картинки.` };
  }

  const hasTask = text.length >= 40 || files.some((f) => f.role === "task");
  if (!hasTask) {
    return { error: "Нужно само задание: текст от 40 символов или приложенный файл." };
  }
  if (mode === "review" && !workText && !files.some((f) => f.role === "work")) {
    return { error: "Для проверки приложи саму работу — файлом или ссылкой на неё." };
  }
  if (text.length > MAX_INPUT) {
    return { error: `Текст длиннее ${MAX_INPUT} символов. Оставь самое важное.` };
  }

  const profession = str(body?.profession, MAX_PROFESSION);
  const deadline = str(body?.deadline, 200);
  return { mode, text, company, vacancy, workText, profession, deadline, files };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Только POST" });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "На сервере не задан ANTHROPIC_API_KEY." });
    return;
  }

  const input = validate(req.body);
  if (input.error) {
    res.status(400).json({ error: input.error });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const params = {
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: "adaptive", display: "summarized" },
    system: [{ type: "text", text: CORES[input.mode], cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildPrompt(input) }],
    tools: [
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: 6 },
      { type: "web_search_20260209", name: "web_search", max_uses: 6 },
    ],
  };

  const run = async (useFallbacks) => {
    const p = useFallbacks
      ? { ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }
      : params;
    return useFallbacks ? client.beta.messages.stream(p) : client.messages.stream(p);
  };

  try {
    let stream;
    try {
      stream = await run(true);
    } catch {
      stream = await run(false);
    }

    for await (const event of stream) {
      if (event.type === "content_block_start" && event.content_block.type === "server_tool_use") {
        send("status", { stage: event.content_block.name === "web_fetch" ? "fetch" : "search" });
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") send("text", { t: event.delta.text });
        else if (event.delta.type === "thinking_delta") send("thinking", { t: event.delta.thinking });
      }
    }

    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      send("error", { error: "Разбор не удался: запрос отклонён фильтром безопасности." });
    } else {
      send("done", { usage: final.usage });
    }
  } catch (err) {
    send("error", { error: err?.message ?? "Не удалось выполнить разбор." });
  } finally {
    res.end();
  }
}
