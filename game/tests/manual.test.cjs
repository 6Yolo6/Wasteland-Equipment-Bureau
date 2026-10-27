'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {CONTENT,DEVELOPMENT_CONTENT}=require('../../.test-build/content/catalog.js');
const {manualItems,manualLinks,manualRules,definitionLines}=require('../../.test-build/presentation/FieldManual.js');
const {GamePresenter}=require('../../.test-build/presentation/GamePresenter.js');
const {createInventory,transactInventory}=require('../../.test-build/core/inventory.js');
const {evaluateLoadout}=require('../../.test-build/core/loadout.js');
const clone=v=>JSON.parse(JSON.stringify(v));
class Painter {constructor(){this.calls=[];}begin(){this.calls=[];}end(){}rect(){}line(){}circle(){}polygon(){}text(...args){this.calls.push(args);}}
function h(content=DEVELOPMENT_CONTENT){const p=new GamePresenter(content),paint=new Painter();p.update(0);p.draw(paint);return {p,paint};}
function render(h){h.p.update(0);h.p.draw(h.paint);return h;}
function click(h,id){const hit=h.p.hits.find(h=>h.id===id);assert(hit&&hit.enabled,'Missing enabled '+id);h.p.pointerDown(hit.x+hit.w/2,hit.y+hit.h/2);h.p.pointerUp(hit.x+hit.w/2,hit.y+hit.h/2);return render(h);}
function run(h0=h()){click(h0,'start-run');click(h0,'guide-close');return h0;}

test('MANUAL every definition is indexed, including unavailable content and one-shot lifetime',()=>{
 const items=manualItems(CONTENT);assert.equal(items.length,17);assert.deepEqual(items.map(i=>i.id),CONTENT.items.map(i=>i.id));assert.equal(manualItems(CONTENT,'weapon').length,4);assert.equal(manualItems(CONTENT,'supply').length,13);const one=items.find(i=>i.id==='I15');assert.match(one.subtitle,/出勤一次/);assert(one.lines.some(line=>line.includes('未触发')));const kit=items.find(i=>i.id==='I09');assert(kit.lines.some(line=>line.includes('每波重置')));
});
test('MANUAL includes two direct links and all four combos, not just equipped recipes',()=>{
 const links=manualLinks(CONTENT);assert.deepEqual(links.map(l=>l.id),['L01','L02','C01','C02','C03','C04']);for(const link of links){assert(link.lines.length>=4);assert(link.example?.length>=2);assert(link.relatedIds?.length>=2);}
});
test('MANUAL every recipe diagram is a legal 5x6 arrangement and triggers exactly the documented effect',()=>{
 for(const link of manualLinks(CONTENT)){
  let inv=createInventory(link.example.map((p,i)=>({id:'e'+i,defId:p.defId,spawnIndex:i})));
  link.example.forEach((p,i)=>{const r=transactInventory(inv,{type:'place',instanceId:'e'+i,x:p.x,y:p.y,rotation:p.rotation,expectedRevision:inv.revision},CONTENT);assert(r.ok,link.id+': '+r.reason);inv=r.state;});
  const load=evaluateLoadout(inv,CONTENT);if(link.id==='L01')assert.equal(load.weapons[0].hasteBps,1000);else if(link.id==='L02')assert.equal(load.weapons[0].bonusDamage,1);else assert(load.combos.some(c=>c.id===link.id),link.id+' example must really work');
 }
});
test('MANUAL texts project modified weapon stats and limits, rather than fixed catalog summaries',()=>{
 const c=clone(CONTENT);c.items[0].weapon.damage=33;c.items[0].weapon.cooldown=17;c.limits.hasteBps=2500;
 const text=definitionLines(c.items[0],c).join('\n');assert.match(text,/主目标33伤害/);assert.match(text,/每1.7秒/);assert.match(text,/25%/);
});
test('MANUAL includes all enemies, exact enrage boundary, no fake pressure damage',()=>{
 const rules=manualRules(CONTENT);for(const enemy of CONTENT.enemies)assert(rules.some(r=>r.id===enemy.id));assert(rules.find(r=>r.id==='R01').lines.some(l=>l.includes('不会逐秒增加')));assert(rules.find(r=>r.id==='B01').lines.some(l=>l.includes('严格低于50%')));
});
test('MANUAL menu reachable, all seventeen detail pages accessible without creating run or spending RNG',()=>{
 const x=h();const original=clone(x.p.session.state);click(x,'open-manual');const ids=[];
 for(let i=0;i<4;i++){const visible=x.p.hits.filter(h=>h.id.startsWith('manual-entry-')).map(h=>h.id);for(const id of visible){ids.push(id);click(x,id);let pages=0;while(x.p.hits.find(h=>h.id==='manual-entry-next')?.enabled){click(x,'manual-entry-next');assert(++pages<20);}click(x,'manual-index');}if(i<3)click(x,'manual-next');}
 assert.equal(ids.length,17);assert.equal(new Set(ids).size,17);assert.deepEqual(x.p.session.state,original);click(x,'manual-close');assert.equal(x.p.screen,'menu');assert.equal(x.p.session.state.run,null);
});
test('MANUAL filters and tabs reset pagination, expose every link and enemy',()=>{
 const x=h();click(x,'open-manual');click(x,'manual-next');click(x,'manual-filter-weapon');assert.equal(x.p.manualPage,0);assert.equal(x.p.hits.filter(h=>h.id.startsWith('manual-entry-')).length,4);click(x,'manual-tab-links');assert.equal(x.p.manualPage,0);click(x,'manual-next');click(x,'manual-entry-C04');assert.equal(x.p.manualEntryId,'C04');click(x,'manual-tab-rules');assert.equal(x.p.manualEntryId,null);assert.equal(x.p.manualPage,0);click(x,'manual-next');click(x,'manual-entry-B01');assert.equal(x.p.manualEntryId,'B01');
});
test('MANUAL normal-mode unavailable equipment still has details, never alters unlocks',()=>{
 const x=h(CONTENT);click(x,'open-manual');click(x,'manual-entry-I04');assert(x.paint.calls.some(t=>t[0].includes('当前掉落未开放')));assert.equal(CONTENT.items.find(i=>i.id==='I04').unlocked,false);
});
test('MANUAL blocks pointer and rotation/undo shortcuts behind modal',()=>{
 const x=run();const before=clone(x.p.session.state);click(x,'open-manual');x.p.pointerDown(82,450);x.p.pointerUp(82,450);x.p.key('r');x.p.key('z');render(x);assert.deepEqual(x.p.session.state,before);x.p.key('Escape');render(x);assert.equal(x.p.manualOpen,false);
});
test('MANUAL opening and closing during combat freezes full state while respecting other pauses',()=>{
 const x=run();const r=x.p.session.state.run;assert(x.p.session.dispatch({type:'inventory',command:{type:'place',instanceId:r.inventory.instances[0].id,x:0,y:0,rotation:0,expectedRevision:r.inventory.revision}}).ok);render(x);click(x,'start-combat');x.p.driver.pause('user');render(x);
 const before=clone(x.p.session.state.run);click(x,'open-manual');x.p.update(1);render(x);assert.deepEqual(x.p.session.state.run,before);click(x,'manual-close');assert(x.p.driver.reasons.has('user'));assert(!x.p.driver.reasons.has('manual'));x.p.driver.resume('user');x.p.update(0.1);assert(x.p.session.state.run.combat.tick>before.combat.tick);
});
test('MANUAL backdrop and text stay inside dialog, navigation buttons do not overlap',()=>{
 const x=h();click(x,'open-manual');for(const tab of ['items','links','rules']){click(x,'manual-tab-'+tab);for(const hit of x.p.hits){assert(hit.x>=32&&hit.x+hit.w<=688,hit.id);assert(hit.y>=150&&hit.y+hit.h<=1220,hit.id);}for(const call of x.paint.calls)assert(call[2]<110||(call[2]>=150&&call[2]<=1220));}
});
