'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pollUntil } = require('../lib/async-poll.cjs');

test('async false results are awaited until a real ready value arrives', async () => {
  let calls = 0;
  const expected = { ready: true };
  const value = await pollUntil(async () => ++calls < 3 ? false : expected, { timeoutMs: 1000, intervalMs: 1 });
  assert.equal(calls, 3);
  assert.equal(value, expected);
});
test('a never-resolving predicate is bounded by the deadline', async () => {
  await assert.rejects(pollUntil(() => new Promise(() => {}), { timeoutMs: 15, intervalMs: 1, label: 'hung predicate' }), /Timed out waiting for hung predicate/);
});
test('a permanently false predicate times out rather than passing', async () => {
  await assert.rejects(pollUntil(async () => false, { timeoutMs: 15, intervalMs: 1 }), /Timed out waiting/);
});
test('predicate failures are not swallowed', async () => {
  const original = new Error('runtime failed');
  await assert.rejects(pollUntil(async () => { throw original; }), error => error === original);
});
test('invalid timeout and interval are rejected', async () => {
  await assert.rejects(pollUntil(() => true, { timeoutMs: 0 }), TypeError);
  await assert.rejects(pollUntil(() => true, { intervalMs: Infinity }), TypeError);
});
