'use strict';
// Real presenter hit regions/pointer methods, in-memory painter/storage only.
// This is NOT Cocos, Chrome, screenshots or touch-device verification.
const test=require('node:test');const assert=require('node:assert/strict');
const {makeLegacySaveFixture,PHASES}=require('../../tools/lib/legacy-save-fixtures.cjs');
const {BALANCED_DEVELOPMENT_CONTENT:CURRENT,DEVELOPMENT_CONTENT:OLD}=require('../../.test-build/content/catalog.js');
const {GamePresenter}=require('../../.test-build/presentation/GamePresenter.js');
const {SessionStore}=require('../../.test-build/application/session-store.js');
const {GameSession}=require('../../.test-build/application/session.js');
const {SAVE_KEYS}=require('../../.test-build/application/save-repository.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const painter={begin(){},end(){},rect(){},line(){},circle(){},polygon(){},text(){}};
function draw(p){p.draw(painter);}
function click(p,id){p.update(1/60);draw(p);const hit=p.hits.find(h=>h.id===id);assert(hit&&hit.enabled,'Missing hit '+id);p.pointerDown(hit.x+hit.w/2,hit.y+hit.h/2);p.pointerUp(hit.x+hit.w/2,hit.y+hit.h/2);p.update(1/60);draw(p);assert.equal(p.persistenceError,null);}
function boot(storage){return new GamePresenter(CURRENT,new SessionStore(storage,CURRENT,'local-controller-route-new-id-0001'));}
function reload(p,storage){const before=clone(p.session.state);assert.equal(p.checkpoint(),true);const fresh=boot(storage);draw(fresh);assert.deepEqual(fresh.session.state,before);return fresh;}
const comparable=run=>({...run,revision:0,combat:{...run.combat,events:[]}});
for(const phase of PHASES)test('LEGACY UI route '+phase+' uses real pointer commands, old resume, one reward and tuned next run',()=>{
 const f=makeLegacySaveFixture(phase),values=new Map(Object.entries(f.slots).filter(([,v])=>v!==null));const storage={get:k=>values.get(k)??null,set:(k,v)=>values.set(k,v),remove:k=>values.delete(k)};const raw=[...values];let p=boot(storage);draw(p);
 assert.deepEqual([...values],raw,'first load preserves original slots');assert.deepEqual(p.session.state,f.expected);assert.equal(p.content.version,phase==='settlement-claimed'?CURRENT.version:OLD.version);
 if(phase==='combat'){assert(p.driver.reasons.has('resume-confirmation'));const before=clone(p.session.state);p.update(.35);assert.deepEqual(p.session.state,before);assert.equal(p.session.state.run.combat.weapons.find(w=>w.defId==='I03').damage,7);}
 p=reload(p,storage);const env=JSON.parse(values.get(SAVE_KEYS.current));assert.equal(env.contentVersion,CURRENT.version);assert.equal(env.payload.session.run.contentVersion,OLD.version);
 if(phase==='combat'){
  const before=clone(p.session.state);click(p,'resume-combat');for(let i=0;i<30;i++)p.update(1/60);click(p,'pause-combat');const actual=p.session.state.run;const control=new GameSession(OLD,{initialState:before});control.advance(actual.combat.tick-before.run.combat.tick);assert.deepEqual(comparable(actual),comparable(control.state.run));
 }
 if(phase==='loot'){click(p,'skip-loot');assert.equal(p.session.state.run.phase,'preparation');assert.equal(p.content.version,OLD.version);}
 if(phase==='settlement-unclaimed'){click(p,'claim-and-menu');assert.equal(p.session.state.wallet,32);p=reload(p,storage);assert.equal(p.session.state.wallet,32);assert.equal(p.session.dispatch({type:'claim-settlement'}).ok,false);assert.equal(p.session.state.wallet,32);}
 else if(phase!=='settlement-claimed'){if(p.driver.reasons.size)click(p,'resume-combat');click(p,'abandon-run');click(p,'confirm-abandon');click(p,'claim-and-menu');}
 assert.equal(p.screen,'menu');const wallet=p.session.state.wallet;click(p,'start-run');assert.equal(p.session.state.run.contentVersion,CURRENT.version);assert.equal(p.session.state.wallet,wallet);assert.equal(p.guidePage,null,'fixture tutorial was genuinely persisted');
 const blade=p.session.state.run.inventory.instances.find(i=>i.defId==='I03');click(p,'stash-item-'+blade.id);draw(p);const hit=p.hits.find(h=>h.itemId===blade.id);p.pointerDown(hit.x+hit.w/2,hit.y+hit.h/2);p.pointerMove(82,450);p.pointerUp(82,450);p.update(1/60);draw(p);assert(p.session.state.run.inventory.placements.some(v=>v.instanceId===blade.id));
 click(p,'start-combat');p.update(.3);click(p,'pause-combat');assert.equal(p.session.state.run.combat.weapons[0].damage,5);p=reload(p,storage);assert.equal(p.session.state.wallet,wallet);assert.equal(p.session.state.run.combat.weapons[0].damage,5);assert(p.driver.reasons.has('resume-confirmation'));
});
