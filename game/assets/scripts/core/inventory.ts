import { Cell, GameContent, InventoryCommand, InventoryResult, InventorySnapshot, InventoryState, ItemDef, ItemInstance, Placement, Rotation } from './types';

const DIRECTIONS: Cell[] = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
const keyOf = (cell: Cell): string => cell.x + ',' + cell.y;
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const isId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isIndex = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isSize = (value: unknown): value is number => isIndex(value) && value > 0;
const isRotation = (value: unknown): value is Rotation => value === 0 || value === 90 || value === 180 || value === 270;
const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** Clockwise quarter turns, followed by bounding-box normalization and y/x order.
 * Invalid shapes are rejected, not silently repaired by removing duplicate cells.
 */
export function normalizeShape(cells: Cell[], rotation: Rotation = 0): Cell[] {
  if (!isRotation(rotation)) throw new RangeError('invalid rotation: expected 0, 90, 180 or 270');
  if (!Array.isArray(cells) || cells.length === 0) throw new TypeError('shape must be a non-empty array');
  const seen = new Set<string>();
  const rotated: Cell[] = [];
  let minX = Infinity;
  let minY = Infinity;
  for (const cell of cells) {
    if (!isObject(cell) || !Number.isSafeInteger(cell.x) || !Number.isSafeInteger(cell.y)) {
      throw new TypeError('shape coordinates must be safe integers');
    }
    const key = keyOf(cell);
    if (seen.has(key)) throw new TypeError('shape contains duplicate cells');
    seen.add(key);
    let x = cell.x;
    let y = cell.y;
    if (rotation === 90) { x = -cell.y; y = cell.x; }
    else if (rotation === 180) { x = -cell.x; y = -cell.y; }
    else if (rotation === 270) { x = cell.y; y = -cell.x; }
    rotated.push({ x, y });
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
  }
  const normalized = rotated.map(cell => {
    const x = cell.x - minX;
    const y = cell.y - minY;
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) throw new RangeError('shape coordinate overflow');
    return { x, y };
  });
  const remaining = new Set(normalized.map(keyOf));
  const queue: Cell[] = [normalized[0]];
  remaining.delete(keyOf(queue[0]));
  for (let index = 0; index < queue.length; index++) {
    for (const direction of DIRECTIONS) {
      const cell = { x: queue[index].x + direction.x, y: queue[index].y + direction.y };
      if (remaining.delete(keyOf(cell))) queue.push(cell);
    }
  }
  if (remaining.size !== 0) throw new TypeError('shape must be four-connected');
  return normalized.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Returns actual occupied cells; empty corners of the bounding box stay empty. */
export function occupiedCells(placement: Placement, def: ItemDef): Cell[] {
  if (!isObject(placement) || !isId(placement.instanceId) || !Number.isSafeInteger(placement.x) || !Number.isSafeInteger(placement.y)) {
    throw new TypeError('invalid placement: instanceId and integer coordinates required');
  }
  // Check explicitly: normalizeShape's default must not accept a missing saved rotation.
  if (!isRotation(placement.rotation)) throw new RangeError('invalid rotation: expected 0, 90, 180 or 270');
  if (!isObject(def)) throw new TypeError('invalid item definition');
  return normalizeShape(def.shape, placement.rotation).map(cell => {
    const x = placement.x + cell.x;
    const y = placement.y + cell.y;
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) throw new RangeError('placement coordinate overflow');
    return { x, y };
  });
}

function instanceErrors(instances: ItemInstance[]): string[] {
  if (!Array.isArray(instances)) return ['instances must be an array'];
  const errors: string[] = [];
  const ids = new Set<string>();
  const spawnIndices = new Set<number>();
  for (let index = 0; index < instances.length; index++) {
    const item = instances[index];
    if (!isObject(item) || !isId(item.id) || !isId(item.defId) || !isIndex(item.spawnIndex)) {
      errors.push('instances/' + index + ': invalid id, defId or spawnIndex');
      continue;
    }
    if (ids.has(item.id)) errors.push('instances/' + index + ': duplicate instance ' + item.id);
    ids.add(item.id);
    if (spawnIndices.has(item.spawnIndex)) errors.push('instances/' + index + ': duplicate spawnIndex ' + item.spawnIndex);
    spawnIndices.add(item.spawnIndex);
  }
  return errors;
}

export function createInventory(instances: ItemInstance[], width = 5, height = 6): InventoryState {
  if (!isSize(width) || !isSize(height)) throw new RangeError('inventory dimensions must be positive safe integers');
  const errors = instanceErrors(instances);
  if (errors.length) throw new TypeError(errors.join('; '));
  return {
    width, height, revision: 0,
    instances: instances.map(item => ({ id: item.id, defId: item.defId, spawnIndex: item.spawnIndex })),
    placements: [], stash: instances.map(item => item.id), history: [],
  };
}

/** Checks both the live partition and every undo snapshot against the same instances.
 * A corrupt snapshot must never become a way to lose or resurrect an instance.
 */
export function validateInventory(state: InventoryState, content: GameContent): string[] {
  if (!isObject(state)) return ['inventory must be an object'];
  const errors: string[] = [];
  const dimensionsValid = isSize(state.width) && isSize(state.height);
  if (!dimensionsValid) errors.push('inventory dimensions must be positive safe integers');
  if (!isIndex(state.revision)) errors.push('revision must be a non-negative safe integer');
  errors.push(...instanceErrors(state.instances));
  const instances = new Map<string, ItemInstance>();
  if (Array.isArray(state.instances)) {
    for (const item of state.instances) {
      if (isObject(item) && isId(item.id) && isId(item.defId) && isIndex(item.spawnIndex)) instances.set(item.id, item);
    }
  }
  const definitions = new Map<string, ItemDef>();
  if (!isObject(content) || !Array.isArray(content.items)) errors.push('content.items must be an array');
  else {
    for (let index = 0; index < content.items.length; index++) {
      const def = content.items[index];
      if (!isObject(def) || !isId(def.id)) { errors.push('content.items/' + index + ': invalid definition'); continue; }
      if (definitions.has(def.id)) errors.push('content.items: duplicate definition ' + def.id);
      definitions.set(def.id, def);
      try { normalizeShape(def.shape); }
      catch (error) { errors.push('content.items/' + def.id + ': ' + messageOf(error)); }
    }
  }
  for (const item of instances.values()) {
    if (!definitions.has(item.defId)) errors.push('instance/' + item.id + ': unknown definition ' + item.defId);
  }

  const checkLayout = (layout: InventorySnapshot, path: string): void => {
    if (!isObject(layout)) { errors.push(path + ': invalid snapshot'); return; }
    const located = new Set<string>();
    const occupied = new Map<string, string>();
    const locate = (id: unknown): void => {
      if (!isId(id)) { errors.push(path + ': invalid instance reference'); return; }
      if (!instances.has(id)) errors.push(path + ': unknown instance ' + id);
      if (located.has(id)) errors.push(path + ': duplicate location for ' + id);
      located.add(id);
    };
    if (!Array.isArray(layout.placements)) errors.push(path + '.placements must be an array');
    else for (const placement of layout.placements) {
      if (!isObject(placement)) { errors.push(path + ': invalid placement'); continue; }
      locate(placement.instanceId);
      if (!Number.isSafeInteger(placement.x) || !Number.isSafeInteger(placement.y) || !isRotation(placement.rotation)) {
        errors.push(path + '/' + placement.instanceId + ': invalid coordinates or rotation');
        continue;
      }
      const instance = instances.get(placement.instanceId);
      const def = instance && definitions.get(instance.defId);
      if (!def) continue;
      try {
        for (const cell of occupiedCells(placement, def)) {
          if (dimensionsValid && (cell.x < 0 || cell.y < 0 || cell.x >= state.width || cell.y >= state.height)) {
            errors.push(path + '/' + placement.instanceId + ': out-of-bounds');
          }
          const key = keyOf(cell);
          const previous = occupied.get(key);
          if (previous !== undefined) errors.push(path + ': overlap at ' + key + ' (' + previous + ', ' + placement.instanceId + ')');
          occupied.set(key, placement.instanceId);
        }
      } catch (error) { errors.push(path + '/' + placement.instanceId + ': ' + messageOf(error)); }
    }
    if (!Array.isArray(layout.stash)) errors.push(path + '.stash must be an array');
    else for (const id of layout.stash) locate(id);
    for (const id of instances.keys()) if (!located.has(id)) errors.push(path + ': missing instance ' + id);
  };
  checkLayout(state, 'inventory');
  if (!Array.isArray(state.history)) errors.push('history must be an array');
  else for (let index = 0; index < state.history.length; index++) checkLayout(state.history[index], 'history/' + index);
  return errors;
}

function snapshotOf(state: InventorySnapshot): InventorySnapshot {
  return { placements: state.placements.map(placement => ({ ...placement })), stash: state.stash.slice() };
}
function rejected(state: InventoryState, reason: string): InventoryResult { return { ok: false, state, reason }; }
function stateProblem(state: InventoryState, content: GameContent): string | undefined {
  const errors = validateInventory(state, content);
  return errors.length ? 'invalid-inventory: ' + errors.join('; ') : undefined;
}

/** All commits are immutable and increment the current revision, including undo. */
export function transactInventory(state: InventoryState, cmd: InventoryCommand, content: GameContent): InventoryResult {
  const problem = stateProblem(state, content);
  if (problem) return rejected(state, problem);
  if (!isObject(cmd) || !['place', 'stash', 'undo'].includes(cmd.type) || !isIndex(cmd.expectedRevision)) return rejected(state, 'invalid-command');
  if (cmd.expectedRevision !== state.revision) return rejected(state, 'stale-revision');
  if (state.revision === Number.MAX_SAFE_INTEGER) return rejected(state, 'revision-exhausted');
  if (cmd.type === 'undo') {
    if (!state.history.length) return rejected(state, 'nothing-to-undo');
    const previous = snapshotOf(state.history[state.history.length - 1]);
    return { ok: true, state: { ...state, ...previous, revision: state.revision + 1, history: state.history.slice(0, -1) } };
  }
  if (!isId(cmd.instanceId)) return rejected(state, 'invalid-instance-id');
  const instance = state.instances.find(item => item.id === cmd.instanceId);
  if (!instance) return rejected(state, 'unknown-instance');
  const original = state.placements.find(placement => placement.instanceId === cmd.instanceId);
  const layout = snapshotOf(state);
  let swappedId: string | undefined;
  if (cmd.type === 'stash') {
    if (!original) return rejected(state, 'already-in-stash');
    layout.placements = layout.placements.filter(placement => placement.instanceId !== cmd.instanceId);
    layout.stash.push(cmd.instanceId);
  } else {
    if (!isRotation(cmd.rotation)) return rejected(state, 'invalid-rotation');
    if (!Number.isSafeInteger(cmd.x) || !Number.isSafeInteger(cmd.y)) return rejected(state, 'invalid-coordinates');
    const target: Placement = { instanceId: cmd.instanceId, x: cmd.x, y: cmd.y, rotation: cmd.rotation };
    const definitions = new Map(content.items.map(def => [def.id, def]));
    let targetCells: Cell[];
    try { targetCells = occupiedCells(target, definitions.get(instance.defId)!); }
    catch (error) { return rejected(state, 'invalid-placement: ' + messageOf(error)); }
    if (targetCells.some(cell => cell.x < 0 || cell.y < 0 || cell.x >= state.width || cell.y >= state.height)) return rejected(state, 'out-of-bounds');
    const targetKeys = new Set(targetCells.map(keyOf));
    const instanceDefinitions = new Map(state.instances.map(item => [item.id, definitions.get(item.defId)!]));
    const conflicts = state.placements.filter(placement => placement.instanceId !== cmd.instanceId &&
      occupiedCells(placement, instanceDefinitions.get(placement.instanceId)!).some(cell => targetKeys.has(keyOf(cell))));
    if (conflicts.length > 1) return rejected(state, 'multiple-conflicts');
    const other = conflicts[0];
    swappedId = other && other.instanceId;
    if (original) {
      layout.placements = layout.placements.map(placement => {
        if (placement.instanceId === cmd.instanceId) return target;
        if (other && placement.instanceId === other.instanceId) {
          return { ...placement, x: original.x, y: original.y }; // B keeps B's orientation.
        }
        return placement;
      });
    } else {
      const stashIndex = layout.stash.indexOf(cmd.instanceId);
      if (other) {
        layout.stash[stashIndex] = other.instanceId; // Replace, never append/sort the displaced item.
        layout.placements = layout.placements.map(placement => placement.instanceId === other.instanceId ? target : placement);
      } else {
        layout.stash.splice(stashIndex, 1);
        layout.placements.push(target);
      }
    }
  }
  const next: InventoryState = {
    ...state, ...layout, revision: state.revision + 1,
    history: [...state.history, snapshotOf(state)],
  };
  const nextProblem = stateProblem(next, content);
  if (nextProblem) return rejected(state, (swappedId ? 'swap-invalid: ' : '') + nextProblem);
  return swappedId === undefined ? { ok: true, state: next } : { ok: true, state: next, swappedId };
}

/** Loot/reward boundary: append all incoming instances to stash, then close undo. */
export function addInstances(state: InventoryState, instances: ItemInstance[], content: GameContent): InventoryResult {
  const problem = stateProblem(state, content);
  if (problem) return rejected(state, problem);
  if (state.revision === Number.MAX_SAFE_INTEGER) return rejected(state, 'revision-exhausted');
  const errors = instanceErrors(instances);
  if (errors.length) return rejected(state, 'invalid-instances: ' + errors.join('; '));
  const next: InventoryState = {
    ...state, ...snapshotOf(state), revision: state.revision + 1, history: [],
    instances: [...state.instances, ...instances.map(item => ({ id: item.id, defId: item.defId, spawnIndex: item.spawnIndex }))],
    stash: [...state.stash, ...instances.map(item => item.id)],
  };
  const nextProblem = stateProblem(next, content);
  return nextProblem ? rejected(state, nextProblem) : { ok: true, state: next };
}

/** Sets the current layout as the checkpoint; phase/revision gates belong to the run. */
export function beginPreparation(state: InventoryState): InventoryState {
  return { ...state, ...snapshotOf(state), history: [] };
}
