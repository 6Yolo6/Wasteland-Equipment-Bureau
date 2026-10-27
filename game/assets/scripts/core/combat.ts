import {
  BattleLoadout, CircuitLoadout, CircuitRuntime, CombatEvent, CombatOutcome, CombatState, ConsumableLoadout,
  ConsumableRuntime, DamageStats, EnemyDef, EnemyState, WeaponLoadout, WeaponRuntime,
} from './types';
import { randomInt } from './random';
import { cooldownUnits, effectiveCooldown } from './loadout';

const BPS = 10000;
const MAX_INT = Number.MAX_SAFE_INTEGER;
const PLAYER = 'player';

function integer(value: number, name: string, min = 0, max = MAX_INT): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(name + ' must be a safe integer in [' + min + ', ' + max + ']');
  }
  return value;
}

function object(value: unknown, name: string): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(name + ' must be an object');
  }
}

function array(value: unknown, name: string): void {
  if (!Array.isArray(value)) throw new TypeError(name + ' must be an array');
}

function identifier(value: string, name: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(name + ' must be a nonempty string');
  }
}

function add(a: number, b: number, name: string): number {
  return integer(a + b, name);
}

function cooldown(weapon: WeaponLoadout): number { return effectiveCooldown(weapon); }
function scheduledAttack(weapon: WeaponLoadout, ordinal: number): number {
  // Absolute fixed-point phase: 0.63s stays 0.63s on average on a 100ms simulation.
  const units = integer(cooldownUnits(weapon) * ordinal, 'weapon scheduled attack product', 1);
  return Math.ceil(units / BPS);
}
function validateCircuits(circuits: CircuitLoadout[], weapons: WeaponLoadout[], runtime = false): void {
  array(circuits, 'circuits');
  const anchors = new Set<string>();
  for (const circuit of circuits) {
    object(circuit, 'circuit'); identifier(circuit.anchorId, 'circuit.anchorId');
    if (anchors.has(circuit.anchorId)) throw new Error('Duplicate circuit anchor');
    anchors.add(circuit.anchorId); array(circuit.weaponIds, 'circuit.weaponIds');
    if (circuit.weaponIds.length !== 2 || new Set(circuit.weaponIds).size !== 2 || circuit.weaponIds.some(id => !weapons.some(w => w.instanceId === id))) throw new Error('Circuit requires two distinct equipped weapons');
    integer(circuit.delayTicks, 'circuit.delayTicks', 1); integer(circuit.maxPulses, 'circuit.maxPulses', 1);
    if (runtime) {
      const live = circuit as CircuitRuntime; integer(live.pulses, 'circuit.pulses', 0, circuit.maxPulses);
      array(live.firedWeaponIds, 'circuit.firedWeaponIds');
      if (new Set(live.firedWeaponIds).size !== live.firedWeaponIds.length || live.firedWeaponIds.some(id => !circuit.weaponIds.includes(id)) || live.firedWeaponIds.length > 1) throw new Error('Invalid relay progress');
    }
  }
}

type Attributes = Pick<BattleLoadout, 'maxHp' | 'reduction' | 'critBps' |
  'critMultiplierBps' | 'shieldCap' | 'killShield' | 'killShieldCap'>;

function validateAttributes(value: Attributes): void {
  integer(value.maxHp, 'maxHp', 1);
  integer(value.maxHp * BPS, 'maxHp basis-point product', 1);
  integer(value.reduction, 'reduction');
  integer(value.critBps, 'critBps', 0, BPS);
  integer(value.critMultiplierBps, 'critMultiplierBps', BPS);
  integer(value.shieldCap, 'shieldCap');
  integer(value.killShield, 'killShield');
  integer(value.killShieldCap, 'killShieldCap');
}

function validateEquipment(
  weapons: WeaponLoadout[], consumables: ConsumableLoadout[], critMultiplierBps: number,
): void {
  array(weapons, 'weapons');
  array(consumables, 'consumables');
  const ids = new Set<string>();
  const indices = new Set<number>();
  const instance = (item: { instanceId: string; spawnIndex: number }, name: string): void => {
    object(item, name);
    identifier(item.instanceId, name + '.instanceId');
    integer(item.spawnIndex, name + '.spawnIndex');
    if (ids.has(item.instanceId)) throw new Error('Duplicate equipment instanceId: ' + item.instanceId);
    if (indices.has(item.spawnIndex)) throw new Error('Duplicate equipment spawnIndex: ' + item.spawnIndex);
    ids.add(item.instanceId);
    indices.add(item.spawnIndex);
  };
  for (const weapon of weapons) {
    instance(weapon, 'weapon');
    identifier(weapon.defId, 'weapon.defId');
    integer(weapon.damage, 'weapon.damage');
    integer(weapon.bonusDamage, 'weapon.bonusDamage');
    integer(weapon.cooldown, 'weapon.cooldown', 1);
    integer(weapon.hasteBps, 'weapon.hasteBps', 0, BPS);
    integer(weapon.targets, 'weapon.targets', 1);
    integer(weapon.splash, 'weapon.splash');
    integer(weapon.thirdHitDamage, 'weapon.thirdHitDamage');
    const power = add(Math.max(weapon.damage, weapon.splash), weapon.bonusDamage, 'weapon power');
    integer(power * critMultiplierBps, 'weapon critical damage product');
    cooldown(weapon);
  }
  for (const consumable of consumables) {
    instance(consumable, 'consumable');
    integer(consumable.emergencyHeal, 'consumable.emergencyHeal');
    integer(consumable.thresholdBps, 'consumable.thresholdBps', 0, BPS);
    integer(consumable.periodicHeal, 'consumable.periodicHeal');
    integer(consumable.everyTicks, 'consumable.everyTicks', consumable.periodicHeal > 0 ? 1 : 0);
    integer(consumable.charges, 'consumable.charges');
    integer(consumable.pierce, 'consumable.pierce');
    integer(consumable.pierceCharges, 'consumable.pierceCharges');
    if (consumable.singleUse !== undefined && typeof consumable.singleUse !== 'boolean') throw new Error('Invalid single-use flag');
    const emergencyShield = consumable.emergencyShield === undefined ? 0 : integer(consumable.emergencyShield, 'consumable.emergencyShield');
    if (emergencyShield > 0 && !consumable.singleUse) throw new Error('Emergency shields must be single-use');
    if (consumable.singleUse) {
      const heal = consumable.emergencyHeal > 0 && consumable.charges === 1 && consumable.thresholdBps > 0 && consumable.pierce === 0 && consumable.pierceCharges === 0 && emergencyShield === 0;
      const pierce = consumable.pierce > 0 && consumable.pierceCharges === 1 && consumable.emergencyHeal === 0 && consumable.thresholdBps === 0 && consumable.charges === 0 && emergencyShield === 0;
      const foam = emergencyShield > 0 && consumable.charges === 1 && consumable.emergencyHeal === 0 && consumable.thresholdBps === 0 && consumable.pierce === 0 && consumable.pierceCharges === 0;
      if ((!heal && !pierce && !foam) || consumable.periodicHeal > 0 || consumable.everyTicks > 0) throw new Error('Unsupported single-use consumable');
    }
  }
}

function validateEnemy(enemy: EnemyDef, maxHp: number, runtime = false): void {
  object(enemy, 'enemy');
  identifier(enemy.id, 'enemy.id');
  identifier(enemy.name, 'enemy.name');
  identifier(enemy.color, 'enemy.color');
  integer(maxHp, 'enemy.maxHp', 1);
  integer(maxHp * BPS, 'enemy health basis-point product', 1);
  integer(enemy.hp, 'enemy.hp', runtime ? -MAX_INT : 1, maxHp);
  integer(enemy.damage, 'enemy.damage');
  integer(enemy.armor, 'enemy.armor');
  integer(enemy.cooldown, 'enemy.cooldown', 1);
  if (!['normal', 'heavy', 'armored', 'boss'].includes(enemy.behavior)) {
    throw new Error('Invalid enemy behavior');
  }
  if (enemy.behavior === 'boss' || enemy.enrageThresholdBps !== undefined) {
    integer(enemy.enrageThresholdBps as number, 'enemy.enrageThresholdBps', 1, BPS);
  }
  if (enemy.behavior === 'boss' || enemy.enragedCooldown !== undefined) {
    integer(enemy.enragedCooldown as number, 'enemy.enragedCooldown', 1, enemy.cooldown);
  }
}

function validateState(state: CombatState): void {
  object(state, 'state');
  validateAttributes(state);
  integer(state.tick, 'tick');
  integer(state.deadlineTick, 'deadlineTick');
  integer(state.hp, 'hp', -MAX_INT, state.maxHp);
  integer(state.shield, 'shield', 0, state.shieldCap);
  integer(state.recoveredShield, 'recoveredShield', 0, state.killShieldCap);
  integer(state.rng, 'rng', 0, 0xffffffff);
  integer(state.nextEventSeq, 'nextEventSeq', 1);
  if (!['active', 'victory', 'defeat', 'timeout'].includes(state.outcome)) {
    throw new Error('Invalid combat outcome');
  }
  validateEquipment(state.weapons, state.consumables, state.critMultiplierBps);
  validateCircuits(state.circuits, state.weapons, true);
  array(state.enemies, 'enemies');
  array(state.events, 'events');
  object(state.stats, 'stats');
  object(state.stats.weapons, 'stats.weapons');
  for (const key of ['damageTaken', 'shieldAbsorbed', 'healing', 'kills', 'comboTriggers', 'ticks'] as const) {
    integer(state.stats[key], 'stats.' + key);
  }
  if (Object.keys(state.stats.weapons).length !== state.weapons.length) {
    throw new Error('Weapon statistics must match the weapon instances');
  }
  for (const weapon of state.weapons) {
    integer(weapon.nextAttackTick, 'weapon.nextAttackTick');
    integer(weapon.attacks, 'weapon.attacks');
    if (!Object.prototype.hasOwnProperty.call(state.stats.weapons, weapon.instanceId)) {
      throw new Error('Missing statistics for weapon: ' + weapon.instanceId);
    }
    const stats = state.stats.weapons[weapon.instanceId];
    object(stats, 'weapon statistics');
    for (const key of ['base', 'combo', 'raw', 'overkill', 'attacks'] as const) {
      integer(stats[key], 'weapon statistics.' + key);
    }
    const actual = add(stats.base, stats.combo, 'weapon actual damage');
    if (add(actual, stats.overkill, 'weapon damage total') !== stats.raw || stats.attacks !== weapon.attacks) {
      throw new Error('Inconsistent weapon statistics: ' + weapon.instanceId);
    }
  }
  for (const consumable of state.consumables) {
    integer(consumable.used, 'consumable.used', 0, consumable.charges);
    integer(consumable.pierceUsed, 'consumable.pierceUsed', 0, consumable.pierceCharges);
  }
  const ids = new Set<string>();
  const indices = new Set<number>();
  for (const enemy of state.enemies) {
    object(enemy, 'enemy');
    validateEnemy(enemy, enemy.maxHp, true);
    identifier(enemy.instanceId, 'enemy.instanceId');
    integer(enemy.spawnIndex, 'enemy.spawnIndex');
    integer(enemy.nextAttackTick, 'enemy.nextAttackTick');
    if (typeof enemy.enraged !== 'boolean') throw new TypeError('enemy.enraged must be boolean');
    if (enemy.enraged && enemy.behavior !== 'boss') throw new Error('Only a boss can be enraged');
    if (ids.has(enemy.instanceId) || indices.has(enemy.spawnIndex)) throw new Error('Duplicate enemy instance');
    ids.add(enemy.instanceId);
    indices.add(enemy.spawnIndex);
  }
}

function bySpawn(a: { spawnIndex: number }, b: { spawnIndex: number }): number {
  return a.spawnIndex - b.spawnIndex;
}

function blankDamageStats(): DamageStats {
  return { base: 0, combo: 0, raw: 0, overkill: 0, attacks: 0 };
}

/** Seal a wave at tick zero. Only null (the first wave) grants full health.
 * Loadout bonuses/caps are already aggregated by the layout domain. No RNG is consumed here.
 * Empty/dead/expired starts are resolved by the first positive step, without running a tick.
 */
export function createCombat(
  loadout: BattleLoadout, enemies: EnemyDef[], rng: number, hp: number | null, deadlineTick = 450,
): CombatState {
  object(loadout, 'loadout');
  validateAttributes(loadout);
  integer(loadout.initialShield, 'initialShield');
  validateEquipment(loadout.weapons, loadout.consumables, loadout.critMultiplierBps);
  const circuits = loadout.circuits === undefined ? [] : loadout.circuits;
  validateCircuits(circuits, loadout.weapons);
  array(loadout.combos, 'combos');
  array(loadout.capped, 'capped');
  array(enemies, 'enemies');
  for (const enemy of enemies) {
    object(enemy, 'enemy');
    validateEnemy(enemy, enemy.hp);
  }
  integer(rng, 'rng', 0, 0xffffffff);
  if (hp !== null) integer(hp, 'hp', -MAX_INT);
  integer(deadlineTick, 'deadlineTick');
  const weapons: WeaponRuntime[] = loadout.weapons.map(weapon => ({
    ...weapon, nextAttackTick: cooldown(weapon), attacks: 0,
  })).sort(bySpawn);
  const consumables: ConsumableRuntime[] = loadout.consumables.map(consumable => ({
    ...consumable, used: 0, pierceUsed: 0,
  })).sort(bySpawn);
  return {
    tick: 0, deadlineTick, hp: hp === null ? loadout.maxHp : Math.max(0, Math.min(loadout.maxHp, hp)),
    maxHp: loadout.maxHp, shield: Math.min(loadout.shieldCap, loadout.initialShield),
    reduction: loadout.reduction, critBps: loadout.critBps, critMultiplierBps: loadout.critMultiplierBps,
    shieldCap: loadout.shieldCap, killShield: loadout.killShield, killShieldCap: loadout.killShieldCap,
    recoveredShield: 0, rng, weapons, consumables,
    circuits: circuits.map(circuit => ({...circuit, weaponIds: circuit.weaponIds.slice(), firedWeaponIds: [], pulses: 0})),
    enemies: enemies.map((enemy, spawnIndex) => ({
      ...enemy, instanceId: 'enemy:' + spawnIndex + ':' + enemy.id, spawnIndex,
      maxHp: enemy.hp, nextAttackTick: enemy.cooldown, enraged: false,
    })),
    outcome: 'active', nextEventSeq: 1, events: [],
    stats: {
      // fromEntries also treats IDs such as "__proto__" as ordinary own keys.
      weapons: Object.fromEntries(weapons.map(weapon => [weapon.instanceId, blankDamageStats()])),
      damageTaken: 0, shieldAbsorbed: 0, healing: 0, kills: 0, comboTriggers: 0, ticks: 0,
    },
  };
}

function copyState(state: CombatState): CombatState {
  return {
    ...state,
    weapons: state.weapons.map(weapon => ({ ...weapon })).sort(bySpawn),
    consumables: state.consumables.map(consumable => ({ ...consumable })).sort(bySpawn),
    enemies: state.enemies.map(enemy => ({ ...enemy })).sort(bySpawn),
    circuits: state.circuits.map(circuit => ({...circuit, weaponIds: circuit.weaponIds.slice(), firedWeaponIds: circuit.firedWeaponIds.slice()})),
    stats: {
      ...state.stats,
      weapons: Object.fromEntries(Object.entries(state.stats.weapons).map(([id, stats]) => [id, { ...stats }])),
    },
    events: [],
  };
}

function emit(state: CombatState, event: Omit<CombatEvent, 'seq' | 'tick'>): void {
  const seq = state.nextEventSeq;
  state.nextEventSeq = add(seq, 1, 'nextEventSeq');
  state.events.push({ seq, tick: state.tick, ...event });
}

function finish(state: CombatState): boolean {
  if (state.outcome !== 'active') return true;
  let outcome: CombatOutcome = 'active';
  if (state.hp <= 0) outcome = 'defeat';
  else if (state.enemies.every(enemy => enemy.hp <= 0)) outcome = 'victory';
  else if (state.tick >= state.deadlineTick) outcome = 'timeout';
  if (outcome === 'active') return false;
  state.outcome = outcome;
  emit(state, { type: 'terminal', detail: outcome });
  return true;
}

function heal(state: CombatState, consumable: ConsumableRuntime, amount: number, detail: string): void {
  const actual = Math.min(amount, state.maxHp - state.hp);
  state.hp += actual;
  state.stats.healing = add(state.stats.healing, actual, 'stats.healing');
  // A zero periodic heal still records the scheduled opportunity that was consumed.
  emit(state, { type: 'heal', source: consumable.instanceId, target: PLAYER, amount: actual, detail, remaining: consumable.charges - consumable.used });
}

function periodicHealing(state: CombatState): void {
  for (const consumable of state.consumables) {
    if (consumable.periodicHeal > 0 && consumable.used < consumable.charges &&
        state.tick % consumable.everyTicks === 0) {
      consumable.used = add(consumable.used, 1, 'consumable.used');
      heal(state, consumable, consumable.periodicHeal, 'periodic');
    }
  }
}

function emergencyHealing(state: CombatState): void {
  for (const consumable of state.consumables) {
    if (state.hp > 0 && state.hp < state.maxHp && consumable.emergencyHeal > 0 &&
        consumable.used < consumable.charges &&
        state.hp * BPS <= state.maxHp * consumable.thresholdBps) {
      consumable.used = add(consumable.used, 1, 'consumable.used');
      heal(state, consumable, consumable.emergencyHeal, 'emergency');
      if(consumable.singleUse)emit(state, {type:'consume',source:consumable.instanceId,detail:'single-use',remaining:0});
    }
  }
}

function recoverShield(state: CombatState, source: string): void {
  const actual = Math.min(state.killShield, state.killShieldCap - state.recoveredShield, state.shieldCap - state.shield);
  if (actual <= 0) return;
  state.shield += actual;
  // The shared per-wave allowance counts shield actually recovered, not overflow.
  state.recoveredShield += actual;
  emit(state, { type: 'shield', source, target: PLAYER, amount: actual, detail: 'kill' });
}

function enrage(state: CombatState, enemy: EnemyState): void {
  if (enemy.behavior !== 'boss' || enemy.enraged || enemy.hp <= 0 ||
      enemy.hp * BPS >= enemy.maxHp * (enemy.enrageThresholdBps as number)) return;
  const remaining = Math.max(0, enemy.nextAttackTick - state.tick);
  const product = integer(remaining * (enemy.enragedCooldown as number), 'boss remaining cooldown product');
  // Keep progress through the old cooldown: round up, never postpone an already due attack.
  const next = add(state.tick, Math.ceil(product / enemy.cooldown), 'boss nextAttackTick');
  enemy.nextAttackTick = Math.min(enemy.nextAttackTick, next);
  enemy.enraged = true;
  emit(state, { type: 'enrage', source: enemy.instanceId });
}

function hitEnemy(
  state: CombatState, weapon: WeaponRuntime, enemy: EnemyState, power: number, pierce: number,
  detail: 'base' | 'splash' | 'C04',
): void {
  if (enemy.hp <= 0) return;
  const raw = Math.max(1, power - Math.max(0, enemy.armor - pierce));
  const actual = Math.min(enemy.hp, raw);
  enemy.hp -= actual;
  const stats = state.stats.weapons[weapon.instanceId];
  const field = detail === 'C04' ? 'combo' : 'base';
  stats[field] = add(stats[field], actual, 'weapon statistics.' + field);
  // Raw means post-armor damage before the target-health clamp (CBT-004).
  stats.raw = add(stats.raw, raw, 'weapon statistics.raw');
  stats.overkill = add(stats.overkill, raw - actual, 'weapon statistics.overkill');
  emit(state, { type: 'damage', source: weapon.instanceId, target: enemy.instanceId, amount: actual, detail });
  if (enemy.hp === 0) {
    state.stats.kills = add(state.stats.kills, 1, 'stats.kills');
    emit(state, { type: 'kill', source: weapon.instanceId, target: enemy.instanceId });
    recoverShield(state, weapon.instanceId);
  } else {
    enrage(state, enemy);
  }
}

function relayAfterShot(state: CombatState, weapon: WeaponRuntime): void {
  for (const circuit of state.circuits) {
    if (circuit.pulses >= circuit.maxPulses || !circuit.weaponIds.includes(weapon.instanceId)) continue;
    if (!circuit.firedWeaponIds.includes(weapon.instanceId)) circuit.firedWeaponIds.push(weapon.instanceId);
    if (circuit.firedWeaponIds.length < 2) continue;
    circuit.firedWeaponIds = [];
    const target = state.enemies.filter(enemy => enemy.hp > 0).sort((a,b) => a.nextAttackTick - b.nextAttackTick || a.spawnIndex - b.spawnIndex)[0];
    if (!target) continue; // A winning shot cannot spend a pointless pulse.
    target.nextAttackTick = add(target.nextAttackTick, circuit.delayTicks, 'relay delayed attack');
    circuit.pulses = add(circuit.pulses, 1, 'circuit.pulses');
    state.stats.comboTriggers = add(state.stats.comboTriggers, 1, 'stats.comboTriggers');
    emit(state, {type:'relay', source:circuit.anchorId, target:target.instanceId, amount:circuit.delayTicks, remaining:circuit.maxPulses-circuit.pulses, detail:'C02'});
  }
}

function attackWithWeapon(state: CombatState, weapon: WeaponRuntime): void {
  const alive = state.enemies.filter(enemy => enemy.hp > 0);
  if (alive.length === 0) return;
  const primary = alive[0];
  weapon.attacks = add(weapon.attacks, 1, 'weapon.attacks');
  weapon.nextAttackTick = Math.max(add(state.tick, 1, 'weapon.nextAttackTick'), scheduledAttack(weapon, add(weapon.attacks, 1, 'attack ordinal')));
  const stats = state.stats.weapons[weapon.instanceId];
  stats.attacks = add(stats.attacks, 1, 'weapon statistics.attacks');
  // Exactly one unbiased critical sample per base attack, even at 0% or 100%.
  const draw = randomInt(state.rng, BPS);
  state.rng = draw.state;
  const critical = draw.value < state.critBps;
  // A sealed piercing round waits for armor among this attack's captured targets.
  // Per-wave supplies retain their old first-attack behavior, even against no armor.
  const hitTargets = alive.slice(0, weapon.targets);
  if (weapon.splash > 0 && alive.length > weapon.targets) hitTargets.push(alive[weapon.targets]);
  const armoredHit = hitTargets.some(enemy => enemy.armor > 0);
  const supply = state.consumables.find(consumable => consumable.pierce > 0 && consumable.pierceUsed < consumable.pierceCharges && (!consumable.singleUse || armoredHit));
  const pierce = supply ? supply.pierce : 0;
  if (supply) {
    supply.pierceUsed = add(supply.pierceUsed, 1, 'consumable.pierceUsed');
    emit(state, { type:'consume', source:supply.instanceId, target:weapon.instanceId, amount:1, remaining:supply.pierceCharges-supply.pierceUsed, detail:'pierce' });
    if (supply.singleUse) emit(state, {type:'consume',source:supply.instanceId,detail:'single-use',remaining:0});
  }
  emit(state, { type: 'attack', source: weapon.instanceId, target: primary.instanceId, detail: critical ? 'critical' : 'normal' });
  const power = (base: number): number => {
    const total = add(base, weapon.bonusDamage, 'weapon power');
    return critical ? Math.floor(integer(total * state.critMultiplierBps, 'critical damage product') / BPS) : total;
  };
  // Snapshot targets once, so a killed primary cannot shift the splash onto the wrong enemy.
  for (const enemy of alive.slice(0, weapon.targets)) hitEnemy(state, weapon, enemy, power(weapon.damage), pierce, 'base');
  if (weapon.splash > 0 && alive.length > weapon.targets) {
    hitEnemy(state, weapon, alive[weapon.targets], power(weapon.splash), pierce, 'splash');
  }
  if (weapon.thirdHitDamage > 0 && weapon.attacks % 3 === 0) {
    state.stats.comboTriggers = add(state.stats.comboTriggers, 1, 'stats.comboTriggers');
    emit(state, { type: 'combo', source: weapon.instanceId, target: primary.instanceId, amount: weapon.thirdHitDamage, detail: 'C04' });
    // C04 is a separate flat, armored hit on the original primary, not another base attack:
    // no bonus/crit/pierce, no retargeting a dead enemy, no new RNG or consumable charge.
    hitEnemy(state, weapon, primary, weapon.thirdHitDamage, 0, 'C04');
  }
  relayAfterShot(state, weapon);
}

function emergencyShielding(state: CombatState): void {
  if (state.shield !== 0 || state.shieldCap === 0) return;
  const supply = state.consumables.find(c => (c.emergencyShield || 0) > 0 && c.used < c.charges);
  if (!supply) return;
  const amount = Math.min(supply.emergencyShield || 0, state.shieldCap);
  supply.used = add(supply.used, 1, 'consumable.used');
  state.shield = amount;
  emit(state, {type:'shield',source:supply.instanceId,target:PLAYER,amount,remaining:supply.charges-supply.used,detail:'emergency'});
  emit(state, {type:'consume',source:supply.instanceId,detail:'single-use',remaining:0});
}

function attackPlayer(state: CombatState, enemy: EnemyState): void {
  const interval = enemy.enraged ? enemy.enragedCooldown as number : enemy.cooldown;
  enemy.nextAttackTick = add(state.tick, interval, 'enemy.nextAttackTick');
  emit(state, { type: 'attack', source: enemy.instanceId, target: PLAYER, amount: enemy.damage });
  emergencyShielding(state);
  const raw = Math.max(1, enemy.damage - state.reduction);
  const absorbed = Math.min(state.shield, raw);
  state.shield -= absorbed;
  state.stats.shieldAbsorbed = add(state.stats.shieldAbsorbed, absorbed, 'stats.shieldAbsorbed');
  if (absorbed > 0) {
    // Shield event amounts are signed deltas; statistics use positive absorbed amounts.
    emit(state, { type: 'shield', source: enemy.instanceId, target: PLAYER, amount: -absorbed, detail: 'absorb' });
  }
  const actual = Math.min(state.hp, raw - absorbed);
  state.hp -= actual;
  state.stats.damageTaken = add(state.stats.damageTaken, actual, 'stats.damageTaken');
  emit(state, { type: 'damage', source: enemy.instanceId, target: PLAYER, amount: actual, detail: 'enemy', raw: enemy.damage, blocked: Math.min(state.reduction, Math.max(0, enemy.damage - 1)), absorbed });
  if (actual > 0 && state.hp > 0) emergencyHealing(state);
}

/** Advance whole 100ms ticks without mutating the input snapshot.
 * events is only this call's batch; aggregate batches by seq for a replay.
 * A zero-tick or terminal step clears events but cannot spend resources or re-emit a terminal.
 */
export function stepCombat(state: CombatState, ticks = 1): CombatState {
  integer(ticks, 'ticks');
  validateState(state);
  const next = copyState(state);
  if (ticks === 0 || next.outcome !== 'active' || finish(next)) return next;
  for (let count = 0; count < ticks && next.outcome === 'active'; count++) {
    next.tick = add(next.tick, 1, 'tick');
    next.stats.ticks = next.tick;
    periodicHealing(next);
    for (const weapon of next.weapons) {
      if (weapon.nextAttackTick <= next.tick) attackWithWeapon(next, weapon);
    }
    for (const enemy of next.enemies) {
      if (next.hp <= 0) break;
      if (enemy.hp > 0 && enemy.nextAttackTick <= next.tick) attackPlayer(next, enemy);
    }
    finish(next);
  }
  return next;
}
