'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {GameSession}=require('../../.test-build/application/session.js');
const {GamePresenter}=require('../../.test-build/presentation/GamePresenter.js');
const {SessionStore}=require('../../.test-build/application/session-store.js');
const {validateSessionSave}=require('../../.test-build/application/save-validation.js');
const {SAVE_KEYS}=require('../../.test-build/application/save-repository.js');
const {GROWTH_DEVELOPMENT_CONTENT:GROWTH,RESEARCH_CONTENT,withResearch,BALANCED_DEVELOPMENT_CONTENT:OLD,availableStarters}=require('../../.test-build/content/catalog.js');
const {RESEARCH_BLUEPRINTS,researchSpent}=require('../../.test-build/content/research.js');
const {plan,score:layoutScore}=require('../../tools/experiment_layout.cjs');
const clone=v=>JSON.parse(JSON.stringify(v));
class Storage {constructor(){this.values=new Map();this.fail=false;}get(k){return this.values.get(k)??null;}set(k,v){if(this.fail)throw Error('injected research write failure');this.values.set(k,v);}remove(k){this.values.delete(k);}}
function boot(storage=new Storage(),content=GROWTH){const store=new SessionStore(storage,content,'local-research-unit-test');const session=new GameSession(content,{namespace:()=>store.installId,initialState:store.load()||undefined,commit:(next,checkpoint)=>store.save(next,checkpoint)});return {storage,store,session};}
function act(h,action){const result=h.session.dispatch(action);assert.equal(result.ok,true,result.reason);return result;}
function fill(h){const run=h.session.state.run;const planned=plan(run.inventory,h.session.content,'local-layout');for(const move of planned.commands)act(h,{type:'inventory',command:{type:'place',instanceId:move.instanceId,x:move.x,y:move.y,rotation:move.rotation,expectedRevision:h.session.state.run.inventory.revision}});}
function earn(h=boot()){
  h.session.start(20261015,'I01');
  for(let wave=1;wave<=5;wave++){
    fill(h);act(h,{type:'start-combat'});h.session.advance(450);
    const run=h.session.state.run;if(run.phase==='defeat'){act(h,{type:'finish-defeat'});break;}
    if(run.phase==='settlement')break;
    assert.equal(run.phase,'loot');
    let best=0,score=-Infinity;
    const {addInstances}=require('../../.test-build/core/inventory.js');
    for(let i=0;i<run.loot.length;i++){
      const inv=addInstances(run.inventory,run.loot[i].itemIds.map((defId,k)=>({id:run.id+'/item/'+(run.nextSpawnIndex+k),defId,spawnIndex:run.nextSpawnIndex+k})),h.session.content).state;
      const next=plan(inv,h.session.content,'local-layout');const value=layoutScore(next.inventory,h.session.content);if(value>score){score=value;best=i;}
    }
    act(h,{type:'choose-loot',optionId:run.loot[best].id});
  }
  act(h,{type:'claim-settlement'});assert(h.session.state.wallet>=8,'genuine playthrough must earn first research');return h;
}
function payload(h){return JSON.parse(h.storage.get(SAVE_KEYS.current)).payload;}

test('RESEARCH baseline has 12 drops, 3 starters; blueprint changes only access flags and never combat stats',()=>{
  assert.equal(RESEARCH_CONTENT.items.filter(item=>item.unlocked).length,12);
  assert.deepEqual(availableStarters(RESEARCH_CONTENT).map(item=>item.id),['I01','I02','I03']);
  const all=withResearch(RESEARCH_CONTENT,RESEARCH_BLUEPRINTS.map(bp=>bp.itemId));assert.equal(all.items.filter(item=>item.unlocked).length,17);
  assert.equal(availableStarters(all).length,4);
  all.items.forEach((item,i)=>assert.deepEqual({...item,unlocked:RESEARCH_CONTENT.items[i].unlocked},RESEARCH_CONTENT.items[i]));
  assert.deepEqual(all.limits,RESEARCH_CONTENT.limits);assert.deepEqual(all.enemies,RESEARCH_CONTENT.enemies);
});

test('RESEARCH insufficient funds, unknown blueprints and active/unclaimed run cannot spend or switch',()=>{
  const h=boot();let before=h.session.state;
  assert.equal(h.session.purchaseResearch('relay').ok,false);assert.equal(h.session.purchaseResearch('invented').ok,false);assert.equal(h.session.state,before);
  h.session.start(1,'I01');before=h.session.state;
  assert.equal(h.session.purchaseResearch('relay').ok,false);assert.equal(h.session.setResearchMode('research').ok,false);assert.equal(h.session.state,before);
  act(h,{type:'abandon'});before=h.session.state;assert.equal(h.session.setResearchMode('research').ok,false);assert.equal(h.session.state,before);
  act(h,{type:'claim-settlement'});assert.equal(h.session.setResearchMode('research').ok,true);
});

test('RESEARCH real earned coins buy one durable blueprint; repeated purchase and claim never duplicate',()=>{
  const h=earn();const before=h.session.state.wallet;const settlement=clone(h.session.state.run);
  const rewards=clone(payload(h).rewardLedger);
  assert.equal(h.session.purchaseResearch('relay').ok,true);assert.equal(h.session.state.wallet,before-8);
  assert.deepEqual(h.session.state.run,settlement,'research cannot mutate finished combat or receipts');
  assert.deepEqual(payload(h).rewardLedger,rewards);assert.deepEqual(h.session.state.research.purchases,['relay']);
  const after=h.session.state;assert.equal(h.session.purchaseResearch('relay').ok,false);assert.equal(h.session.state,after);
  assert.equal(h.session.dispatch({type:'claim-settlement'}).ok,false);assert.equal(h.session.state.wallet,before-8);
  validateSessionSave(payload(h),GROWTH);
  const resumed=boot(h.storage);assert.deepEqual(resumed.session.state,h.session.state);
  assert.equal(resumed.session.purchaseResearch('relay').ok,false);
});

test('RESEARCH save failure never publishes deduction/unlock; reload recovers retry with exactly one spend',()=>{
  const h=earn();const before=h.session.state;h.storage.fail=true;
  assert.throws(()=>h.session.purchaseResearch('relay'),error=>error.code==='storage');assert.equal(h.session.state,before);
  h.storage.fail=false;const resumed=boot(h.storage);
  assert.equal(resumed.session.purchaseResearch('relay').ok,true);assert.equal(resumed.session.state.wallet,before.wallet-8);
  assert.equal(resumed.session.purchaseResearch('relay').ok,false);
});

test('RESEARCH new run freezes its unlock pool; sandbox preserves every item and old unfinished runs keep original rules',()=>{
  const h=earn();assert.equal(h.session.purchaseResearch('relay').ok,true);assert.equal(h.session.setResearchMode('research').ok,true);
  h.session.start(1,'I01');assert.equal(h.session.state.run.contentVersion,RESEARCH_CONTENT.version);
  assert.deepEqual(h.session.state.run.researchUnlocks,['I12']);assert.equal(h.session.content.items.find(item=>item.id==='I12').unlocked,true);
  assert.equal(h.session.content.items.find(item=>item.id==='I04').unlocked,false);validateSessionSave(payload(h),GROWTH);
  const before=h.session.state;assert.equal(h.session.purchaseResearch('saline').ok,false);assert.equal(h.session.state,before);
  const old=boot(new Storage(),OLD);old.session.start(1,'I04');const saved=clone(old.session.state);
  const upgraded=boot(old.storage);assert.deepEqual(upgraded.session.state,saved);assert.equal(upgraded.session.content.version,OLD.version);
  act(upgraded,{type:'abandon'});act(upgraded,{type:'claim-settlement'});upgraded.session.start(1,'I04');assert.equal(upgraded.session.content.version,GROWTH.version);
});

test('RESEARCH nonce-free spend reconciliation rejects forged balances, duplicates, unknown IDs and unowned snapshots',()=>{
  const h=earn();h.session.purchaseResearch('relay');const original=payload(h);
  for(const mutate of [p=>p.session.wallet++,p=>p.session.research.purchases.push('relay'),p=>p.session.research.purchases.push('future'),p=>p.session.research=null,p=>p.session.research.mode='future']){
    const p=clone(original);mutate(p);assert.throws(()=>validateSessionSave(p,GROWTH));
  }
  h.session.setResearchMode('research');h.session.start(1,'I01');
  const p=payload(h);p.session.run.researchUnlocks=['I04'];assert.throws(()=>validateSessionSave(p,GROWTH),/owned/);
  assert.throws(()=>withResearch(RESEARCH_CONTENT,['I12','I12']));assert.throws(()=>withResearch(RESEARCH_CONTENT,['I01']));
  assert.equal(researchSpent(undefined),0);
});

class Painter {begin(){}end(){}rect(){}line(){}circle(){}polygon(){}text(){}}
function render(p){p.update(0);p.draw(new Painter());return p;}
function click(p,id,disabled=false){const hit=p.hits.find(h=>h.id===id);assert(hit,id);if(!disabled)assert(hit.enabled,id);p.pointerDown(hit.x+hit.w/2,hit.y+hit.h/2);p.pointerUp(hit.x+hit.w/2,hit.y+hit.h/2);render(p);}

test('RESEARCH real pointer UI purchases only after confirmation, cancellation preserves coins and mode switches remain saved',()=>{
  const h=earn();const p=render(new GamePresenter(GROWTH,new SessionStore(h.storage,GROWTH,'local-research-ui-test')));
  assert.equal(p.screen,'menu');click(p,'open-research');const wallet=p.session.state.wallet;
  click(p,'research-relay');assert.equal(p.researchConfirm,'relay');p.key('Escape');render(p);assert.equal(p.researchConfirm,null);assert.equal(p.researchOpen,true);assert.equal(p.session.state.wallet,wallet);
  click(p,'research-relay');click(p,'research-confirm');assert.equal(p.session.state.wallet,wallet-8);
  assert.equal(p.hits.find(hit=>hit.id==='research-relay').enabled,false);click(p,'research-relay',true);assert.equal(p.session.state.wallet,wallet-8);
  click(p,'research-mode-growth');assert.equal(p.session.state.research.mode,'research');click(p,'research-close');
  assert.ok(!p.hits.some(hit=>hit.id==='starter-I04'));
  const next=render(new GamePresenter(GROWTH,new SessionStore(h.storage,GROWTH,'local-research-ui-resume')));
  assert.equal(next.session.state.wallet,wallet-8);assert.equal(next.session.state.research.mode,'research');
  click(next,'start-run');if(next.guidePage!==null)click(next,'guide-close');
  assert.deepEqual(next.session.state.run.researchUnlocks,['I12']);assert.ok(!next.hits.some(hit=>hit.id==='open-research'));
});

test('RESEARCH switching from locked sandbox nozzle atomically falls back to a valid saved starter',()=>{
  const h=boot();const p=render(new GamePresenter(GROWTH,new SessionStore(h.storage,GROWTH,'local-research-ui-test')));
  click(p,'starter-I04');click(p,'open-research');click(p,'research-mode-growth');click(p,'research-close');
  assert.equal(p.starter,'I01');assert.equal(p.persistenceError,null);
  const next=new GamePresenter(GROWTH,new SessionStore(h.storage,GROWTH,'local-research-ui-resume'));
  assert.equal(next.starter,'I01');assert.equal(next.persistenceError,null);
});
