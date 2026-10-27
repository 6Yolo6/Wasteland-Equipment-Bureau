'use strict';
const { performance } = require('node:perf_hooks');

/** Await predicates explicitly; never treat a pending Promise as a ready condition. */
async function pollUntil(predicate, { timeoutMs = 15000, intervalMs = 50, label = 'condition' } = {}) {
  if (typeof predicate !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new TypeError('pollUntil requires a predicate and positive finite durations');
  }
  const deadline = performance.now() + timeoutMs;
  const expired = () => new Error('Timed out waiting for ' + label);
  for (;;) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw expired();
    let timer;
    let result;
    try {
      result = await Promise.race([
        Promise.resolve().then(predicate),
        new Promise((_, reject) => { timer = setTimeout(() => reject(expired()), remaining); })
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (result) return result;
    const left = deadline - performance.now();
    if (left <= 0) throw expired();
    await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, left)));
  }
}
module.exports = { pollUntil };
