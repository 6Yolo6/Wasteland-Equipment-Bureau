'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {canonicalJson,crc32Ascii,checksum,CHECKSUM_ALGORITHM}=require('../../.test-build/core/save-codec.js');
const {SaveRepository,SAVE_KEYS,sealSave}=require('../../.test-build/application/save-repository.js');
const {SessionStore}=require('../../.test-build/application/session-store.js');
const {validateSessionSave}=require('../../.test-build/application/save-validation.js');
const {GameSession}=require('../../.test-build/application/session.js');
const {GamePresenter}=require('../../.test-build/presentation/GamePresenter.js');
const {LocalStorageAdapter}=require('../../.test-build/adapters/local-storage.js');
const {DEVELOPMENT_CONTENT:CONTENT}=require('../../.test-build/content/catalog.js');
const {RNG_VERSION}=require('../../.test-build/core/random.js');
const clone=value=>JSON.parse(JSON.stringify(value));
const INSTALL='local-storage-test-0001';
class MemoryStorage {
  constructor(){this.values=new Map();this.operations=[];this.fail=null;}
  get(key){this.operations.push(['get',key]);if(this.fail)this.fail('get',key,this);return this.values.get(key)??null;}
  set(key,value){this.operations.push(['set',key]);if(this.fail)this.fail('set',key,this);this.values.set(key,value);}
  remove(key){this.operations.push(['remove',key]);if(this.fail)this.fail('remove',key,this);this.values.delete(key);}
}
const validate=value=>{assert.equal(typeof value.coins,'number');assert.ok(Number.isSafeInteger(value.coins)&&value.coins>=0);assert.ok(Array.isArray(value.receipts));assert.equal(value.receipts.reduce((s,v)=>s+v,0),value.coins);};
function repo(storage=new MemoryStorage()){const repository=new SaveRepository(storage,'test-content',validate);repository.load();return {storage,repository};}
function body(payload,revision=1,overrides={}){return {schemaVersion:1,revision,contentVersion:'test-content',rngVersion:RNG_VERSION,installId:INSTALL,checksumAlgorithm:CHECKSUM_ALGORITHM,payload,extensions:{},...overrides};}
function boot(storage=new MemoryStorage()){const store=new SessionStore(storage,CONTENT,INSTALL);const presenter=new GamePresenter(CONTENT,store);return {storage,store,presenter,session:presenter.session};}
function begin(h=boot(),seed=1,starter='I03'){h.presenter.seed=seed;h.presenter.starter=starter;h.presenter.start();assert.equal(h.presenter.persistenceError,null);return h;}
function action(h,value){const result=h.session.dispatch(value);assert.equal(result.ok,true,result.reason);return result;}
function place(h,spawnIndex,x,y){const run=h.session.state.run;return action(h,{type:'inventory',command:{type:'place',instanceId:run.inventory.instances.find(i=>i.spawnIndex===spawnIndex).id,x,y,rotation:0,expectedRevision:run.inventory.revision}});}
function render(p){const calls=[];p.draw({begin(){},end(){},rect(){},line(){},circle(){},polygon(){},text(...v){calls.push(v);}});return calls;}
function click(p,id){render(p);const hit=p.hits.find(v=>v.id===id);assert.ok(hit,'Missing '+id);assert.equal(hit.enabled,true);p.pointerDown(hit.x+hit.w/2,hit.y+hit.h/2);p.pointerUp(hit.x+hit.w/2,hit.y+hit.h/2);}

test('SAVE CRC32 reference vectors and canonical order/Unicode are deterministic',()=>{
  assert.equal(crc32Ascii(''),'00000000');assert.equal(crc32Ascii('123456789'),'cbf43926');
  assert.equal(canonicalJson({z:1,a:'中文😀',b:[true,null,-1]}),'{"a":"\\u4e2d\\u6587\\ud83d\\ude00","b":[true,null,-1],"z":1}');
  assert.equal(checksum({b:2,a:1}),checksum({a:1,b:2}));assert.notEqual(checksum({a:2}),checksum({a:1}));
});
test('SAVE unsupported/nonfinite/fractional/sparse data is rejected',()=>{
  for(const value of [undefined,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1,()=>1,new Date(),[undefined],Array(2)])assert.throws(()=>canonicalJson(value));
  assert.throws(()=>crc32Ascii('中文'));
});
test('SAVE fresh load is empty and has zero storage writes',()=>{const {repository,storage}=repo();assert.equal(repository.revision,0);assert.equal(storage.operations.filter(v=>v[0]!=='get').length,0);});
test('SAVE full commit readback and backup preserves previous whole envelope',()=>{
  const {repository,storage}=repo();const first=repository.commit({coins:0,receipts:[]},INSTALL,0);const next=repository.commit({coins:4,receipts:[4]},INSTALL,1);
  assert.equal(next.revision,2);assert.deepEqual(JSON.parse(storage.values.get(SAVE_KEYS.backup)),first);assert.equal(storage.values.has(SAVE_KEYS.pending),false);
  assert.deepEqual(repo(storage).repository.load().envelope,next);
});
for(const stage of ['backup-write','backup-read','pending-write','pending-read','current-write','current-read'])test('SAVE failure at '+stage+' restores one complete old/new state, never mixed rewards',()=>{
  const {repository,storage}=repo();repository.commit({coins:0,receipts:[]},INSTALL,0);
  const [slot,operation]=stage.split('-');let setSeen=false;
  storage.fail=(op,key)=>{if(key===SAVE_KEYS[slot]&&op==='set')setSeen=true;if(key===SAVE_KEYS[slot]&&((operation==='write'&&op==='set')||(operation==='read'&&op==='get'&&setSeen)))throw new Error('injected');};
  assert.throws(()=>repository.commit({coins:4,receipts:[4]},INSTALL,1),error=>error.code==='storage');
  assert.throws(()=>repository.commit({coins:4,receipts:[4]},INSTALL,1));storage.fail=null;
  const restored=repo(storage).repository.load().envelope;assert.ok(restored);assert.ok([0,4].includes(restored.payload.coins));validate(restored.payload);
});
test('SAVE truncated pending candidate cannot replace valid old current',()=>{
  const {repository,storage}=repo();repository.commit({coins:0,receipts:[]},INSTALL,0);
  storage.fail=(op,key,s)=>{if(op==='set'&&key===SAVE_KEYS.pending){s.values.set(key,'{"schemaVersion":1');throw new Error('partial write');}};
  assert.throws(()=>repository.commit({coins:4,receipts:[4]},INSTALL,1));storage.fail=null;assert.equal(repo(storage).repository.load().envelope.payload.coins,0);
});
test('SAVE cleanup failure after verified current is still committed once',()=>{
  const {repository,storage}=repo();storage.fail=(op)=>{if(op==='remove')throw new Error('cleanup');};
  const result=repository.commit({coins:4,receipts:[4]},INSTALL,0);assert.equal(result.payload.coins,4);storage.fail=null;
  const recovered=repo(storage).repository.load();assert.equal(recovered.source,'current');assert.equal(recovered.envelope.payload.coins,4);
});
test('SAVE corrupt primary falls back without overwriting evidence',()=>{
  const {repository,storage}=repo();repository.commit({coins:0,receipts:[]},INSTALL,0);repository.commit({coins:4,receipts:[4]},INSTALL,1);storage.values.set(SAVE_KEYS.current,'broken');
  const before=clone([...storage.values]);const loaded=repo(storage).repository.load();assert.equal(loaded.source,'backup');assert.deepEqual([...storage.values],before);
});
test('SAVE valid interrupted pending newer than current is recovered without replay',()=>{
  const {repository,storage}=repo();repository.commit({coins:0,receipts:[]},INSTALL,0);const next=sealSave(body({coins:4,receipts:[4]},2));storage.values.set(SAVE_KEYS.pending,canonicalJson(next));
  assert.equal(repo(storage).repository.load().source,'pending');assert.equal(repo(storage).repository.load().envelope.payload.coins,4);
});
for(const slot of ['current','backup','pending'])test('SAVE future schema in '+slot+' blocks even unknown checksum and valid old alternative',()=>{
  const {repository,storage}=repo();repository.commit({coins:0,receipts:[]},INSTALL,0);storage.values.set(SAVE_KEYS[slot],'{"schemaVersion":99,"checksumAlgorithm":"future-unknown"}');const before=[...storage.values];
  assert.throws(()=>repo(storage),error=>error.code==='future');assert.deepEqual([...storage.values],before);
});
test('SAVE all corrupt slots preserve original data and block writing',()=>{const storage=new MemoryStorage();storage.values.set(SAVE_KEYS.current,'broken');const r=new SaveRepository(storage,'test-content',validate);assert.throws(()=>r.load(),e=>e.code==='corrupt');assert.throws(()=>r.commit({coins:0,receipts:[]},INSTALL,0));assert.equal(storage.values.get(SAVE_KEYS.current),'broken');});
test('SAVE same revision different whole states is a read-only conflict',()=>{const {repository,storage}=repo();repository.commit({coins:0,receipts:[]},INSTALL,0);storage.values.set(SAVE_KEYS.backup,canonicalJson(sealSave(body({coins:4,receipts:[4]}))));assert.throws(()=>repo(storage),e=>e.code==='conflict');});
test('SAVE incompatible content and algorithm retain old data',()=>{for(const overrides of [{contentVersion:'old-content'},{rngVersion:'unknown-rng'}]){const storage=new MemoryStorage();storage.values.set(SAVE_KEYS.current,canonicalJson(sealSave(body({coins:0,receipts:[]},1,overrides))));assert.throws(()=>repo(storage),e=>e.code==='incompatible');}});
test('SAVE payload invariants checked after checksum, before acceptance',()=>{const storage=new MemoryStorage();storage.values.set(SAVE_KEYS.current,canonicalJson(sealSave(body({coins:4,receipts:[]}))));assert.throws(()=>repo(storage),e=>e.code==='corrupt');});
test('SAVE stale caller and another-tab update cannot overwrite balance',()=>{
  const {repository,storage}=repo();repository.commit({coins:0,receipts:[]},INSTALL,0);const other=repo(storage).repository;repository.commit({coins:4,receipts:[4]},INSTALL,1);
  assert.throws(()=>other.commit({coins:5,receipts:[5]},INSTALL,1),e=>e.code==='conflict');assert.throws(()=>repository.commit({coins:8,receipts:[4,4]},INSTALL,1),e=>e.code==='stale');assert.equal(repo(storage).repository.load().envelope.payload.coins,4);
});
test('SAVE same-schema extension fields are carried across commits',()=>{const storage=new MemoryStorage();storage.values.set(SAVE_KEYS.current,canonicalJson(sealSave(body({coins:0,receipts:[]},1,{extensions:{futureFeature:{enabled:true}}}))));const r=repo(storage).repository;assert.deepEqual(r.commit({coins:4,receipts:[4]},INSTALL,1).extensions,{futureFeature:{enabled:true}});});
test('SAVE adapter uses injected native capability and never swallows quota/read failures',()=>{const storage=new Map();const adapter=new LocalStorageAdapter({getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)});adapter.set('x','ok');assert.equal(adapter.get('x'),'ok');adapter.remove('x');assert.equal(adapter.get('x'),null);const bad=new LocalStorageAdapter({getItem(){throw Error('read');},setItem(){throw Error('quota');},removeItem(){throw Error('remove');}});assert.throws(()=>bad.set('x','y'),/quota/);assert.throws(()=>bad.get('x'),/read/);});
test('SAVE preparation restore preserves full bag, undo history, run IDs, seed and tutorial',()=>{
  const h=begin();place(h,0,0,0);place(h,1,2,0);click(h.presenter,'guide-close');const before=clone(h.session.state);const restored=boot(h.storage);
  assert.deepEqual(restored.session.state,before);assert.equal(restored.presenter.screen,'run');assert.equal(restored.presenter.tutorialSeen,true);assert.equal(restored.session.state.run.id,INSTALL+'-run-1');assert.equal(restored.presenter.persistenceError,null);
});
test('SAVE combat reload restores exact RNG/counters, pauses and never catches up wall time',()=>{
  const h=begin();place(h,0,0,0);action(h,{type:'start-combat'});h.session.advance(20);h.presenter.checkpoint();const before=clone(h.session.state);const restored=boot(h.storage);
  assert.equal(restored.presenter.persistenceError,null);assert.deepEqual(restored.session.state,before);assert.ok(restored.presenter.driver.reasons.has('resume-confirmation'));
  restored.presenter.update(60);assert.deepEqual(restored.session.state,before);click(restored.presenter,'resume-combat');restored.presenter.update(0.1);h.session.advance(1);assert.deepEqual(restored.session.state,h.session.state);
});
test('SAVE settlement interrupted current write restores receipt and balance exactly once',()=>{
  const h=begin();place(h,0,0,0);place(h,1,2,0);place(h,2,0,2);place(h,3,2,2);action(h,{type:'start-combat'});h.session.advance(450);assert.equal(h.session.state.run.phase,'loot');action(h,{type:'abandon'});
  assert.equal(h.session.state.run.settlement.baseCoins,4);const before=clone(h.session.state);
  h.storage.fail=(op,key)=>{if(op==='set'&&key===SAVE_KEYS.current)throw Error('crash');};
  assert.throws(()=>h.session.dispatch({type:'claim-settlement'}));assert.deepEqual(h.session.state,before);h.storage.fail=null;
  const restored=boot(h.storage);assert.equal(restored.presenter.persistenceError,null);assert.equal(restored.session.state.wallet,4);assert.equal(restored.session.state.run.settlement.claimed,true);
  assert.equal(restored.session.dispatch({type:'claim-settlement'}).ok,false);assert.equal(restored.session.state.wallet,4);restored.presenter.start();assert.equal(restored.session.state.run.id,INSTALL+'-run-2');assert.equal(restored.session.state.wallet,4);
});
test('SAVE loot reload preserves options; receiving then reloading cannot duplicate instances',()=>{
  const h=begin();place(h,0,0,0);place(h,1,2,0);place(h,2,0,2);place(h,3,2,2);action(h,{type:'start-combat'});h.session.advance(450);assert.equal(h.session.state.run.phase,'loot');
  const options=clone(h.session.state.run.loot);let restored=boot(h.storage);assert.deepEqual(restored.session.state.run.loot,options);action(restored,{type:'choose-loot',optionId:options[0].id});const after=clone(restored.session.state);restored=boot(h.storage);assert.deepEqual(restored.session.state,after);assert.equal(restored.session.dispatch({type:'choose-loot',optionId:options[0].id}).ok,false);
});
test('SAVE corrupt/future startup displays a blocking retry UI and never starts a zero-wallet new run',()=>{
  const storage=new MemoryStorage();storage.values.set(SAVE_KEYS.current,'{"schemaVersion":2}');const h=boot(storage);assert.ok(h.presenter.persistenceError);const before=[...storage.values];render(h.presenter);assert.deepEqual(h.presenter.hits.map(v=>v.id),['retry-storage']);h.presenter.start();h.presenter.update(10);assert.equal(h.session.state.run,null);assert.deepEqual([...storage.values],before);
});
test('SAVE quota error pauses UI; retry re-reads verified checkpoint instead of replaying action',()=>{
  const h=begin();click(h.presenter,'guide-close');const before=clone(h.session.state);h.storage.fail=(op,key)=>{if(op==='set'&&key===SAVE_KEYS.pending)throw Error('quota');};
  const item=h.session.state.run.inventory.instances[0];click(h.presenter,'stash-item-'+item.id);h.presenter.pointerDown(82,450);h.presenter.pointerUp(82,450);assert.ok(h.presenter.persistenceError);assert.deepEqual(h.session.state,before);
  h.storage.fail=null;click(h.presenter,'retry-storage');assert.equal(h.presenter.persistenceError,null);assert.deepEqual(h.session.state,before);
});
test('SAVE rejects malformed wallet, run phase, rotation, counters and unknown equipment',()=>{
  const h=begin();const raw=JSON.parse(h.storage.values.get(SAVE_KEYS.current)).payload;
  for(const mutate of [v=>v.session.wallet=-1,v=>v.session.wallet=1,v=>v.session.run.phase='unknown',v=>v.session.run.nextSpawnIndex=2,v=>v.session.run.inventory.instances[0].defId='unknown',v=>v.session.nextRun=1,v=>v.tutorialSeen='yes']){const invalid=clone(raw);mutate(invalid);assert.throws(()=>validateSessionSave(invalid,CONTENT));}
});

test('SAVE abandoning before first combat preserves null HP and zero-reward receipt on restart',()=>{
  const h=begin();action(h,{type:'abandon'});assert.equal(h.session.state.run.hp,null);action(h,{type:'claim-settlement'});
  const restored=boot(h.storage);assert.equal(restored.presenter.persistenceError,null);assert.equal(restored.presenter.screen,'menu');assert.equal(restored.session.state.wallet,0);assert.equal(restored.session.state.run.settlement.claimed,true);
  restored.presenter.start();assert.equal(restored.session.state.run.id,INSTALL+'-run-2');
});
test('SAVE retry recovers the original install ID before starting the next run',()=>{
  const h=begin();action(h,{type:'abandon'});action(h,{type:'claim-settlement'});const original=h.storage.values.get(SAVE_KEYS.current);
  h.storage.values.set(SAVE_KEYS.current,'{"schemaVersion":99}');const store=new SessionStore(h.storage,CONTENT,'local-different-boot-0002');const p=new GamePresenter(CONTENT,store);assert.ok(p.persistenceError);
  h.storage.values.set(SAVE_KEYS.current,original);click(p,'retry-storage');assert.equal(p.persistenceError,null);p.start();assert.equal(p.session.state.run.id,INSTALL+'-run-2');
});
test('SAVE unknown saved equipment blocks even with a valid older backup, preserving all data',()=>{
  const h=begin();place(h,0,0,0);const env=JSON.parse(h.storage.values.get(SAVE_KEYS.current));env.payload.session.run.inventory.instances[0].defId='unknown-content-item';const {checksum:old,...body}=env;h.storage.values.set(SAVE_KEYS.current,canonicalJson(sealSave(body)));
  const before=[...h.storage.values];const restored=boot(h.storage);assert.match(restored.presenter.persistenceError,/未知装备/);assert.deepEqual([...h.storage.values],before);
});

for(const [defId,seed] of [['I16',141308201],['I17',3485187529],['I15',3949938804]])test('SAVE naturally earned '+defId+' preserves spent counters on combat reload and permanent removal after wave',()=>{
  const h=begin(boot(),seed,'I01');
  if(defId==='I15')place(h,0,0,0);else{place(h,0,0,0);place(h,1,1,0);place(h,2,0,2);place(h,3,1,2);}
  action(h,{type:'start-combat'});h.session.advance(450);assert.equal(h.session.state.run.phase,'loot');
  const offer=h.session.state.run.loot.find(option=>option.itemIds.includes(defId));assert.ok(offer,'Expected natural offer '+defId);action(h,{type:'choose-loot',optionId:offer.id});
  const item=h.session.state.run.inventory.instances.find(i=>i.defId===defId);place(h,item.spawnIndex,defId==='I15'?2:3,defId==='I15'?0:3);
  let triggered=false;
  for(let wave=2;wave<=3&&!triggered;wave++){
    action(h,{type:'start-combat'});
    for(let tick=0;tick<450&&h.session.state.run.phase==='combat';tick++){
      h.session.advance(1);const supply=h.session.state.run.combat.consumables.find(c=>c.instanceId===item.id);
      if(supply.used+supply.pierceUsed===1){
        triggered=true;h.presenter.checkpoint();const restored=boot(h.storage);assert.equal(restored.presenter.persistenceError,null);assert.deepEqual(restored.session.state,h.session.state);
        h.session=restored.session;h.presenter=restored.presenter;h.store=restored.store;break;
      }
    }
    if(!triggered){assert.equal(h.session.state.run.phase,'loot');const restored=boot(h.storage);assert.equal(restored.presenter.persistenceError,null);assert.ok(restored.session.state.run.inventory.instances.some(i=>i.id===item.id));action(h,{type:'skip-loot'});}
  }
  assert.equal(triggered,true);h.session.advance(450);assert.equal(h.session.state.run.phase!=='combat',true);
  const restored=boot(h.storage);assert.equal(restored.presenter.persistenceError,null);assert.ok(!restored.session.state.run.inventory.instances.some(i=>i.id===item.id));assert.equal(restored.session.state.run.inventory.history.length,0);
});

test('SAVE fourth initial weapon selection, preparation and combat recover with matching content rules',()=>{
  const h=boot();click(h.presenter,'starter-I04');let restored=boot(h.storage);assert.equal(restored.presenter.persistenceError,null);assert.equal(restored.presenter.starter,'I04');restored.presenter.start();click(restored.presenter,'guide-close');place(restored,0,0,0);action(restored,{type:'start-combat'});restored.session.advance(10);
  const again=boot(h.storage);assert.equal(again.presenter.persistenceError,null);assert.deepEqual(again.session.state,restored.session.state);assert.equal(again.session.state.run.combat.weapons[0].targets,3);
});

test('SAVE fallback commit never rewrites the only valid backup before a new candidate is verified',()=>{
  const {repository,storage}=repo();repository.commit({coins:0,receipts:[]},INSTALL,0);repository.commit({coins:4,receipts:[4]},INSTALL,1);
  storage.values.set(SAVE_KEYS.current,'broken-current');const before=storage.values.get(SAVE_KEYS.backup);const recovering=repo(storage).repository;storage.operations=[];
  storage.fail=(op,key,s)=>{if(op==='set'&&key===SAVE_KEYS.backup){s.values.set(key,'partial-backup');throw Error('would destroy only backup');}if(op==='set'&&key===SAVE_KEYS.pending){s.values.set(key,'partial-candidate');throw Error('candidate failed');}};
  assert.throws(()=>recovering.commit({coins:4,receipts:[4]},INSTALL,1),error=>error.code==='storage');
  assert.equal(storage.values.get(SAVE_KEYS.backup),before);assert.equal(storage.operations.some(([op,key])=>op==='set'&&key===SAVE_KEYS.backup),false);
  storage.fail=null;const restored=repo(storage).repository.load();assert.equal(restored.source,'backup');assert.deepEqual(restored.envelope.payload,{coins:0,receipts:[]});
});
