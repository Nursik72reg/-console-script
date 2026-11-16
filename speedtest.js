#!/usr/bin/env node
// Точка входа: разбирает аргументы, запускает замер и печатает результат.

import { parseArgs } from 'node:util';
import { runSeries } from './src/measure.js';
import { summarize, toMbps, toMegabytes } from './src/stats.js';

const DEFAULT_COUNT = 10; // по условию задачи
const DEFAULT_TIMEOUT_SECONDS = 30;
// Таймер в Node.js принимает не больше 2^32 − 1 мс, поэтому ограничиваем сутками.
const MAX_TIMEOUT_SECONDS = 86_400;

const HELP = `Замер скорости скачивания: несколько последовательных запросов к одному адресу.

Использование:
  node speedtest.js <url> [опции]

Опции:
  -n, --count <число>      сколько запросов сделать (по умолчанию ${DEFAULT_COUNT})
  -t, --timeout <секунды>  таймаут одного запроса (по умолчанию ${DEFAULT_TIMEOUT_SECONDS})
      --json               вывести результат в JSON, без таблицы
  -h, --help               показать эту справку

Пример:
  node speedtest.js "https://speed.cloudflare.com/__down?bytes=5000000"`;

// Ошибка в аргументах: печатаем причину и выходим с кодом 1.
function fail(message) {
  console.error(`Ошибка: ${message}`);
  process.exit(1);
}

function readOptions() {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        count: { type: 'string', short: 'n', default: String(DEFAULT_COUNT) },
        timeout: { type: 'string', short: 't', default: String(DEFAULT_TIMEOUT_SECONDS) },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (error) {
    // parseArgs бросает исключение на неизвестную опцию.
    fail(`${error.message}\n\n${HELP}`);
  }

  const { values, positionals } = parsed;

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  if (positionals.length !== 1) {
    fail(`нужно передать ровно один адрес\n\n${HELP}`);
  }

  // Проверяем адрес заранее, чтобы показать понятную ошибку, а не стек fetch.
  let url;
  try {
    url = new URL(positionals[0]);
  } catch {
    fail(`некорректный адрес: ${positionals[0]}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    fail('поддерживаются только адреса http:// и https://');
  }

  const count = Number(values.count);
  if (!Number.isInteger(count) || count < 1) {
    fail('--count должен быть целым числом не меньше 1');
  }

  const timeoutSeconds = Number(values.timeout);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0 || timeoutSeconds > MAX_TIMEOUT_SECONDS) {
    fail(`--timeout должен быть числом секунд больше 0 и не больше ${MAX_TIMEOUT_SECONDS}`);
  }

  return { url, count, timeoutSeconds, json: values.json };
}

// Одна строка таблицы: номер запроса, время, объём, скорость.
function formatRow(result, index) {
  const number = String(index + 1).padStart(2);
  const time = `${result.ms.toFixed(0)} мс`.padStart(9);
  const size = `${toMegabytes(result.bytes).toFixed(2)} МБ`.padStart(11);
  const speed = `${toMbps(result.bytes, result.ms).toFixed(2)} Мбит/с`.padStart(15);
  return `  #${number} ${time} ${size} ${speed}`;
}

function printSummary(stats) {
  console.log('');
  console.log(`Среднее время запроса: ${stats.avgMs.toFixed(0)} мс`);
  console.log(
    `  медиана ${stats.medianMs.toFixed(0)} мс, мин ${stats.minMs.toFixed(0)} мс, макс ${stats.maxMs.toFixed(0)} мс`,
  );
  console.log(`  из них ожидание ответа сервера: ${stats.avgTtfbMs.toFixed(0)} мс`);
  console.log(
    `Скачано всего:         ${toMegabytes(stats.totalBytes).toFixed(2)} МБ (${stats.totalBytes} байт)`,
  );
  console.log(
    `Скорость скачивания:   ${stats.mbps.toFixed(2)} Мбит/с (${(stats.mbps / 8).toFixed(2)} МБ/с)`,
  );
}

// Превращаем техническую ошибку в понятное сообщение.
function describeError(error, timeoutSeconds) {
  if (error.name === 'TimeoutError') {
    return `запрос не уложился в ${timeoutSeconds} с`;
  }
  // У сетевых ошибок fetch настоящая причина лежит в error.cause.
  return error.cause?.message || error.message;
}

async function main() {
  const { url, count, timeoutSeconds, json } = readOptions();

  if (!json) {
    console.log(`Адрес: ${url.href}`);
    console.log(`Запросов: ${count}\n`);
  }

  let results;
  try {
    results = await runSeries(url, {
      count,
      timeoutMs: timeoutSeconds * 1000,
      // Печатаем строку сразу после каждого запроса, а не всё в конце.
      onResult: json ? undefined : (result, index) => console.log(formatRow(result, index)),
    });
  } catch (error) {
    fail(describeError(error, timeoutSeconds));
  }

  const stats = summarize(results);

  if (stats.totalBytes === 0) {
    fail('сервер вернул пустые ответы — скорость посчитать не из чего');
  }

  if (json) {
    console.log(JSON.stringify({ url: url.href, ...stats, results }, null, 2));
  } else {
    printSummary(stats);
  }
}

main();
