'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCombat, stepCombat } = require('../../.test-build/core/combat.js');
const { randomInt } = require('../../.test-build/core/random.js');
const { CONTENT } = require('../../.test-build/content/catalog.js');

const clone = value => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
function weapon(overrides = {}) {
  return {
    instanceId: 'w', defId: 'fixture-weapon', spawnIndex: 0,
    damage: 5, cooldown: 3, targets: 1, splash: 0, bonusDamage: 0,
    hasteBps: 0, thirdHitDamage: 0, ...overrides,
  };
}
function supply(overrides = {}) {
  return {
    instanceId: 'c', spawnIndex: 10, emergencyHeal: 0, thresholdBps: 4000,
    periodicHeal: 0, everyTicks: 0, charges: 0, pierce: 0, pierceCharges: 0,
    ...overrides,
  };
}
function enemy(overrides = {}) {
  return {
    id: 'fixture-enemy', name: 'Fixture enemy', hp: 10000, damage: 1,
    cooldown: 1000, armor: 0, color: '#888888', behavior: 'normal', ...overrides,
  };
}
function loadout(overrides = {}) {
  return {
    maxHp: 100, initialShield: 0, reduction: 0, critBps: 0, critMultiplierBps: 15000,
    shieldCap: 80, killShield: 0, killShieldCap: 20,
    weapons: [weapon()], consumables: [], combos: [], capped: [], ...overrides,
  };
}
function start(overrides = {}, enemies = [enemy()], hp = null, seed = 1, deadline = 450) {
  return createCombat(loadout(overrides), enemies, seed, hp, deadline);
}
function rngAfter(seed, attacks) {
  for (let i = 0; i < attacks; i++) seed = randomInt(seed, 10000).state;
  return seed;
}
function withoutEvents(state) {
  return { ...state, events: [] };
}
function eventsOf(state, type) {
  return state.events.filter(event => event.type === type);
}
function playerAttacks(state) {
  return eventsOf(state, 'attack').filter(event => event.target !== 'player');
}
function enemyAttacks(state) {
  return eventsOf(state, 'attack').filter(event => event.target === 'player');
}
function assertStats(state) {
  for (const w of state.weapons) {
    const stats = state.stats.weapons[w.instanceId];
    assert.equal(stats.attacks, w.attacks);
    assert.equal(stats.raw, stats.base + stats.combo + stats.overkill);
    for (const value of Object.values(stats)) assert.ok(Number.isSafeInteger(value) && value >= 0);
  }
  assert.ok(state.hp >= 0 && state.hp <= state.maxHp);
  assert.ok(state.shield >= 0 && state.shield <= state.shieldCap);
  assert.ok(state.recoveredShield <= state.killShieldCap);
  assert.equal(state.stats.ticks, state.tick);
}
function runBatches(initial, sizes, budget = 450, serialize = false) {
  let state = initial;
  let advanced = 0;
  let index = 0;
  const events = [];
  while (advanced < budget && state.outcome === 'active') {
    const ticks = Math.min(sizes[index++ % sizes.length], budget - advanced);
    state = stepCombat(state, ticks);
    events.push(...state.events);
    advanced += ticks;
    assertStats(state);
    if (serialize) state = clone(state);
  }
  return { state, events };
}

test('CBT create: sealed copies, stable instance ordering, counters and first-wave health', () => {
  const l = freeze(loadout({
    maxHp: 132, initialShield: 200,
    weapons: [weapon({ instanceId: 'late', spawnIndex: 8 }), weapon({ instanceId: 'early', spawnIndex: 2 })],
    consumables: [supply({ instanceId: 'last', spawnIndex: 12 }), supply({ instanceId: 'first', spawnIndex: 9 })],
  }));
  const enemies = freeze([enemy({ id: 'same' }), enemy({ id: 'same' })]);
  const original = clone({ l, enemies });
  const state = createCombat(l, enemies, 0, null);
  assert.equal(state.tick, 0);
  assert.equal(state.deadlineTick, 450);
  assert.equal(state.hp, 132);
  assert.equal(state.shield, 80);
  assert.equal(state.recoveredShield, 0);
  assert.equal(state.rng, 0);
  assert.equal(state.outcome, 'active');
  assert.equal(state.nextEventSeq, 1);
  assert.deepEqual(state.events, []);
  assert.deepEqual(state.weapons.map(w => w.instanceId), ['early', 'late']);
  assert.deepEqual(state.consumables.map(c => c.instanceId), ['first', 'last']);
  assert.deepEqual(state.enemies.map(e => e.spawnIndex), [0, 1]);
  assert.notEqual(state.enemies[0].instanceId, state.enemies[1].instanceId);
  assert.ok(state.weapons.every(w => w.attacks === 0 && w.nextAttackTick === 3));
  assert.ok(state.consumables.every(c => c.used === 0 && c.pierceUsed === 0));
  assert.ok(state.enemies.every(e => e.maxHp === e.hp && !e.enraged && e.nextAttackTick === 1000));
  state.weapons[0].damage = 99;
  state.consumables[0].charges = 99;
  state.enemies[0].hp = 1;
  assert.deepEqual({ l, enemies }, original);
});

test('CBT-011: carried health clamps downward; equipping max HP never heals', () => {
  assert.equal(start({ maxHp: 132 }, [enemy()], null).hp, 132);
  assert.equal(start({ maxHp: 200 }, [enemy()], 47).hp, 47);
  const reduced = start({ maxHp: 100 }, [enemy()], 132);
  const increased = start({ maxHp: 200 }, [enemy()], reduced.hp);
  assert.equal(reduced.hp, 100);
  assert.equal(increased.hp, 100);
  assert.equal(increased.stats.healing, 0);
  assert.equal(start({}, [enemy()], -50).hp, 0);
  assert.equal(start({}, [enemy()], 0).hp, 0);
  assert.equal(start({}, [enemy()], Number.MAX_SAFE_INTEGER).hp, 100);
});

test('CBT cooldown: first attack rounds up but repeated attacks retain fixed-point phase', () => {
  const initial = freeze(start({ weapons: [weapon({ cooldown: 12, hasteBps: 2000 })] }));
  assert.equal(initial.weapons[0].nextAttackTick, 10);
  const before = stepCombat(initial, 9);
  assert.equal(before.rng, initial.rng);
  assert.equal(before.stats.weapons.w.attacks, 0);
  assert.deepEqual(before.events, []);
  const after = stepCombat(before, 21);
  assert.deepEqual(playerAttacks(after).map(event => event.tick), [10, 20, 29]);
  assert.equal(after.weapons[0].nextAttackTick, 39);
  assert.equal(initial.tick, 0);
  const minimum = stepCombat(start({ weapons: [weapon({ cooldown: 1, hasteBps: 10000 })] }), 9);
  assert.deepEqual(playerAttacks(minimum).map(event => event.tick), [3, 6, 9]);
});

test('CBT-002: tick order is periodic heal, spawn-ordered weapons, then living enemies', () => {
  const initial = freeze(start({
    weapons: [weapon({ instanceId: 'late', spawnIndex: 2, damage: 4 }), weapon({ instanceId: 'early', spawnIndex: 1, damage: 5 })],
    consumables: [supply({ periodicHeal: 10, everyTicks: 3, charges: 1 })],
  }, [enemy({ hp: 5, damage: 90, cooldown: 3 }), enemy({ hp: 20, damage: 6, cooldown: 3 })], 40));
  const state = stepCombat(initial, 3);
  const [front, back] = state.enemies;
  assert.deepEqual(state.events.map(e => [e.type, e.source]), [
    ['heal', 'c'], ['attack', 'early'], ['damage', 'early'], ['kill', 'early'],
    ['attack', 'late'], ['damage', 'late'], ['attack', back.instanceId], ['damage', back.instanceId],
  ]);
  assert.equal(front.hp, 0);
  assert.equal(back.hp, 16);
  assert.equal(front.nextAttackTick, 3);
  assert.equal(back.nextAttackTick, 6);
  assert.equal(state.hp, 44);
  assert.equal(state.stats.healing, 10);
  assert.equal(state.stats.damageTaken, 6);
  assert.equal(state.stats.kills, 1);
  assert.equal(initial.hp, 40);
  assert.equal(initial.stats.weapons.early.attacks, 0);
});

test('CBT: killing the last target prevents later same-tick weapons from spending attacks or RNG', () => {
  const state = stepCombat(start({
    weapons: [weapon({ instanceId: 'first', spawnIndex: 0 }), weapon({ instanceId: 'second', spawnIndex: 1 })],
    consumables: [supply({ pierce: 1, pierceCharges: 3 })],
  }, [enemy({ hp: 1, cooldown: 3, damage: 100 })]), 100);
  assert.equal(state.outcome, 'victory');
  assert.equal(state.hp, 100);
  assert.equal(state.stats.weapons.first.attacks, 1);
  assert.equal(state.stats.weapons.second.attacks, 0);
  assert.equal(state.consumables[0].pierceUsed, 1);
  assert.equal(state.rng, rngAfter(1, 1));
  assert.equal(enemyAttacks(state).length, 0);
});

test('CBT-004: bonus then critical floor then armor; raw and overkill are post-armor', () => {
  const state = stepCombat(start({ critBps: 10000, weapons: [weapon({ damage: 12, bonusDamage: 2 })] },
    [enemy({ hp: 3, armor: 2 })]), 3);
  assert.deepEqual(state.stats.weapons.w, { base: 3, combo: 0, raw: 19, overkill: 16, attacks: 1 });
  assert.equal(eventsOf(state, 'damage')[0].amount, 3);
  assert.equal(state.stats.kills, 1);
  assert.equal(state.outcome, 'victory');
  assertStats(state);
});

test('CBT: fractional critical products floor before armor, and ordinary damage is at least one', () => {
  const critical = stepCombat(start({ critBps: 10000, weapons: [weapon({ damage: 7, bonusDamage: 2 })] },
    [enemy({ armor: 2 })]), 3);
  assert.equal(critical.stats.weapons.w.raw, 11); // floor((7 + 2) * 1.5) - 2
  const minimum = stepCombat(start({ weapons: [weapon({ damage: 0 })] }, [enemy({ hp: 2, armor: 500 })]), 6);
  assert.deepEqual(minimum.stats.weapons.w, { base: 2, combo: 0, raw: 2, overkill: 0, attacks: 2 });
});

test('CBT RNG: every base attack samples once, all its targets share that critical result', () => {
  const state = stepCombat(start({ critBps: 5000, weapons: [weapon({ damage: 10, targets: 3 })] },
    [enemy(), enemy(), enemy()]), 9);
  assert.deepEqual(playerAttacks(state).map(e => e.detail), ['critical', 'critical', 'normal']);
  assert.deepEqual(eventsOf(state, 'damage').map(e => e.amount), [15, 15, 15, 15, 15, 15, 10, 10, 10]);
  assert.equal(state.rng, rngAfter(1, 3));
  assert.equal(state.stats.weapons.w.attacks, 3);
  for (const critBps of [0, 10000]) {
    const result = stepCombat(start({ critBps }), 6);
    assert.equal(result.rng, rngAfter(1, 2));
  }
});

test('CBT I02: the additional splash shares bonus/critical/pierce and its captured target', () => {
  const shotgun = CONTENT.items.find(item => item.id === 'I02').weapon;
  assert.equal(shotgun.targets, 1);
  const state = stepCombat(start({
    critBps: 10000, weapons: [weapon({ ...shotgun, cooldown: 3, bonusDamage: 2 })],
    consumables: [supply({ pierce: 1, pierceCharges: 3 })],
  }, [enemy({ hp: 1, armor: 2 }), enemy({ hp: 100, armor: 2 }), enemy({ hp: 100, armor: 2 })]), 3);
  assert.deepEqual(state.enemies.map(e => e.hp), [0, 89, 100]);
  assert.deepEqual(eventsOf(state, 'damage').map(e => [e.target, e.amount, e.detail]), [
    [state.enemies[0].instanceId, 1, 'base'], [state.enemies[1].instanceId, 11, 'splash'],
  ]);
  assert.equal(state.consumables[0].pierceUsed, 1);
  assert.equal(state.rng, rngAfter(1, 1));
  assert.deepEqual(state.stats.weapons.w, { base: 12, combo: 0, raw: 40, overkill: 28, attacks: 1 });
});

test('CBT I11: one available spawn-ordered source covers all targets, then exhausts without stacking', () => {
  const initial = start({
    critBps: 10000, weapons: [weapon({ damage: 10, bonusDamage: 2, targets: 3 })],
    consumables: [
      supply({ instanceId: 'late', spawnIndex: 8, pierce: 5, pierceCharges: 2 }),
      supply({ instanceId: 'early', spawnIndex: 4, pierce: 2, pierceCharges: 1 }),
    ],
  }, [enemy({ armor: 4 }), enemy({ armor: 4 }), enemy({ armor: 4 })]);
  const first = stepCombat(initial, 3);
  assert.deepEqual(first.consumables.map(c => c.pierceUsed), [1, 0]);
  assert.deepEqual(eventsOf(first, 'damage').map(e => e.amount), [16, 16, 16]);
  const rest = stepCombat(first, 9);
  assert.deepEqual(eventsOf(rest, 'damage').map(e => e.amount), [18, 18, 18, 18, 18, 18, 14, 14, 14]);
  assert.deepEqual(rest.consumables.map(c => c.pierceUsed), [1, 2]);
  assert.equal(rest.stats.weapons.w.attacks, 4);
  assert.equal(rest.rng, rngAfter(1, 4));
  assertStats(rest);
});

test('CBT shield: clamp once, apply reduction before shield, count only actual HP loss', () => {
  const state = stepCombat(start({ weapons: [], initialShield: 25, shieldCap: 20, reduction: 3 },
    [enemy({ damage: 15, cooldown: 1 })]), 2);
  assert.equal(state.shield, 0);
  assert.equal(state.hp, 96);
  assert.equal(state.stats.shieldAbsorbed, 20);
  assert.equal(state.stats.damageTaken, 4);
  assert.deepEqual(eventsOf(state, 'shield').map(e => e.amount), [-12, -8]);
  assert.deepEqual(eventsOf(state, 'damage').map(e => e.amount), [0, 4]);
  const minimum = stepCombat(start({ weapons: [], reduction: 100 }, [enemy({ damage: 5, cooldown: 1 })]), 1);
  assert.equal(minimum.stats.damageTaken, 1);
});

test('CBT I09: equality at the threshold triggers immediately and later kits recheck healed health', () => {
  const state = stepCombat(start({
    weapons: [], consumables: [
      supply({ instanceId: 'late', spawnIndex: 11, emergencyHeal: 18, charges: 1 }),
      supply({ instanceId: 'early', spawnIndex: 10, emergencyHeal: 18, charges: 1 }),
    ],
  }, [enemy({ damage: 60, cooldown: 1 }), enemy({ damage: 10, cooldown: 1 })]), 1);
  assert.equal(state.hp, 48);
  assert.equal(state.stats.damageTaken, 70);
  assert.equal(state.stats.healing, 18);
  assert.deepEqual(state.consumables.map(c => c.used), [1, 0]);
  assert.deepEqual(state.events.map(e => e.type), ['attack', 'damage', 'heal', 'attack', 'damage']);
  assert.equal(eventsOf(state, 'heal')[0].source, 'early');
});

test('CBT I09: multiple eligible kits share maximum HP and actual healing statistics', () => {
  const state = stepCombat(start({ weapons: [], consumables: [
    supply({ instanceId: 'small', spawnIndex: 10, emergencyHeal: 10, charges: 1 }),
    supply({ instanceId: 'large', spawnIndex: 11, emergencyHeal: 90, charges: 1 }),
    supply({ instanceId: 'spare', spawnIndex: 12, emergencyHeal: 90, thresholdBps: 10000, charges: 1 }),
  ] }, [enemy({ damage: 70, cooldown: 1 })]), 1);
  assert.equal(state.hp, 100);
  assert.equal(state.stats.healing, 70);
  assert.deepEqual(eventsOf(state, 'heal').map(e => e.amount), [10, 60]);
  assert.deepEqual(state.consumables.map(c => c.used), [1, 1, 0]);
});

test('CBT I09: a shield-only hit is not an injury and cannot consume emergency healing', () => {
  const state = stepCombat(start({ weapons: [], initialShield: 10,
    consumables: [supply({ emergencyHeal: 18, charges: 1 })],
  }, [enemy({ damage: 5, cooldown: 1 })], 20), 1);
  assert.equal(state.hp, 20);
  assert.equal(state.shield, 5);
  assert.equal(state.consumables[0].used, 0);
  assert.equal(state.stats.healing, 0);
});

test('CBT-010: lethal damage clamps to zero, cannot be rescued, and stops later enemies', () => {
  const initial = freeze(start({ weapons: [], consumables: [supply({ emergencyHeal: 100, charges: 1 })] },
    [enemy({ damage: 500, cooldown: 1 }), enemy({ damage: 500, cooldown: 1 })], 7));
  const state = stepCombat(initial, 50);
  assert.equal(state.hp, 0);
  assert.equal(state.tick, 1);
  assert.equal(state.outcome, 'defeat');
  assert.equal(state.stats.damageTaken, 7);
  assert.equal(state.stats.healing, 0);
  assert.equal(state.consumables[0].used, 0);
  assert.equal(enemyAttacks(state).length, 1);
  assert.equal(eventsOf(state, 'heal').length, 0);
  assert.equal(eventsOf(state, 'terminal').length, 1);
  assert.equal(initial.hp, 7);
});

test('CBT I10: full-health periodic opportunities are consumed on their exact ticks', () => {
  const state = stepCombat(start({ weapons: [],
    consumables: [supply({ periodicHeal: 5, everyTicks: 2, charges: 2 })],
  }, [enemy({ damage: 20, cooldown: 3 })]), 6);
  assert.deepEqual(eventsOf(state, 'heal').map(e => [e.tick, e.amount]), [[2, 0], [4, 5]]);
  assert.equal(state.consumables[0].used, 2);
  assert.equal(state.stats.healing, 5);
  assert.equal(state.stats.damageTaken, 40);
  assert.equal(state.hp, 65);
});

test('CBT healing: periodic sources share the health cap and a mixed source shares its charge counter', () => {
  const capped = stepCombat(start({ weapons: [], consumables: [
    supply({ instanceId: 'one', spawnIndex: 10, periodicHeal: 8, everyTicks: 1, charges: 1 }),
    supply({ instanceId: 'two', spawnIndex: 11, periodicHeal: 9, everyTicks: 1, charges: 1 }),
  ] }, [enemy()], 90), 1);
  assert.equal(capped.hp, 100);
  assert.equal(capped.stats.healing, 10);
  assert.deepEqual(eventsOf(capped, 'heal').map(e => e.amount), [8, 2]);
  const shared = stepCombat(start({ weapons: [], consumables: [
    supply({ periodicHeal: 5, everyTicks: 1, emergencyHeal: 90, charges: 1 }),
  ] }, [enemy({ damage: 70, cooldown: 1 })]), 1);
  assert.equal(shared.hp, 30);
  assert.equal(shared.consumables[0].used, 1);
  assert.deepEqual(eventsOf(shared, 'heal').map(e => [e.detail, e.amount]), [['periodic', 0]]);
});

test('CBT kill shields: all kills share both the shield cap and actual per-wave recovery cap', () => {
  const enemies = [enemy({ hp: 1 }), enemy({ hp: 1 }), enemy({ hp: 1 })];
  const capped = stepCombat(start({ weapons: [weapon({ targets: 3 })], shieldCap: 10,
    killShield: 4, killShieldCap: 6,
  }, enemies), 3);
  assert.equal(capped.stats.kills, 3);
  assert.equal(capped.shield, 6);
  assert.equal(capped.recoveredShield, 6);
  assert.deepEqual(eventsOf(capped, 'shield').map(e => e.amount), [4, 2]);
  const full = stepCombat(start({ weapons: [weapon({ targets: 3 })], initialShield: 8, shieldCap: 10,
    killShield: 8, killShieldCap: 12,
  }, enemies), 3);
  assert.equal(full.shield, 10);
  assert.equal(full.recoveredShield, 2);
  assert.deepEqual(eventsOf(full, 'shield').map(e => e.amount), [2]);
});

test('CBT kill shields: absorption does not replenish the per-wave recovery allowance', () => {
  const state = stepCombat(start({ shieldCap: 20, killShield: 4, killShieldCap: 6 }, [
    enemy({ hp: 5, damage: 4, cooldown: 3 }), enemy({ hp: 5, damage: 4, cooldown: 3 }),
    enemy({ hp: 5, damage: 4, cooldown: 3 }), enemy({ hp: 50, damage: 4, cooldown: 3 }),
  ]), 9);
  assert.equal(state.stats.kills, 3);
  assert.equal(state.recoveredShield, 6);
  assert.equal(state.shield, 0);
  assert.equal(state.stats.shieldAbsorbed, 6);
  assert.deepEqual(eventsOf(state, 'shield').filter(e => e.detail === 'kill').map(e => [e.tick, e.amount]), [[3, 4], [6, 2]]);
  assert.equal(state.hp, 82);
});

test('COM-006 C04: attacks three and six proc exactly once without extra attacks, RNG, or doses', () => {
  const state = stepCombat(start({ weapons: [weapon({ damage: 1, thirdHitDamage: 5 })],
    consumables: [supply({ pierce: 1, pierceCharges: 9 })],
  }), 18);
  assert.deepEqual(eventsOf(state, 'combo').map(e => [e.tick, e.detail]), [[9, 'C04'], [18, 'C04']]);
  assert.equal(state.stats.comboTriggers, 2);
  assert.deepEqual(state.stats.weapons.w, { base: 6, combo: 10, raw: 16, overkill: 0, attacks: 6 });
  assert.equal(state.weapons[0].attacks, 6);
  assert.equal(state.consumables[0].pierceUsed, 6);
  assert.equal(state.rng, rngAfter(1, 6));
});

test('C04: the extra hit is flat armored combo damage, not a second boosted base attack', () => {
  const state = stepCombat(start({ critBps: 10000,
    weapons: [weapon({ damage: 7, bonusDamage: 2, thirdHitDamage: 5 })],
    consumables: [supply({ pierce: 1, pierceCharges: 6 })],
  }, [enemy({ armor: 1 })]), 18);
  assert.deepEqual(state.stats.weapons.w, { base: 78, combo: 8, raw: 86, overkill: 0, attacks: 6 });
  assert.equal(state.stats.comboTriggers, 2);
  assert.equal(state.consumables[0].pierceUsed, 6);
  assert.equal(state.rng, rngAfter(1, 6));
});

test('C04: lethal extra damage is counted accurately and emits one kill before terminal', () => {
  const state = stepCombat(start({ weapons: [weapon({ damage: 2, thirdHitDamage: 5 })] }, [enemy({ hp: 10 })]), 30);
  assert.equal(state.tick, 9);
  assert.equal(state.stats.comboTriggers, 1);
  assert.equal(state.stats.kills, 1);
  assert.deepEqual(state.stats.weapons.w, { base: 6, combo: 4, raw: 11, overkill: 1, attacks: 3 });
  assert.deepEqual(state.events.slice(-4).map(e => e.type), ['combo', 'damage', 'kill', 'terminal']);
  assert.equal(eventsOf(state, 'kill').length, 1);
});

test('C04: a proc never hits or kills an already-dead primary again, nor retargets its extra damage', () => {
  const state = stepCombat(start({ weapons: [weapon({ damage: 2, thirdHitDamage: 5 })] },
    [enemy({ hp: 6 }), enemy({ hp: 10 })]), 9);
  assert.deepEqual(state.enemies.map(e => e.hp), [0, 10]);
  assert.equal(state.stats.comboTriggers, 1);
  assert.equal(eventsOf(state, 'combo').length, 1);
  assert.equal(eventsOf(state, 'kill').length, 1);
  assert.equal(eventsOf(state, 'damage').length, 3);
  assert.deepEqual(state.stats.weapons.w, { base: 6, combo: 0, raw: 6, overkill: 0, attacks: 3 });
});

test('C04: immediate combo resolution precedes the next weapon and enemy attacks', () => {
  const state = stepCombat(start({ weapons: [
    weapon({ instanceId: 'blade', spawnIndex: 0, damage: 1, thirdHitDamage: 5 }),
    weapon({ instanceId: 'late', spawnIndex: 1, cooldown: 9, damage: 1 }),
  ] }, [enemy({ hp: 8, cooldown: 9, damage: 100 })]), 9);
  assert.equal(state.outcome, 'victory');
  assert.equal(state.stats.weapons.blade.attacks, 3);
  assert.equal(state.stats.weapons.late.attacks, 0);
  assert.equal(enemyAttacks(state).length, 0);
  assert.equal(state.rng, rngAfter(1, 3));
});

test('CBT boss: exactly half health is not below the threshold, and phase changes only once', () => {
  const initial = start({ weapons: [weapon({ damage: 25 })] }, [enemy({
    hp: 100, behavior: 'boss', cooldown: 20, enrageThresholdBps: 5000, enragedCooldown: 8,
  })]);
  const half = stepCombat(initial, 6);
  assert.equal(half.enemies[0].hp, 50);
  assert.equal(half.enemies[0].enraged, false);
  assert.equal(eventsOf(half, 'enrage').length, 0);
  const below = stepCombat(half, 3);
  assert.equal(below.enemies[0].hp, 25);
  assert.equal(below.enemies[0].enraged, true);
  assert.equal(below.enemies[0].nextAttackTick, 14); // 9 + ceil((20 - 9) * 8 / 20)
  assert.equal(eventsOf(below, 'enrage').length, 1);
  const dead = stepCombat(below, 20);
  assert.equal(eventsOf(dead, 'enrage').length, 0);
  assert.equal(dead.enemies[0].enraged, true);
});

test('CBT boss: remaining cooldown scales down and subsequent attacks use configured interval', () => {
  const initial = start({ weapons: [weapon({ damage: 51, cooldown: 100 })] }, [enemy({
    hp: 100, behavior: 'boss', damage: 1, cooldown: 200, enrageThresholdBps: 5000, enragedCooldown: 20,
  })], null, 1, 190);
  const phase = stepCombat(initial, 100);
  assert.equal(phase.enemies[0].nextAttackTick, 110);
  assert.equal(enemyAttacks(phase).length, 0);
  const after = stepCombat(phase, 71);
  assert.deepEqual(enemyAttacks(after).map(e => e.tick), [110, 130, 150, 170]);
  assert.equal(after.enemies[0].nextAttackTick, 190);
  assert.equal(eventsOf(after, 'enrage').length, 0);
});

test('CBT boss: enrage never postpones an attack already due on that same tick', () => {
  const state = stepCombat(start({ weapons: [weapon({ damage: 60, cooldown: 6 })] }, [enemy({
    hp: 100, damage: 3, cooldown: 6, behavior: 'boss', enrageThresholdBps: 5000, enragedCooldown: 3,
  })]), 9);
  assert.deepEqual(enemyAttacks(state).map(e => e.tick), [6, 9]);
  assert.deepEqual(eventsOf(state, 'enrage').map(e => e.tick), [6]);
  assert.equal(state.enemies[0].nextAttackTick, 12);
  assert.equal(state.hp, 94);
});

test('CBT boss: custom thresholds are honored and a lethal hit never emits enrage', () => {
  const custom = stepCombat(start({ weapons: [weapon({ damage: 26 })] }, [enemy({
    hp: 100, behavior: 'boss', enrageThresholdBps: 2500, cooldown: 20, enragedCooldown: 10,
  })]), 9);
  assert.deepEqual(eventsOf(custom, 'enrage').map(e => e.tick), [9]);
  const dead = stepCombat(start({ weapons: [weapon({ damage: 100 })] }, [enemy({
    hp: 100, behavior: 'boss', enrageThresholdBps: 5000, cooldown: 20, enragedCooldown: 10,
  })]), 3);
  assert.equal(eventsOf(dead, 'enrage').length, 0);
  assert.equal(dead.enemies[0].enraged, false);
  assert.equal(dead.outcome, 'victory');
});

test('CBT-009: the default deadline is 450 ticks, a large batch stops at it exactly once', () => {
  const state = stepCombat(start({ weapons: [] }), Number.MAX_SAFE_INTEGER);
  assert.equal(state.tick, 450);
  assert.equal(state.stats.ticks, 450);
  assert.equal(state.outcome, 'timeout');
  assert.equal(state.rng, 1);
  assert.deepEqual(state.events, [{ seq: 1, tick: 450, type: 'terminal', detail: 'timeout' }]);
});

test('CBT terminal: the whole deadline tick runs, then defeat wins over timeout and victory over timeout', () => {
  const victory = stepCombat(start({}, [enemy({ hp: 1, cooldown: 3, damage: 100 })], null, 1, 3), 30);
  assert.equal(victory.tick, 3);
  assert.equal(victory.outcome, 'victory');
  assert.equal(victory.hp, 100);
  const defeat = stepCombat(start({ weapons: [] }, [enemy({ damage: 100, cooldown: 3 })], null, 1, 3), 30);
  assert.equal(defeat.tick, 3);
  assert.equal(defeat.outcome, 'defeat');
  assert.equal(eventsOf(defeat, 'terminal').length, 1);
});

test('CBT-003: preexisting death wins over all enemies dead and deadline, with no healing tick', () => {
  const initial = start({ weapons: [], consumables: [supply({ periodicHeal: 100, everyTicks: 1, charges: 1 })] }, [], 0, 1, 0);
  assert.equal(initial.outcome, 'active');
  assert.deepEqual(initial.events, []);
  const state = stepCombat(initial, 1);
  assert.equal(state.tick, 0);
  assert.equal(state.outcome, 'defeat');
  assert.equal(state.hp, 0);
  assert.equal(state.consumables[0].used, 0);
  assert.deepEqual(state.events, [{ seq: 1, tick: 0, type: 'terminal', detail: 'defeat' }]);
  assert.equal(stepCombat(start({}, [], null, 1, 0)).outcome, 'victory');
  assert.equal(stepCombat(start({}, [enemy()], null, 1, 0)).outcome, 'timeout');
  const deadSnapshot = start({}, [enemy()]);
  deadSnapshot.hp = -1;
  deadSnapshot.enemies[0].hp = 0;
  assert.equal(stepCombat(deadSnapshot).outcome, 'defeat');
});

test('CBT zero ticks: clear the previous batch without advancing any state or consuming resources', () => {
  const previous = freeze(stepCombat(start(), 3));
  const cleared = stepCombat(previous, 0);
  assert.deepEqual(cleared, withoutEvents(previous));
  assert.notEqual(cleared, previous);
  assert.ok(previous.events.length > 0);
  assert.deepEqual(stepCombat(start({}, [], 0), 0).events, []);
});

test('CBT terminal idempotence: every outcome freezes counters and emits no repeated events', () => {
  const terminals = [
    stepCombat(start({}, [enemy({ hp: 1 })]), 3),
    stepCombat(start({ weapons: [] }, [enemy({ damage: 100, cooldown: 1 })]), 1),
    stepCombat(start({ weapons: [] }, [enemy()], null, 1, 1), 1),
  ];
  for (const terminal of terminals) {
    freeze(terminal);
    assert.equal(eventsOf(terminal, 'terminal').length, 1);
    let state = terminal;
    for (const ticks of [1, 50, 0, Number.MAX_SAFE_INTEGER]) {
      state = stepCombat(state, ticks);
      assert.deepEqual(state, withoutEvents(terminal));
    }
    assert.equal(eventsOf(terminal, 'terminal').length, 1);
  }
});

test('CBT-001: deterministic batching and JSON continuation have identical aggregated events, RNG and stats', () => {
  const initial = freeze(start({
    maxHp: 200, initialShield: 30, reduction: 1, critBps: 3500, killShield: 8,
    weapons: [
      weapon({ instanceId: 'shotgun', spawnIndex: 2, damage: 18, cooldown: 7, splash: 6, bonusDamage: 2 }),
      weapon({ instanceId: 'blade', spawnIndex: 0, damage: 7, cooldown: 4, thirdHitDamage: 5 }),
    ],
    consumables: [
      supply({ instanceId: 'medic', spawnIndex: 10, emergencyHeal: 24, charges: 1 }),
      supply({ instanceId: 'drip', spawnIndex: 11, periodicHeal: 5, everyTicks: 8, charges: 4 }),
      supply({ instanceId: 'rust', spawnIndex: 12, pierce: 1, pierceCharges: 3 }),
    ],
  }, [
    enemy({ hp: 100, armor: 2, cooldown: 10, damage: 6 }),
    enemy({ hp: 120, armor: 1, cooldown: 11, damage: 7 }),
    enemy({ hp: 300, armor: 3, cooldown: 12, damage: 9, behavior: 'boss', enrageThresholdBps: 5000, enragedCooldown: 5 }),
  ], null, 91827));
  const original = clone(initial);
  const bulk = runBatches(initial, [450]);
  for (const [sizes, serialized] of [[[1], false], [[7, 0, 13, 1, 0, 29], false], [[2, 11, 0, 5], true]]) {
    const result = runBatches(initial, sizes, 450, serialized);
    assert.deepEqual(withoutEvents(result.state), withoutEvents(bulk.state));
    assert.deepEqual(result.events, bulk.events);
  }
  assert.notEqual(bulk.state.outcome, 'active');
  assert.equal(bulk.events.filter(e => e.type === 'terminal').length, 1);
  assert.deepEqual(bulk.events.map(e => e.seq), bulk.events.map((_, i) => i + 1));
  assert.ok(bulk.events.every((e, i) => i === 0 || e.tick >= bulk.events[i - 1].tick));
  assert.equal(bulk.state.nextEventSeq, bulk.events.length + 1);
  assert.deepEqual(initial, original);
});

test('CBT ordering: runtime spawnIndex, not array order, determines attacks, targets and consumable source', () => {
  const initial = start({
    weapons: [weapon({ instanceId: 'first', spawnIndex: 0 }), weapon({ instanceId: 'last', spawnIndex: 2 })],
    consumables: [supply({ instanceId: 'a', spawnIndex: 10, pierce: 1, pierceCharges: 1 }),
      supply({ instanceId: 'b', spawnIndex: 11, pierce: 3, pierceCharges: 2 })],
  }, [enemy({ armor: 3 }), enemy({ armor: 3 })]);
  const reordered = clone(initial);
  reordered.weapons.reverse();
  reordered.consumables.reverse();
  reordered.enemies.reverse();
  assert.deepEqual(stepCombat(reordered, 9), stepCombat(initial, 9));
});

test('CBT statistics: legal prototype-like instance IDs are own keys, not shared prototype objects', () => {
  const initial = start({ weapons: [
    weapon({ instanceId: '__proto__', spawnIndex: 0 }),
    weapon({ instanceId: 'constructor', spawnIndex: 1 }),
  ] });
  const state = stepCombat(initial, 3);
  assert.ok(Object.hasOwn(state.stats.weapons, '__proto__'));
  assert.equal(state.stats.weapons.__proto__.attacks, 1);
  assert.equal(state.stats.weapons.constructor.attacks, 1);
  assert.equal(initial.stats.weapons.__proto__.attacks, 0);
  assert.equal(Object.getPrototypeOf(state.stats.weapons), Object.prototype);
  assertStats(state);
});

test('CBT validation: reject invalid seeds, health, deadlines, and top-level inputs', () => {
  for (const seed of [-1, 1.5, NaN, Infinity, 4294967296]) {
    assert.throws(() => createCombat(loadout(), [enemy()], seed, null), /rng/);
  }
  for (const hp of [NaN, Infinity, -Infinity, 0.5, undefined, '10']) {
    assert.throws(() => createCombat(loadout(), [enemy()], 1, hp), /hp/);
  }
  for (const deadline of [-1, 0.5, NaN, Infinity]) {
    assert.throws(() => createCombat(loadout(), [enemy()], 1, null, deadline), /deadlineTick/);
  }
  assert.throws(() => createCombat(null, [], 1, null), /loadout/);
  assert.throws(() => createCombat(loadout(), null, 1, null), /enemies/);
  assert.throws(() => createCombat(loadout(), [null], 1, null), /enemy/);
});

test('CBT validation: reject malformed loadout numbers, duplicate identities and unsafe arithmetic', () => {
  const mutations = [
    l => { l.maxHp = 0; }, l => { l.maxHp = NaN; }, l => { l.maxHp = Number.MAX_SAFE_INTEGER; },
    l => { l.initialShield = -1; }, l => { l.shieldCap = -1; }, l => { l.reduction = -1; },
    l => { l.critBps = 10001; }, l => { l.critMultiplierBps = 0; }, l => { l.killShield = -1; },
    l => { l.killShieldCap = -1; }, l => { l.weapons = null; }, l => { l.consumables = null; },
    l => { l.combos = null; }, l => { l.capped = null; }, l => { l.weapons[0] = null; },
    l => { l.weapons[0].cooldown = 0; }, l => { l.weapons[0].cooldown = 0.5; },
    l => { l.weapons[0].hasteBps = -1; }, l => { l.weapons[0].hasteBps = 10001; },
    l => { l.weapons[0].damage = Infinity; }, l => { l.weapons[0].damage = -1; },
    l => { l.weapons[0].damage = Number.MAX_SAFE_INTEGER; }, l => { l.weapons[0].bonusDamage = -1; },
    l => { l.weapons[0].thirdHitDamage = -1; }, l => { l.weapons[0].targets = 0; },
    l => { l.weapons[0].splash = -1; }, l => { l.weapons[0].spawnIndex = -1; },
    l => { l.weapons[0].instanceId = ''; }, l => { l.weapons[0].defId = ''; },
    l => { l.weapons.push(weapon({ spawnIndex: 1 })); },
    l => { l.weapons.push(weapon({ instanceId: 'other' })); },
    l => { l.consumables.push(supply({ instanceId: 'w' })); },
    l => { l.consumables.push(supply({ spawnIndex: 0 })); },
    l => { l.consumables.push(supply({ charges: -1 })); },
    l => { l.consumables.push(supply({ thresholdBps: 10001 })); },
    l => { l.consumables.push(supply({ periodicHeal: 5, everyTicks: 0, charges: 1 })); },
    l => { l.consumables.push(supply({ emergencyHeal: -1 })); },
    l => { l.consumables.push(supply({ pierce: -1 })); },
    l => { l.consumables.push(supply({ pierceCharges: -1 })); },
  ];
  mutations.forEach((mutate, index) => {
    const l = loadout();
    mutate(l);
    assert.throws(() => createCombat(l, [enemy()], 1, null), undefined, 'mutation ' + index);
  });
});

test('CBT validation: enemy definitions require finite integers and a valid faster boss phase', () => {
  const invalid = [
    { hp: 0 }, { hp: -1 }, { hp: NaN }, { hp: Infinity }, { damage: -1 }, { armor: -1 },
    { cooldown: 0 }, { cooldown: 1.5 }, { behavior: 'unknown' }, { id: '' },
    { behavior: 'boss' }, { behavior: 'boss', enrageThresholdBps: 0, enragedCooldown: 2 },
    { behavior: 'boss', enrageThresholdBps: 10001, enragedCooldown: 2 },
    { behavior: 'boss', enrageThresholdBps: 5000, enragedCooldown: 0 },
    { behavior: 'boss', enrageThresholdBps: 5000, cooldown: 10, enragedCooldown: 11 },
  ];
  for (const overrides of invalid) assert.throws(() => start({}, [enemy(overrides)]));
});

test('CBT validation: ticks must be nonnegative safe integers, including on terminal snapshots', () => {
  const initial = freeze(start());
  const terminal = freeze(stepCombat(start({}, [])));
  for (const ticks of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, '3']) {
    assert.throws(() => stepCombat(initial, ticks), /ticks/);
    assert.throws(() => stepCombat(terminal, ticks), /ticks/);
  }
  assert.equal(stepCombat(initial).tick, 1);
  assert.equal(initial.tick, 0);
});

test('CBT validation: malformed runtime snapshots fail without mutating the caller', () => {
  const mutations = [
    s => { s.rng = -1; }, s => { s.tick = NaN; }, s => { s.hp = Infinity; },
    s => { s.hp = 101; }, s => { s.shield = 81; }, s => { s.recoveredShield = 21; },
    s => { s.outcome = 'revived'; }, s => { s.nextEventSeq = 0; }, s => { s.events = null; },
    s => { s.weapons[0].nextAttackTick = -1; }, s => { s.weapons[0].attacks = 1.5; },
    s => { s.stats.weapons.w.raw = NaN; }, s => { s.stats.weapons.w.raw = 2; },
    s => { s.stats.weapons.w.attacks = 1; }, s => { delete s.stats.weapons.w; },
    s => { s.stats.damageTaken = -1; }, s => { s.enemies[0].enraged = 'true'; },
    s => { s.enemies[0].enraged = true; }, s => { delete s.enemies[0].maxHp; },
    s => { s.enemies[0].nextAttackTick = -1; },
    s => { s.enemies.push(clone(s.enemies[0])); },
    s => { s.consumables[0].used = 2; }, s => { s.consumables[0].pierceUsed = 2; },
  ];
  for (const mutate of mutations) {
    const state = start({ consumables: [supply({ charges: 1, pierce: 1, pierceCharges: 1 })] });
    mutate(state);
    freeze(state);
    assert.throws(() => stepCombat(state));
  }
  assert.throws(() => stepCombat(null), /state/);
});

test('CBT arithmetic: counter and event-sequence overflow is rejected atomically', () => {
  const state = start({ weapons: [weapon({ damage: 1 })] });
  state.stats.weapons.w.base = Number.MAX_SAFE_INTEGER;
  state.stats.weapons.w.raw = Number.MAX_SAFE_INTEGER;
  freeze(state);
  assert.throws(() => stepCombat(state, 3), /weapon statistics.base/);
  assert.equal(state.tick, 0);
  assert.equal(state.enemies[0].hp, 10000);
  assert.equal(state.weapons[0].attacks, 0);
  const sequence = start({}, []);
  sequence.nextEventSeq = Number.MAX_SAFE_INTEGER;
  freeze(sequence);
  assert.throws(() => stepCombat(sequence), /nextEventSeq/);
  assert.equal(sequence.outcome, 'active');
  assert.deepEqual(sequence.events, []);
});


test('CBT conservation: 32 seeded fixtures preserve health, shield, damage, RNG and event accounting across batches', () => {
  for (let seed = 0; seed < 32; seed++) {
    const initial = freeze(start({
      maxHp: 35 + seed % 4 * 10, initialShield: seed % 13, shieldCap: 10,
      reduction: seed % 3, critBps: seed * 1379 % 10001, killShield: seed % 5, killShieldCap: 7,
      weapons: [
        weapon({ instanceId: 'main', spawnIndex: 0, damage: 2 + seed % 7, cooldown: 3 + seed % 5,
          targets: 1 + seed % 3, splash: seed % 2 ? 3 : 0, bonusDamage: seed % 3,
          hasteBps: seed % 3 * 1000, thirdHitDamage: seed % 2 ? 5 : 0 }),
        weapon({ instanceId: 'side', spawnIndex: 4, damage: 1 + seed % 5, cooldown: 5 + seed % 4 }),
      ],
      consumables: [
        supply({ instanceId: 'heal', spawnIndex: 20, emergencyHeal: 12, charges: 1 }),
        supply({ instanceId: 'drip', spawnIndex: 21, periodicHeal: 3, everyTicks: 4, charges: 3 }),
        supply({ instanceId: 'pierce', spawnIndex: 22, pierce: 2, pierceCharges: 3 }),
      ],
    }, [
      enemy({ hp: 10 + seed % 8, damage: 1 + seed % 4, cooldown: 3 + seed % 3, armor: seed % 4 }),
      enemy({ hp: 15 + seed % 8, damage: 2 + seed % 5, cooldown: 4 + seed % 3, armor: seed % 3 }),
      enemy({ hp: 25 + seed % 10, damage: 3 + seed % 4, cooldown: 5 + seed % 3, armor: seed % 2,
        behavior: 'boss', enrageThresholdBps: 5000, enragedCooldown: 3 }),
    ], null, seed, 30 + seed % 7));
    const bulk = runBatches(initial, [100], 100);
    const split = runBatches(initial, [0, 1, 7, 2], 100, true);
    assert.deepEqual(withoutEvents(split.state), withoutEvents(bulk.state), 'state seed ' + seed);
    assert.deepEqual(split.events, bulk.events, 'events seed ' + seed);
    const s = bulk.state;
    const values = Object.values(s.stats.weapons);
    const sum = numbers => numbers.reduce((a, b) => a + b, 0);
    assert.equal(s.hp, initial.hp + s.stats.healing - s.stats.damageTaken);
    assert.equal(s.shield, initial.shield + s.recoveredShield - s.stats.shieldAbsorbed);
    assert.equal(sum(values.map(v => v.base + v.combo)), sum(initial.enemies.map(e => e.hp)) - sum(s.enemies.map(e => e.hp)));
    assert.equal(s.rng, rngAfter(seed, sum(values.map(v => v.attacks))));
    assert.equal(s.stats.kills, s.enemies.filter(e => e.hp === 0).length);
    const kills = bulk.events.filter(e => e.type === 'kill');
    assert.equal(kills.length, new Set(kills.map(e => e.target)).size);
    assert.equal(kills.length, s.stats.kills);
    assert.equal(bulk.events.filter(e => e.type === 'combo').length, s.stats.comboTriggers);
    assert.equal(sum(bulk.events.filter(e => e.type === 'heal').map(e => e.amount)), s.stats.healing);
    assert.equal(sum(bulk.events.filter(e => e.type === 'damage' && e.target === 'player').map(e => e.amount)), s.stats.damageTaken);
    assert.equal(bulk.events.filter(e => e.type === 'terminal').length, 1);
    assert.equal(s.nextEventSeq, bulk.events.length + 1);
  }
});
