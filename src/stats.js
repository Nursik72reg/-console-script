// Чистая арифметика без сети: её легко проверить тестами.

// Приставки десятичные, как в тарифах провайдеров: 1 МБ = 1 000 000 байт.
const BYTES_IN_MEGABYTE = 1_000_000;
const BITS_IN_BYTE = 8;

export function toMegabytes(bytes) {
  return bytes / BYTES_IN_MEGABYTE;
}

/** Скорость в Мбит/с: сколько мегабит пришло за секунду. */
export function toMbps(bytes, ms) {
  if (ms <= 0) return 0;
  const megabits = (bytes * BITS_IN_BYTE) / BYTES_IN_MEGABYTE;
  return megabits / (ms / 1000);
}

/** Медиана: значение посередине отсортированного списка. */
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  // При чётном количестве середины две — берём их среднее.
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Сводит замеры отдельных запросов ({ ms, ttfbMs, bytes }) в итоговую статистику. */
export function summarize(results) {
  if (results.length === 0) {
    throw new Error('нет ни одного замера');
  }

  const times = results.map((r) => r.ms);
  const totalMs = sum(times);
  const totalBytes = sum(results.map((r) => r.bytes));

  return {
    requests: results.length,
    totalBytes,
    totalMs,
    avgMs: totalMs / results.length,
    medianMs: median(times),
    minMs: Math.min(...times),
    maxMs: Math.max(...times),
    avgTtfbMs: sum(results.map((r) => r.ttfbMs)) / results.length,
    // Общий объём, делённый на общее время, а не среднее скоростей отдельных
    // запросов: так короткий удачный запрос не перевешивает длинные.
    mbps: toMbps(totalBytes, totalMs),
  };
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}
