/** Pure domain contracts. No engine, clock, storage or platform dependencies. */
export interface Cell { x: number; y: number; }
export type Rotation = 0 | 90 | 180 | 270;
export type Category = 'weapon' | 'armor' | 'support' | 'consumable' | 'module' | 'device';
export interface WeaponSpec { damage: number; cooldown: number; targets: number; splash: number; }
export interface ItemEffects {
  shield?: number; emergencyShield?: number; reduction?: number; maxHp?: number; adjacentHasteBps?: number;
  killShield?: number; healThresholdBps?: number; emergencyHeal?: number;
  periodicHeal?: number; healEveryTicks?: number; healCharges?: number;
  pierceCharges?: number; pierce?: number; adjacentDamage?: number; critBps?: number;
}
export interface ItemDef {
  id: string; name: string; shortName: string; category: Category; shape: Cell[];
  color: string; description: string; weight: number; unlocked: boolean; lifetime?: 'single-use';
  weapon?: WeaponSpec; effects: ItemEffects;
}
export interface EnemyDef {
  id: string; name: string; hp: number; damage: number; cooldown: number; armor: number;
  color: string; behavior: 'normal' | 'heavy' | 'armored' | 'boss';
  enrageThresholdBps?: number; enragedCooldown?: number;
}
export interface ComboDef { id: string; name: string; description: string; limit: number; relay?: { delayTicks: number; maxPulses: number; }; }
export interface CircuitLoadout { anchorId: string; weaponIds: string[]; delayTicks: number; maxPulses: number; }
export interface CircuitRuntime extends CircuitLoadout { firedWeaponIds: string[]; pulses: number; }
export interface GameContent {
  version: string; randomNamespace?: string; items: ItemDef[]; enemies: EnemyDef[]; waves: string[][]; combos: ComboDef[];
  limits: { hasteBps: number; critBps: number; reduction: number; weaponBonus: number; shield: number; maxHp: number; killShield: number; deadlineTick: number; };
  event: { chanceBps: number; weaponWeightMultiplier: number; };
}
export interface ItemInstance { id: string; defId: string; spawnIndex: number; }
export interface Placement { instanceId: string; x: number; y: number; rotation: Rotation; }
export interface InventorySnapshot { placements: Placement[]; stash: string[]; }
export interface InventoryState extends InventorySnapshot {
  width: number; height: number; revision: number; instances: ItemInstance[]; history: InventorySnapshot[];
}
export type InventoryCommand =
  | { type: 'place'; instanceId: string; x: number; y: number; rotation: Rotation; expectedRevision: number; }
  | { type: 'stash'; instanceId: string; expectedRevision: number; }
  | { type: 'undo'; expectedRevision: number; };
export interface InventoryResult { ok: boolean; state: InventoryState; reason?: string; swappedId?: string; }
export interface ComboActivation { id: string; name: string; anchorId: string; participants: string[]; description: string; }
export interface WeaponLoadout {
  instanceId: string; defId: string; spawnIndex: number; damage: number; cooldown: number;
  targets: number; splash: number; bonusDamage: number; hasteBps: number; thirdHitDamage: number;
}
export interface ConsumableLoadout {
  instanceId: string; spawnIndex: number; defId?: string; singleUse?: boolean; emergencyShield?: number; emergencyHeal: number; thresholdBps: number;
  periodicHeal: number; everyTicks: number; charges: number; pierce: number; pierceCharges: number;
}
export interface BattleLoadout {
  maxHp: number; initialShield: number; reduction: number; critBps: number; critMultiplierBps: number;
  shieldCap: number; killShield: number; killShieldCap: number;
  weapons: WeaponLoadout[]; consumables: ConsumableLoadout[]; combos: ComboActivation[]; circuits?: CircuitLoadout[]; capped: string[];
}
export interface WeaponRuntime extends WeaponLoadout { nextAttackTick: number; attacks: number; }
export interface ConsumableRuntime extends ConsumableLoadout { used: number; pierceUsed: number; }
export interface EnemyState extends EnemyDef { instanceId: string; spawnIndex: number; maxHp: number; nextAttackTick: number; enraged: boolean; }
export interface DamageStats { base: number; combo: number; raw: number; overkill: number; attacks: number; }
export interface CombatStats {
  weapons: Record<string, DamageStats>; damageTaken: number; shieldAbsorbed: number; healing: number;
  kills: number; comboTriggers: number; ticks: number;
}
export interface CombatEvent {
  seq: number; tick: number; type: 'attack' | 'damage' | 'heal' | 'shield' | 'kill' | 'enrage' | 'combo' | 'relay' | 'consume' | 'terminal';
  source?: string; target?: string; amount?: number; detail?: string;
  raw?: number; blocked?: number; absorbed?: number; remaining?: number;
}
export type CombatOutcome = 'active' | 'victory' | 'defeat' | 'timeout';
export interface CombatState {
  tick: number; deadlineTick: number; hp: number; maxHp: number; shield: number; reduction: number;
  critBps: number; critMultiplierBps: number; shieldCap: number; killShield: number; killShieldCap: number;
  recoveredShield: number; rng: number; weapons: WeaponRuntime[]; consumables: ConsumableRuntime[];
  enemies: EnemyState[]; circuits: CircuitRuntime[]; outcome: CombatOutcome; stats: CombatStats; nextEventSeq: number;
  events: CombatEvent[];
}
export type RunPhase = 'preparation' | 'combat' | 'loot' | 'defeat' | 'settlement';
export interface LootOption { id: string; itemIds: string[]; }
export interface WaveReport { wave: number; outcome: CombatOutcome; stats: CombatStats; remainingHp: number; }
export interface Settlement { key: string; reason: 'victory' | 'defeat' | 'timeout' | 'abandoned'; baseCoins: number; claimed: boolean; }
export interface RunState {
  researchUnlocks?:string[];
  id: string; seed: number; contentVersion: string; revision: number; phase: RunPhase; wave: number;
  victories: number; inventory: InventoryState; nextSpawnIndex: number; hp: number | null;
  combat: CombatState | null; loot: LootOption[]; lootEvent: boolean; reports: WaveReport[];
  settlement: Settlement | null; processedCommandIds: string[];
}
