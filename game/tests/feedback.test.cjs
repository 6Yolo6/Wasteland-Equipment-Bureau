'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {CONTENT,DEVELOPMENT_CONTENT,validateContent}=require('../../.test-build/content/catalog.js');
const {createInventory,transactInventory}=require('../../.test-build/core/inventory.js');
const {evaluateLoadout,attackSeconds,effectiveCooldown}=require('../../.test-build/core/loadout.js');
const {createCombat,stepCombat}=require('../../.test-build/core/combat.js');
const {inspectItem,placementChanges,BattleJournal,describeEvent}=require('../../.test-build/presentation/RuleReadout.js');
function board(entries){let inv=createInventory(entries.map((e,i)=>({id:e[0],defId:e[1],spawnIndex:i})));for(const [id,def,x,y,rotation=0] of entries){const r=transactInventory(inv,{type:'place',instanceId:id,x,y,rotation,expectedRevision:inv.revision},CONTENT);assert.equal(r.ok,true,r.reason);inv=r.state;}return inv;}
const w=(id,spawnIndex,cooldown,extra={})=>({instanceId:id,defId:'I01',spawnIndex,cooldown,damage:1,targets:1,splash:0,bonusDamage:0,hasteBps:0,thirdHitDamage:0,...extra});
const enemy=(extra={})=>({id:'E01',name:'Test enemy',hp:10000,damage:1,cooldown:1000,armor:0,color:'#fff',behavior:'normal',...extra});
const loadout=(extra={})=>({maxHp:120,initialShield:0,reduction:0,critBps:0,critMultiplierBps:15000,shieldCap:80,killShield:0,killShieldCap:20,weapons:[w('a',0,3),w('b',1,5)],consumables:[],combos:[],capped:[],circuits:[{anchorId:'wire',weaponIds:['a','b'],delayTicks:3,maxPulses:3}],...extra});
const shots=c=>c.events.filter(e=>e.type==='attack'&&e.source==='a').map(e=>e.tick);

test('FEEDBACK battery bug: 0.7s blade keeps a 0.63s mean instead of losing haste to rounding',()=>{
 const initial=createCombat(loadout({weapons:[w('a',0,7,{hasteBps:1000})],circuits:[]}),[enemy()],1,null);
 assert.equal(attackSeconds(initial.weapons[0]),0.63);assert.equal(effectiveCooldown(initial.weapons[0]),7);
 const result=stepCombat(initial,63);assert.deepEqual(shots(result),[7,13,19,26,32,38,45,51,57,63]);assert.equal(initial.weapons[0].attacks,0);
 const plain=stepCombat(createCombat(loadout({weapons:[w('a',0,7)],circuits:[]}),[enemy()],1,null),63);assert.equal(plain.weapons[0].attacks,9);assert.equal(result.weapons[0].attacks,10);
});
test('FEEDBACK timing: every scheduled shot is within one simulation tick of the exact mean, never early',()=>{
 for(const base of [7,12,16,20])for(const hasteBps of [0,1000,2000]){
  const weapon=w('a',0,base,{hasteBps});const c=stepCombat(createCombat(loadout({weapons:[weapon],circuits:[]}),[enemy()],1,null),400);
  shots(c).forEach((tick,i)=>{const exact=(i+1)*attackSeconds(weapon)*10;assert(tick+1e-10>=exact);assert(tick-exact<1+1e-10);});
 }
});
test('FEEDBACK timing and relay: partitioned, bulk and JSON-resumed simulation have identical event histories',()=>{
 const initial=createCombat(loadout({weapons:[w('a',0,7,{hasteBps:1000}),w('b',1,12,{hasteBps:1000})]}),[enemy({cooldown:20})],77,null);
 const bulk=stepCombat(initial,200);let split=initial;const events=[];for(let i=0;i<200;i++){split=stepCombat(JSON.parse(JSON.stringify(split)),1);events.push(...split.events);}
 assert.deepEqual(events,bulk.events);assert.deepEqual({...split,events:[]},{...bulk,events:[]});
});
test('FEEDBACK C02: legal copper anchor requires a battery and two distinct weapon instances',()=>{
 const inv=board([['gun','I01',2,0],['blade','I03',0,3],['battery','I07',1,1],['wire','I12',1,2]]);
 const l=evaluateLoadout(inv,CONTENT);assert.deepEqual(l.circuits,[{anchorId:'wire',weaponIds:['gun','blade'],delayTicks:3,maxPulses:3}]);
 assert.equal(inspectItem(inv,CONTENT,'wire').active,true);assert(inspectItem(inv,CONTENT,'wire').lines.some(s=>s.includes('各开火一次')));
 const removed=transactInventory(inv,{type:'stash',instanceId:'battery',expectedRevision:inv.revision},CONTENT).state;
 assert.equal(evaluateLoadout(removed,CONTENT).circuits.length,0);assert(inspectItem(removed,CONTENT,'wire').lines.some(s=>s.includes('还缺：电池')));
});
test('FEEDBACK C02: repeated shots from one weapon do not fill both relay inputs',()=>{
 const c=stepCombat(createCombat(loadout({weapons:[w('a',0,3),w('b',1,20)]}),[enemy()],1,null),19);
 assert.equal(c.circuits[0].pulses,0);assert.deepEqual(c.circuits[0].firedWeaponIds,['a']);
 assert.equal(stepCombat(c,1).circuits[0].pulses,1);
});
test('FEEDBACK C02: delay targets the earliest enemy intent, not an arbitrary front target',()=>{
 const c=stepCombat(createCombat(loadout(),[enemy({cooldown:30}),enemy({id:'E02',cooldown:12})],1,null),5);
 assert.equal(c.enemies[0].nextAttackTick,30);assert.equal(c.enemies[1].nextAttackTick,15);
 const event=c.events.find(e=>e.type==='relay');assert.equal(event.target,c.enemies[1].instanceId);assert.equal(event.amount,3);assert.equal(event.remaining,2);
});
test('FEEDBACK C02: at most three pulses per wave, and tied intents use spawn order',()=>{
 const initial=createCombat(loadout(),[enemy({cooldown:100}),enemy({cooldown:100})],1,null);const c=stepCombat(initial,50);
 assert.deepEqual(c.events.filter(e=>e.type==='relay').map(e=>e.tick),[5,10,15]);assert.equal(c.circuits[0].pulses,3);assert.equal(c.stats.comboTriggers,3);
 assert.equal(c.enemies[0].nextAttackTick,106);assert.equal(c.enemies[1].nextAttackTick,103);assert.deepEqual(initial.circuits[0].firedWeaponIds,[]);
});
test('FEEDBACK C02: same-tick relay postpones an enemy attack without undoing an already delivered attack',()=>{
 const c=stepCombat(createCombat(loadout(),[enemy({cooldown:5})],1,null),5);assert.equal(c.hp,120);assert.equal(c.enemies[0].nextAttackTick,8);
 const next=stepCombat(c,3);assert.equal(next.hp,119);assert.equal(next.events.filter(e=>e.type==='attack'&&e.target==='player')[0].tick,8);
});
test('FEEDBACK C02: no pulse after the last target dies, no extra RNG or consumable spending',()=>{
 const won=stepCombat(createCombat(loadout(),[enemy({hp:2})],1,null),5);assert.equal(won.outcome,'victory');assert.equal(won.circuits[0].pulses,0);
 const withRelay=stepCombat(createCombat(loadout(),[enemy()],19,null),50);const without=stepCombat(createCombat(loadout({circuits:[]}),[enemy()],19,null),50);
 assert.equal(withRelay.rng,without.rng);assert.deepEqual(withRelay.weapons,without.weapons);
});
test('FEEDBACK C02: invalid wiring, repeated anchors and corrupted runtime progress are rejected',()=>{
 for(const relay of [{anchorId:'wire',weaponIds:['a','a'],delayTicks:3,maxPulses:3},{anchorId:'wire',weaponIds:['a','missing'],delayTicks:3,maxPulses:3},{anchorId:'wire',weaponIds:['a','b'],delayTicks:0,maxPulses:3}])assert.throws(()=>createCombat(loadout({circuits:[relay]}),[enemy()],1,null));
 const c=createCombat(loadout(),[enemy()],1,null);c.circuits[0].firedWeaponIds=['a','a'];assert.throws(()=>stepCombat(c,1));
 const bad=structuredClone(CONTENT);bad.combos.find(c=>c.id==='C02').relay.maxPulses=0;assert(validateContent(bad).length);
});
test('FEEDBACK layout: a diagonal battery reports disconnected, an edge connects the exact receiver',()=>{
 const diagonal=board([['blade','I03',0,0],['battery','I07',2,1]]);assert.equal(inspectItem(diagonal,CONTENT,'battery').active,false);
 const placed=transactInventory(diagonal,{type:'place',instanceId:'battery',x:1,y:1,rotation:0,expectedRevision:diagonal.revision},CONTENT).state;
 const info=inspectItem(placed,CONTENT,'battery');assert.equal(info.active,true);assert.deepEqual(info.peers,['blade']);assert(info.lines.some(s=>s.includes('0.7 → 0.63秒')));
 assert(placementChanges(diagonal,placed,CONTENT).some(s=>s.includes('0.7秒→0.63秒')));assert.equal(inspectItem(diagonal,CONTENT,'battery').active,false);
});
test('FEEDBACK readout: inspection does not alter inventory, history, RNG or charges',()=>{
 const inv=board([['gun','I01',0,0],['plate','I05',1,0],['battery','I07',0,2],['kit','I09',1,2]]),saved=structuredClone(inv);
 for(let i=0;i<20;i++)for(const item of inv.instances)inspectItem(inv,CONTENT,item.id);
 assert.deepEqual(inv,saved);
});
test('FEEDBACK events: incoming damage exposes exact mitigation and shield/HP split',()=>{
 const c=stepCombat(createCombat(loadout({weapons:[],circuits:[],initialShield:2,reduction:1}),[enemy({damage:5,cooldown:1})],1,null),1);
 const hit=c.events.find(e=>e.type==='damage'&&e.target==='player');assert.deepEqual([hit.raw,hit.blocked,hit.absorbed,hit.amount],[5,1,2,2]);assert.equal(c.hp,118);
});
test('FEEDBACK events: used piercing doses and periodic full-health healing have explicit counters',()=>{
 const supply={instanceId:'medicine',spawnIndex:8,emergencyHeal:0,thresholdBps:0,periodicHeal:5,everyTicks:3,charges:2,pierce:1,pierceCharges:2};
 const c=stepCombat(createCombat(loadout({consumables:[supply],circuits:[]}),[enemy()],1,null),6);
 assert.deepEqual(c.events.filter(e=>e.type==='consume').map(e=>e.remaining),[1,0]);
 assert.deepEqual(c.events.filter(e=>e.type==='heal').map(e=>[e.amount,e.remaining]),[[0,1],[0,0]]);
});
test('FEEDBACK journal: events survive empty frames, dedupe, bound memory, and reset per wave',()=>{
 const journal=new BattleJournal();const c=createCombat(loadout({circuits:[]}),[enemy()],1,null);
 const run={id:'test',wave:1,inventory:createInventory([{id:'a',defId:'I01',spawnIndex:0},{id:'b',defId:'I03',spawnIndex:1}]),combat:stepCombat(c,30)};
 journal.capture(run,CONTENT);const before=structuredClone(journal.entries);journal.capture(run,CONTENT);assert.deepEqual(journal.entries,before);
 run.combat={...run.combat,events:[]};journal.capture(run,CONTENT);assert.deepEqual(journal.entries,before);
 run.combat={...run.combat,events:Array.from({length:200},(_,i)=>({seq:1000+i,tick:50+i,type:'damage',source:'a',target:run.combat.enemies[0].instanceId,amount:1,detail:'base'}))};journal.capture(run,CONTENT);assert.equal(journal.entries.length,160);
 run.wave=2;run.combat={...c,events:[]};journal.capture(run,CONTENT);assert.equal(journal.entries.length,0);
});
test('FEEDBACK rules version: changed rules keep explicit, isolated A/B seed namespaces',()=>{
 assert.equal(CONTENT.version,'mvp-0.2.3');assert.equal(CONTENT.randomNamespace,'mvp-0.2.0');assert.equal(DEVELOPMENT_CONTENT.randomNamespace,'mvp-0.2.0-dev-all');assert.notEqual(CONTENT.randomNamespace,DEVELOPMENT_CONTENT.randomNamespace);
});

test('FEEDBACK optional circuit data: omitted is valid, malformed null/false/zero is not silently ignored',()=>{
 for(const circuits of [null,false,0,''])assert.throws(()=>createCombat(loadout({circuits}),[enemy()],1,null));
 const legacy=loadout();delete legacy.circuits;assert.deepEqual(createCombat(legacy,[enemy()],1,null).circuits,[]);
});
