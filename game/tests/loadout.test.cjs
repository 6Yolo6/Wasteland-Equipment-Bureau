'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CONTENT } = require('../../.test-build/content/catalog.js');
const { createInventory, validateInventory, transactInventory } = require('../../.test-build/core/inventory.js');
const { evaluateLoadout, buildAdjacency, effectiveCooldown } = require('../../.test-build/core/loadout.js');

const clone = value => structuredClone(value);
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
// Entry: id, defId, x, y, rotation, spawnIndex. Wider fixtures isolate quantity caps.
function equipped(entries, content = CONTENT, width = 5, height = 6) {
  const state = createInventory(entries.map((e, i) => ({ id: e[0], defId: e[1], spawnIndex: e[5] === undefined ? i : e[5] })), width, height);
  state.placements = entries.map(e => ({ instanceId: e[0], x: e[2], y: e[3], rotation: e[4] === undefined ? 0 : e[4] }));
  state.stash = [];
  assert.deepEqual(validateInventory(state, content), [], 'fixture must be a legal inventory');
  return state;
}
function removeToStash(state, ...ids) {
  const next = clone(state);
  next.placements = next.placements.filter(p => !ids.includes(p.instanceId));
  next.stash.push(...ids);
  assert.deepEqual(validateInventory(next, CONTENT), []);
  return next;
}
const weapon = (result, id) => result.weapons.find(w => w.instanceId === id);
const consumable = (result, id) => result.consumables.find(c => c.instanceId === id);
const activations = (result, rule) => result.combos.filter(c => c.id === rule);
const capFor = (result, scope) => result.capped.some(value => value.startsWith(scope + ':'));
function transact(state, command) {
  const result = transactInventory(state, { ...command, expectedRevision: state.revision }, CONTENT);
  assert.equal(result.ok, true, result.reason);
  return result.state;
}
function parallelEntries(prefix, x, anchorSpawn, weaponSpawn) {
  return [[prefix + '-joint', 'I12', x + 1, 2, 0, anchorSpawn], [prefix + '-battery', 'I07', x + 1, 1, 0, weaponSpawn + 2], [prefix + '-upper', 'I01', x + 2, 0, 0, weaponSpawn], [prefix + '-left', 'I01', x, 2, 0, weaponSpawn + 1]];
}
function medicalEntries(prefix, x, spawn) {
  return [[prefix + '-med', 'I09', x + 1, 2, 0, spawn], [prefix + '-bottle', 'I10', x, 1, 0, spawn + 1], [prefix + '-rust', 'I11', x + 3, 2, 0, spawn + 2]];
}
function gearEntries(prefix, x, spawn) {
  return [[prefix + '-blade', 'I03', x + 1, 2, 0, spawn], [prefix + '-recycler', 'I08', x + 1, 1, 0, spawn + 1], [prefix + '-iron', 'I13', x + 3, 2, 0, spawn + 2]];
}

test('LOADOUT: stash contributes nothing, and base HP is a pure input', () => {
  const state = createInventory(CONTENT.items.map((def, i) => ({ id: def.id, defId: def.id, spawnIndex: i })));
  const result = evaluateLoadout(freeze(state), freeze(clone(CONTENT)));
  assert.deepEqual(result, {
    maxHp: 120, initialShield: 0, reduction: 0, critBps: 0, critMultiplierBps: 15000,
    shieldCap: 80, killShield: 0, killShieldCap: 20, weapons: [], consumables: [], combos: [], circuits: [], capped: [],
  });
  assert.equal(evaluateLoadout(state, CONTENT, 135).maxHp, 135);
  assert.equal(buildAdjacency(state, CONTENT).size, 0);
});

test('LOADOUT: all seventeen definitions derive their base stats, distinct healing/piercing charges and targets', () => {
  const entries = CONTENT.items.map((def, i) => [def.id, def.id, i * 4, 0, 0, i]);
  const state = freeze(equipped(entries, CONTENT, CONTENT.items.length*4, 3));
  const result = evaluateLoadout(state, CONTENT);
  assert.equal(result.maxHp, 132); assert.equal(result.initialShield, 23); assert.equal(result.reduction, 1);
  assert.equal(result.critBps, 500); assert.equal(result.critMultiplierBps, 15000); assert.equal(result.killShield, 4);
  assert.deepEqual(result.combos, []); assert.deepEqual(result.capped, []);
  assert.deepEqual(result.weapons.map(w => [w.defId, w.damage, w.cooldown, w.targets, w.splash, w.bonusDamage, w.hasteBps, w.thirdHitDamage]), [
    ['I01', 12, 12, 1, 0, 0, 0, 0], ['I02', 18, 20, 1, 6, 0, 0, 0], ['I03', 7, 7, 1, 0, 0, 0, 0], ['I04', 5, 16, 3, 0, 0, 0, 0],
  ]);
  assert.deepEqual(result.consumables, [
    { instanceId: 'I09', spawnIndex: 8, emergencyHeal: 18, thresholdBps: 4000, periodicHeal: 0, everyTicks: 0, charges: 1, pierce: 0, pierceCharges: 0 },
    { instanceId: 'I10', spawnIndex: 9, emergencyHeal: 0, thresholdBps: 0, periodicHeal: 5, everyTicks: 80, charges: 4, pierce: 0, pierceCharges: 0 },
    { instanceId: 'I11', spawnIndex: 10, emergencyHeal: 0, thresholdBps: 0, periodicHeal: 0, everyTicks: 0, charges: 0, pierce: 1, pierceCharges: 3 },
    { instanceId:'I15',spawnIndex:14,defId:'I15',singleUse:true,emergencyHeal:26,thresholdBps:4000,periodicHeal:0,everyTicks:0,charges:1,pierce:0,pierceCharges:0 },
    { instanceId:'I16',spawnIndex:15,defId:'I16',singleUse:true,emergencyHeal:0,thresholdBps:0,periodicHeal:0,everyTicks:0,charges:0,pierce:3,pierceCharges:1 },
    { instanceId:'I17',spawnIndex:16,defId:'I17',singleUse:true,emergencyShield:24,emergencyHeal:0,thresholdBps:0,periodicHeal:0,everyTicks:0,charges:1,pierce:0,pierceCharges:0 },
  ]);
  assert.equal(state.instances.length, 17);
  result.weapons[0].damage = 999; result.consumables[0].charges = 0;
  const again = evaluateLoadout(state, CONTENT);
  assert.equal(again.weapons[0].damage, 12); assert.equal(again.consumables[0].charges, 1);
});

test('LOADOUT: only real four-neighbors count, never diagonal, gap, hollow box edge or self', () => {
  const diagonal = equipped([['gun', 'I01', 0, 0], ['battery', 'I07', 1, 2]]);
  assert.deepEqual(buildAdjacency(diagonal, CONTENT).get('gun'), []);
  assert.equal(weapon(evaluateLoadout(diagonal, CONTENT), 'gun').hasteBps, 0);
  const hollowEdge = equipped([['gun', 'I02', 0, 0], ['battery', 'I07', 2, 0]]);
  assert.deepEqual(buildAdjacency(hollowEdge, CONTENT).get('gun'), []);
  const inHole = equipped([['gun', 'I02', 0, 0], ['battery', 'I07', 1, 0]]);
  const graph = buildAdjacency(inHole, CONTENT);
  assert.deepEqual(graph.get('gun'), ['battery']); assert.deepEqual(graph.get('battery'), ['gun']);
  assert.ok(!graph.get('gun').includes('gun'));
  assert.equal(weapon(evaluateLoadout(inHole, CONTENT), 'gun').hasteBps, 1000);
});

test('LOADOUT: many shared edges and equivalent shields activate C01 once with lexical participants', () => {
  const state = equipped([['gun', 'I01', 2, 1, 0, 0], ['z-plate', 'I05', 0, 1, 0, 1], ['a-plate', 'I05', 3, 1, 0, 9]]);
  const graph = buildAdjacency(state, CONTENT);
  assert.deepEqual(graph.get('gun'), ['z-plate', 'a-plate']);
  assert.deepEqual(graph.get('z-plate'), ['gun']);
  const result = evaluateLoadout(state, CONTENT);
  assert.equal(weapon(result, 'gun').bonusDamage, 2); assert.equal(activations(result, 'C01').length, 1);
  assert.deepEqual(activations(result, 'C01')[0].participants, ['a-plate', 'gun']);
  assert.equal(result.initialShield, 32); assert.equal(result.reduction, 2);
});

test('LOADOUT: I07 haste is once per weapon/type, with actual duplicate-source truncation reported', () => {
  const state = equipped([['gun', 'I01', 1, 1], ['battery-a', 'I07', 0, 1], ['battery-b', 'I07', 2, 1]]);
  const result = evaluateLoadout(state, CONTENT);
  assert.equal(weapon(result, 'gun').hasteBps, 1000); assert.equal(weapon(result, 'gun').cooldown, 12); assert.equal(effectiveCooldown(weapon(result, 'gun')), 11);
  assert.equal(result.initialShield, 4);
  assert.ok(capFor(result, 'weapon:gun/I07.hasteBps'));
  const one = evaluateLoadout(removeToStash(state, 'battery-b'), CONTENT);
  assert.equal(weapon(one, 'gun').hasteBps, 1000); assert.ok(!capFor(one, 'weapon:gun/I07.hasteBps'));
});

test('LOADOUT: four different I13 neighbors grant only +3, without counting edges twice', () => {
  const state = equipped([
    ['gun', 'I01', 2, 2], ['left', 'I13', 0, 2], ['right', 'I13', 3, 1], ['top', 'I13', 1, 0], ['bottom', 'I13', 2, 4],
  ]);
  const result = evaluateLoadout(state, CONTENT);
  assert.equal(buildAdjacency(state, CONTENT).get('gun').length, 4);
  assert.equal(weapon(result, 'gun').bonusDamage, 3); assert.ok(capFor(result, 'weapon:gun/I13.bonusDamage'));
});

test('LOADOUT: C01 quantity cap picks three oldest weapons, independent of input/configuration order', () => {
  const state = equipped([
    ['last', 'I03', 1, 1, 0, 40], ['plate', 'I05', 1, 2, 0, 50], ['third', 'I03', 1, 4, 0, 30],
    ['first', 'I01', 0, 2, 0, 10], ['second', 'I01', 3, 2, 0, 20],
  ]);
  const result = evaluateLoadout(state, CONTENT);
  assert.deepEqual(activations(result, 'C01').map(c => c.anchorId), ['first', 'second', 'third']);
  assert.equal(weapon(result, 'last').bonusDamage, 0);
  for (const id of ['first', 'second', 'third']) assert.equal(weapon(result, id).bonusDamage, 2);
  assert.ok(capFor(result, 'combo:C01'));
  const reordered = clone(state); reordered.instances.reverse(); reordered.placements.reverse();
  const content = clone(CONTENT); content.items.reverse(); content.combos.reverse();
  assert.deepEqual(evaluateLoadout(reordered, content), result);
  content.combos.find(c => c.id === 'C01').limit = 1;
  assert.deepEqual(activations(evaluateLoadout(state, content), 'C01').map(c => c.anchorId), ['first']);
  content.combos.find(c => c.id === 'C01').limit = 0;
  assert.equal(activations(evaluateLoadout(state, content), 'C01').length, 0);
});

test('LOADOUT: duplicate spawnIndex is rejected before handing an invalid loadout to combat', () => {
  const state = equipped([['z-gun', 'I01', 0, 2, 0, 1], ['plate', 'I05', 1, 2, 0, 0], ['a-gun', 'I01', 3, 2, 0, 2]]);
  state.instances[2].spawnIndex = state.instances[0].spawnIndex;
  assert.ok(validateInventory(state, CONTENT).some(error => error.includes('spawnIndex')));
  assert.throws(() => evaluateLoadout(state, CONTENT), /spawnIndex/);
});

test('LOADOUT: C02 needs two distinct weapons, not two edges of one weapon, plus a battery', () => {
  const state = equipped([['joint', 'I12', 1, 2], ['gun', 'I03', 1, 3], ['battery', 'I07', 1, 1]]);
  assert.equal(activations(evaluateLoadout(state, CONTENT), 'C02').length, 0);
  assert.deepEqual(buildAdjacency(state, CONTENT).get('joint'), ['gun', 'battery']);
  const complete = equipped(parallelEntries('p', 0, 0, 1));
  assert.equal(activations(evaluateLoadout(complete, CONTENT), 'C02').length, 1);
  assert.equal(activations(evaluateLoadout(removeToStash(complete, 'p-battery'), CONTENT), 'C02').length, 0);
});

test('LOADOUT: C02 chooses two weapons by spawnIndex, battery by ID, and computes the final 20% cooldown', () => {
  const state = equipped([
    ['joint', 'I12', 1, 2, 0, 20], ['z-battery', 'I07', 1, 1, 0, 30],
    ['z-first', 'I01', 2, 0, 0, 1], ['a-third', 'I01', 0, 2, 0, 3], ['y-second', 'I03', 1, 3, 0, 2],
    ['a-battery', 'I07', 3, 2, 0, 40],
  ]);
  const result = evaluateLoadout(state, CONTENT);
  assert.equal(activations(result, 'C02').length, 1);
  assert.deepEqual(activations(result, 'C02')[0].participants, ['a-battery', 'joint', 'y-second', 'z-first']);
  assert.equal(weapon(result, 'z-first').hasteBps, 2000); assert.equal(weapon(result, 'z-first').cooldown, 12); assert.equal(effectiveCooldown(weapon(result, 'z-first')), 10);
  assert.equal(weapon(result, 'y-second').hasteBps, 1000); assert.equal(weapon(result, 'a-third').hasteBps, 0);
  assert.ok(capFor(result, 'combo:C02/joint/weapons'));
});

test('LOADOUT: C02 applies to just the oldest eligible joint, with the excluded anchor reported', () => {
  const state = equipped([...parallelEntries('late', 0, 50, 60), ...parallelEntries('early', 6, 1, 10)], CONTENT, 10, 6);
  const result = evaluateLoadout(state, CONTENT);
  assert.deepEqual(activations(result, 'C02').map(c => c.anchorId), ['early-joint']);
  assert.equal(weapon(result, 'early-upper').hasteBps, 2000); assert.equal(weapon(result, 'early-left').hasteBps, 1000);
  assert.equal(weapon(result, 'late-upper').hasteBps, 1000); assert.equal(weapon(result, 'late-left').hasteBps, 0);
  assert.ok(capFor(result, 'combo:C02'));
});

test('LOADOUT: C03 requires both sources and boosts only the designated medkit without adding charges', () => {
  const state = equipped(medicalEntries('kit', 0, 0));
  const result = evaluateLoadout(state, CONTENT);
  assert.equal(activations(result, 'C03').length, 1);
  assert.equal(consumable(result, 'kit-med').emergencyHeal, 24);
  assert.equal(consumable(result, 'kit-med').thresholdBps, 4000); assert.equal(consumable(result, 'kit-med').charges, 1);
  assert.equal(consumable(result, 'kit-bottle').charges, 4); assert.equal(consumable(result, 'kit-bottle').periodicHeal, 5);
  assert.equal(consumable(result, 'kit-rust').pierceCharges, 3);
  for (const missing of ['kit-bottle', 'kit-rust']) {
    const incomplete = evaluateLoadout(removeToStash(state, missing), CONTENT);
    assert.equal(activations(incomplete, 'C03').length, 0); assert.equal(consumable(incomplete, 'kit-med').emergencyHeal, 18);
  }
});

test('LOADOUT: C03 uses lexical equivalent participants and only one oldest medkit', () => {
  const choices = equipped([
    ['med', 'I09', 1, 2, 0, 0], ['z-bottle', 'I10', 0, 1, 0, 1], ['a-bottle', 'I10', 3, 2, 0, 9],
    ['z-rust', 'I11', 1, 1, 0, 2], ['a-rust', 'I11', 2, 3, 0, 10],
  ]);
  const selected = evaluateLoadout(choices, CONTENT);
  assert.deepEqual(activations(selected, 'C03')[0].participants, ['a-bottle', 'a-rust', 'med']);
  const state = equipped([...medicalEntries('late', 0, 20), ...medicalEntries('early', 6, 1)], CONTENT, 10, 6);
  const result = evaluateLoadout(state, CONTENT);
  assert.deepEqual(activations(result, 'C03').map(c => c.anchorId), ['early-med']);
  assert.equal(consumable(result, 'early-med').emergencyHeal, 24); assert.equal(consumable(result, 'late-med').emergencyHeal, 18);
  assert.ok(capFor(result, 'combo:C03'));
});

test('LOADOUT: C04 marks third-hit combo damage, retains base damage, and never spends piercing charges', () => {
  const state = freeze(equipped([...gearEntries('gear', 0, 0), ['rust', 'I11', 0, 2, 0, 9]]));
  const before = clone(state);
  const result = evaluateLoadout(state, CONTENT);
  assert.equal(activations(result, 'C04').length, 1);
  assert.equal(weapon(result, 'gear-blade').damage, 7); assert.equal(weapon(result, 'gear-blade').bonusDamage, 1);
  assert.equal(weapon(result, 'gear-blade').thirdHitDamage, 5); assert.equal(result.killShield, 4);
  assert.equal(consumable(result, 'rust').pierceCharges, 3);
  for (let i = 0; i < 6; i++) assert.deepEqual(evaluateLoadout(state, CONTENT), result);
  assert.deepEqual(state, before);
  for (const missing of ['gear-recycler', 'gear-iron']) {
    const incomplete = evaluateLoadout(removeToStash(state, missing), CONTENT);
    assert.equal(activations(incomplete, 'C04').length, 0); assert.equal(weapon(incomplete, 'gear-blade').thirdHitDamage, 0);
  }
});

test('LOADOUT: C04 quantity cap cannot leak the extra hit to a second blade', () => {
  const state = equipped([...gearEntries('late', 0, 20), ...gearEntries('early', 6, 1)], CONTENT, 11, 6);
  const result = evaluateLoadout(state, CONTENT);
  assert.deepEqual(activations(result, 'C04').map(c => c.anchorId), ['early-blade']);
  assert.equal(weapon(result, 'early-blade').thirdHitDamage, 5); assert.equal(weapon(result, 'late-blade').thirdHitDamage, 0);
  assert.ok(capFor(result, 'combo:C04'));
});

test('LOADOUT: rules, anchors, weapons, consumables, graph and cap text are stable under full input permutations', () => {
  const state = equipped([
    ...gearEntries('gear', 20, 60), ...medicalEntries('kit', 14, 40),
    ['plate', 'I05', 0, 1, 0, 80], ['gun', 'I01', 2, 1, 0, 70], ...parallelEntries('wire', 7, 1, 10),
  ], CONTENT, 26, 6);
  const result = evaluateLoadout(freeze(clone(state)), freeze(clone(CONTENT)));
  assert.deepEqual(result.combos.map(c => c.id), ['C01', 'C02', 'C03', 'C04']);
  assert.ok(result.combos.every(c => c.name && c.description && c.participants.includes(c.anchorId)));
  const reversed = clone(state); reversed.instances.reverse(); reversed.placements.reverse();
  const content = clone(CONTENT); content.items.reverse(); content.combos.reverse();
  for (const def of content.items) { def.shape.reverse(); def.effects = Object.fromEntries(Object.entries(def.effects).reverse()); }
  assert.deepEqual(evaluateLoadout(reversed, content), result);
  assert.deepEqual([...buildAdjacency(reversed, content)], [...buildAdjacency(state, CONTENT)]);
  assert.deepEqual(result.consumables.map(c => c.spawnIndex), result.consumables.map(c => c.spawnIndex).sort((a, b) => a - b));
});

test('LOADOUT: global HP/shield/reduction/crit/recovered-shield caps carry raw and clamped amounts', () => {
  const ids = [...Array(5).fill('I05'), ...Array(7).fill('I06'), ...Array(8).fill('I14'), ...Array(6).fill('I08'), 'I07'];
  const state = equipped(ids.map((defId, i) => ['cap-' + i, defId, i * 4, 0, 0, i]), CONTENT, ids.length * 4, 3);
  const result = evaluateLoadout(state, CONTENT);
  assert.equal(result.maxHp, 200); assert.equal(result.initialShield, 80); assert.equal(result.reduction, 3);
  assert.equal(result.critBps, 3500); assert.equal(result.killShield, 20); assert.equal(result.killShieldCap, 20); assert.equal(result.shieldCap, 80);
  for (const scope of ['maxHp', 'initialShield', 'reduction', 'critBps', 'killShield']) assert.ok(capFor(result, scope));
  assert.ok(result.capped.includes('maxHp: 204 -> 200'));
  assert.ok(result.capped.includes('initialShield: 82 -> 80'));
  assert.ok(result.capped.includes('killShield: 24 -> 20'));
  assert.equal(new Set(result.capped).size, result.capped.length);
});

test('LOADOUT: configured total haste and layout damage caps apply after source caps and combos', () => {
  const hasteContent = clone(CONTENT);
  hasteContent.items.find(d => d.id === 'I07').effects.adjacentHasteBps = 1500;
  const wire = equipped(parallelEntries('wire', 0, 0, 1), hasteContent);
  const hasted = evaluateLoadout(wire, hasteContent);
  assert.equal(weapon(hasted, 'wire-upper').hasteBps, 2000); assert.equal(weapon(hasted, 'wire-upper').cooldown, 12); assert.equal(effectiveCooldown(weapon(hasted, 'wire-upper')), 10);
  assert.ok(capFor(hasted, 'weapon:wire-upper/hasteBps'));
  const damageContent = clone(CONTENT);
  damageContent.items.find(d => d.id === 'I07').effects.adjacentDamage = 10;
  const state = equipped([['gun', 'I01', 2, 1], ['plate', 'I05', 0, 1], ['iron', 'I13', 3, 1], ['battery', 'I07', 2, 0]], damageContent);
  const boosted = evaluateLoadout(state, damageContent);
  assert.equal(weapon(boosted, 'gun').damage, 12); assert.equal(weapon(boosted, 'gun').bonusDamage, 6);
  assert.ok(boosted.capped.includes('weapon:gun/bonusDamage: 13 -> 6'));
  damageContent.limits.weaponBonus = 2;
  assert.equal(weapon(evaluateLoadout(state, damageContent), 'gun').bonusDamage, 2);
  hasteContent.limits.hasteBps = 0;
  const disabled = evaluateLoadout(wire, hasteContent);
  assert.equal(weapon(disabled, 'wire-upper').hasteBps, 0); assert.equal(weapon(disabled, 'wire-upper').cooldown, 12);
  hasteContent.items.find(d => d.id === 'I01').weapon.cooldown = 1;
  assert.equal(effectiveCooldown(weapon(evaluateLoadout(wire, hasteContent), 'wire-upper')), 3);
});

test('LOADOUT: move/stash/rotation/undo recompute from scratch, with no residual or accumulating bonuses', () => {
  let state = equipped([['plate', 'I05', 0, 0], ['gun', 'I01', 2, 0], ['battery', 'I07', 3, 0]]);
  const original = evaluateLoadout(state, CONTENT);
  assert.equal(weapon(original, 'gun').bonusDamage, 2); assert.equal(weapon(original, 'gun').hasteBps, 1000);
  state = transact(state, { type: 'place', instanceId: 'battery', x: 4, y: 5, rotation: 0 });
  state = transact(state, { type: 'stash', instanceId: 'plate' });
  const moved = evaluateLoadout(state, CONTENT);
  assert.equal(weapon(moved, 'gun').bonusDamage, 0); assert.equal(weapon(moved, 'gun').hasteBps, 0); assert.deepEqual(moved.combos, []);
  state = transact(state, { type: 'undo' }); state = transact(state, { type: 'undo' });
  assert.deepEqual(evaluateLoadout(state, CONTENT), original);
  let rotated = equipped([['l', 'I02', 0, 0], ['battery', 'I07', 2, 0]]);
  assert.equal(weapon(evaluateLoadout(rotated, CONTENT), 'l').hasteBps, 0);
  rotated = transact(rotated, { type: 'place', instanceId: 'l', x: 0, y: 0, rotation: 90 });
  assert.equal(weapon(evaluateLoadout(rotated, CONTENT), 'l').hasteBps, 1000);
  rotated = transact(rotated, { type: 'undo' });
  assert.equal(weapon(evaluateLoadout(rotated, CONTENT), 'l').hasteBps, 0);
});

test('LOADOUT: invalid input fails explicitly instead of deriving NaN or silently ignoring corrupt gear', () => {
  const state = equipped([['gun', 'I01', 0, 0]]);
  for (const baseHp of [0, -1, NaN, Infinity, '120', null, 1.5]) assert.throws(() => evaluateLoadout(state, CONTENT, baseHp));
  for (const rotation of [undefined, null, 45, 360, '90']) {
    const malformed = clone(state); malformed.placements[0].rotation = rotation;
    assert.throws(() => evaluateLoadout(malformed, CONTENT), /rotation/);
    assert.throws(() => buildAdjacency(malformed, CONTENT));
  }
  for (const corrupt of [
    c => c.limits.hasteBps = 10001, c => c.limits.critBps = NaN, c => c.limits.weaponBonus = -1, c => c.limits.maxHp = 0,
    c => c.items[0].weapon.cooldown = 0, c => c.items[0].effects.shield = NaN, c => c.items[0].effects = null,
    c => c.combos[0].limit = Infinity, c => c.combos.push({ ...c.combos[0] }), c => c.combos = null,
  ]) {
    const content = clone(CONTENT); corrupt(content);
    assert.throws(() => evaluateLoadout(state, content));
  }
  assert.throws(() => evaluateLoadout(null, CONTENT));
  assert.throws(() => evaluateLoadout(state, null));
});

test('LOADOUT: effectiveCooldown validates inputs and never mutates or compounds base cooldown', () => {
  const value = freeze({ cooldown: 12, hasteBps: 2000 });
  assert.equal(effectiveCooldown(value), 10); assert.equal(effectiveCooldown(value), 10);
  assert.equal(value.cooldown, 12);
  assert.equal(effectiveCooldown({ cooldown: 1, hasteBps: 10000 }), 3);
  for (const malformed of [null, {}, { cooldown: 0, hasteBps: 0 }, { cooldown: 12, hasteBps: -1 }, { cooldown: 12, hasteBps: 10001 }, { cooldown: NaN, hasteBps: 0 }, { cooldown: 12, hasteBps: '1000' }]) {
    assert.throws(() => effectiveCooldown(malformed));
  }
});
