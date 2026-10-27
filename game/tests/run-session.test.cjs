'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CONTENT, DEVELOPMENT_CONTENT, validateContent } = require('../../.test-build/content/catalog.js');
const { createRun, applyRunCommand, advanceRun } = require('../../.test-build/core/run.js');
const { addInstances, occupiedCells, validateInventory } = require('../../.test-build/core/inventory.js');
const { evaluateLoadout } = require('../../.test-build/core/loadout.js');
const { GameSession, FixedStepDriver } = require('../../.test-build/application/session.js');

const clone = value => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
function fresh(seed = 1, starter = 'I03', content = CONTENT) {
  const session = new GameSession(content);
  session.start(seed, starter);
  return session;
}
function partition(run, content = CONTENT) {
  assert.deepEqual(validateInventory(run.inventory, content), []);
  const ids = run.inventory.instances.map(item => item.id);
  const located = [...run.inventory.stash, ...run.inventory.placements.map(p => p.instanceId)];
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(located).size, located.length);
  assert.deepEqual(located.slice().sort(), ids.slice().sort());
  assert.ok(run.inventory.instances.every(item => item.spawnIndex < run.nextSpawnIndex));
}
function accept(session, action) {
  const before = session.state.run;
  const result = session.dispatch(action);
  assert.equal(result.ok, true, result.reason || JSON.stringify(action));
  assert.equal(result.state.revision, before.revision + 1);
  assert.equal(result.duplicate, undefined);
  partition(result.state, session.content);
  return result;
}
function command(run, action, commandId = run.id + '/external/' + run.revision, overrides = {}) {
  return { commandId, runId: run.id, expectedRevision: run.revision, action, ...overrides };
}
function rejectSubmit(session, submitted) {
  const before = session.state;
  const snapshot = clone(before);
  const result = session.submit(submitted);
  assert.equal(result.ok, false);
  assert.equal(result.state, before.run);
  assert.equal(session.state, before);
  assert.deepEqual(session.state, snapshot);
  assert.equal(typeof result.reason, 'string');
  return result;
}
function rejectAction(session, action) {
  return rejectSubmit(session, command(session.state.run, action));
}
function inventoryAction(session, operation) {
  return { type: 'inventory', command: { expectedRevision: session.state.run.inventory.revision, ...operation } };
}
function place(session, spawnIndex, x, y, rotation = 0) {
  const item = session.state.run.inventory.instances.find(item => item.spawnIndex === spawnIndex);
  assert.ok(item, 'missing instance ' + spawnIndex);
  return accept(session, inventoryAction(session, { type: 'place', instanceId: item.id, x, y, rotation }));
}
function stash(session, spawnIndex) {
  const item = session.state.run.inventory.instances.find(item => item.spawnIndex === spawnIndex);
  return accept(session, inventoryAction(session, { type: 'stash', instanceId: item.id }));
}
function arrange(session, placements) {
  assert.equal(session.state.run.phase, 'preparation');
  for (const old of [...session.state.run.inventory.placements]) {
    accept(session, inventoryAction(session, { type: 'stash', instanceId: old.instanceId }));
  }
  for (const [spawnIndex, x, y, rotation = 0] of placements) place(session, spawnIndex, x, y, rotation);
}
function fight(session, batches = [450]) {
  const events = [];
  let calls = 0;
  while (session.state.run.phase === 'combat') {
    assert.ok(calls < 5000, 'battle did not reach its deadline');
    const before = session.state.run;
    session.advance(batches[calls++ % batches.length]);
    // A run-level no-op does not commit a new combat batch; do not replay old events.
    if (session.state.run.combat !== before.combat) events.push(...session.state.run.combat.events);
  }
  return events;
}

// This is a fixed, actually played route through unmodified CONTENT (seed 1, I03).
// Tuples are [owned spawnIndex, x, y, rotation]; all actions go through GameSession.
// No granted gear, HP edits, enemy edits, rerolls, or all-unlocked content are used here.
const DEFAULT_PLAN = [
  {
    "placements": [
      [
        0,
        0,
        0,
        0
      ],
      [
        1,
        2,
        0,
        0
      ],
      [
        2,
        4,
        0,
        0
      ],
      [
        3,
        0,
        1,
        0
      ]
    ],
    "option": 2,
    "loot": [
      "I01",
      "I01"
    ]
  },
  {
    "placements": [
      [
        0,
        0,
        0,
        0
      ],
      [
        1,
        2,
        0,
        0
      ],
      [
        2,
        4,
        0,
        0
      ],
      [
        3,
        0,
        1,
        0
      ],
      [
        4,
        4,
        1,
        0
      ],
      [
        5,
        2,
        2,
        0
      ]
    ],
    "option": 1,
    "loot": [
      "I01",
      "I08"
    ]
  },
  {
    "placements": [
      [
        0,
        0,
        0,
        0
      ],
      [
        1,
        2,
        0,
        0
      ],
      [
        2,
        4,
        0,
        0
      ],
      [
        3,
        0,
        1,
        0
      ],
      [
        4,
        4,
        1,
        0
      ],
      [
        5,
        2,
        2,
        0
      ],
      [
        6,
        0,
        2,
        0
      ],
      [
        7,
        3,
        3,
        0
      ]
    ],
    "option": 1,
    "loot": [
      "I02",
      "I01"
    ]
  },
  {
    "placements": [
      [
        0,
        0,
        0,
        0
      ],
      [
        1,
        2,
        0,
        0
      ],
      [
        2,
        4,
        0,
        0
      ],
      [
        3,
        0,
        1,
        0
      ],
      [
        4,
        4,
        1,
        0
      ],
      [
        5,
        2,
        2,
        0
      ],
      [
        6,
        0,
        2,
        0
      ],
      [
        7,
        3,
        3,
        0
      ],
      [
        9,
        1,
        2,
        0
      ],
      [
        8,
        0,
        4,
        0
      ]
    ],
    "option": 1,
    "loot": [
      "I07",
      "I11"
    ]
  },
  {
    "placements": [
      [
        0,
        0,
        0,
        0
      ],
      [
        1,
        2,
        0,
        0
      ],
      [
        2,
        4,
        0,
        0
      ],
      [
        3,
        0,
        1,
        0
      ],
      [
        4,
        4,
        1,
        0
      ],
      [
        5,
        2,
        2,
        0
      ],
      [
        6,
        0,
        2,
        0
      ],
      [
        7,
        3,
        3,
        0
      ],
      [
        9,
        1,
        2,
        0
      ],
      [
        8,
        0,
        4,
        0
      ],
      [
        10,
        1,
        4,
        0
      ],
      [
        11,
        3,
        2,
        0
      ]
    ]
  }
];
function playDefault(through = 5, batches = [450]) {
  const session = fresh();
  const waves = [];
  for (let wave = 1; wave <= through; wave++) {
    const plan = DEFAULT_PLAN[wave - 1];
    assert.equal(session.state.run.wave, wave);
    assert.equal(session.state.run.inventory.instances.length, 4 + 2 * (wave - 1));
    arrange(session, plan.placements);
    const prepared = clone(session.state.run.inventory);
    const loadout = evaluateLoadout(session.state.run.inventory, CONTENT);
    const carried = session.state.run.hp;
    accept(session, { type: 'start-combat' });
    let run = session.state.run;
    assert.deepEqual(run.inventory.placements, prepared.placements);
    assert.deepEqual(run.inventory.stash, prepared.stash);
    assert.deepEqual(run.inventory.history, []);
    assert.equal(run.hp, carried === null ? loadout.maxHp : Math.min(carried, loadout.maxHp));
    assert.deepEqual(run.combat.enemies.map(e => e.id), CONTENT.waves[wave - 1]);
    for (const enemy of run.combat.enemies) {
      const def = CONTENT.enemies.find(def => def.id === enemy.id);
      assert.equal(enemy.hp, def.hp);
      assert.equal(enemy.maxHp, def.hp);
      assert.equal(enemy.damage, def.damage);
      assert.equal(enemy.armor, def.armor);
      assert.equal(enemy.cooldown, def.cooldown);
    }
    const events = fight(session, batches);
    run = session.state.run;
    assert.equal(run.combat.outcome, 'victory', 'default wave ' + wave);
    assert.equal(run.victories, wave);
    assert.equal(run.reports.length, wave);
    assert.equal(run.reports[wave - 1].wave, wave);
    assert.equal(run.reports[wave - 1].outcome, 'victory');
    assert.equal(run.reports[wave - 1].remainingHp, run.hp);
    assert.deepEqual(run.reports[wave - 1].stats, run.combat.stats);
    assert.equal(events.filter(e => e.type === 'terminal').length, 1);
    assert.equal(session.state.wallet, 0, 'no coins before claiming settlement');
    partition(run);
    waves.push({ wave, hp: run.hp, ticks: run.combat.tick, events });
    if (wave === through) break;
    assert.equal(run.phase, 'loot');
    const option = run.loot[plan.option];
    assert.deepEqual(option.itemIds, plan.loot, 'seeded loot changed; inspect content version rather than granting gear');
    accept(session, { type: 'choose-loot', optionId: option.id });
  }
  return { session, waves };
}
function firstLoot() { return playDefault(1).session; }
function naturalDefeat() {
  const session = fresh(1, 'I01');
  place(session, 0, 0, 0);
  for (let wave = 1; wave <= 5 && session.state.run.phase === 'preparation'; wave++) {
    accept(session, { type: 'start-combat' });
    fight(session);
    if (session.state.run.phase === 'loot') accept(session, { type: 'skip-loot' });
  }
  assert.equal(session.state.run.phase, 'defeat');
  return session;
}
function timeoutSession() {
  // Routing-only fixture: shorten the deadline, not HP, enemies, weapons, or rewards.
  // The default-content victory tests above never use this content.
  const content = clone(CONTENT);
  content.version += '-test-deadline';
  content.limits.deadlineTick = 1;
  const session = fresh(1, 'I01', content);
  place(session, 0, 0, 0);
  accept(session, { type: 'start-combat' });
  fight(session);
  return session;
}
function fixtureItems(session, defIds) {
  // Public inventory-domain fixture builder, only for full-bag / max-HP boundaries.
  // It is intentionally NOT called by the untouched default-content clear route.
  const run = session.state.run;
  const incoming = defIds.map((defId, offset) => {
    const spawnIndex = run.nextSpawnIndex + offset;
    return { id: run.id + '/item/' + spawnIndex, defId, spawnIndex };
  });
  const added = addInstances(run.inventory, incoming, session.content);
  assert.equal(added.ok, true, added.reason);
  session.state = { ...session.state, run: { ...run, inventory: added.state, nextSpawnIndex: run.nextSpawnIndex + incoming.length } };
  partition(session.state.run, session.content);
}

// Creation, guards and frozen layouts.
test('RUN start: valid starters, deterministic identity and all initial items in stash', () => {
  for (const starter of ['I01', 'I02', 'I03']) {
    const run = createRun('identity', 0, starter, CONTENT);
    assert.deepEqual(run, createRun('identity', 0, starter, CONTENT));
    assert.equal(run.phase, 'preparation');
    assert.equal(run.contentVersion, CONTENT.version);
    assert.equal(run.wave, 1);
    assert.equal(run.hp, null);
    assert.equal(run.combat, null);
    assert.equal(run.victories, 0);
    assert.equal(run.nextSpawnIndex, 4);
    assert.deepEqual(run.inventory.instances.map(i => i.defId), [starter, 'I05', 'I07', 'I09']);
    assert.deepEqual(run.inventory.placements, []);
    assert.equal(run.inventory.stash.length, 4);
    assert.deepEqual(run.processedCommandIds, []);
    partition(run);
  }
  for (const seed of [-1, 1.5, NaN, Infinity, 4294967296]) assert.throws(() => createRun('bad-seed', seed, 'I01', CONTENT));
  for (const starter of ['', 'I04', 'missing']) assert.throws(() => createRun('bad-starter', 1, starter, CONTENT));
  assert.throws(() => createRun('', 1, 'I01', CONTENT));
});

test('SESSION start guard: live phases and unclaimed settlements cannot be replaced', () => {
  const combat = fresh(); place(combat, 0, 0, 0); accept(combat, { type: 'start-combat' });
  const abandoned = fresh(); accept(abandoned, { type: 'abandon' });
  const sessions = [fresh(), combat, firstLoot(), naturalDefeat(), playDefault().session, abandoned];
  for (const session of sessions) {
    const before = clone(session.state);
    assert.throws(() => session.start(2, 'I02'));
    assert.deepEqual(session.state, before);
  }
  const empty = new GameSession(CONTENT);
  const before = clone(empty.state);
  assert.throws(() => empty.start(NaN, 'I01'));
  assert.throws(() => empty.start(1, 'I04'));
  assert.deepEqual(empty.state, before);
  assert.throws(() => empty.dispatch({ type: 'abandon' }), /No active run/);
  assert.throws(() => empty.submit({}), /No active run/);
  empty.advance(10);
  assert.deepEqual(empty.state, before);
});

test('RUN start-combat guard: stash-only or armor-only layouts cannot start; a placed weapon can', () => {
  const session = fresh();
  rejectAction(session, { type: 'start-combat' });
  place(session, 1, 2, 0);
  rejectAction(session, { type: 'start-combat' });
  place(session, 0, 0, 0);
  accept(session, { type: 'start-combat' });
  assert.equal(session.state.run.phase, 'combat');
  assert.equal(session.state.run.hp, 120);
  rejectAction(session, { type: 'start-combat' });
});

test('RUN layout seal: immutable preparation snapshots and combat loadout cannot be edited mid-wave', () => {
  const session = fresh(); arrange(session, DEFAULT_PLAN[0].placements);
  const preparation = freeze(session.state.run);
  const before = clone(preparation);
  const expected = evaluateLoadout(preparation.inventory, CONTENT);
  accept(session, { type: 'start-combat' });
  assert.deepEqual(preparation, before);
  const sealed = freeze(session.state.run);
  assert.deepEqual(sealed.inventory.history, []);
  assert.deepEqual(sealed.combat.weapons.map(({ nextAttackTick, attacks, ...w }) => w), expected.weapons);
  assert.equal(sealed.combat.shield, expected.initialShield);
  assert.equal(sealed.combat.reduction, expected.reduction);
  rejectAction(session, inventoryAction(session, { type: 'stash', instanceId: preparation.inventory.instances[0].id }));
  rejectAction(session, inventoryAction(session, { type: 'undo' }));
  session.advance(1);
  assert.deepEqual(session.state.run.inventory, sealed.inventory);
  assert.equal(sealed.combat.tick, 0);
  assert.equal(sealed.combat.weapons[0].attacks, 0);
});

test('RUN revision gates: stale outer or inventory revisions are atomic rejections', () => {
  const session = fresh();
  const old = session.state.run;
  const stale = command(old, inventoryAction(session, { type: 'place', instanceId: old.inventory.instances[0].id, x: 0, y: 0, rotation: 0 }), 'delayed-placement');
  place(session, 1, 2, 0);
  rejectSubmit(session, stale);
  const currentOuter = { ...stale, commandId: 'stale-inner', expectedRevision: session.state.run.revision };
  rejectSubmit(session, currentOuter);
  assert.ok(!session.state.run.processedCommandIds.includes(stale.commandId));
  const retry = { ...stale, expectedRevision: session.state.run.revision,
    action: { ...stale.action, command: { ...stale.action.command, expectedRevision: session.state.run.inventory.revision } } };
  assert.equal(session.submit(retry).ok, true);
});

test('RUN advance guards: invalid batches throw, zero and inactive phases are no-ops, version mismatch is rejected', () => {
  const session = fresh(); place(session, 0, 0, 0);
  const prepared = freeze(session.state.run);
  assert.equal(advanceRun(prepared, 1, CONTENT), prepared);
  accept(session, { type: 'start-combat' });
  const active = freeze(session.state.run);
  for (const ticks of [-1, NaN, Infinity, 1.5, 10001]) assert.throws(() => advanceRun(active, ticks, CONTENT), /tick batch/);
  assert.equal(advanceRun(active, 0, CONTENT), active);
  const differentVersion = { ...CONTENT, version: CONTENT.version + '-other' };
  assert.throws(() => advanceRun(active, 1, differentVersion), /version mismatch/);
  const result = applyRunCommand(active, command(active, { type: 'abandon' }), differentVersion);
  assert.equal(result.ok, false);
  assert.equal(result.state, active);
  assert.equal(active.combat.tick, 0);
});

// Loot is a transaction, not a fresh roll on every read.
test('LOOT-001: three stable two-item options use only the normal unlocked pool and survive JSON continuation', () => {
  const session = firstLoot();
  const run = freeze(session.state.run);
  assert.equal(CONTENT.items.filter(i => i.unlocked).length, 12);
  assert.equal(run.loot.length, 3);
  const allowed = new Set(CONTENT.items.filter(i => i.unlocked).map(i => i.id));
  assert.equal(new Set(run.loot.map(o => o.id)).size, 3);
  run.loot.forEach((option, i) => {
    assert.equal(option.id, run.id + '/loot/1/' + i);
    assert.equal(option.itemIds.length, 2);
    assert.ok(option.itemIds.every(id => allowed.has(id)));
  });
  for (let i = 0; i < 10; i++) assert.equal(advanceRun(run, 450, CONTENT), run);
  const restored = new GameSession(CONTENT);
  restored.state = clone(session.state);
  restored.advance(450);
  assert.deepEqual(restored.state, session.state);
  const take = command(run, { type: 'choose-loot', optionId: run.loot[0].id }, 'persisted-loot-choice');
  assert.equal(session.submit(take).ok, true);
  assert.equal(restored.submit(clone(take)).ok, true);
  assert.deepEqual(restored.state, session.state);
  assert.equal(run.reports.length, 1);
});

test('LOOT claim: invalid option ID and stale revision change nothing; rejected commandId remains retryable', () => {
  const session = firstLoot();
  const run = session.state.run;
  const id = 'retryable-loot-command';
  rejectSubmit(session, command(run, { type: 'choose-loot', optionId: 'missing-option' }, id));
  rejectSubmit(session, command(run, { type: 'choose-loot', optionId: run.loot[0].id }, id, { expectedRevision: run.revision - 1 }));
  assert.ok(!session.state.run.processedCommandIds.includes(id));
  const beforeInventory = clone(run.inventory);
  const result = session.submit(command(run, { type: 'choose-loot', optionId: run.loot[0].id }, id));
  assert.equal(result.ok, true);
  assert.equal(result.state.phase, 'preparation');
  assert.equal(result.state.wave, 2);
  assert.equal(result.state.nextSpawnIndex, 6);
  assert.deepEqual(result.state.inventory.placements, beforeInventory.placements);
  assert.deepEqual(result.state.inventory.instances.slice(0, 4), beforeInventory.instances);
  assert.deepEqual(result.state.inventory.instances.slice(4), [
    { id: run.id + '/item/4', defId: run.loot[0].itemIds[0], spawnIndex: 4 },
    { id: run.id + '/item/5', defId: run.loot[0].itemIds[1], spawnIndex: 5 },
  ]);
  assert.deepEqual(result.state.inventory.stash, [...beforeInventory.stash, run.id + '/item/4', run.id + '/item/5']);
  assert.equal(result.state.combat, null);
  assert.deepEqual(result.state.loot, []);
  assert.equal(result.state.lootEvent, false);
  partition(result.state);
});

test('LOOT commandId dedup: repeat receipts never append items or let a previous-wave option be reused', () => {
  const session = firstLoot();
  const offered = session.state.run;
  const take = command(offered, { type: 'choose-loot', optionId: offered.loot[DEFAULT_PLAN[0].option].id }, 'take-wave-one');
  assert.equal(session.submit(take).ok, true);
  const chosen = freeze(session.state.run);
  for (let i = 0; i < 10; i++) {
    const repeated = session.submit(clone(take));
    assert.equal(repeated.ok, true);
    assert.equal(repeated.duplicate, true);
    assert.equal(repeated.coinsAdded, 0);
    assert.equal(repeated.state, chosen);
    assert.equal(session.state.wallet, 0);
  }
  rejectAction(session, { type: 'choose-loot', optionId: offered.loot[0].id });
  arrange(session, DEFAULT_PLAN[1].placements);
  accept(session, { type: 'start-combat' }); fight(session);
  assert.equal(session.state.run.phase, 'loot');
  rejectAction(session, { type: 'choose-loot', optionId: offered.loot[0].id });
  assert.equal(session.state.run.inventory.instances.length, 6);
});

test('LOOT skip: preserve every held item, close history, and advance only once', () => {
  const session = firstLoot();
  const before = freeze(session.state.run);
  const skip = command(before, { type: 'skip-loot' }, 'skip-wave-one');
  const result = session.submit(skip);
  assert.equal(result.ok, true);
  assert.equal(result.state.wave, 2);
  assert.equal(result.state.phase, 'preparation');
  assert.equal(result.state.nextSpawnIndex, before.nextSpawnIndex);
  assert.deepEqual(result.state.inventory.instances, before.inventory.instances);
  assert.deepEqual(result.state.inventory.placements, before.inventory.placements);
  assert.deepEqual(result.state.inventory.stash, before.inventory.stash);
  assert.deepEqual(result.state.inventory.history, []);
  assert.deepEqual(result.state.loot, []);
  assert.equal(session.submit(skip).duplicate, true);
  rejectAction(session, { type: 'skip-loot' });
  assert.equal(session.state.run.wave, 2);
});

test('LOOT-002 full bag: actual 30-cell layout keeps every item and appends both rewards to stash', () => {
  const session = fresh(1, 'I01');
  fixtureItems(session, ['I05','I05','I05','I05','I05','I07']);
  arrange(session, [[0,4,0],[1,0,0],[4,2,0],[5,0,2],[6,2,2],[7,0,4],[8,2,4],[3,4,2,90],[2,4,4],[9,4,5]]);
  const inv = session.state.run.inventory;
  const cells = inv.placements.flatMap(p => occupiedCells(p, CONTENT.items.find(d => d.id === inv.instances.find(i => i.id === p.instanceId).defId)));
  assert.equal(cells.length, 30);
  assert.equal(new Set(cells.map(c => c.x + ',' + c.y)).size, 30);
  assert.deepEqual(inv.stash, []);
  accept(session, { type: 'start-combat' }); fight(session);
  assert.equal(session.state.run.phase, 'loot');
  const before = freeze(session.state.run);
  const option = before.loot[0];
  accept(session, { type: 'choose-loot', optionId: option.id });
  const after = session.state.run;
  assert.deepEqual(after.inventory.placements, before.inventory.placements);
  assert.deepEqual(after.inventory.instances.slice(0, 10), before.inventory.instances);
  assert.equal(after.inventory.instances.length, 12);
  assert.deepEqual(after.inventory.instances.slice(10).map(i => i.defId), option.itemIds);
  assert.deepEqual(after.inventory.stash, [after.id + '/item/10', after.id + '/item/11']);
  assert.equal(after.nextSpawnIndex, 12);
  partition(after);
});

test('UNDO boundary: no undo in combat/loot and no undo across either accepted or skipped loot', () => {
  for (const takeLoot of [true, false]) {
    const session = fresh(); arrange(session, DEFAULT_PLAN[0].placements);
    assert.ok(session.state.run.inventory.history.length > 0);
    const delayed = command(session.state.run, inventoryAction(session, { type: 'undo' }), 'pre-combat-undo');
    accept(session, { type: 'start-combat' });
    rejectAction(session, inventoryAction(session, { type: 'undo' }));
    fight(session);
    rejectAction(session, inventoryAction(session, { type: 'undo' }));
    const optionId = session.state.run.loot[0].id;
    accept(session, takeLoot ? { type: 'choose-loot', optionId } : { type: 'skip-loot' });
    const checkpoint = clone(session.state.run.inventory);
    rejectSubmit(session, delayed);
    rejectAction(session, inventoryAction(session, { type: 'undo' }));
    stash(session, 0);
    accept(session, inventoryAction(session, { type: 'undo' }));
    assert.deepEqual(session.state.run.inventory.placements, checkpoint.placements);
    assert.deepEqual(session.state.run.inventory.stash, checkpoint.stash);
    assert.deepEqual(session.state.run.inventory.instances, checkpoint.instances);
    assert.ok(session.state.run.inventory.revision > checkpoint.revision);
    rejectAction(session, inventoryAction(session, { type: 'undo' }));
    partition(session.state.run);
  }
});

// Actual five-wave closure and all settlement branches.
test('RUN-SESSION default clear: legal seed-1 route wins all five real waves without data/HP/enemy edits', t => {
  const originalContent = clone(CONTENT);
  const { session, waves } = playDefault();
  const run = session.state.run;
  assert.equal(run.phase, 'settlement');
  assert.equal(run.wave, 5);
  assert.equal(run.victories, 5);
  assert.deepEqual(run.reports.map(r => r.wave), [1,2,3,4,5]);
  assert.ok(run.reports.every(r => r.outcome === 'victory'));
  assert.equal(run.inventory.instances.length, 12);
  assert.equal(run.nextSpawnIndex, 12);
  assert.deepEqual(run.loot, []);
  assert.deepEqual(run.combat.enemies.map(e => e.id), ['B01']);
  assert.deepEqual(run.settlement, { key: run.id + '/settlement', reason: 'victory', baseCoins: 32, claimed: false });
  assert.equal(session.state.wallet, 0);
  accept(session, { type: 'claim-settlement' });
  assert.equal(session.state.wallet, 32);
  assert.equal(session.state.run.settlement.claimed, true);
  assert.deepEqual(CONTENT, originalContent);
  t.diagnostic('Unmodified CONTENT; seed=1, starter=I03, loot indices=2/1/1/1; ' + JSON.stringify(waves.map(({ wave, hp, ticks }) => ({ wave, hp, ticks }))));
});

test('RUN batches: same five-wave commands produce identical aggregated combat events and reports', () => {
  const bulk = playDefault(5, [450]);
  const split = playDefault(5, [1,7,0,3,19]);
  assert.deepEqual(split.waves, bulk.waves);
  const normalized = session => {
    const state = clone(session.state);
    state.run.revision = 0; // Run revision counts accepted advance calls, not logical ticks.
    state.run.combat.events = [];
    return state;
  };
  assert.deepEqual(normalized(split.session), normalized(bulk.session));
});

test('RUN defeat: bare default I01 naturally loses after two wins and settles only on confirmation', () => {
  const session = naturalDefeat();
  const run = freeze(session.state.run);
  assert.equal(run.wave, 3);
  assert.equal(run.victories, 2);
  assert.equal(run.hp, 0);
  assert.deepEqual(run.reports.map(r => r.outcome), ['victory','victory','defeat']);
  assert.equal(run.settlement, null);
  assert.equal(session.state.wallet, 0);
  for (let i = 0; i < 10; i++) assert.equal(advanceRun(run, 450, CONTENT), run);
  rejectAction(session, { type: 'start-combat' });
  rejectAction(session, { type: 'claim-settlement' });
  accept(session, { type: 'finish-defeat' });
  assert.deepEqual(session.state.run.settlement, { key: run.id + '/settlement', reason: 'defeat', baseCoins: 8, claimed: false });
  accept(session, { type: 'claim-settlement' });
  assert.equal(session.state.wallet, 8);
  rejectAction(session, { type: 'finish-defeat' });
});

test('RUN timeout: distinct failure reason, one report, no automatic coins or restart', () => {
  const session = timeoutSession();
  const run = freeze(session.state.run);
  assert.equal(run.phase, 'defeat');
  assert.equal(run.hp, 120);
  assert.equal(run.combat.outcome, 'timeout');
  assert.equal(run.combat.tick, 1);
  assert.equal(run.reports.length, 1);
  assert.equal(run.reports[0].outcome, 'timeout');
  assert.equal(run.settlement, null);
  session.advance(450);
  assert.equal(session.state.run, run);
  accept(session, { type: 'finish-defeat' });
  assert.equal(session.state.run.settlement.reason, 'timeout');
  assert.equal(session.state.run.settlement.baseCoins, 0);
  accept(session, { type: 'claim-settlement' });
  assert.equal(session.state.wallet, 0);
  rejectAction(session, { type: 'start-combat' });
});

test('RUN abandon: all live phases settle only completed victories and never receive the clear bonus', () => {
  const combat = fresh(); place(combat, 0, 0, 0); accept(combat, { type: 'start-combat' }); combat.advance(5);
  const sessions = [fresh(), combat, firstLoot(), naturalDefeat()];
  for (const session of sessions) {
    const before = clone(session.state.run);
    accept(session, { type: 'abandon' });
    assert.equal(session.state.run.phase, 'settlement');
    assert.equal(session.state.run.settlement.reason, 'abandoned');
    assert.equal(session.state.run.settlement.baseCoins, before.victories * 4);
    assert.deepEqual(session.state.run.inventory.instances, before.inventory.instances);
    assert.deepEqual(session.state.run.reports, before.reports);
    assert.deepEqual(session.state.run.loot, []);
    const ended = session.state.run;
    session.advance(450);
    assert.equal(session.state.run, ended);
    rejectAction(session, { type: 'abandon' });
    accept(session, { type: 'claim-settlement' });
    assert.equal(session.state.wallet, before.victories * 4);
  }
});

test('SESSION settlement receipts: replayed claims, new duplicate claims and JSON reload cannot mint twice', () => {
  const session = playDefault().session;
  const run = session.state.run;
  const claim = command(run, { type: 'claim-settlement' }, 'claim-once');
  const first = session.submit(claim);
  assert.equal(first.ok, true);
  assert.equal(first.coinsAdded, 32);
  const claimed = freeze(session.state.run);
  for (let i = 0; i < 10; i++) {
    const repeated = session.submit(clone(claim));
    assert.equal(repeated.duplicate, true);
    assert.equal(repeated.coinsAdded, 0);
    assert.equal(repeated.state, claimed);
    assert.equal(session.state.wallet, 32);
  }
  rejectAction(session, { type: 'claim-settlement' });
  const restored = new GameSession(CONTENT);
  restored.state = clone(session.state);
  assert.equal(restored.submit(clone(claim)).coinsAdded, 0);
  assert.equal(restored.state.wallet, 32);
  assert.equal(restored.state.run.revision, claimed.revision);
});

test('SESSION wallet overflow: a failed claim cannot mark the settlement claimed or consume commandId', () => {
  const session = firstLoot(); accept(session, { type: 'abandon' });
  session.state = { ...session.state, wallet: Number.MAX_SAFE_INTEGER };
  const before = freeze(session.state);
  const claim = command(before.run, { type: 'claim-settlement' }, 'overflow-claim');
  assert.throws(() => session.submit(claim), /Wallet overflow/);
  assert.equal(session.state, before);
  assert.equal(session.state.run.settlement.claimed, false);
  assert.ok(!session.state.run.processedCommandIds.includes(claim.commandId));
  session.state = { ...session.state, wallet: 0 };
  assert.equal(session.submit(claim).coinsAdded, 4);
  assert.equal(session.state.wallet, 4);
});

test('SESSION cross-run boundary: old successful and delayed loot commands cannot affect a new run', () => {
  const session = firstLoot();
  const old = session.state.run;
  const oldLoot = command(old, { type: 'choose-loot', optionId: old.loot[0].id }, 'old-run-delayed-loot');
  const oldProcessed = command(old, { type: 'abandon' }, 'old-run-abandon');
  assert.equal(session.submit(oldProcessed).ok, true);
  accept(session, { type: 'claim-settlement' });
  const wallet = session.state.wallet;
  const next = session.start(2, 'I02');
  assert.notEqual(next.id, old.id);
  assert.equal(next.id, 'run-2');
  assert.equal(next.phase, 'preparation');
  assert.equal(next.hp, null);
  assert.equal(next.inventory.instances.length, 4);
  assert.equal(session.state.wallet, wallet);
  rejectSubmit(session, oldLoot);
  rejectSubmit(session, oldProcessed);
  assert.deepEqual(session.state.run.processedCommandIds, []);
});

test('RUN phase guards: loot, defeat confirmation and reward commands cannot skip the state machine', () => {
  const session = fresh();
  for (const action of [{ type: 'choose-loot', optionId: 'none' }, { type: 'skip-loot' }, { type: 'finish-defeat' }, { type: 'claim-settlement' }]) rejectAction(session, action);
  place(session, 0, 0, 0); accept(session, { type: 'start-combat' });
  for (const action of [{ type: 'choose-loot', optionId: 'none' }, { type: 'skip-loot' }, { type: 'finish-defeat' }, { type: 'claim-settlement' }]) rejectAction(session, action);
  const loot = firstLoot();
  rejectAction(loot, { type: 'start-combat' });
  rejectAction(loot, { type: 'finish-defeat' });
  rejectAction(loot, { type: 'claim-settlement' });
});

// Maximum-health changes use real inventory actions, including undo.
test('RUN I06: a legitimately offered cloak raises max HP but never heals carried health, even through undo', () => {
  const session = fresh(1, 'I01'); place(session, 0, 0, 0);
  accept(session, { type: 'start-combat' }); fight(session);
  assert.equal(session.state.run.phase, 'loot');
  const carried = session.state.run.hp;
  assert.ok(carried > 0 && carried < 120);
  const option = session.state.run.loot.find(o => o.itemIds.includes('I06'));
  assert.ok(option, 'seed 1 must offer a real I06');
  accept(session, { type: 'choose-loot', optionId: option.id });
  const cloak = session.state.run.inventory.instances.find(i => i.defId === 'I06');
  place(session, cloak.spawnIndex, 2, 0);
  assert.equal(evaluateLoadout(session.state.run.inventory, CONTENT).maxHp, 132);
  assert.equal(session.state.run.hp, carried);
  for (let i = 0; i < 3; i++) {
    stash(session, cloak.spawnIndex);
    assert.equal(evaluateLoadout(session.state.run.inventory, CONTENT).maxHp, 120);
    accept(session, inventoryAction(session, { type: 'undo' }));
    assert.equal(evaluateLoadout(session.state.run.inventory, CONTENT).maxHp, 132);
    assert.equal(session.state.run.hp, carried);
  }
  accept(session, { type: 'start-combat' });
  assert.equal(session.state.run.combat.maxHp, 132);
  assert.equal(session.state.run.combat.hp, carried);
  assert.equal(session.state.run.combat.stats.healing, 0);
});

test('RUN I06 downward clamp: removing max HP truncates carried health and undo cannot refill it', () => {
  const session = fresh(); fixtureItems(session, ['I05','I06']);
  arrange(session, [[0,0,0],[1,2,0],[2,0,1],[3,4,0,90],[4,0,2],[5,2,3]]);
  assert.equal(session.state.run.hp, null);
  accept(session, { type: 'start-combat' });
  assert.equal(session.state.run.hp, 132);
  fight(session);
  assert.equal(session.state.run.phase, 'loot');
  assert.equal(session.state.run.hp, 132); // Real shields absorbed the first wave, no HP was assigned.
  accept(session, { type: 'skip-loot' });
  stash(session, 5);
  assert.equal(session.state.run.hp, 120);
  assert.equal(evaluateLoadout(session.state.run.inventory, CONTENT).maxHp, 120);
  accept(session, inventoryAction(session, { type: 'undo' }));
  assert.equal(evaluateLoadout(session.state.run.inventory, CONTENT).maxHp, 132);
  assert.equal(session.state.run.hp, 120);
  accept(session, { type: 'start-combat' });
  assert.equal(session.state.run.combat.maxHp, 132);
  assert.equal(session.state.run.combat.hp, 120);
});

test('CONTENT mode isolation: development uses its own version and all 17 items without unlocking normal content', () => {
  assert.ok(DEVELOPMENT_CONTENT, 'DEVELOPMENT_CONTENT must be exported by the production catalog');
  assert.equal(DEVELOPMENT_CONTENT.version, CONTENT.version + '-dev-all');
  assert.equal(CONTENT.items.filter(i => i.unlocked).length, 12);
  assert.equal(DEVELOPMENT_CONTENT.items.filter(i => i.unlocked).length, 17);
  assert.deepEqual(validateContent(DEVELOPMENT_CONTENT), []);
  for (const item of CONTENT.items) {
    const dev = DEVELOPMENT_CONTENT.items.find(d => d.id === item.id);
    assert.deepEqual({ ...dev, unlocked: item.unlocked }, item);
  }
  const normal = fresh(); place(normal, 0, 0, 0); accept(normal, { type: 'start-combat' });
  assert.throws(() => advanceRun(normal.state.run, 1, DEVELOPMENT_CONTENT), /version mismatch/);
  const dev = fresh(1, 'I03', DEVELOPMENT_CONTENT);
  arrange(dev, DEFAULT_PLAN[0].placements); accept(dev, { type: 'start-combat' }); fight(dev);
  assert.equal(dev.state.run.phase, 'loot');
  assert.equal(dev.state.run.contentVersion, DEVELOPMENT_CONTENT.version);
  assert.ok(dev.state.run.loot.flatMap(o => o.itemIds).every(id => DEVELOPMENT_CONTENT.items.some(i => i.id === id && i.unlocked)));
  assert.equal(CONTENT.items.filter(i => i.unlocked).length, 12);
});

// FixedStepDriver uses injected durations only: no wall clock, GUI, timers or background catch-up.
test('DRIVER fixed ticks: accumulate fractional frames, emit whole ticks and enforce per-call catch-up limit', () => {
  const calls = [];
  const driver = new FixedStepDriver(ticks => calls.push(ticks));
  assert.equal(driver.update(0.04), 0);
  assert.equal(driver.update(0.03), 0);
  assert.equal(driver.update(0.029), 0);
  assert.equal(driver.update(0.001), 1);
  assert.equal(driver.update(0.2), 2);
  assert.equal(driver.update(0.56), 5);
  assert.equal(driver.update(0.04), 1);
  assert.deepEqual(calls, [1,2,5,1]);
  assert.ok(calls.every(n => Number.isSafeInteger(n) && n >= 1 && n <= 5));
});

test('DRIVER frame partitions: ordinary foreground duration is independent of rendering cadence', () => {
  const total = frames => {
    let ticks = 0;
    const driver = new FixedStepDriver(n => { ticks += n; });
    for (const dt of frames) driver.update(dt);
    return ticks;
  };
  assert.equal(total(Array(200).fill(0.005)), 10);
  assert.equal(total(Array(10).fill(0.1)), 10);
  assert.equal(total([0.95,0.05]), 10);
});

test('LIFE-002 pause reasons: independent reasons stack; resuming one never clears another', () => {
  const calls = [];
  const driver = new FixedStepDriver(n => calls.push(n));
  driver.update(0.09);
  driver.pause('user'); driver.pause('background'); driver.pause('user');
  assert.equal(driver.reasons.size, 2);
  assert.equal(driver.update(12), 0);
  driver.resume('user');
  assert.ok(driver.reasons.has('background'));
  assert.equal(driver.update(0.8), 0);
  driver.resume('unrelated');
  assert.ok(driver.reasons.has('background'));
  driver.resume('background');
  assert.equal(driver.reasons.size, 0);
  assert.equal(driver.update(0.01), 0);
  assert.equal(driver.update(0.09), 1);
  assert.deepEqual(calls, [1]);
});

test('LIFE-001 background: paused time cannot change combat RNG, HP, cooldowns, stats or accumulated ticks', () => {
  const session = fresh(); arrange(session, DEFAULT_PLAN[0].placements); accept(session, { type: 'start-combat' });
  const driver = new FixedStepDriver(n => session.advance(n));
  driver.update(0.2);
  driver.update(0.09);
  const before = clone(session.state);
  driver.pause('background'); driver.pause('user');
  for (const dt of [12,0.7,120]) assert.equal(driver.update(dt), 0);
  driver.resume('background');
  assert.equal(driver.update(1), 0);
  assert.deepEqual(session.state, before);
  driver.resume('user');
  assert.equal(driver.update(0.01), 0);
  assert.deepEqual(session.state, before);
  assert.equal(driver.update(0.09), 1);
  assert.equal(session.state.run.combat.tick, before.run.combat.tick + 1);
  assert.equal(session.state.run.combat.rng, before.run.combat.rng);
});

test('DRIVER long suspension: require explicit resume confirmation, discard debt, preserve other pauses', () => {
  const calls = [];
  const driver = new FixedStepDriver(n => calls.push(n));
  driver.update(0.09);
  assert.equal(driver.update(1.01), 0);
  assert.ok(driver.reasons.has('resume-confirmation'));
  driver.pause('menu');
  driver.resume('resume-confirmation');
  assert.equal(driver.update(0.5), 0);
  assert.ok(driver.reasons.has('menu'));
  driver.resume('menu');
  assert.equal(driver.update(0.01), 0);
  assert.equal(driver.update(0.09), 1);
  assert.deepEqual(calls, [1]);
});

test('DRIVER invalid frame durations and reset do not manufacture ticks or clear pause reasons', () => {
  const calls = [];
  const driver = new FixedStepDriver(n => calls.push(n));
  for (const dt of [NaN, Infinity, -Infinity, -1, 0]) {
    driver.update(0.09);
    assert.equal(driver.update(dt), 0);
    assert.equal(driver.update(0.01), 0);
    driver.reset();
  }
  driver.pause('user'); driver.reset();
  assert.ok(driver.reasons.has('user'));
  assert.equal(driver.update(0.5), 0);
  driver.resume('user');
  driver.update(0.1);
  assert.deepEqual(calls, [1]);
});

test('DRIVER integration: ordinary frame delivery reaches the same real first-wave report as direct ticks', () => {
  const direct = playDefault(1).session;
  const session = fresh(); arrange(session, DEFAULT_PLAN[0].placements); accept(session, { type: 'start-combat' });
  const driver = new FixedStepDriver(n => session.advance(n));
  const durations = [0.016,0.023,0.041,0.02];
  let frames = 0;
  while (session.state.run.phase === 'combat') {
    assert.ok(frames < 5000);
    driver.update(durations[frames++ % durations.length]);
  }
  assert.deepEqual(session.state.run.reports, direct.state.run.reports);
  assert.deepEqual(session.state.run.loot, direct.state.run.loot);
  assert.equal(session.state.run.combat.rng, direct.state.run.combat.rng);
  assert.equal(session.state.run.hp, direct.state.run.hp);
  assert.equal(session.state.run.phase, 'loot');
});

// Regression expectations intentionally fail if an unsafe boundary remains unfixed.
// Keep these assertions active; do not repair main code, replace the assertions with TODO,
// or synthesize a successful result merely to make the test suite green.
test('REGRESSION session command IDs: dispatch cannot reuse an already accepted externally submitted ID', () => {
  const session = fresh();
  const run = session.state.run;
  const external = command(run, inventoryAction(session, { type: 'place', instanceId: run.inventory.instances[0].id, x: 0, y: 0, rotation: 0 }), run.id + '/cmd/2');
  assert.equal(session.submit(external).ok, true);
  const result = session.dispatch({ type: 'start-combat' });
  assert.equal(result.ok, true);
  assert.equal(session.state.run.phase, 'combat', 'a fresh start action was silently treated as the previous placement receipt');
  assert.notEqual(result.duplicate, true);
  assert.equal(new Set(session.state.run.processedCommandIds).size, 2);
});

test('REGRESSION run command IDs: non-string or blank IDs cannot enter the processed-command ledger', () => {
  for (const commandId of [42, {}, [], ' ', String.fromCharCode(9), '', 'x'.repeat(201)]) {
    const session = fresh();
    rejectSubmit(session, command(session.state.run, { type: 'abandon' }, commandId));
    assert.deepEqual(session.state.run.processedCommandIds, []);
  }
});

test('REGRESSION driver configuration: tick duration must be finite and strictly positive', () => {
  for (const tickSeconds of [0, -0.1, NaN, Infinity]) {
    assert.throws(() => new FixedStepDriver(() => {}, tickSeconds, 5), undefined, 'invalid tickSeconds: ' + tickSeconds);
  }
});

test('REGRESSION driver configuration: catch-up budget must be a positive safe integer', () => {
  for (const maxCatchUp of [1.5, 0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => new FixedStepDriver(() => {}, 0.1, maxCatchUp), undefined, 'invalid maxCatchUp: ' + maxCatchUp);
  }
});

test('RUN initial weapons follow active unlocked definitions, including development I04 and future weapons',()=>{
  assert.throws(()=>createRun('locked-nozzle',1,'I04',CONTENT));
  const nozzle=createRun('open-nozzle',1,'I04',DEVELOPMENT_CONTENT);assert.equal(nozzle.inventory.instances[0].defId,'I04');
  const extra={...DEVELOPMENT_CONTENT,items:[...DEVELOPMENT_CONTENT.items,{...DEVELOPMENT_CONTENT.items[0],id:'I18',name:'测试扩展武器'}]};
  assert.equal(createRun('expanded',1,'I18',extra).inventory.instances[0].defId,'I18');
  for(const id of ['I05','I07','I15','unknown'])assert.throws(()=>createRun('not-a-weapon',1,id,DEVELOPMENT_CONTENT));
});
