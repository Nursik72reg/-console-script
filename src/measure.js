// Сетевая часть: скачать адрес один раз и скачать его N раз подряд.

/**
 * Скачивает url целиком и возвращает замеры одного запроса:
 *   ms     — полное время, от отправки запроса до последнего байта тела;
 *   ttfbMs — время до ответа сервера (пришли статус и заголовки);
 *   bytes  — размер тела ответа.
 */
export async function download(url, { timeoutMs }) {
  const startedAt = performance.now();

  const response = await fetch(url, {
    // Не берём ответ из кэша, иначе замер потеряет смысл.
    cache: 'no-store',
    // Просим сервер не сжимать ответ: иначе fetch сам распакует тело,
    // и мы насчитаем больше байт, чем реально прошло по сети.
    headers: { 'Accept-Encoding': 'identity' },
    // Таймаут на весь запрос, включая чтение тела: зависший сервер
    // не должен вешать скрипт навсегда.
    signal: AbortSignal.timeout(timeoutMs),
  });

  // fetch возвращает управление, как только пришли заголовки, — тело ещё в пути.
  const ttfbMs = performance.now() - startedAt;

  if (!response.ok) {
    // Тело ошибки нам не нужно — закрываем соединение, не дочитывая.
    await response.body?.cancel();
    throw new Error(`сервер ответил ${response.status} ${response.statusText}`.trim());
  }

  // Читаем тело потоком, кусок за куском, и считаем только размер.
  // Так файл любого объёма не оседает в памяти целиком.
  // body равен null, если у ответа нет тела (например, 204 No Content).
  let bytes = 0;
  if (response.body) {
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
    }
  }

  // Цикл закончился — значит, пришёл последний байт: это и есть «полный ответ».
  return { ms: performance.now() - startedAt, ttfbMs, bytes };
}

/**
 * Делает count запросов строго по очереди и возвращает массив замеров.
 * onResult вызывается после каждого запроса — чтобы показывать прогресс.
 */
export async function runSeries(url, { count, timeoutMs, onResult }) {
  const results = [];

  // await внутри обычного цикла: следующий запрос не начнётся,
  // пока предыдущий не скачан до конца.
  for (let i = 0; i < count; i++) {
    const result = await download(url, { timeoutMs });
    results.push(result);
    onResult?.(result, i);
  }

  return results;
}
