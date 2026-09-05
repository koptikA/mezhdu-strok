// Проверка движка целиком: реальный вызов API через тот же обработчик,
// что стоит на Vercel. Запуск: node --env-file=.env smoke.mjs
import handler from "./api/analyze.js";
import { writeFileSync } from "node:fs";

// node --env-file=.env smoke.mjs         — разбор задания
// node --env-file=.env smoke.mjs review  — проверка готовой работы
const review = process.argv[2] === "review";

const req = {
  method: "POST",
  body: {
    mode: review ? "review" : "analyze",
    text: `Нужен лендинг для онлайн-школы английского. Один экран, форма записи
на пробный урок, адаптив под телефон. Дизайн на твой вкус, ориентир — сайты
конкурентов. Сроки: неделя. Работа тестовая, неоплачиваемая, по итогам решим.`,
    workText: review
      ? `Сделала один экран в Figma: блок с оффером и формой записи, блок «как
проходит урок», отзывы, подвал. Адаптив под телефон есть. Отдаю ссылкой
на макет, пояснительной записки нет.`
      : "",
    profession: "веб-дизайнер",
    deadline: "неделя",
  },
};

const events = [];
let out = "";
const res = {
  statusCode: 200,
  headers: {},
  setHeader(k, v) { this.headers[k] = v; },
  status(c) { this.statusCode = c; return this; },
  json(o) { events.push(["json", o]); },
  write(chunk) {
    const ev = chunk.match(/^event: (.+)$/m)?.[1];
    const data = JSON.parse(chunk.match(/^data: (.+)$/m)[1]);
    if (ev === "text") out += data.t;
    else events.push([ev, data]);
    if (ev === "status" || ev === "error" || ev === "done") console.log("  событие:", ev, JSON.stringify(data).slice(0, 200));
  },
  end() {},
};

console.time("разбор");
await handler(req, res);
console.timeEnd("разбор");

const err = events.find(([e]) => e === "error" || e === "json");
if (err) { console.error("ПРОВАЛ:", err[1]); process.exit(1); }
if (out.trim().length < 500) { console.error("ПРОВАЛ: разбор пустой или обрубок,", out.length, "знаков"); process.exit(1); }

writeFileSync("smoke-out.md", out);
const done = events.find(([e]) => e === "done")?.[1]?.usage ?? {};
const cost = ((done.input_tokens ?? 0) * 5 + (done.output_tokens ?? 0) * 25) / 1e6;
console.log(`ОК: ${out.length} знаков, вход ${done.input_tokens}, выход ${done.output_tokens}, ~$${cost.toFixed(2)}`);
console.log("разбор целиком: smoke-out.md");
