'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {makeLegacySaveFixture,PHASES}=require('../../tools/lib/legacy-save-fixtures.cjs');
const {BALANCED_DEVELOPMENT_CONTENT,DEVELOPMENT_CONTENT}=require('../../.test-build/content/catalog.js');
const {SessionStore}=require('../../.test-build/application/session-store.js');
const {SAVE_KEYS}=require('../../.test-build/application/save-repository.js');
for(const phase of PHASES)test('FIXTURE genuine legacy '+phase+' is byte-stable, reproducible and accepted by new app',()=>{
 const f=makeLegacySaveFixture(phase);assert.deepEqual(f,makeLegacySaveFixture(phase));const values=new Map(Object.entries(f.slots).filter(([,v])=>v!==null));const storage={get:k=>values.get(k)??null,set(){throw new Error('Fixture load must not write');},remove(){throw new Error('Fixture load must not remove');}};const store=new SessionStore(storage,BALANCED_DEVELOPMENT_CONTENT,'local-fixture-new-id-0001');assert.deepEqual(store.load(),f.expected);assert.equal(store.tutorialSeen,true);assert.equal(store.starter,'I03');const env=JSON.parse(f.slots[SAVE_KEYS.current]);assert.equal(env.contentVersion,DEVELOPMENT_CONTENT.version);assert.equal(env.payload.session.run.contentVersion,DEVELOPMENT_CONTENT.version);if(phase==='combat'){assert.equal(f.expected.run.wave,2);assert.equal(f.expected.run.combat.tick,13);}if(phase.startsWith('settlement')){assert.equal(f.expected.run.victories,5);assert.equal(f.expected.run.settlement.baseCoins,32);assert.equal(f.expected.wallet,phase==='settlement-claimed'?32:0);}
});
test('FIXTURE rejects an unknown phase before creating an artificial state',()=>assert.throws(()=>makeLegacySaveFixture('bogus')));
