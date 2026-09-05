// Проверка входа: что проходит, что отсекается, во что превращается.
// Запуск: node test-files.mjs — API не вызывается, денег не стоит.
import assert from "node:assert/strict";
import { validate, buildPrompt, fileBlocks } from "./api/analyze.js";

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const long = "Текст задания достаточной длины, чтобы пройти проверку в сорок символов.";
const pdf = (name, role) => ({ name, type: "application/pdf", data: b64("%PDF-1.4"), role });

// Перед каждым файлом идёт строка о том, что это; PDF и картинка — своими блоками
const blocks = fileBlocks([
  pdf("тз.pdf", "task"),
  { name: "экран.png", type: "image/png", data: b64("PNG"), role: "work" },
  { name: "письмо.txt", type: "text/plain", data: b64("Привет, надо сделать лендинг"), role: "task" },
]);
assert.match(blocks[0].text, /тз\.pdf.*часть задания/);
assert.equal(blocks[1].type, "document");
assert.equal(blocks[1].source.media_type, "application/pdf");
assert.match(blocks[2].text, /экран\.png.*готовая работа/);
assert.equal(blocks[3].type, "image");
assert.equal(blocks[3].source.media_type, "image/png");
assert.match(blocks[4].text, /письмо\.txt/);
assert.match(blocks[4].text, /надо сделать лендинг/);

// Один файл-задание без текста — достаточный вход
const onlyFile = validate({ text: "", files: [pdf("тз.pdf", "task")] });
assert.equal(onlyFile.error, undefined);
assert.equal(onlyFile.mode, "analyze");
assert.match(buildPrompt(onlyFile).at(-1).text, /приложено/);

// Роль по умолчанию — задание; неизвестная роль туда же
assert.equal(validate({ text: long, files: [pdf("x.pdf", "чепуха")] }).files[0].role, "task");

// Короткий текст без файла-задания — не пропускаем
assert.match(validate({ text: "мало" }).error, /Нужно само задание/);
assert.match(validate({ text: "мало", files: [pdf("cv.pdf", "cv")] }).error, /Нужно само задание/);

// Проверка работы требует саму работу
assert.match(validate({ mode: "review", text: long }).error, /приложи саму работу/i);
assert.equal(validate({ mode: "review", text: long, workText: "https://figma.com/x" }).error, undefined);
assert.equal(validate({ mode: "review", text: long, files: [pdf("w.pdf", "work")] }).mode, "review");

// Сайт компании — только ссылка целиком
assert.match(validate({ text: long, company: "company.ru" }).error, /вместе с https/);
const withCompany = validate({ text: long, company: "https://company.ru" });
assert.equal(withCompany.error, undefined);
assert.match(buildPrompt(withCompany).at(-1).text, /Открой его/);

// Резюме упоминается в промпте только когда приложено
const withCv = validate({ text: long, vacancy: "Ищем дизайнера", files: [pdf("cv.pdf", "cv")] });
assert.match(buildPrompt(withCv).at(-1).text, /Резюме приложено[\s\S]*и вакансией/);
assert.doesNotMatch(buildPrompt(validate({ text: long })).at(-1).text, /Резюме приложено/);

// Word не поддерживается — ошибка должна подсказывать выход
assert.match(
  validate({ text: long, files: [{ name: "тз.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", data: b64("x") }] }).error,
  /сохрани в PDF/
);

// Девять файлов и перевес по весу
assert.match(validate({ text: long, files: Array(9).fill({ name: "a.png", type: "image/png", data: b64("x") }) }).error, /не больше 8/);
assert.match(
  validate({ text: long, files: [{ name: "big.pdf", type: "application/pdf", data: "A".repeat(5 * 1024 * 1024) }] }).error,
  /больше 3 МБ/
);

// Текст без файлов — один текстовый блок
const plain = validate({ text: long, files: [] });
assert.equal(buildPrompt(plain).length, 1);

console.log("ОК: файлы, роли, режим проверки и ограничения ведут себя как задумано");
