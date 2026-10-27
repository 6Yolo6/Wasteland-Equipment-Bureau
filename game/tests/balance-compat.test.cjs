'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {CONTENT,DEVELOPMENT_CONTENT,BALANCED_CONTENT,BALANCED_DEVELOPMENT_CONTENT,contentForVersion,compatibleContentVersions,validateContent}=require('../../.test-build/content/catalog.js');
const {GameSession}=require('../../.test-build/application/session.js');
const {SessionStore}=require('../../.test-build/application/session-store.js');
const {GamePresenter}=require('../../.test-build/presentation/GamePresenter.js');
const {SAVE_KEYS,sealSave}=require('../../.test-build/application/save-repository.js');
const {evaluateLoadout}=require('../../.test-build/core/loadout.js');
const {transactInventory,createInventory}=require('../../.test-build/core/inventory.js');
const {manualRules,definitionLines}=require('../../.test-build/presentation/FieldManual.js');
const {plan,pairedWave}=require('../../tools/experiment_layout.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));
const INSTALL='local-balance-test-0001';
class Memory {constructor(){this.values=new Map();}get(k){return this.values.get(k)??null;}set(k,v){this.values.set(k,v);}remove(k){this.values.delete(k);}}
function open(storage,content){const store=new SessionStore(storage,content,INSTALL);const initialState=store.load()||undefined;const session=new GameSession(content,{initialState,namespace:INSTALL,commit:(s,c)=>store.save(s,c)});return {store,session};}
function accept(session,action){const r=session.dispatch(action);assert(r.ok,r.reason);return r;}
function equip(session){for(const command of plan(session.state.run.inventory,session.content,'first-fit').commands)accept(session,{type:'inventory',command});}
function prepTo(session,wave){while(session.state.run.wave<wave){equip(session);accept(session,{type:'start-combat'});session.advance(450);assert.equal(session.state.run.phase,'loot');accept(session,{type:'choose-loot',optionId:session.state.run.loot[0].id});}}
function legacy(phase){const storage=new Memory(),h=open(storage,DEVELOPMENT_CONTENT);h.session.start(1,'I03');
 if(phase!=='preparation'){prepTo(h.session,phase==='combat'?2:1);equip(h.session);accept(h.session,{type:'start-combat'});h.session.advance(phase==='combat'?13:450);}
 if(phase==='settlement-unclaimed'||phase==='settlement-claimed'){accept(h.session,{type:'abandon'});if(phase==='settlement-claimed')accept(h.session,{type:'claim-settlement'});}
 return {storage,...h};}
test('BALANCE new runs use explicit tuned stats; old catalogs are unchanged',()=>{
 for(const c of [BALANCED_CONTENT,BALANCED_DEVELOPMENT_CONTENT])assert.deepEqual(validateContent(c),[]);
 assert.deepEqual(CONTENT.items.filter(i=>i.weapon).map(i=>i.weapon.damage),[12,18,7,5]);assert.deepEqual(BALANCED_CONTENT.items.filter(i=>i.weapon).map(i=>i.weapon.damage),[9,14,5,8]);
 assert.equal(CONTENT.items.find(i=>i.id==='I13').effects.adjacentDamage,1);assert.equal(BALANCED_CONTENT.items.find(i=>i.id==='I13').effects.adjacentDamage,2);
 assert.deepEqual(BALANCED_CONTENT.enemies,CONTENT.enemies);assert.deepEqual(BALANCED_CONTENT.waves,CONTENT.waves);assert.deepEqual(BALANCED_CONTENT.event,CONTENT.event);
 assert.deepEqual(BALANCED_CONTENT.items.map(i=>[i.id,i.weight,i.shape,i.unlocked]),CONTENT.items.map(i=>[i.id,i.weight,i.shape,i.unlocked]));
});
test('BALANCE same-pool legacy allowlist only; future and cross-pool versions rejected',()=>{
 assert.equal(contentForVersion(BALANCED_CONTENT,CONTENT.version),CONTENT);assert.equal(contentForVersion(BALANCED_DEVELOPMENT_CONTENT,DEVELOPMENT_CONTENT.version),DEVELOPMENT_CONTENT);
 for(const v of ['unknown','mvp-0.2.2',DEVELOPMENT_CONTENT.version])assert.equal(contentForVersion(BALANCED_CONTENT,v),undefined);
 assert.deepEqual(compatibleContentVersions(BALANCED_CONTENT),[CONTENT.version]);
});
for(const phase of ['preparation','combat','loot','settlement-unclaimed','settlement-claimed'])test('BALANCE legacy '+phase+' read preserves bytes, counters and wallet; next save upgrades envelope only',()=>{
 const old=legacy(phase),before=clone(old.session.state),control=new GameSession(DEVELOPMENT_CONTENT,{initialState:clone(old.session.state)}),raw=[...old.storage.values];const fresh=open(old.storage,BALANCED_DEVELOPMENT_CONTENT);
 assert.deepEqual([...old.storage.values],raw,'load is read-only');assert.deepEqual(fresh.session.state,before);assert.equal(fresh.session.content.version,DEVELOPMENT_CONTENT.version);
 fresh.store.save(fresh.session.state);const envelope=JSON.parse(old.storage.get(SAVE_KEYS.current));assert.equal(envelope.contentVersion,BALANCED_DEVELOPMENT_CONTENT.version);assert.equal(envelope.payload.session.run.contentVersion,DEVELOPMENT_CONTENT.version);
 const again=open(old.storage,BALANCED_DEVELOPMENT_CONTENT);assert.deepEqual(again.session.state,before);
 if(phase==='combat'){control.advance(23);again.session.advance(23);assert.deepEqual(again.session.state,control.state,'old combat keeps its old scheduler/RNG/stats');}
});
test('BALANCE unfinished old run uses old rules through loot and settlement; reward cannot duplicate and next run is tuned',()=>{
 const old=legacy('loot'),fresh=open(old.storage,BALANCED_DEVELOPMENT_CONTENT);accept(fresh.session,{type:'choose-loot',optionId:fresh.session.state.run.loot[0].id});assert.equal(fresh.session.content.version,DEVELOPMENT_CONTENT.version);
 accept(fresh.session,{type:'abandon'});accept(fresh.session,{type:'claim-settlement'});const coins=fresh.session.state.wallet;const again=open(old.storage,BALANCED_DEVELOPMENT_CONTENT);assert.equal(again.session.dispatch({type:'claim-settlement'}).ok,false);assert.equal(again.session.state.wallet,coins);
 again.session.start(42,'I04');assert.equal(again.session.state.run.contentVersion,BALANCED_DEVELOPMENT_CONTENT.version);assert.equal(again.session.content.items.find(i=>i.id==='I04').weapon.damage,8);assert.equal(again.session.state.wallet,coins);
});
test('BALANCE menu displays new rules but resumed run displays legacy rules and remains paused',()=>{
 const old=legacy('combat');const store=new SessionStore(old.storage,BALANCED_DEVELOPMENT_CONTENT,INSTALL);const p=new GamePresenter(BALANCED_DEVELOPMENT_CONTENT,store);assert.equal(p.content.version,DEVELOPMENT_CONTENT.version);assert(p.driver.reasons.has('resume-confirmation'));const before=clone(p.session.state);p.update(.5);assert.deepEqual(p.session.state,before);
 p.screen='menu';assert.equal(p.content.version,BALANCED_DEVELOPMENT_CONTENT.version);
});
test('BALANCE new and legacy runs have identical loot offers and RNG for identical first-wave layouts',()=>{
 for(const seed of [1,2,3,7,42,20261015]){const a=new GameSession(DEVELOPMENT_CONTENT),b=new GameSession(BALANCED_DEVELOPMENT_CONTENT);for(const s of [a,b]){s.start(seed,'I03');equip(s);accept(s,{type:'start-combat'});s.advance(450);assert.equal(s.state.run.phase,'loot');}assert.deepEqual(a.state.run.loot,b.state.run.loot);assert.equal(a.state.run.lootEvent,b.state.run.lootEvent);}
});
test('BALANCE adjacent iron is +2, multiple edges do not multiply it, cap stays +3',()=>{
 let inv=createInventory([{id:'w',defId:'I01',spawnIndex:0},{id:'a',defId:'I13',spawnIndex:1},{id:'b',defId:'I13',spawnIndex:2}]);for(const [id,x,y] of [['w',0,0],['a',1,0],['b',0,2]]){const r=transactInventory(inv,{type:'place',instanceId:id,x,y,rotation:0,expectedRevision:inv.revision},BALANCED_CONTENT);assert(r.ok);inv=r.state;}assert.equal(evaluateLoadout(inv,BALANCED_CONTENT).weapons[0].bonusDamage,3);assert.equal(evaluateLoadout(inv,CONTENT).weapons[0].bonusDamage,2);
});
test('BALANCE unknown or cross-pool saved run is blocked without touching storage',()=>{
 for(const version of ['future-content',CONTENT.version]){const old=legacy('preparation');const env=JSON.parse(old.storage.get(SAVE_KEYS.current));const {checksum,...body}=env;body.contentVersion=version;body.payload.session.run.contentVersion=version;old.storage.set(SAVE_KEYS.current,JSON.stringify(sealSave(body)));const raw=[...old.storage.values];assert.throws(()=>open(old.storage,BALANCED_DEVELOPMENT_CONTENT));assert.deepEqual([...old.storage.values],raw);}
});
test('BALANCE manual reflects tuned weapon/iron values and real save availability',()=>{
 assert.match(definitionLines(BALANCED_CONTENT.items[0],BALANCED_CONTENT).join(' '),/9伤害/);assert.match(definitionLines(BALANCED_CONTENT.items.find(i=>i.id==='I13'),BALANCED_CONTENT).join(' '),/伤害 \+2/);const rules=manualRules(BALANCED_CONTENT).find(r=>r.id==='R01').lines.join(' ');assert.match(rules,/已有本机存档/);assert.match(rules,/角铁每件加2/);
});

test('BALANCE paired layout experiment never changes the equipped set, owned set or source inventory',()=>{
 const s=new GameSession(BALANCED_DEVELOPMENT_CONTENT);s.start(42,'I03');const before=clone(s.state.run.inventory);const a=plan(before,s.content,'first-fit'),b=plan(before,s.content,'local-layout');assert.deepEqual(a.inventory.placements.map(p=>p.instanceId).sort(),b.inventory.placements.map(p=>p.instanceId).sort());assert.deepEqual(a.inventory.instances,b.inventory.instances);assert.deepEqual(before,s.state.run.inventory);const pair=pairedWave(before,s.content,42,1,null);assert(pair.sameOwnedAndEquipped);assert.deepEqual(before,s.state.run.inventory);
});
test('BALANCE unknown in-memory run cannot silently switch to the new rules',()=>{
 const s=new GameSession(BALANCED_CONTENT);s.start(1,'I03');s.state.run.contentVersion='unknown';assert.throws(()=>s.content,/Unknown run content/);assert.throws(()=>s.advance(1),/Unknown run content/);
});

test('BALANCE old five-wave run finishes identically under new app, then claims exactly 32 coins once',()=>{
 const old=legacy('preparation'),fresh=open(old.storage,BALANCED_DEVELOPMENT_CONTENT);const control=new GameSession(DEVELOPMENT_CONTENT,{initialState:clone(old.session.state)});
 while(control.state.run.phase==='preparation'){
  for(const s of [control,fresh.session]){equip(s);accept(s,{type:'start-combat'});s.advance(450);}
  assert.deepEqual(fresh.session.state,control.state);
  if(control.state.run.phase==='loot')for(const s of [control,fresh.session])accept(s,{type:'choose-loot',optionId:s.state.run.loot[0].id});
 }
 assert.equal(fresh.session.state.run.settlement.reason,'victory');assert.equal(fresh.session.state.run.settlement.baseCoins,32);accept(fresh.session,{type:'claim-settlement'});const loaded=open(old.storage,BALANCED_DEVELOPMENT_CONTENT);assert.equal(loaded.session.state.wallet,32);assert.equal(loaded.session.dispatch({type:'claim-settlement'}).ok,false);assert.equal(loaded.session.state.wallet,32);
});
