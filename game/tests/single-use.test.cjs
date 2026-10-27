'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {CONTENT,DEVELOPMENT_CONTENT,validateContent}=require('../../.test-build/content/catalog.js');
const {createRun,applyRunCommand,advanceRun}=require('../../.test-build/core/run.js');
const {addInstances,transactInventory,validateInventory}=require('../../.test-build/core/inventory.js');
const {evaluateLoadout}=require('../../.test-build/core/loadout.js');
const {createCombat,stepCombat}=require('../../.test-build/core/combat.js');
const {describeEvent}=require('../../.test-build/presentation/RuleReadout.js');
const clone=v=>JSON.parse(JSON.stringify(v));
function fixture({placed=true,damage=20,hp=50,deadline=100,enemyHp=32,normal=false}={}){
 const content={...DEVELOPMENT_CONTENT,waves:Array.from({length:5},()=>['E01']),enemies:DEVELOPMENT_CONTENT.enemies.map(e=>({...e,hp:enemyHp,damage,cooldown:1,armor:0})),limits:{...CONTENT.limits,deadlineTick:deadline}};
 let run=createRun('single',1,'I01',content);const item={id:'single/item/4',defId:normal?'I09':'I15',spawnIndex:4};
 const added=addInstances(run.inventory,[item],content);assert(added.ok);run={...run,inventory:added.state,nextSpawnIndex:5,hp};
 for(const [id,x,y] of [[run.inventory.instances[0].id,0,0],...(placed?[[item.id,2,0]]:[])]){
  const result=transactInventory(run.inventory,{type:'place',instanceId:id,x,y,rotation:0,expectedRevision:run.inventory.revision},content);assert(result.ok,result.reason);run={...run,inventory:result.state};
 }
 const cmd={commandId:'start',runId:run.id,expectedRevision:run.revision,action:{type:'start-combat'}};
 const started=applyRunCommand(run,cmd,content);assert(started.ok);return {run:started.state,content,id:item.id,cmd};
}
const has=(run,id)=>run.inventory.instances.some(i=>i.id===id);

test('SINGLE content: 1x1 emergency supply is development-open, normal pool unchanged',()=>{
 const item=CONTENT.items.find(i=>i.id==='I15');assert.equal(item.lifetime,'single-use');assert.equal(item.shape.length,1);assert.equal(item.unlocked,false);assert(DEVELOPMENT_CONTENT.items.find(i=>i.id==='I15').unlocked);assert.deepEqual(validateContent(DEVELOPMENT_CONTENT),[]);
});
test('SINGLE activates after surviving HP damage and stays inspectable until wave boundary',()=>{
 const f=fixture();const before=clone(f.run);const run=advanceRun(f.run,1,f.content);assert.equal(run.phase,'combat');assert.equal(run.hp,56);assert(has(run,f.id));assert.equal(run.combat.consumables[0].used,1);assert.equal(run.combat.consumables[0].singleUse,true);assert.equal(run.combat.events.filter(e=>e.type==='consume'&&e.detail==='single-use').length,1);assert.deepEqual(f.run,before);
});
for(const [outcome,options] of [['victory',{damage:1,hp:41,enemyHp:1,deadline:15}],['defeat',{damage:20,hp:50}],['timeout',{damage:1,hp:41,deadline:3}]])test('SINGLE removal at '+outcome+' clears every inventory collection and cannot replay',()=>{
 const f=fixture(options);const r=advanceRun(f.run,450,f.content);assert.equal(r.combat.outcome,outcome);assert.equal(r.combat.consumables[0].used,1);assert(!has(r,f.id));assert(!r.inventory.stash.includes(f.id));assert(!r.inventory.placements.some(p=>p.instanceId===f.id));assert.deepEqual(r.inventory.history,[]);assert.equal(r.inventory.revision,f.run.inventory.revision+1);assert.deepEqual(validateInventory(r.inventory,f.content),[]);assert.equal(advanceRun(r,450,f.content),r);
 const dup=applyRunCommand(r,f.cmd,f.content);assert(dup.ok&&dup.duplicate);assert.equal(dup.state,r);assert(!has(dup.state,f.id));
});
test('SINGLE used item never returns on next preparation, new history or undo',()=>{
 const f=fixture({damage:1,hp:41,enemyHp:1,deadline:15});let run=advanceRun(f.run,450,f.content);
 const skip={commandId:'skip',runId:run.id,expectedRevision:run.revision,action:{type:'skip-loot'}};run=applyRunCommand(run,skip,f.content).state;assert.equal(run.phase,'preparation');assert(!has(run,f.id));
 const first=run.inventory.instances[0].id;const move=transactInventory(run.inventory,{type:'place',instanceId:first,x:1,y:0,rotation:0,expectedRevision:run.inventory.revision},f.content);assert(move.ok);const undo=transactInventory(move.state,{type:'undo',expectedRevision:move.state.revision},f.content);assert(undo.ok);assert(!undo.state.instances.some(i=>i.id===f.id));assert(!undo.state.placements.some(p=>p.instanceId===f.id));
});
test('SINGLE no damage below threshold does not spend immediately on opening combat',()=>{
 const f=fixture({hp:30,damage:1});const c=stepCombat({...f.run.combat,enemies:f.run.combat.enemies.map(e=>({...e,nextAttackTick:10}))},1);assert.equal(c.hp,30);assert.equal(c.consumables[0].used,0);
});
test('SINGLE shield-only hit cannot consume, even below threshold',()=>{
 const f=fixture({hp:30});const c=stepCombat({...f.run.combat,shield:50},1);assert.equal(c.hp,30);assert.equal(c.consumables[0].used,0);
});
test('SINGLE lethal hit cannot resurrect or spend item',()=>{
 const f=fixture({hp:20,damage:20});const run=advanceRun(f.run,450,f.content);assert.equal(run.hp,0);assert.equal(run.combat.outcome,'defeat');assert.equal(run.combat.consumables[0].used,0);assert(has(run,f.id));
});
test('SINGLE stash never participates and unused item survives waves',()=>{
 const f=fixture({placed:false,damage:1,hp:41,enemyHp:1,deadline:15});let r=advanceRun(f.run,450,f.content);assert.equal(r.combat.outcome,'victory');assert.equal(r.combat.consumables.length,0);assert(has(r,f.id));r=applyRunCommand(r,{commandId:'skip',runId:r.id,expectedRevision:r.revision,action:{type:'skip-loot'}},f.content).state;assert.equal(r.wave,2);assert(has(r,f.id));assert(r.inventory.stash.includes(f.id));
});
test('SINGLE unused equipped item survives victory',()=>{
 const f=fixture({damage:1,hp:120,enemyHp:1,deadline:15});const r=advanceRun(f.run,450,f.content);assert.equal(r.combat.outcome,'victory');assert.equal(r.combat.consumables[0].used,0);assert(has(r,f.id));
});
test('SINGLE bulk, frame partitions and JSON reload produce identical counters, events and inventory',()=>{
 const f=fixture();const bulk=advanceRun(f.run,450,f.content);let part=clone(f.run),events=[];while(part.phase==='combat'){part=advanceRun(part,1,f.content);events.push(...part.combat.events);}assert.deepEqual(events,bulk.combat.events);assert.deepEqual(part.combat.stats,bulk.combat.stats);assert.deepEqual(part.inventory,bulk.inventory);assert.equal(part.hp,bulk.hp);
});
test('SINGLE journal names spent item using sealed combat definition after inventory removal',()=>{
 const f=fixture();const run=advanceRun(f.run,450,f.content);const event=run.combat.events.find(e=>e.type==='consume'&&e.detail==='single-use');const entry=describeEvent(event,run,f.content);assert.match(entry.text,/封救.*已用尽/);assert.match(entry.text,/一次/);
});
test('SINGLE existing per-wave acute care remains equipped and resets next wave',()=>{
 const f=fixture({normal:true,damage:1,hp:41,enemyHp:1,deadline:15});let r=advanceRun(f.run,450,f.content);assert.equal(r.combat.consumables[0].used,1);assert(has(r,f.id));assert(!r.combat.consumables[0].singleUse);r=applyRunCommand(r,{commandId:'skip',runId:r.id,expectedRevision:r.revision,action:{type:'skip-loot'}},f.content).state;r=applyRunCommand(r,{commandId:'next',runId:r.id,expectedRevision:r.revision,action:{type:'start-combat'}},f.content).state;assert.equal(r.combat.consumables[0].used,0);
});
test('SINGLE malformed lifetime and unsupported effect configurations fail validation',()=>{
 for(const change of [{lifetime:'forever'},{effects:{emergencyHeal:26,healCharges:2,healThresholdBps:4000}},{effects:{emergencyHeal:26,healCharges:1,healThresholdBps:10001}},{effects:{emergencyHeal:26,healCharges:1,healThresholdBps:0}},{effects:{emergencyHeal:26,healCharges:1,healThresholdBps:4000,shield:1}},{category:'support'}]){const c=clone(CONTENT);Object.assign(c.items.find(i=>i.id==='I15'),change);assert(validateContent(c).length,JSON.stringify(change));}
});
test('SINGLE repeated projection is pure and cannot spend supply',()=>{
 const f=fixture();const before=clone(f.run.inventory);for(let i=0;i<5;i++){const l=evaluateLoadout(f.run.inventory,f.content);assert(l.consumables[0].singleUse);createCombat(l,f.content.enemies.slice(0,1),1,f.run.hp);}assert.deepEqual(f.run.inventory,before);
});
