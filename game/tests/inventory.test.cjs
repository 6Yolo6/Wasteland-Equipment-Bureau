'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CONTENT } = require('../../.test-build/content/catalog.js');
const { normalizeShape, occupiedCells, createInventory, validateInventory, transactInventory, addInstances, beginPreparation } = require('../../.test-build/core/inventory.js');

const clone = value => structuredClone(value);
const item = (id, defId = 'I07', spawnIndex = 0) => ({ id, defId, spawnIndex });
const definition = id => CONTENT.items.find(def => def.id === id);
const layout = state => clone({ placements: state.placements, stash: state.stash });
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
function command(state, data, content = CONTENT) {
  const result = transactInventory(state, { expectedRevision: state.revision, ...data }, content);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.state.revision, state.revision + 1);
  assert.deepEqual(validateInventory(result.state, content), []);
  return result.state;
}
const place = (state, instanceId, x, y, rotation = 0) => command(state, { type: 'place', instanceId, x, y, rotation });
function reject(state, data, content = CONTENT) {
  const before = clone(state);
  const result = transactInventory(state, data, content);
  assert.equal(result.ok, false);
  assert.equal(result.state, state);
  assert.ok(result.reason);
  assert.deepEqual(state, before);
  return result;
}
function conserved(state) {
  assert.deepEqual(validateInventory(state, CONTENT), []);
  assert.deepEqual([...state.placements.map(p => p.instanceId), ...state.stash].sort(), state.instances.map(i => i.id).sort());
}

test('INV: creation puts every instance in input-order stash and copies incoming data', () => {
  const input = [item('later', 'I01', 20), item('first', 'I05', 1), item('middle', 'I07', 10)];
  const before = clone(input);
  const state = createInventory(input);
  assert.equal(state.width, 5); assert.equal(state.height, 6); assert.equal(state.revision, 0);
  assert.deepEqual(state.placements, []); assert.deepEqual(state.history, []);
  assert.deepEqual(state.stash, ['later', 'first', 'middle']);
  assert.deepEqual(input, before);
  input[0].id = 'changed'; input.push(item('new'));
  assert.equal(state.instances[0].id, 'later'); assert.equal(state.instances.length, 3);
  conserved(state);
  assert.equal(createInventory([], 7, 8).height, 8);
});

test('INV: invalid dimensions, instance identities and spawn indices are rejected', () => {
  for (const value of [0, -1, 1.5, NaN, Infinity, '5', null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createInventory([], value, 6));
    assert.throws(() => createInventory([], 5, value));
  }
  for (const instances of [null, {}, [null], [item('')], [item('a', '')], [item('a', 'I07', -1)], [item('a', 'I07', NaN)], [item('a', 'I07', 0.5)], [item('a'), item('a', 'I01', 1)], [item('a'), item('b', 'I01', 0)], new Array(1)]) {
    assert.throws(() => createInventory(instances));
  }
});

test('INV: clockwise rotation normalizes, sorts, preserves cells and restores after four turns', () => {
  for (const def of CONTENT.items) {
    const original = clone(def.shape);
    let shape = normalizeShape(freeze(clone(original)));
    for (let i = 0; i < 4; i++) {
      shape = normalizeShape(shape, 90);
      assert.equal(shape.length, original.length);
      assert.equal(new Set(shape.map(c => c.x + ',' + c.y)).size, shape.length);
      assert.equal(Math.min(...shape.map(c => c.x)), 0);
      assert.equal(Math.min(...shape.map(c => c.y)), 0);
    }
    assert.deepEqual(shape, normalizeShape(original));
    assert.deepEqual(def.shape, original);
  }
  const l = definition('I02').shape;
  assert.deepEqual(normalizeShape(l, 90), [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]);
  assert.deepEqual(normalizeShape(l, 270), [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]);
  assert.deepEqual(normalizeShape(l.map(c => ({ x: c.x - 8, y: c.y + 11 }))), normalizeShape(l));
  assert.deepEqual(normalizeShape(definition('I05').shape, 90), normalizeShape(definition('I05').shape));
});

test('INV: malformed rotations/shapes are not silently repaired or looped over', () => {
  for (const rotation of [-90, 45, 360, 1, NaN, Infinity, '90', null]) assert.throws(() => normalizeShape([{ x: 0, y: 0 }], rotation), /rotation/);
  for (const cells of [null, {}, [], [null], [{}], [{ x: '0', y: 0 }], [{ x: 0.5, y: 0 }], [{ x: NaN, y: 0 }], [{ x: 0, y: Infinity }], [{ x: 0, y: 0 }, { x: 0, y: 0 }], [{ x: 0, y: 0 }, { x: 1, y: 1 }], [{ x: 0, y: 0 }, { x: 2, y: 0 }], [{ x: -Number.MAX_SAFE_INTEGER, y: 0 }, { x: Number.MAX_SAFE_INTEGER, y: 0 }]]) {
    assert.throws(() => normalizeShape(cells));
  }
});

test('INV: occupiedCells honors a hollow anchor, validates saved rotation and is pure', () => {
  const placement = freeze({ instanceId: 'gun', x: 2, y: 3, rotation: 270 });
  assert.deepEqual(occupiedCells(placement, definition('I02')), [{ x: 3, y: 3 }, { x: 2, y: 4 }, { x: 3, y: 4 }]);
  for (const value of [undefined, null, 45, 360, '90']) assert.throws(() => occupiedCells({ ...placement, rotation: value }, definition('I02')), /rotation/);
  for (const value of [undefined, null, NaN, Infinity, 0.2, '0']) assert.throws(() => occupiedCells({ ...placement, x: value }, definition('I02')));
  assert.throws(() => occupiedCells({ ...placement, x: Number.MAX_SAFE_INTEGER }, definition('I02')), /overflow/);
  assert.throws(() => occupiedCells(null, definition('I02')));
  assert.throws(() => occupiedCells(placement, null));
});

test('INV: actual bounding-box holes can contain another instance at either anchor', () => {
  for (const [rotation, x, y] of [[0, 1, 0], [270, 0, 0]]) {
    let state = createInventory([item('l', 'I02'), item('cell', 'I07', 1)]);
    state = place(state, 'l', 0, 0, rotation);
    state = place(state, 'cell', x, y);
    assert.equal(state.placements.length, 2); assert.deepEqual(state.stash, []); conserved(state);
  }
});

test('INV: moving and rotating exclude self, enforce actual bounds, and commit once', () => {
  let state = createInventory([item('gun', 'I01')]);
  state = place(state, 'gun', 4, 3);
  for (const [x, y, rotation] of [[5, 0, 0], [0, 5, 0], [-1, 0, 0], [0, -1, 0], [4, 3, 90]]) {
    reject(freeze(state), { type: 'place', instanceId: 'gun', x, y, rotation, expectedRevision: state.revision });
  }
  const before = clone(state);
  state = place(state, 'gun', 2, 1, 90);
  assert.equal(state.placements[0].rotation, 90);
  assert.deepEqual(state.history.at(-1), layout(before));
  state = place(state, 'gun', 2, 1, 180);
  conserved(state);
});

test('INV: two backpack items exchange atomically with B retaining its original orientation', () => {
  let state = createInventory([item('a', 'I01'), item('b', 'I02', 1)]);
  state = place(state, 'a', 0, 0); state = place(state, 'b', 2, 0);
  const result = transactInventory(freeze(state), { type: 'place', instanceId: 'a', x: 2, y: 0, rotation: 0, expectedRevision: state.revision }, CONTENT);
  assert.equal(result.ok, true, result.reason); assert.equal(result.swappedId, 'b');
  assert.equal(result.state.revision, state.revision + 1);
  assert.deepEqual(result.state.placements, [{ instanceId: 'a', x: 2, y: 0, rotation: 0 }, { instanceId: 'b', x: 0, y: 0, rotation: 0 }]);
  conserved(result.state);
  state = createInventory([item('a'), item('b', 'I01', 1)]);
  state = place(state, 'a', 0, 0); state = place(state, 'b', 2, 1, 90);
  state = place(state, 'a', 2, 1, 270);
  assert.deepEqual(state.placements.find(p => p.instanceId === 'b'), { instanceId: 'b', x: 0, y: 0, rotation: 90 });
});

test('INV: multi-cell contact with one item is a single stash exchange, preserving list positions', () => {
  let state = createInventory([item('head'), item('b', 'I05', 1), item('a', 'I05', 2), item('tail', 'I07', 3)]);
  state = place(state, 'b', 0, 0);
  const checkpoint = layout(state);
  assert.deepEqual(state.stash, ['head', 'a', 'tail']);
  const result = transactInventory(freeze(state), { type: 'place', instanceId: 'a', x: 0, y: 0, rotation: 90, expectedRevision: state.revision }, CONTENT);
  assert.equal(result.ok, true); assert.equal(result.swappedId, 'b');
  state = result.state;
  assert.deepEqual(state.stash, ['head', 'b', 'tail']);
  state = command(state, { type: 'stash', instanceId: 'a' });
  assert.deepEqual(state.stash, ['head', 'b', 'tail', 'a']); conserved(state);
  state = command(state, { type: 'undo' });
  assert.deepEqual(state.stash, ['head', 'b', 'tail']);
  state = command(state, { type: 'undo' });
  assert.deepEqual(layout(state), checkpoint);
});

test('INV: exchanges that send B out of bounds or into A/third item leave the exact state untouched', () => {
  let state = createInventory([item('a'), item('b', 'I05', 1), item('spare', 'I09', 2)]);
  state = place(state, 'a', 4, 5); state = place(state, 'b', 0, 0);
  assert.match(reject(freeze(state), { type: 'place', instanceId: 'a', x: 0, y: 0, rotation: 0, expectedRevision: state.revision }).reason, /swap-invalid/);
  state = createInventory([item('a'), item('b', 'I05', 1), item('c', 'I07', 2)]);
  state = place(state, 'a', 0, 0); state = place(state, 'b', 2, 2); state = place(state, 'c', 1, 0);
  reject(freeze(state), { type: 'place', instanceId: 'a', x: 2, y: 2, rotation: 0, expectedRevision: state.revision });
  state = createInventory([item('a'), item('b', 'I05', 1)]);
  state = place(state, 'a', 0, 0); state = place(state, 'b', 1, 0);
  reject(freeze(state), { type: 'place', instanceId: 'a', x: 1, y: 0, rotation: 0, expectedRevision: state.revision });
});

test('INV: touching two different instances is rejected, from stash and from backpack', () => {
  let state = createInventory([item('a', 'I05'), item('b', 'I07', 1), item('c', 'I07', 2)]);
  state = place(state, 'b', 0, 0); state = place(state, 'c', 1, 0);
  assert.match(reject(freeze(state), { type: 'place', instanceId: 'a', x: 0, y: 0, rotation: 0, expectedRevision: state.revision }).reason, /multiple-conflicts/);
  state = place(state, 'a', 3, 3);
  reject(freeze(state), { type: 'place', instanceId: 'a', x: 0, y: 0, rotation: 0, expectedRevision: state.revision });
});

test('INV: invalid command fields and stale revisions reject without even changing history', () => {
  let state = place(createInventory([item('a'), item('b', 'I01', 1)]), 'a', 0, 0);
  freeze(state);
  const valid = { type: 'place', instanceId: 'b', x: 2, y: 0, rotation: 0, expectedRevision: state.revision };
  for (const cmd of [null, undefined, {}, { ...valid, type: 'delete' }, { ...valid, instanceId: 'missing' }, { ...valid, instanceId: null }]) reject(state, cmd);
  for (const rotation of [undefined, null, -90, 360, 45, NaN, Infinity, '90']) reject(state, { ...valid, rotation });
  for (const coordinate of [undefined, null, 0.5, NaN, Infinity, '1', Number.MAX_SAFE_INTEGER + 1]) {
    reject(state, { ...valid, x: coordinate }); reject(state, { ...valid, y: coordinate });
  }
  for (const expectedRevision of [-1, 0.5, NaN, Infinity, '1', null, undefined]) reject(state, { ...valid, expectedRevision });
  for (const cmd of [valid, { type: 'stash', instanceId: 'a' }, { type: 'undo' }]) {
    assert.equal(reject(state, { ...cmd, expectedRevision: 0 }).reason, 'stale-revision');
    assert.equal(reject(state, { ...cmd, expectedRevision: state.revision + 1 }).reason, 'stale-revision');
  }
  reject(state, { type: 'stash', instanceId: 'b', expectedRevision: state.revision });
});

test('INV: validation catches corrupt partitions, references, history and geometry', () => {
  const base = place(createInventory([item('a'), item('b', 'I07', 1)]), 'a', 0, 0);
  const corruptions = [
    s => s.stash.push('a'), s => s.stash.push('b'), s => s.stash.push('unknown'), s => s.stash.pop(),
    s => s.instances.push(item('a', 'I07', 9)), s => s.instances[0].defId = 'missing', s => s.instances[0].spawnIndex = NaN, s => s.instances[1].spawnIndex = s.instances[0].spawnIndex,
    s => s.placements.push({ ...s.placements[0] }), s => s.placements[0].rotation = 45, s => delete s.placements[0].rotation,
    s => s.placements[0].x = Infinity, s => s.placements[0].x = 5, s => s.placements[0].y = -1,
    s => { s.placements.push({ instanceId: 'b', x: 0, y: 0, rotation: 0 }); s.stash = []; },
    s => s.history[0].stash.pop(), s => s.history.push(null), s => s.history = null, s => s.history = new Array(1),
    s => s.width = 0, s => s.height = 1.5, s => s.revision = NaN,
    s => s.instances = null, s => s.placements = null, s => s.stash = null,
  ];
  for (const corrupt of corruptions) {
    const state = clone(base); corrupt(state);
    const errors = validateInventory(state, CONTENT);
    assert.ok(errors.length); assert.ok(errors.every(error => typeof error === 'string'));
    reject(state, { type: 'undo', expectedRevision: state.revision });
  }
  for (const state of [null, undefined, {}, [], 'inventory']) assert.ok(validateInventory(state, CONTENT).length);
  for (const content of [null, {}, { items: null }]) reject(base, { type: 'undo', expectedRevision: base.revision }, content);
  for (const corrupt of [c => c.items[0].shape = [], c => c.items[0].shape.push({ x: 0, y: 0 }), c => c.items[0].id = c.items[1].id]) {
    const content = clone(CONTENT); corrupt(content);
    reject(base, { type: 'undo', expectedRevision: base.revision }, content);
  }
});

test('INV: repeated undo restores layout/orientation/stash while revision only increases', () => {
  let state = createInventory([item('a', 'I01'), item('b', 'I02', 1), item('c', 'I07', 2)]);
  state = place(state, 'a', 0, 0); state = place(state, 'b', 2, 0);
  state = beginPreparation(state);
  const checkpoints = [layout(state)];
  state = place(state, 'a', 0, 3, 90); checkpoints.push(layout(state));
  state = place(state, 'b', 2, 0, 90); checkpoints.push(layout(state));
  state = place(state, 'c', 0, 3); checkpoints.push(layout(state));
  state = command(state, { type: 'stash', instanceId: 'b' });
  let revision = state.revision;
  for (let i = checkpoints.length - 1; i >= 0; i--) {
    state = command(freeze(state), { type: 'undo' });
    assert.deepEqual(layout(state), checkpoints[i]); assert.equal(state.revision, ++revision);
    assert.equal(state.history.length, i); conserved(state);
  }
  assert.equal(reject(state, { type: 'undo', expectedRevision: state.revision }).reason, 'nothing-to-undo');
  reject(state, { type: 'place', instanceId: 'c', x: 4, y: 5, rotation: 0, expectedRevision: 2 });
  state = place(state, 'c', 4, 5);
  state = command(state, { type: 'undo' });
  assert.deepEqual(layout(state), checkpoints[0]);
});

test('INV: beginPreparation closes the previous undo boundary without changing layout or revision', () => {
  let state = place(createInventory([item('a')]), 'a', 0, 0);
  const before = clone(state);
  state = beginPreparation(freeze(state));
  assert.deepEqual(state.history, []); assert.equal(state.revision, before.revision);
  assert.deepEqual(layout(state), layout(before)); assert.equal(before.history.length, 1);
  reject(state, { type: 'undo', expectedRevision: state.revision });
  state = place(state, 'a', 1, 0);
  state = command(state, { type: 'undo' });
  assert.deepEqual(layout(state), layout(before));
  reject(state, { type: 'undo', expectedRevision: state.revision });
});

test('INV: full 30-cell backpack accepts all loot into stash and cannot undo loot away', () => {
  let state = createInventory(Array.from({ length: 30 }, (_, i) => item('cell-' + i, 'I07', i)));
  for (let i = 0; i < 30; i++) state = place(state, 'cell-' + i, i % 5, Math.floor(i / 5));
  const incoming = [item('loot-plate', 'I05', 30), item('loot-med', 'I09', 31)];
  const result = addInstances(freeze(state), incoming, CONTENT);
  assert.equal(result.ok, true, result.reason); assert.equal(result.state.revision, state.revision + 1);
  assert.deepEqual(result.state.placements, state.placements);
  assert.deepEqual(result.state.stash, ['loot-plate', 'loot-med']);
  assert.deepEqual(result.state.history, []); assert.equal(result.state.instances.length, 32); conserved(result.state);
  reject(result.state, { type: 'undo', expectedRevision: result.state.revision });
  incoming[0].defId = 'changed'; assert.equal(result.state.instances[30].defId, 'I05');
  const arranged = command(result.state, { type: 'stash', instanceId: 'cell-0' });
  const undone = command(arranged, { type: 'undo' });
  assert.equal(undone.instances.length, 32); assert.deepEqual(undone.stash, ['loot-plate', 'loot-med']);
});

test('INV: addInstances is all-or-nothing for invalid input and clears history even for an empty boundary', () => {
  const state = freeze(place(createInventory([item('a')]), 'a', 0, 0));
  for (const incoming of [null, {}, [null], [item('a', 'I01', 1)], [item('b', 'I01', 1), item('b', 'I02', 2)], [item('b', 'missing', 1)], [item('b', 'I01', -1)], [item('b', 'I01', NaN)], [item('b', 'I01', 0)]]) {
    const before = clone(state);
    const result = addInstances(state, incoming, CONTENT);
    assert.equal(result.ok, false); assert.equal(result.state, state); assert.deepEqual(state, before);
  }
  const result = addInstances(state, [], CONTENT);
  assert.equal(result.ok, true); assert.deepEqual(result.state.history, []);
  assert.equal(result.state.revision, state.revision + 1); assert.deepEqual(layout(result.state), layout(state));
});

test('INV: revision exhaustion rejects rather than wrapping, and arbitrary string IDs stay safe', () => {
  const state = { ...createInventory([item('a')]), revision: Number.MAX_SAFE_INTEGER };
  assert.equal(reject(state, { type: 'place', instanceId: 'a', x: 0, y: 0, rotation: 0, expectedRevision: state.revision }).reason, 'revision-exhausted');
  const added = addInstances(state, [item('b', 'I01', 1)], CONTENT);
  assert.equal(added.ok, false); assert.equal(added.state, state);
  let special = createInventory(['__proto__', 'constructor', 'toString'].map((id, i) => item(id, 'I07', i)));
  special = place(special, '__proto__', 0, 0); special = place(special, 'constructor', 1, 0);
  special = place(special, 'toString', 0, 0); conserved(special);
  assert.deepEqual(special.stash, ['__proto__']);
});

test('INV: deterministic mixed transactions preserve every instance, snapshots and failure identity', () => {
  let state = createInventory(CONTENT.items.map((def, i) => item('item-' + i, def.id, i)));
  let seed = 0x41b29;
  const draw = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  for (let step = 0; step < 400; step++) {
    freeze(state);
    const before = JSON.stringify(state);
    const kind = draw(5);
    const instanceId = 'item-' + draw(14);
    const expectedRevision = step % 11 === 0 ? state.revision - 1 : state.revision;
    const cmd = kind === 0 ? { type: 'undo', expectedRevision } : kind === 1 ? { type: 'stash', instanceId, expectedRevision } : {
      type: 'place', instanceId, x: draw(7) - 1, y: draw(8) - 1, rotation: [0, 90, 180, 270, 45][draw(5)], expectedRevision,
    };
    const result = transactInventory(state, cmd, CONTENT);
    assert.equal(JSON.stringify(state), before);
    if (result.ok) { assert.notEqual(result.state, state); assert.equal(result.state.revision, state.revision + 1); }
    else assert.equal(result.state, state);
    state = result.state; conserved(state);
  }
});
