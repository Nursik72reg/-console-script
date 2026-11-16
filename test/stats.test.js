import assert from 'node:assert/strict';
import { test } from 'node:test';
import { median, summarize, toMbps, toMegabytes } from '../src/stats.js';

test('toMegabytes: 1 МБ — это 1 000 000 байт', () => {
  assert.equal(toMegabytes(2_500_000), 2.5);
});

test('toMbps: 1 МБ за секунду — это 8 Мбит/с', () => {
  assert.equal(toMbps(1_000_000, 1000), 8);
});

test('toMbps: нулевое время не даёт деления на ноль', () => {
  assert.equal(toMbps(1_000_000, 0), 0);
});

test('median: нечётное и чётное количество значений', () => {
  assert.equal(median([30, 10, 20]), 20);
  assert.equal(median([40, 10, 20, 30]), 25);
});

test('summarize: считает объём, время и скорость по всем запросам', () => {
  const stats = summarize([
    { ms: 1000, ttfbMs: 100, bytes: 1_000_000 },
    { ms: 3000, ttfbMs: 300, bytes: 1_000_000 },
  ]);

  assert.equal(stats.requests, 2);
  assert.equal(stats.totalBytes, 2_000_000);
  assert.equal(stats.totalMs, 4000);
  assert.equal(stats.avgMs, 2000);
  assert.equal(stats.medianMs, 2000);
  assert.equal(stats.minMs, 1000);
  assert.equal(stats.maxMs, 3000);
  assert.equal(stats.avgTtfbMs, 200);
  // 2 МБ за 4 с = 0,5 МБ/с = 4 Мбит/с.
  // Среднее скоростей по отдельности дало бы (8 + 2,67) / 2 = 5,33 — это неверно.
  assert.equal(stats.mbps, 4);
});

test('summarize: без замеров бросает ошибку', () => {
  assert.throws(() => summarize([]), /нет ни одного замера/);
});
