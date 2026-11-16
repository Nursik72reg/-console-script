// Тесты сети и CLI. Интернет не нужен: поднимаем свой HTTP-сервер на localhost.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { download, runSeries } from '../src/measure.js';

const FILE_SIZE = 300_000;
const CLI_PATH = fileURLToPath(new URL('../speedtest.js', import.meta.url));

let server;
let baseUrl;
let requestsSeen = 0; // сколько запросов к /file пришло
let activeNow = 0; // сколько из них обрабатывается прямо сейчас
let maxActive = 0; // максимум одновременных — для проверки последовательности

before(async () => {
  server = createServer((request, response) => {
    if (request.url === '/file') {
      requestsSeen++;
      activeNow++;
      maxActive = Math.max(maxActive, activeNow);
      response.on('close', () => activeNow--);
      // Небольшая задержка: параллельные запросы успели бы пересечься.
      setTimeout(() => response.end(Buffer.alloc(FILE_SIZE)), 20);
    } else if (request.url === '/hang') {
      // Отдаём заголовки и начало тела, но никогда не заканчиваем ответ.
      response.writeHead(200);
      response.write('начало');
    } else if (request.url === '/empty') {
      response.end();
    } else {
      response.writeHead(404).end('нет такого');
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  // Рвём зависшие соединения (/hang), иначе сервер не закроется.
  server.closeAllConnections?.();
  server.close();
});

// Запускает CLI отдельным процессом и возвращает код выхода и вывод.
function runCli(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI_PATH, ...args], (error, stdout, stderr) => {
      resolve({ code: error ? error.code : 0, stdout, stderr });
    });
  });
}

test('download: дожидается всего тела и считает его размер', async () => {
  const result = await download(`${baseUrl}/file`, { timeoutMs: 5000 });

  assert.equal(result.bytes, FILE_SIZE);
  assert.ok(result.ms > 0);
  assert.ok(result.ttfbMs > 0 && result.ttfbMs <= result.ms);
});

test('download: ответ не 2xx — ошибка со статусом', async () => {
  await assert.rejects(download(`${baseUrl}/missing`, { timeoutMs: 5000 }), /сервер ответил 404/);
});

test('download: зависший ответ обрывается по таймауту', async () => {
  await assert.rejects(download(`${baseUrl}/hang`, { timeoutMs: 200 }), { name: 'TimeoutError' });
});

test('runSeries: делает ровно count запросов и строго по очереди', async () => {
  requestsSeen = 0;
  maxActive = 0;
  const progress = [];

  const results = await runSeries(`${baseUrl}/file`, {
    count: 10,
    timeoutMs: 5000,
    onResult: (result, index) => progress.push(index),
  });

  assert.equal(results.length, 10);
  assert.equal(requestsSeen, 10);
  assert.equal(maxActive, 1, 'запросы не должны идти параллельно');
  assert.deepEqual(progress, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('CLI: по умолчанию 10 запросов, печатает итог в Мбит/с', async () => {
  requestsSeen = 0;
  const { code, stdout } = await runCli([`${baseUrl}/file`]);

  assert.equal(code, 0);
  assert.equal(requestsSeen, 10);
  assert.match(stdout, /Среднее время запроса: \d+ мс/);
  assert.match(stdout, /Скачано всего:\s+3\.00 МБ \(3000000 байт\)/);
  assert.match(stdout, /Скорость скачивания:\s+[\d.]+ Мбит\/с/);
});

test('CLI: --json выводит валидный JSON, --count меняет число запросов', async () => {
  const { code, stdout } = await runCli([`${baseUrl}/file`, '--json', '--count', '3']);
  const report = JSON.parse(stdout);

  assert.equal(code, 0);
  assert.equal(report.requests, 3);
  assert.equal(report.totalBytes, 3 * FILE_SIZE);
  assert.equal(report.results.length, 3);
  assert.ok(report.mbps > 0);
});

test('CLI: без адреса — код 1 и подсказка', async () => {
  const { code, stderr } = await runCli([]);

  assert.equal(code, 1);
  assert.match(stderr, /нужно передать ровно один адрес/);
  assert.match(stderr, /Использование/);
});

test('CLI: некорректные аргументы — код 1', async () => {
  assert.equal((await runCli(['не-адрес'])).code, 1);
  assert.equal((await runCli(['ftp://example.com/file'])).code, 1);
  assert.equal((await runCli([`${baseUrl}/file`, '--count', '0'])).code, 1);
  assert.equal((await runCli([`${baseUrl}/file`, '--timeout', 'abc'])).code, 1);
  assert.equal((await runCli([`${baseUrl}/file`, '--timeout', '99999999999'])).code, 1);
  assert.equal((await runCli([`${baseUrl}/file`, '--unknown'])).code, 1);
});

test('CLI: ошибка сервера и пустой ответ — код 1 с причиной', async () => {
  const notFound = await runCli([`${baseUrl}/missing`]);
  assert.equal(notFound.code, 1);
  assert.match(notFound.stderr, /сервер ответил 404/);

  const empty = await runCli([`${baseUrl}/empty`]);
  assert.equal(empty.code, 1);
  assert.match(empty.stderr, /пустые ответы/);
});

test('CLI: таймаут — код 1 с понятным сообщением', async () => {
  const { code, stderr } = await runCli([`${baseUrl}/hang`, '--timeout', '0.3']);

  assert.equal(code, 1);
  assert.match(stderr, /запрос не уложился в 0\.3 с/);
});
