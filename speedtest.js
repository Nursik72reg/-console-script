#!/usr/bin/env node
'use strict';

// Сколько запросов делаем. По условию задачи — 10.
const REQUESTS_COUNT = 10;

/**
 * Скачивает url целиком и возвращает, сколько это заняло и сколько байт пришло.
 */
async function download(url) {
  const startedAt = performance.now();

  const response = await fetch(url, {
    // Просим не брать ответ из кэша, иначе замер потеряет смысл.
    cache: 'no-store',
    // Просим сервер не сжимать ответ: иначе fetch сам распакует тело,
    // и мы посчитаем больше байт, чем реально прошло по сети.
    headers: { 'Accept-Encoding': 'identity' },
  });

  if (!response.ok) {
    throw new Error(`сервер ответил ${response.status} ${response.statusText}`);
  }

  // fetch возвращает управление, как только пришли заголовки.
  // arrayBuffer() дожидается всего тела — это и есть «полный ответ».
  const body = await response.arrayBuffer();

  return {
    ms: performance.now() - startedAt,
    bytes: body.byteLength,
  };
}

async function main() {
  const input = process.argv[2];

  if (!input) {
    console.error('Использование: node speedtest.js <url>');
    process.exit(1);
  }

  // Проверяем адрес заранее, чтобы показать понятную ошибку, а не стек fetch.
  let url;
  try {
    url = new URL(input);
  } catch {
    console.error(`Некорректный адрес: ${input}`);
    process.exit(1);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    console.error('Поддерживаются только адреса http:// и https://');
    process.exit(1);
  }

  console.log(`Адрес: ${url.href}`);
  console.log(`Запросов: ${REQUESTS_COUNT}\n`);

  let totalMs = 0;
  let totalBytes = 0;

  // Обычный цикл с await — запросы идут строго по очереди, а не параллельно.
  for (let i = 1; i <= REQUESTS_COUNT; i++) {
    const { ms, bytes } = await download(url);
    totalMs += ms;
    totalBytes += bytes;
    console.log(
      `  #${String(i).padStart(2)}  ${ms.toFixed(0).padStart(6)} мс  ${toMegabytes(bytes).toFixed(2)} МБ`,
    );
  }

  if (totalBytes === 0) {
    console.error('\nСервер вернул пустые ответы — скорость посчитать не из чего.');
    process.exit(1);
  }

  const totalSeconds = totalMs / 1000;
  // Скорость = весь объём / всё время скачивания. Биты = байты * 8.
  const megabitsPerSecond = (totalBytes * 8) / 1_000_000 / totalSeconds;
  const megabytesPerSecond = toMegabytes(totalBytes) / totalSeconds;

  console.log('');
  console.log(`Среднее время запроса: ${(totalMs / REQUESTS_COUNT).toFixed(0)} мс`);
  console.log(`Скачано всего:         ${toMegabytes(totalBytes).toFixed(2)} МБ (${totalBytes} байт)`);
  console.log(
    `Скорость скачивания:   ${megabitsPerSecond.toFixed(2)} Мбит/с (${megabytesPerSecond.toFixed(2)} МБ/с)`,
  );
}

// 1 МБ = 1 000 000 байт (десятичные приставки, как у провайдеров).
function toMegabytes(bytes) {
  return bytes / 1_000_000;
}

main().catch((error) => {
  // У сетевых ошибок fetch настоящая причина лежит в error.cause.
  const reason = error.cause?.message ?? error.message;
  console.error(`\nОшибка: ${reason}`);
  process.exit(1);
});
