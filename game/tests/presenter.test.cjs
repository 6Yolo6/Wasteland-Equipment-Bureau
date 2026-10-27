'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { GamePresenter } = require('../../.test-build/presentation/GamePresenter.js');
const { GameSession } = require('../../.test-build/application/session.js');
const { DEVELOPMENT_CONTENT, validateContent } = require('../../.test-build/content/catalog.js');
const { occupiedCells, validateInventory } = require('../../.test-build/core/inventory.js');
const { evaluateLoadout } = require('../../.test-build/core/loadout.js');

// No engine, browser, controller mocks, onClick shortcuts, or writes to session state.
// Empty board cells are not hit regions; these are the controller's logical canvas cells.
const cellPoint = (x, y) => ({ x: 48 + x * 72 + 34, y: 416 + y * 72 + 34 });
const center = hit => ({ x: hit.x + hit.w / 2, y: hit.y + hit.h / 2 });
const clone = value => structuredClone(value);
class StubPainter {
  constructor() { this.calls = []; this.begins = 0; this.ends = 0; }
  begin() { this.calls = []; this.begins++; }
  end() { this.ends++; }
  rect(...args) { this.calls.push(['rect', ...args]); }
  line(...args) { this.calls.push(['line', ...args]); }
  circle(...args) { this.calls.push(['circle', ...args]); }
  polygon(...args) { this.calls.push(['polygon', ...args]); }
  text(...args) { this.calls.push(['text', ...args]); }
}
function render(h) {
  h.presenter.update(0); // Observe phase transitions just as a foreground frame does.
  h.presenter.draw(h.painter);
  assert.equal(h.presenter.session, h.session, 'the controller must keep the real session');
  assert.equal(h.painter.begins, h.painter.ends);
  return h;
}
function harness(content = DEVELOPMENT_CONTENT) {
  const presenter = new GamePresenter(content);
  assert.ok(presenter.session instanceof GameSession);
  return render({ presenter, painter: new StubPainter(), session: presenter.session, content });
}
function region(h, id) {
  const hit = h.presenter.hits.find(hit => hit.id === id);
  assert.ok(hit, 'missing hit region: ' + id + '; visible: ' + h.presenter.hits.map(hit => hit.id).join(', '));
  return hit;
}
function rawTap(h, point) {
  h.presenter.pointerDown(point.x, point.y);
  h.presenter.pointerUp(point.x, point.y);
}
function tap(h, point) { rawTap(h, point); return render(h); }
function click(h, id, allowDisabled = false) {
  const hit = region(h, id);
  if (!allowDisabled) assert.equal(hit.enabled, true, id + ' should be enabled');
  return tap(h, center(hit));
}
function start(h = harness(), starter = 'I01') {
  click(h, 'starter-' + starter);
  click(h, 'start-run');
  if(h.presenter.guidePage!==null) click(h, 'guide-close'); // Actual input, not a tutorial-state override.
  assert.equal(h.presenter.screen, 'run');
  assert.equal(h.session.state.run.phase, 'preparation');
  return h;
}
const inventory = h => h.session.state.run.inventory;
const savedLayout = h => clone({ placements: inventory(h).placements, stash: inventory(h).stash });
const instanceId = (h, defId) => {
  const instance = inventory(h).instances.find(item => item.defId === defId);
  assert.ok(instance, 'missing fixture definition ' + defId);
  return instance.id;
};
function itemHit(h, id) {
  const hit = h.presenter.hits.find(hit => hit.itemId === id);
  assert.ok(hit, 'item is not currently reachable through the rendered UI: ' + id);
  return hit;
}
function select(h, id) { return click(h, itemHit(h, id).id); }
function placeByClick(h, id, x, y, rotation = 0) {
  select(h, id);
  for (let turn = 0; h.presenter.rotation !== rotation && turn < 4; turn++) click(h, 'rotate');
  assert.equal(h.presenter.rotation, rotation);
  tap(h, cellPoint(x, y));
  const placed = inventory(h).placements.find(p => p.instanceId === id);
  assert.deepEqual(placed, { instanceId: id, x, y, rotation });
  return h;
}
function beginDrag(h, sourceRegion, target) {
  const source = center(region(h, sourceRegion));
  h.presenter.pointerDown(source.x, source.y);
  h.presenter.pointerMove(target.x, target.y);
  return render(h);
}
function drop(h, point) { h.presenter.pointerUp(point.x, point.y); return render(h); }
function drag(h, sourceRegion, target) { beginDrag(h, sourceRegion, target); return drop(h, target); }
const texts = h => h.painter.calls.filter(call => call[0] === 'text').map(call => call[1]);
function conserved(h) {
  const inv = inventory(h);
  assert.deepEqual(validateInventory(inv, h.content), []);
  assert.deepEqual([...inv.stash, ...inv.placements.map(p => p.instanceId)].sort(), inv.instances.map(i => i.id).sort());
}
function dispatch(h, action) {
  const result = h.session.dispatch(action);
  assert.equal(result.ok, true, result.reason);
  render(h);
  conserved(h);
  return result;
}
function inventoryCommand(h, command) {
  return dispatch(h, { type: 'inventory', command: { ...command, expectedRevision: inventory(h).revision } });
}
function playCurrentBattle(h) {
  assert.equal(h.session.state.run.phase, 'combat');
  let frames = 0;
  while (h.session.state.run.phase === 'combat' && frames++ < h.content.limits.deadlineTick + 2) h.presenter.update(0.1);
  assert.notEqual(h.session.state.run.phase, 'combat', 'the bounded simulation must reach a terminal phase');
  return render(h);
}
function armed(h = start()) {
  placeByClick(h, instanceId(h, 'I01'), 0, 0);
  click(h, 'start-combat');
  assert.equal(h.session.state.run.phase, 'combat');
  return h;
}
// Deliberately weak enemies isolate pagination and navigation, NOT balance or a
// default-content victory claim. Items, five waves and loot commands remain real.
function paginationContent() {
  return {
    ...DEVELOPMENT_CONTENT,
    version: DEVELOPMENT_CONTENT.version + '/presenter-pagination-fixture',
    enemies: DEVELOPMENT_CONTENT.enemies.map(enemy => ({ ...enemy, hp: 1, damage: 1, armor: 0, cooldown: 450 })),
  };
}
function fifthPreparation() {
  const h = start(harness(paginationContent()));
  placeByClick(h, instanceId(h, 'I01'), 0, 0);
  for (let wave = 1; wave <= 4; wave++) {
    assert.equal(h.session.state.run.wave, wave);
    click(h, 'start-combat');
    playCurrentBattle(h);
    assert.equal(h.session.state.run.phase, 'loot');
    const count = inventory(h).instances.length;
    click(h, 'loot-0');
    assert.equal(inventory(h).instances.length, count + 2);
    assert.deepEqual(inventory(h).history, []);
  }
  assert.equal(h.session.state.run.wave, 5);
  assert.equal(h.session.state.run.phase, 'preparation');
  return h;
}
function twelveInStash() {
  const h = fifthPreparation();
  inventoryCommand(h, { type: 'stash', instanceId: instanceId(h, 'I01') });
  assert.equal(inventory(h).stash.length, 12);
  return h;
}
const visibleStash = h => h.presenter.hits.filter(hit => hit.id.startsWith('stash-item-')).map(hit => hit.itemId);
function emptyPlacement(h, id) {
  const inv = inventory(h);
  const def = h.content.items.find(def => def.id === inv.instances.find(item => item.id === id).defId);
  const occupied = new Set();
  for (const placement of inv.placements) {
    const other = h.content.items.find(def => def.id === inv.instances.find(item => item.id === placement.instanceId).defId);
    for (const cell of occupiedCells(placement, other)) occupied.add(cell.x + ',' + cell.y);
  }
  for (const rotation of [0, 90, 180, 270]) for (let y = 0; y < inv.height; y++) for (let x = 0; x < inv.width; x++) {
    const placement = { instanceId: id, x, y, rotation };
    if (occupiedCells(placement, def).every(cell => cell.x < inv.width && cell.y < inv.height && !occupied.has(cell.x + ',' + cell.y))) return placement;
  }
  assert.fail('fixture unexpectedly has no empty placement');
}

test('PRESENTER: Painter and menu hit regions drive a real session with the all-open development catalog', () => {
  assert.equal(DEVELOPMENT_CONTENT.items.length, 17);
  assert.ok(DEVELOPMENT_CONTENT.items.every(item => item.unlocked));
  assert.deepEqual(validateContent(DEVELOPMENT_CONTENT), []);
  const h = harness();
  assert.equal(h.presenter.screen, 'menu'); assert.equal(h.session.state.run, null);
  const state = h.session.state;
  const oldSeed = h.presenter.seed;
  click(h, 'new-seed'); assert.notEqual(h.presenter.seed, oldSeed); assert.equal(h.session.state, state);
  const seed = h.presenter.seed;
  click(h, 'starter-I02'); assert.equal(h.presenter.starter, 'I02'); assert.equal(h.session.state, state);
  click(h, 'start-run');
  assert.equal(h.session.state.run.seed, seed);
  assert.deepEqual(inventory(h).instances.map(item => item.defId), ['I02', 'I05', 'I07', 'I09']);
  assert.equal(inventory(h).placements.length, 0); assert.equal(inventory(h).stash.length, 4);
  assert.equal(h.presenter.guidePage, 0); click(h, 'guide-close');
  assert.ok(h.painter.calls.some(call => call[0] === 'rect'));
  assert.ok(h.painter.calls.some(call => call[0] === 'polygon'));
  assert.ok(texts(h).some(text => text.includes('开发验证')));
  conserved(h);
});

test('PRESENTER: selecting and hovering do not commit; click-to-place commits exactly one real command', () => {
  const h = start();
  const gun = instanceId(h, 'I01');
  const before = h.session.state;
  select(h, gun);
  assert.equal(h.presenter.selectedId, gun); assert.equal(h.session.state, before);
  h.presenter.pointerMove(...Object.values(cellPoint(1, 1))); render(h);
  assert.equal(h.session.state, before);
  tap(h, cellPoint(1, 1));
  assert.deepEqual(inventory(h).placements, [{ instanceId: gun, x: 1, y: 1, rotation: 0 }]);
  assert.equal(inventory(h).revision, 1); assert.equal(inventory(h).history.length, 1);
  assert.equal(h.session.state.run.revision, before.run.revision + 1);
  assert.equal(h.session.state.nextCommand, before.nextCommand + 1);
  assert.equal(region(h, 'start-combat').enabled, true);
  conserved(h);
});

test('PRESENTER: unavailable rotate/undo/unequip/start buttons never dispatch', () => {
  const h = start();
  const before = h.session.state;
  for (const id of ['rotate', 'undo', 'unequip', 'start-combat']) {
    assert.equal(region(h, id).enabled, false); click(h, id, true); assert.equal(h.session.state, before);
  }
});

test('PRESENTER: invalid click placement preserves the exact state, stash order and preview selection', () => {
  const h = start();
  const gun = instanceId(h, 'I01'); select(h, gun);
  const before = h.session.state;
  tap(h, cellPoint(4, 5));
  assert.equal(h.session.state, before); assert.equal(h.presenter.selectedId, gun);
  assert.match(h.presenter.toast, /out-of-bounds|越界/);
  assert.deepEqual(inventory(h).history, []);
  tap(h, cellPoint(4, 3));
  assert.deepEqual(inventory(h).placements[0], { instanceId: gun, x: 4, y: 3, rotation: 0 });
  conserved(h);
});

test('PRESENTER: a stash drag preview is pure until pointerUp, even after repeated draws', () => {
  const h = start(); const gun = instanceId(h, 'I01');
  const before = h.session.state;
  const target = cellPoint(1, 2);
  beginDrag(h, 'stash-item-' + gun, target);
  for (let i = 0; i < 3; i++) render(h);
  assert.equal(h.session.state, before); assert.ok(texts(h).includes('松手放置'));
  drop(h, target);
  assert.equal(inventory(h).revision, before.run.inventory.revision + 1);
  assert.deepEqual(inventory(h).placements[0], { instanceId: gun, x: 1, y: 2, rotation: 0 });
  conserved(h);
});

test('PRESENTER: dragging from a non-anchor occupied cell preserves its grab offset', () => {
  const h = start(); const gun = instanceId(h, 'I01');
  placeByClick(h, gun, 0, 0);
  drag(h, 'bag-item-' + gun + '-0-1', cellPoint(3, 4));
  assert.deepEqual(inventory(h).placements[0], { instanceId: gun, x: 3, y: 3, rotation: 0 });
  conserved(h);
});

test('PRESENTER: backpack drag exchange commits both items once and keeps displaced orientation', () => {
  const h = start(); const gun = instanceId(h, 'I01'); const plate = instanceId(h, 'I05');
  placeByClick(h, gun, 0, 0); placeByClick(h, plate, 2, 0, 90);
  const before = h.session.state; const target = cellPoint(2, 0);
  beginDrag(h, 'bag-item-' + gun + '-0-0', target);
  assert.equal(h.session.state, before); assert.ok(texts(h).includes('松手交换'));
  drop(h, target);
  assert.deepEqual(inventory(h).placements.find(p => p.instanceId === gun), { instanceId: gun, x: 2, y: 0, rotation: 0 });
  assert.deepEqual(inventory(h).placements.find(p => p.instanceId === plate), { instanceId: plate, x: 0, y: 0, rotation: 90 });
  assert.deepEqual(inventory(h).stash, before.run.inventory.stash);
  assert.equal(inventory(h).revision, before.run.inventory.revision + 1); conserved(h);
});

test('PRESENTER: stash drag replaces the displaced item at the source stash slot', () => {
  const h = start(); const plate = instanceId(h, 'I05'); const battery = instanceId(h, 'I07');
  placeByClick(h, plate, 0, 0);
  const stash = inventory(h).stash.slice(); const sourceIndex = stash.indexOf(battery);
  drag(h, 'stash-item-' + battery, cellPoint(0, 0));
  const expected = stash.slice(); expected[sourceIndex] = plate;
  assert.deepEqual(inventory(h).stash, expected);
  assert.deepEqual(inventory(h).placements, [{ instanceId: battery, x: 0, y: 0, rotation: 0 }]);
  conserved(h);
});

test('PRESENTER: two-item collisions and invalid reverse swaps are visibly rejected without mutation', () => {
  const h = start(); const gun = instanceId(h, 'I01'); const plate = instanceId(h, 'I05'); const battery = instanceId(h, 'I07');
  placeByClick(h, gun, 0, 0); placeByClick(h, battery, 1, 0);
  const before = h.session.state; const target = cellPoint(0, 0);
  beginDrag(h, 'stash-item-' + plate, target);
  assert.ok(texts(h).some(text => text.includes('无法放置'))); assert.equal(h.session.state, before);
  drop(h, target); assert.equal(h.session.state, before); conserved(h);
  const other = start(); const otherPlate = instanceId(other, 'I05'); const otherBattery = instanceId(other, 'I07');
  placeByClick(other, otherPlate, 0, 0); placeByClick(other, otherBattery, 4, 5);
  const reverseBefore = other.session.state;
  drag(other, 'bag-item-' + otherBattery + '-4-5', cellPoint(0, 0));
  assert.equal(other.session.state, reverseBefore); conserved(other);
});

test('PRESENTER: cancelPointer, Escape, and a release outside both zones cancel without a commit', () => {
  for (const cancellation of ['cancelPointer', 'Escape', 'outside']) {
    const h = start(); const gun = instanceId(h, 'I01'); placeByClick(h, gun, 0, 0);
    const before = h.session.state;
    beginDrag(h, 'bag-item-' + gun + '-0-0', cellPoint(2, 2));
    if (cancellation === 'cancelPointer') h.presenter.cancelPointer();
    if (cancellation === 'Escape') h.presenter.key('Escape');
    drop(h, cancellation === 'outside' ? { x: 600, y: 350 } : cellPoint(2, 2));
    assert.equal(h.session.state, before); assert.equal(inventory(h).placements[0].rotation, 0);
    if (cancellation === 'Escape') assert.equal(h.presenter.selectedId, null);
  }
});

test('PRESENTER: an off-canvas drop must not be interpreted as unloading into stash', () => {
  const h = start(); const gun = instanceId(h, 'I01'); placeByClick(h, gun, 0, 0);
  const before = h.session.state;
  drag(h, 'bag-item-' + gun + '-0-0', { x: -40, y: 1000 });
  assert.equal(h.session.state, before, 'outside the 720-wide canvas is not the stash drop area');
});

test('PRESENTER: dragging into stash and the unequip button retain instance identity and append order', () => {
  const h = start(); const gun = instanceId(h, 'I01'); placeByClick(h, gun, 0, 0);
  const stash = inventory(h).stash.slice();
  drag(h, 'bag-item-' + gun + '-0-0', { x: 650, y: 1050 });
  assert.deepEqual(inventory(h).stash, [...stash, gun]); assert.equal(inventory(h).placements.length, 0);
  placeByClick(h, gun, 0, 0); click(h, 'unequip');
  assert.deepEqual(inventory(h).stash, [...stash, gun]); conserved(h);
});

test('PRESENTER: stash and backpack rotations stay previews until placement confirmation', () => {
  const h = start(); const gun = instanceId(h, 'I01'); select(h, gun);
  const before = h.session.state;
  click(h, 'rotate'); assert.equal(h.presenter.rotation, 90); assert.equal(h.session.state, before);
  assert.ok(texts(h).some(text => text.includes('预览朝向  90°')));
  tap(h, cellPoint(0, 0)); assert.equal(inventory(h).placements[0].rotation, 90);
  const placed = h.session.state;
  h.presenter.key('r'); render(h);
  assert.equal(h.presenter.rotation, 180); assert.equal(h.session.state, placed);
  click(h, 'bag-item-' + gun + '-0-0');
  assert.equal(inventory(h).placements[0].rotation, 180);
  assert.equal(inventory(h).revision, placed.run.inventory.revision + 1);
  conserved(h);
});

test('PRESENTER: an invalid rotation confirmation and subsequent Escape leave saved orientation intact', () => {
  const h = start(); const gun = instanceId(h, 'I01'); placeByClick(h, gun, 4, 0);
  const before = h.session.state;
  click(h, 'rotate'); click(h, 'bag-item-' + gun + '-4-0');
  assert.equal(h.session.state, before); assert.equal(inventory(h).placements[0].rotation, 0);
  h.presenter.key('Escape'); render(h); assert.equal(h.presenter.selectedId, null); assert.equal(h.session.state, before);
  select(h, gun); assert.equal(h.presenter.rotation, 0);
});

test('PRESENTER: undo buttons restore every layout and stash boundary with monotonically increasing revisions', () => {
  const h = start(); const gun = instanceId(h, 'I01'); const plate = instanceId(h, 'I05');
  const checkpoints = [savedLayout(h)];
  placeByClick(h, gun, 0, 0); checkpoints.push(savedLayout(h));
  placeByClick(h, plate, 2, 0); checkpoints.push(savedLayout(h));
  select(h, gun); click(h, 'rotate'); click(h, 'bag-item-' + gun + '-0-0'); checkpoints.push(savedLayout(h));
  select(h, plate); click(h, 'unequip');
  let revision = inventory(h).revision;
  for (let i = checkpoints.length - 1; i >= 0; i--) {
    if (i % 2) { h.presenter.key('z'); render(h); } else click(h, 'undo');
    assert.equal(inventory(h).revision, ++revision); assert.deepEqual(savedLayout(h), checkpoints[i]); conserved(h);
  }
  assert.equal(region(h, 'undo').enabled, false);
  const before = h.session.state; click(h, 'undo', true); assert.equal(h.session.state, before);
});

test('PRESENTER: the displayed combo follows the real layout and disappears again after undo', () => {
  const h = start(); const gun = instanceId(h, 'I01'); const plate = instanceId(h, 'I05');
  placeByClick(h, gun, 0, 0); placeByClick(h, plate, 1, 0);
  assert.equal(evaluateLoadout(inventory(h), h.content).combos.length, 1);
  assert.ok(texts(h).some(text => text.includes('屏护射位')));
  click(h, 'undo');
  assert.equal(evaluateLoadout(inventory(h), h.content).combos.length, 0);
  assert.ok(texts(h).some(text=>text.includes('○ 武器贴护板加伤')));
});

test('PRESENTER: twelve earned items paginate 8/4, remain reachable once each, and never disappear', () => {
  const h = twelveInStash(); const before = h.session.state; const expected = inventory(h).stash.slice();
  assert.deepEqual(visibleStash(h), expected.slice(0, 8)); assert.equal(region(h, 'stash-prev').enabled, false);
  click(h, 'stash-prev', true); assert.equal(h.presenter.stashPage, 0);
  click(h, 'stash-next'); assert.equal(h.presenter.stashPage, 1);
  assert.deepEqual(visibleStash(h), expected.slice(8)); assert.equal(region(h, 'stash-next').enabled, false);
  const allVisible = [...expected.slice(0, 8), ...visibleStash(h)];
  assert.deepEqual(allVisible, expected); assert.equal(new Set(allVisible).size, 12);
  select(h, expected[8]); assert.equal(h.presenter.selectedId, expected[8]);
  click(h, 'stash-next', true); assert.equal(h.presenter.stashPage, 1);
  click(h, 'stash-prev'); assert.deepEqual(visibleStash(h), expected.slice(0, 8));
  assert.equal(h.session.state, before); conserved(h);
});

test('PRESENTER: removing the last four stash entries clamps the page and keeps all real command results', () => {
  const h = twelveInStash(); click(h, 'stash-next');
  const ids = inventory(h).stash.slice(8);
  for (const id of ids) inventoryCommand(h, { type: 'place', ...emptyPlacement(h, id) });
  assert.equal(inventory(h).stash.length, 8); assert.equal(h.presenter.stashPage, 0);
  assert.equal(h.presenter.hits.some(hit => hit.id === 'stash-next' || hit.id === 'stash-prev'), false);
  assert.deepEqual(visibleStash(h), inventory(h).stash);
  assert.equal(inventory(h).instances.length, 12); conserved(h);
});

test('PRESENTER: pause freezes the exact combat snapshot and resume discards fractional time debt', () => {
  const h = armed(); h.presenter.update(0.25); render(h);
  const before = h.session.state.run; const tick = before.combat.tick;
  assert.equal(tick, 2); click(h, 'pause-combat');
  assert.ok(h.presenter.driver.reasons.has('user'));
  assert.deepEqual(h.presenter.hits.map(hit => hit.id), ['open-manual', 'resume-combat']);
  for (let i = 0; i < 5; i++) h.presenter.update(0.5);
  assert.equal(h.session.state.run, before);
  click(h, 'resume-combat'); assert.equal(h.presenter.driver.reasons.size, 0); assert.equal(h.session.state.run, before);
  h.presenter.update(0.05); assert.equal(h.session.state.run.combat.tick, tick);
  h.presenter.update(0.05); assert.equal(h.session.state.run.combat.tick, tick + 1);
});

test('PRESENTER: background/resume requires explicit confirmation and never applies offline damage', () => {
  const h = armed(); h.presenter.update(0.1); render(h);
  const before = h.session.state.run;
  h.presenter.background(true); render(h);
  assert.equal(region(h, 'resume-combat').enabled, false);
  click(h, 'resume-combat', true); h.presenter.update(30); assert.equal(h.session.state.run, before);
  h.presenter.background(false); render(h);
  assert.ok(h.presenter.driver.reasons.has('resume-confirmation')); assert.equal(region(h, 'resume-combat').enabled, true);
  h.presenter.update(30); assert.equal(h.session.state.run, before);
  click(h, 'resume-combat'); assert.equal(h.session.state.run, before);
  h.presenter.update(0.1); assert.equal(h.session.state.run.combat.tick, before.combat.tick + 1);
});

test('PRESENTER: a long foreground hitch pauses for confirmation instead of catch-up damage', () => {
  const h = armed(); const before = h.session.state.run;
  h.presenter.update(2); render(h);
  assert.equal(h.session.state.run, before); assert.ok(h.presenter.driver.reasons.has('resume-confirmation'));
  click(h, 'resume-combat'); h.presenter.update(0.1);
  assert.equal(h.session.state.run.combat.tick, 1);
});

test('PRESENTER: canceling end-run confirmation preserves inventory, combat and wallet', () => {
  for (const inCombat of [false, true]) {
    const h = inCombat ? armed() : start();
    const before = h.session.state;
    click(h, 'abandon-run');
    assert.equal(h.presenter.confirmAbandon, true);
    assert.deepEqual(h.presenter.hits.map(hit => hit.id), ['cancel-abandon', 'confirm-abandon']);
    if (inCombat) h.presenter.update(0.5);
    assert.equal(h.session.state, before);
    click(h, 'cancel-abandon');
    assert.equal(h.presenter.confirmAbandon, false); assert.equal(h.presenter.driver.reasons.has('confirm-abandon'), false);
    assert.equal(h.session.state, before);
    if (inCombat) { h.presenter.update(0.1); assert.equal(h.session.state.run.combat.tick, before.run.combat.tick + 1); }
  }
});

test('PRESENTER: Escape cancellation of end-run confirmation releases its pause reason', () => {
  const h = armed(); const before = h.session.state.run;
  click(h, 'abandon-run'); h.presenter.key('Escape'); render(h);
  assert.equal(h.presenter.confirmAbandon, false);
  assert.equal(h.presenter.driver.reasons.has('confirm-abandon'), false, 'a dismissed confirmation must not leave combat permanently paused');
  h.presenter.update(0.1); assert.equal(h.session.state.run.combat.tick, before.combat.tick + 1);
});

test('PRESENTER: confirmation overlays prevent click-through placement behind the dialog', () => {
  const h = start(); select(h, instanceId(h, 'I01'));
  click(h, 'abandon-run'); const before = h.session.state;
  tap(h, cellPoint(0, 0));
  assert.equal(h.presenter.confirmAbandon, true);
  assert.equal(h.session.state, before, 'a board click covered by the modal must not dispatch an inventory command');
});

test('PRESENTER: confirmation overlays prevent keyboard undo behind the dialog', () => {
  const h = start(); placeByClick(h, instanceId(h, 'I01'), 0, 0);
  click(h, 'abandon-run'); const before = h.session.state;
  h.presenter.key('z'); render(h);
  assert.equal(h.session.state, before, 'keyboard undo must not mutate a layout behind an open confirmation');
});

test('PRESENTER: confirming abandonment settles once and the claim button returns to a usable menu', () => {
  const h = start(); placeByClick(h, instanceId(h, 'I01'), 0, 0);
  const before = h.session.state.run;
  click(h, 'abandon-run'); click(h, 'confirm-abandon');
  assert.equal(h.session.state.run.phase, 'settlement'); assert.equal(h.session.state.run.settlement.reason, 'abandoned');
  assert.equal(h.session.state.run.revision, before.revision + 1);
  assert.equal(h.presenter.driver.reasons.has('confirm-abandon'), false);
  assert.equal(h.session.state.wallet, 0);
  click(h, 'claim-and-menu');
  assert.equal(h.presenter.screen, 'menu'); assert.equal(h.session.state.run.settlement.claimed, true);
  assert.equal(h.presenter.driver.reasons.size, 0);
  click(h, 'start-run'); assert.equal(h.session.state.run.phase, 'preparation'); assert.notEqual(h.session.state.run.id, before.id);
});

test('PRESENTER: real development content reaches defeat/settlement from the menu without ads or state injection', () => {
  const h = start(); placeByClick(h, instanceId(h, 'I01'), 0, 0);
  const ids = inventory(h).instances.map(item => item.id); let waves = 0;
  while (h.session.state.run.phase === 'preparation' && waves++ < 5) {
    click(h, 'start-combat');
    const locked = h.session.state;
    assert.deepEqual(inventory(h).history, []);
    assert.equal(h.presenter.hits.some(hit => ['rotate', 'undo', 'unequip'].includes(hit.id)), false);
    h.presenter.key('r'); h.presenter.key('z');
    rawTap(h, cellPoint(0, 0));
    assert.equal(h.session.state, locked, 'combat has no working inventory inputs');
    playCurrentBattle(h);
    if (h.session.state.run.phase === 'loot') click(h, 'skip-loot');
  }
  assert.equal(h.session.state.run.phase, 'defeat', 'a lone starter with skipped loot is a deterministic losing fixture');
  assert.equal(h.session.state.wallet, 0); assert.deepEqual(inventory(h).instances.map(item => item.id), ids);
  assert.ok(h.session.state.run.reports.length > 0);
  const coins = 4 * h.session.state.run.victories;
  click(h, 'finish-defeat'); assert.equal(h.session.state.run.phase, 'settlement');
  assert.equal(h.session.state.run.settlement.baseCoins, coins);
  const claimPoint = center(region(h, 'claim-and-menu'));
  rawTap(h, claimPoint); rawTap(h, claimPoint); // Two real taps before the next paint cannot double-pay.
  render(h);
  assert.equal(h.presenter.screen, 'menu'); assert.equal(h.session.state.wallet, coins);
  assert.equal(h.session.state.run.settlement.claimed, true);
  click(h, 'start-run'); assert.equal(h.session.state.run.phase, 'preparation'); assert.equal(h.session.state.wallet, coins);
});

test('PRESENTER: five-wave navigation fixture reaches victory and pays the single 32-coin base reward', () => {
  const h = fifthPreparation();
  click(h, 'start-combat'); playCurrentBattle(h);
  assert.equal(h.session.state.run.phase, 'settlement'); assert.equal(h.session.state.run.settlement.reason, 'victory');
  assert.equal(h.session.state.run.victories, 5); assert.equal(h.session.state.run.reports.length, 5);
  assert.equal(h.session.state.run.settlement.baseCoins, 32); assert.equal(h.session.state.wallet, 0);
  click(h, 'claim-and-menu');
  assert.equal(h.presenter.screen, 'menu'); assert.equal(h.session.state.wallet, 32);
});


test('FEEDBACK UI: first-run guide is skippable, replayable, and cannot mutate the underlying run',()=>{
 const h=harness();click(h,'start-run');assert.equal(h.presenter.guidePage,0);const before=h.session.state;
 rawTap(h,cellPoint(0,0));h.presenter.key('z');h.presenter.key('r');render(h);assert.equal(h.session.state,before);
 for(let page=0;page<5;page++){assert.equal(h.presenter.guidePage,page);click(h,'guide-next');assert.equal(h.session.state,before);}
 assert.equal(h.presenter.guidePage,5);assert(texts(h).some(t=>t.includes('三件套组合')));click(h,'guide-close');assert.equal(h.presenter.guidePage,null);assert.equal(h.presenter.driver.reasons.has('guide'),false);
 click(h,'open-guide');assert.equal(h.presenter.guidePage,0);h.presenter.key('Escape');render(h);assert.equal(h.presenter.guidePage,null);assert.equal(h.session.state,before);
});
test('FEEDBACK UI: battery drag previews the real 0.63s blade benefit without committing early',()=>{
 const h=start(harness(),'I03'),blade=instanceId(h,'I03'),battery=instanceId(h,'I07');placeByClick(h,blade,0,0);placeByClick(h,battery,2,1);
 assert(texts(h).some(t=>t.includes('供电未接通')));const before=h.session.state;
 beginDrag(h,itemHit(h,battery).id,cellPoint(1,1));assert.equal(h.session.state,before);assert(texts(h).some(t=>t.includes('尚未提交')));assert(texts(h).some(t=>t.includes('0.63')));
 drop(h,cellPoint(1,1));assert.equal(evaluateLoadout(inventory(h),h.content).weapons[0].hasteBps,1000);assert(texts(h).some(t=>t.includes('供电已接通')));
 click(h,'inspect-item');assert(texts(h).some(t=>t.includes('0.63')));const detailState=h.session.state;h.presenter.key('z');rawTap(h,cellPoint(0,0));render(h);assert.equal(h.session.state,detailState);click(h,'detail-close');
});
test('FEEDBACK UI: opening the rulebook during combat freezes ticks and closing releases only its own pause',()=>{
 const h=armed();h.presenter.update(0.1);render(h);click(h,'open-guide');const state=h.session.state;
 h.presenter.update(0.8);assert.equal(h.session.state,state);h.presenter.background(true);h.presenter.key('Escape');render(h);
 assert.equal(h.presenter.driver.reasons.has('guide'),false);assert.equal(h.presenter.driver.reasons.has('background'),true);h.presenter.background(false);render(h);click(h,'resume-combat');h.presenter.update(0.1);assert.equal(h.session.state.run.combat.tick,state.run.combat.tick+1);
});
test('FEEDBACK UI: combat explains the deadline, exposes damage and preserves a readable journal through empty frames',()=>{
 const h=armed();for(let i=0;i<25;i++)h.presenter.update(0.1);render(h);
 assert(texts(h).includes('撤离倒计时'));assert(!texts(h).includes('区域压力'));assert(texts(h).some(t=>t.includes('秒后攻击')));
 assert(h.presenter.journal.entries.some(entry=>entry.event.type==='damage'));const count=h.presenter.journal.entries.length;render(h);assert.equal(h.presenter.journal.entries.length,count);
 click(h,'combat-journal');const state=h.session.state;h.presenter.update(0.8);assert.equal(h.session.state,state);assert(texts(h).some(t=>t.includes('保留本波最近160条')));
 click(h,'journal-close');h.presenter.update(0.1);assert.equal(h.session.state.run.combat.tick,state.run.combat.tick+1);
});

test('FEEDBACK UI: every guide page keeps readable body text above navigation, including all combo recipes',()=>{
 const h=harness();click(h,'start-run');
 for(let page=0;page<6;page++){
  const body=h.painter.calls.filter(call=>call[0]==='text'&&call[2]===87&&call[3]>=593);
  assert(body.length>0);assert(body.every(call=>call[4]>=24));assert(body.every(call=>call[3]<=1035),'guide '+page+' overlaps navigation: '+Math.max(...body.map(call=>call[3])));
  if(page<5)click(h,'guide-next');
 }
});

test('STARTERS UI: development menu exposes all four weapons and I04 can equip and enter combat',()=>{
  const h=harness();assert.deepEqual(h.presenter.hits.filter(hit=>hit.id.startsWith('starter-')).map(hit=>hit.id),['starter-I01','starter-I02','starter-I03','starter-I04']);
  const regions=h.presenter.hits.filter(hit=>hit.id.startsWith('starter-'));
  assert(regions.every(hit=>hit.y+hit.h<=973&&hit.w>=300));
  const nozzle=region(h,'starter-I04');assert(texts(h).includes('余热喷嘴'));assert(texts(h).includes('多目标扫射 · 群体压制'));
  const started=start(h,'I04');assert.equal(started.session.state.run.inventory.instances[0].defId,'I04');placeByClick(started,instanceId(started,'I04'),0,0);click(started,'start-combat');assert.equal(started.session.state.run.phase,'combat');assert.equal(started.session.state.run.combat.weapons[0].targets,3);
});
test('STARTERS UI: normal pool hides locked I04; expanded lists paginate without mutating run',()=>{
  const {CONTENT}=require('../../.test-build/content/catalog.js');const normal=harness(CONTENT);assert.deepEqual(normal.presenter.hits.filter(hit=>hit.id.startsWith('starter-')).map(hit=>hit.id),['starter-I01','starter-I02','starter-I03']);
  const extra={...DEVELOPMENT_CONTENT,items:[...DEVELOPMENT_CONTENT.items,{...DEVELOPMENT_CONTENT.items[0],id:'I18',name:'扩展武器'}]};const h=harness(extra);const before=h.session.state;click(h,'starter-next');assert.equal(h.session.state,before);assert.equal(region(h,'starter-prev').enabled,true);assert.equal(region(h,'starter-next').enabled,false);click(h,'starter-I18');assert.equal(h.presenter.starter,'I18');click(h,'start-run');assert.equal(h.session.state.run.inventory.instances[0].defId,'I18');
});


// Loot inspection is presentation-only: pending rewards and inventory stay authoritative.
function pendingLoot() {
  const h = start(harness(paginationContent()));
  placeByClick(h, instanceId(h, 'I01'), 0, 0);
  click(h, 'start-combat'); playCurrentBattle(h);
  assert.equal(h.session.state.run.phase, 'loot');
  return h;
}

test('PRESENTER: supply can be collapsed and reopened without claiming, rerolling or advancing', () => {
  const h = pendingLoot(); const before = h.session.state; const saved = clone(before);
  for (let i = 0; i < 4; i++) {
    click(h, 'view-loot-equipment');
    assert.equal(h.presenter.lootCollapsed, true);
    assert.ok(h.presenter.hits.some(hit => hit.id.startsWith('bag-item-')));
    assert.ok(h.presenter.hits.some(hit => hit.id.startsWith('stash-item-')));
    for (const id of ['start-combat', 'rotate', 'undo', 'unequip', 'skip-loot', 'loot-0']) {
      assert.ok(!h.presenter.hits.some(hit => hit.id === id), id + ' cannot bypass pending supply');
    }
    assert.ok(texts(h).includes('已有装备 · 物资待领取'));
    click(h, 'return-loot');
    assert.equal(h.presenter.lootCollapsed, false);
    assert.equal(h.session.state, before);
    assert.deepEqual(h.session.state, saved);
    for (let option = 0; option < 3; option++) assert.ok(region(h, 'loot-' + option).enabled);
  }
});

test('PRESENTER: supply equipment inspection supports live rules and adjacent peers, with no inventory edits', () => {
  const h = pendingLoot(); const before = h.session.state;
  click(h, 'view-loot-equipment'); select(h, instanceId(h, 'I01'));
  click(h, 'inspect-item'); assert.equal(h.presenter.detailId, instanceId(h, 'I01'));
  assert.equal(h.presenter.lootCollapsed, true);
  click(h, 'detail-close'); assert.ok(region(h, 'return-loot'));
  select(h, inventory(h).stash[0]); click(h, 'inspect-item');
  click(h, 'detail-manual'); assert.equal(h.presenter.manualOpen, true);
  h.presenter.key('Escape'); render(h);
  assert.equal(h.presenter.manualOpen, false); assert.equal(h.presenter.lootCollapsed, true);
  assert.equal(h.presenter.driver.reasons.size, 0);
  assert.ok(region(h, 'return-loot')); assert.equal(h.session.state, before);
});

test('PRESENTER: read-only supply inspection cannot move, rotate, stash or undo using pointer or keyboard', () => {
  const h = pendingLoot(); const before = h.session.state;
  click(h, 'view-loot-equipment');
  const gun = instanceId(h, 'I01'); select(h, gun);
  const rotation = h.presenter.rotation;
  h.presenter.key('r'); h.presenter.key('z'); render(h);
  assert.equal(h.presenter.rotation, rotation);
  drag(h, itemHit(h, gun).id, { x: 300, y: 970 });
  drag(h, 'stash-item-' + inventory(h).stash[0], cellPoint(4, 5));
  select(h, gun); tap(h, cellPoint(3, 3));
  assert.equal(h.session.state, before); conserved(h);
  assert.equal(h.presenter.lootCollapsed, true);
});

test('PRESENTER: Escape closes nested overlays before toggling supply, and abandon cancellation preserves the inspection view', () => {
  const h = pendingLoot(); const before = h.session.state;
  h.presenter.key('Escape'); render(h); assert.equal(h.presenter.lootCollapsed, true);
  select(h, instanceId(h, 'I01')); click(h, 'inspect-item');
  h.presenter.key('Escape'); render(h);
  assert.equal(h.presenter.detailId, null); assert.equal(h.presenter.lootCollapsed, true);
  click(h, 'abandon-run'); h.presenter.key('Escape'); render(h);
  assert.equal(h.presenter.confirmAbandon, false); assert.equal(h.presenter.lootCollapsed, true);
  click(h, 'open-guide'); h.presenter.key('Escape'); render(h);
  assert.equal(h.presenter.lootCollapsed, true); assert.equal(h.presenter.driver.reasons.size, 0);
  h.presenter.key('Escape'); render(h); assert.equal(h.presenter.lootCollapsed, false);
  h.presenter.key('Escape'); render(h); assert.equal(h.presenter.lootCollapsed, true);
  assert.equal(h.session.state, before);
});

test('PRESENTER: supply inspection keeps all paginated reserve items accessible at later waves', () => {
  const h = start(harness(paginationContent()));
  placeByClick(h, instanceId(h, 'I01'), 0, 0);
  for (let wave = 1; wave <= 4; wave++) {
    click(h, 'start-combat'); playCurrentBattle(h);
    assert.equal(h.presenter.lootCollapsed, false, 'every newly earned supply opens its own choices');
    const before = h.session.state;
    click(h, 'view-loot-equipment');
    const seen = [...visibleStash(h)];
    while (h.presenter.hits.some(hit => hit.id === 'stash-next' && hit.enabled)) {
      click(h, 'stash-next'); seen.push(...visibleStash(h));
    }
    assert.deepEqual(seen.sort(), inventory(h).stash.slice().sort());
    assert.equal(h.session.state, before);
    click(h, 'return-loot'); click(h, 'loot-0');
    assert.equal(h.session.state.run.wave, wave + 1);
    assert.equal(h.session.state.run.phase, 'preparation');
    assert.equal(h.presenter.lootCollapsed, false);
    assert.equal(h.presenter.stashPage, 0);
  }
});

test('PRESENTER: claiming after inspection grants exactly one option, and explicit skip still discards only the pending supply', () => {
  for (const choose of [true, false]) {
    const h = pendingLoot(); const before = clone(h.session.state.run);
    click(h, 'view-loot-equipment'); click(h, 'return-loot');
    const option = before.loot[1];
    click(h, choose ? 'loot-1' : 'skip-loot');
    const run = h.session.state.run;
    assert.equal(run.phase, 'preparation'); assert.equal(run.wave, before.wave + 1);
    assert.equal(run.inventory.instances.length, before.inventory.instances.length + (choose ? 2 : 0));
    if (choose) assert.deepEqual(run.inventory.instances.slice(-2).map(item => item.defId), option.itemIds);
    else assert.deepEqual(run.inventory.instances, before.inventory.instances);
    assert.deepEqual(run.loot, []); assert.equal(h.presenter.lootCollapsed, false);
    const after = h.session.state;
    assert.equal(h.session.dispatch({ type: 'choose-loot', optionId: option.id }).ok, false);
    assert.equal(h.session.state, after); conserved(h);
  }
});

test('PRESENTER: reload while supply is collapsed restores the same pending reward choices without a new save schema', () => {
  const { SessionStore } = require('../../.test-build/application/session-store.js');
  const values = new Map();
  const storage = { get: key => values.get(key) ?? null, set: (key, value) => values.set(key, value), remove: key => values.delete(key) };
  const install = 'local-loot-inspection-storage-test';
  // Use baseline content for real save validation; the pagination fixture is not a supported ruleset.
  const presenter = new GamePresenter(DEVELOPMENT_CONTENT, new SessionStore(storage, DEVELOPMENT_CONTENT, install));
  const h = start(render({ presenter, painter: new StubPainter(), session: presenter.session, content: DEVELOPMENT_CONTENT }));
  placeByClick(h, instanceId(h, 'I01'), 0, 0);
  for (const id of inventory(h).stash.slice()) {
    const placement = emptyPlacement(h, id);
    placeByClick(h, id, placement.x, placement.y, placement.rotation);
  }
  click(h, 'start-combat'); playCurrentBattle(h); assert.equal(h.session.state.run.phase, 'loot');
  const before = clone(h.session.state); const saved = [...values];
  click(h, 'view-loot-equipment'); select(h, instanceId(h, 'I01'));
  assert.deepEqual([...values], saved, 'presentation toggles do not write gameplay state');
  const next = new GamePresenter(DEVELOPMENT_CONTENT, new SessionStore(storage, DEVELOPMENT_CONTENT, install));
  const resumed = render({ presenter: next, painter: new StubPainter(), session: next.session, content: DEVELOPMENT_CONTENT });
  assert.equal(next.screen, 'run'); assert.equal(next.lootCollapsed, false);
  assert.deepEqual(next.session.state, before);
  assert.ok(region(resumed, 'view-loot-equipment')); assert.ok(region(resumed, 'loot-0'));
});
