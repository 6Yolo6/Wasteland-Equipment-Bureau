'use strict';
/** Synthetic integration fixtures produced by REAL legacy rules and save commits.
 * Never reads user storage and never grants items or changes HP/enemy values. */
const assert=require('node:assert/strict');
const {DEVELOPMENT_CONTENT,LEGACY_GROWTH_DEVELOPMENT_CONTENT}=require('../../.test-build/content/catalog.js');
const {GameSession}=require('../../.test-build/application/session.js');
const {SessionStore}=require('../../.test-build/application/session-store.js');
const {SAVE_KEYS}=require('../../.test-build/application/save-repository.js');
const {plan}=require('../experiment_layout.cjs');
const PHASES=['preparation','combat','loot','settlement-unclaimed','settlement-claimed'];
class MemoryStorage{constructor(){this.values=new Map();}get(key){return this.values.get(key)??null;}set(key,value){this.values.set(key,value);}remove(key){this.values.delete(key);}}
function makeLegacySaveFixture(phase){
 assert(PHASES.includes(phase),'Unknown legacy fixture phase');const storage=new MemoryStorage();const store=new SessionStore(storage,DEVELOPMENT_CONTENT,'local-browser-legacy-fixture-0001');store.load();store.tutorialSeen=true;store.seed=1;store.starter='I03';
 const session=new GameSession(DEVELOPMENT_CONTENT,{namespace:()=>store.installId,commit:(next,checkpoint)=>store.save(next,checkpoint)});session.start(1,'I03');
 const accept=action=>{const r=session.dispatch(action);assert(r.ok,r.reason);};const equip=()=>{for(const command of plan(session.state.run.inventory,session.content,'first-fit').commands)accept({type:'inventory',command});};
 if(phase==='preparation')equip();
 else if(phase==='combat'){equip();accept({type:'start-combat'});session.advance(450);assert.equal(session.state.run.phase,'loot');accept({type:'choose-loot',optionId:session.state.run.loot[0].id});equip();accept({type:'start-combat'});session.advance(13);assert.equal(session.state.run.phase,'combat');}
 else if(phase==='loot'){equip();accept({type:'start-combat'});session.advance(450);assert.equal(session.state.run.phase,'loot');}
 else {while(session.state.run.phase==='preparation'){equip();accept({type:'start-combat'});session.advance(450);if(session.state.run.phase==='loot')accept({type:'choose-loot',optionId:session.state.run.loot[0].id});}assert.equal(session.state.run.settlement.reason,'victory');assert.equal(session.state.run.settlement.baseCoins,32);if(phase==='settlement-claimed')accept({type:'claim-settlement'});}
 store.save(session.state); // Ensure the final combat tick is the durable checkpoint.
 return {phase,contentVersion:DEVELOPMENT_CONTENT.version,expected:JSON.parse(JSON.stringify(session.state)),slots:Object.fromEntries(Object.values(SAVE_KEYS).map(key=>[key,storage.get(key)]))};
}
function makeGrowthSaveFixture(research,phase){
 assert(PHASES.includes(phase));const content=LEGACY_GROWTH_DEVELOPMENT_CONTENT,storage=new MemoryStorage(),store=new SessionStore(storage,content,'local-browser-growth-fixture-0001');store.load();store.tutorialSeen=true;store.seed=42;store.starter='I03';
 const session=new GameSession(content,{namespace:()=>store.installId,commit:(next,c)=>store.save(next,c)}),accept=action=>{const r=session.dispatch(action);assert(r.ok,r.reason);},equip=()=>{for(const command of plan(session.state.run.inventory,session.content,'first-fit').commands)accept({type:'inventory',command});};
 if(research){session.start(42,'I03');for(let wave=1;wave<=2;wave++){equip();accept({type:'start-combat'});session.advance(450);assert.equal(session.state.run.phase,'loot');accept({type:'choose-loot',optionId:session.state.run.loot[0].id});}accept({type:'abandon'});accept({type:'claim-settlement'});assert.equal(session.state.wallet,8);assert(session.purchaseResearch('relay').ok);assert(session.setResearchMode('research').ok);}
 session.start(42,'I03');equip();if(phase!=='preparation'){accept({type:'start-combat'});session.advance(phase==='combat'?13:450);if(phase==='loot')assert.equal(session.state.run.phase,'loot');if(phase.startsWith('settlement')){accept({type:'abandon'});if(phase==='settlement-claimed')accept({type:'claim-settlement'});}}
 store.save(session.state);return {phase,research,contentVersion:session.state.run.contentVersion,expected:JSON.parse(JSON.stringify(session.state)),slots:Object.fromEntries(Object.values(SAVE_KEYS).map(key=>[key,storage.get(key)]))};
}
module.exports={makeLegacySaveFixture,makeGrowthSaveFixture,PHASES};
