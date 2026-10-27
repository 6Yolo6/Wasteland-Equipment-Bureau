import { BattleLoadout, Cell, CircuitLoadout, ComboActivation, ComboDef, ConsumableLoadout, GameContent, InventoryState, ItemDef, ItemEffects, ItemInstance, WeaponLoadout } from './types';
import { occupiedCells, validateInventory } from './inventory';

interface EquippedItem { instance: ItemInstance; def: ItemDef; cells: Cell[]; }
interface ComboCandidate { anchor: EquippedItem; participants: EquippedItem[]; recipients: EquippedItem[]; weaponCandidates?: number; }
const DIRECTIONS: Cell[] = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
const keyOf = (cell: Cell): string => cell.x + ',' + cell.y;
// Do not depend on the host's locale or on object/placement enumeration order.
const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const compareItems = (a: EquippedItem, b: EquippedItem): number => a.instance.spawnIndex - b.instance.spawnIndex || compareText(a.instance.id, b.instance.id);

function equippedItems(inventory: InventoryState, content: GameContent): EquippedItem[] {
  const errors = validateInventory(inventory, content);
  if (errors.length) throw new TypeError('invalid-inventory: ' + errors.join('; '));
  const instances = new Map(inventory.instances.map(instance => [instance.id, instance]));
  const definitions = new Map(content.items.map(def => [def.id, def]));
  return inventory.placements.map(placement => {
    const instance = instances.get(placement.instanceId)!;
    const def = definitions.get(instance.defId)!;
    return { instance, def, cells: occupiedCells(placement, def) };
  }).sort(compareItems);
}

function adjacencyOf(items: EquippedItem[]): Map<string, EquippedItem[]> {
  const grid = new Map<string, EquippedItem>();
  for (const item of items) for (const cell of item.cells) grid.set(keyOf(cell), item);
  const adjacency = new Map<string, EquippedItem[]>();
  for (const item of items) {
    const neighbors = new Set<EquippedItem>();
    for (const cell of item.cells) for (const direction of DIRECTIONS) {
      const other = grid.get(keyOf({ x: cell.x + direction.x, y: cell.y + direction.y }));
      if (other && other !== item) neighbors.add(other);
    }
    adjacency.set(item.instance.id, Array.from(neighbors).sort(compareItems));
  }
  return adjacency;
}

/** Undirected four-neighbor graph, one edge per pair of distinct placed instances.
 * Both map insertion order and neighbor order use spawnIndex, with an ID tie-break.
 */
export function buildAdjacency(inventory: InventoryState, content: GameContent): Map<string, string[]> {
  const graph = adjacencyOf(equippedItems(inventory, content));
  const result = new Map<string, string[]>();
  for (const [id, neighbors] of graph) result.set(id, neighbors.map(item => item.instance.id));
  return result;
}

function requireInteger(value: number, name: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(name + ': expected a safe integer >= ' + minimum);
}
function add(a: number, b: number, name: string): number {
  const result = a + b;
  if (!Number.isSafeInteger(result)) throw new RangeError(name + ': integer overflow');
  return result;
}
/** WeaponLoadout.cooldown remains the BASE cooldown for combat's scheduler.
 * Presentation can use this helper without applying haste to an already shortened value.
 */
export function cooldownUnits(weapon: Pick<WeaponLoadout, 'cooldown' | 'hasteBps'>): number {
  if (!weapon || typeof weapon !== 'object') throw new TypeError('invalid weapon');
  requireInteger(weapon.cooldown, 'weapon.cooldown', 1);
  requireInteger(weapon.hasteBps, 'weapon.hasteBps');
  if (weapon.hasteBps > 10000) throw new RangeError('weapon.hasteBps must not exceed 10000');
  const product = weapon.cooldown * (10000 - weapon.hasteBps);
  requireInteger(product, 'weapon cooldown product');
  return Math.max(30000, product);
}

/** First attack tick. Repeated attacks retain the fractional remainder, not this rounded interval. */
export function effectiveCooldown(weapon: Pick<WeaponLoadout, 'cooldown' | 'hasteBps'>): number {
  return Math.ceil(cooldownUnits(weapon) / 10000);
}
/** Mean seconds per attack; integer fixed-point scheduling keeps all battery haste. */
export function attackSeconds(weapon: Pick<WeaponLoadout, 'cooldown' | 'hasteBps'>): number {
  return cooldownUnits(weapon) / 100000;
}
function validateEffects(content: GameContent): void {
  if (!content.limits || typeof content.limits !== 'object') throw new TypeError('invalid loadout limits');
  const limits: (keyof GameContent['limits'])[] = ['hasteBps', 'critBps', 'reduction', 'weaponBonus', 'shield', 'maxHp', 'killShield'];
  for (const key of limits) requireInteger(content.limits[key], 'limits.' + key, key === 'maxHp' ? 1 : 0);
  if (content.limits.hasteBps > 10000 || content.limits.critBps > 10000) throw new RangeError('basis-point caps must not exceed 10000');
  if (!Array.isArray(content.combos)) throw new TypeError('combos must be an array');
  const ruleIds = new Set<string>();
  for (const rule of content.combos) {
    if (!rule || typeof rule.id !== 'string' || !rule.id || typeof rule.name !== 'string' || typeof rule.description !== 'string') throw new TypeError('invalid combo definition');
    if (ruleIds.has(rule.id)) throw new TypeError('duplicate combo definition: ' + rule.id);
    ruleIds.add(rule.id);
    requireInteger(rule.limit, 'combo.' + rule.id + '.limit');
    if (rule.relay) {
      if (rule.id !== 'C02') throw new TypeError('Only C02 defines a relay');
      requireInteger(rule.relay.delayTicks, 'relay.delayTicks', 1);
      requireInteger(rule.relay.maxPulses, 'relay.maxPulses', 1);
    }
  }
  for (const def of content.items) {
    if (!def.effects || typeof def.effects !== 'object' || Array.isArray(def.effects)) throw new TypeError(def.id + ': invalid effects');
    for (const [key, value] of Object.entries(def.effects)) if (value !== undefined) requireInteger(value, def.id + '.' + key);
    if ((def.effects.healThresholdBps || 0) > 10000) throw new RangeError(def.id + ': invalid heal threshold');
    if ((def.effects.periodicHeal || 0) > 0) requireInteger(def.effects.healEveryTicks!, def.id + '.healEveryTicks', 1);
    if (def.category === 'weapon') {
      if (!def.weapon) throw new TypeError(def.id + ': missing weapon specification');
      requireInteger(def.weapon.damage, def.id + '.damage', 1);
      requireInteger(def.weapon.cooldown, def.id + '.cooldown', 1);
      requireInteger(def.weapon.targets, def.id + '.targets', 1);
      requireInteger(def.weapon.splash, def.id + '.splash');
    }
  }
}

function firstById(neighbors: EquippedItem[], defId: string): EquippedItem | undefined {
  return neighbors.filter(item => item.def.id === defId).sort((a, b) => compareText(a.instance.id, b.instance.id))[0];
}

function candidateFor(rule: ComboDef, anchor: EquippedItem, neighbors: EquippedItem[]): ComboCandidate | undefined {
  switch (rule.id) {
    case 'C01': {
      if (anchor.def.category !== 'weapon') return undefined;
      const plate = firstById(neighbors, 'I05');
      return plate ? { anchor, participants: [anchor, plate], recipients: [anchor] } : undefined;
    }
    case 'C02': {
      if (anchor.def.id !== 'I12') return undefined;
      const battery = firstById(neighbors, 'I07');
      const weapons = neighbors.filter(item => item.def.category === 'weapon').sort(compareItems);
      if (!battery || weapons.length < 2) return undefined;
      const recipients = weapons.slice(0, 2);
      return { anchor, participants: [anchor, battery, ...recipients], recipients, weaponCandidates: weapons.length };
    }
    case 'C03': {
      if (anchor.def.id !== 'I09') return undefined;
      const saline = firstById(neighbors, 'I10');
      const medicine = firstById(neighbors, 'I11');
      return saline && medicine ? { anchor, participants: [anchor, saline, medicine], recipients: [anchor] } : undefined;
    }
    case 'C04': {
      if (anchor.def.id !== 'I03') return undefined;
      const recycler = firstById(neighbors, 'I08');
      const iron = firstById(neighbors, 'I13');
      return recycler && iron ? { anchor, participants: [anchor, recycler, iron], recipients: [anchor] } : undefined;
    }
    default: return undefined;
  }
}

/** A fresh, pure projection of the final layout. No runtime charges or HP are spent
 * here: combat owns those counters and must retain them on revive.
 */
export function evaluateLoadout(inventory: InventoryState, content: GameContent, baseMaxHp = 120): BattleLoadout {
  requireInteger(baseMaxHp, 'baseMaxHp', 1);
  const items = equippedItems(inventory, content);
  validateEffects(content);
  const adjacency = adjacencyOf(items);
  const capped: string[] = [];
  const cap = (scope: string, value: number, maximum: number): number => {
    if (value > maximum) capped.push(scope + ': ' + value + ' -> ' + maximum);
    return Math.min(value, maximum);
  };
  const total = (kind: keyof ItemEffects): number => items.reduce((value, item) => add(value, item.def.effects[kind] || 0, kind), 0);
  const maxHp = cap('maxHp', add(baseMaxHp, total('maxHp'), 'maxHp'), content.limits.maxHp);
  const initialShield = cap('initialShield', total('shield'), content.limits.shield);
  const reduction = cap('reduction', total('reduction'), content.limits.reduction);
  const critBps = cap('critBps', total('critBps'), content.limits.critBps);
  const killShield = cap('killShield', total('killShield'), content.limits.killShield);
  const combos: ComboActivation[] = [];
  const circuits: CircuitLoadout[] = [];
  const comboDamage = new Map<string, number>();
  const comboHaste = new Map<string, number>();
  const comboHealing = new Map<string, number>();
  const thirdHitDamage = new Map<string, number>();
  const increase = (values: Map<string, number>, id: string, amount: number): void => { values.set(id, add(values.get(id) || 0, amount, id)); };

  // Rule order, anchor order, participant selection and quantity caps are separate
  // from stat aggregation. Losing a candidate cannot change earlier recipients.
  for (const rule of content.combos.slice().sort((a, b) => compareText(a.id, b.id))) {
    const candidates: ComboCandidate[] = [];
    const anchors = new Set<string>();
    for (const item of items) {
      const candidate = candidateFor(rule, item, adjacency.get(item.instance.id)!);
      if (candidate && !anchors.has(item.instance.id)) { anchors.add(item.instance.id); candidates.push(candidate); }
    }
    cap('combo:' + rule.id, candidates.length, rule.limit);
    for (const candidate of candidates.slice(0, rule.limit)) {
      const anchorId = candidate.anchor.instance.id;
      combos.push({
        id: rule.id, name: rule.name, anchorId,
        participants: candidate.participants.map(item => item.instance.id).sort(compareText),
        description: rule.description,
      });
      if (rule.id === 'C01') increase(comboDamage, anchorId, 2);
      else if (rule.id === 'C02') {
        cap('combo:C02/' + anchorId + '/weapons', candidate.weaponCandidates!, 2);
        for (const recipient of candidate.recipients) increase(comboHaste, recipient.instance.id, 1000);
        if (rule.relay) circuits.push({ anchorId, weaponIds: candidate.recipients.map(item => item.instance.id), ...rule.relay });
      } else if (rule.id === 'C03') increase(comboHealing, anchorId, 6);
      else if (rule.id === 'C04') thirdHitDamage.set(anchorId, 5);
    }
  }

  const weapons: WeaponLoadout[] = [];
  const consumables: ConsumableLoadout[] = [];
  for (const item of items) {
    const id = item.instance.id;
    const effects = item.def.effects;
    if (item.def.category === 'weapon') {
      const spec = item.def.weapon!;
      let haste = 0;
      let batteryHaste = 0;
      let batteryMaximum = 0;
      let damage = 0;
      let ironDamage = 0;
      for (const neighbor of adjacency.get(id)!) {
        const adjacentHaste = neighbor.def.effects.adjacentHasteBps || 0;
        const adjacentDamage = neighbor.def.effects.adjacentDamage || 0;
        if (neighbor.def.id === 'I07') {
          batteryHaste = add(batteryHaste, adjacentHaste, 'I07.hasteBps');
          batteryMaximum = Math.max(batteryMaximum, adjacentHaste);
        } else haste = add(haste, adjacentHaste, 'hasteBps');
        if (neighbor.def.id === 'I13') ironDamage = add(ironDamage, adjacentDamage, 'I13.bonusDamage');
        else damage = add(damage, adjacentDamage, 'bonusDamage');
      }
      const scope = 'weapon:' + id;
      haste = add(haste, cap(scope + '/I07.hasteBps', batteryHaste, batteryMaximum), 'hasteBps');
      damage = add(damage, cap(scope + '/I13.bonusDamage', ironDamage, 3), 'bonusDamage');
      const hasteBps = cap(scope + '/hasteBps', add(haste, comboHaste.get(id) || 0, 'hasteBps'), content.limits.hasteBps);
      const bonusDamage = cap(scope + '/bonusDamage', add(damage, comboDamage.get(id) || 0, 'bonusDamage'), content.limits.weaponBonus);
      effectiveCooldown({ cooldown: spec.cooldown, hasteBps }); // Validate the derived interval, but keep the base in the contract.
      weapons.push({
        instanceId: id, defId: item.def.id, spawnIndex: item.instance.spawnIndex,
        damage: spec.damage, cooldown: spec.cooldown,
        targets: spec.targets, splash: spec.splash, bonusDamage, hasteBps,
        thirdHitDamage: thirdHitDamage.get(id) || 0,
      });
    }
    if (item.def.category === 'consumable') {
      consumables.push({
        instanceId: id, spawnIndex: item.instance.spawnIndex, ...(item.def.lifetime==='single-use'?{defId:item.def.id,singleUse:true}:{}),
        ...(effects.emergencyShield?{emergencyShield:effects.emergencyShield}:{}),
        emergencyHeal: add(effects.emergencyHeal || 0, comboHealing.get(id) || 0, 'emergencyHeal'),
        thresholdBps: effects.healThresholdBps || 0,
        periodicHeal: effects.periodicHeal || 0, everyTicks: effects.healEveryTicks || 0,
        charges: effects.healCharges || 0, pierce: effects.pierce || 0, pierceCharges: effects.pierceCharges || 0,
      });
    }
  }
  return {
    maxHp, initialShield, reduction, critBps, critMultiplierBps: 15000,
    shieldCap: content.limits.shield, killShield, killShieldCap: content.limits.killShield,
    weapons, consumables, combos, circuits, capped: Array.from(new Set(capped)).sort(compareText),
  };
}
