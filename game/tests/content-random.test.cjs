const test=require('node:test');
const assert=require('node:assert/strict');
const {CONTENT,validateContent}=require('../../.test-build/content/catalog.js');
const {normalizeSeed,nextUint32,deriveSeed,randomInt,weightedIndex,RNG_VERSION}=require('../../.test-build/core/random.js');
const clone=v=>JSON.parse(JSON.stringify(v));
test('CFG: seventeen items, three normals, one boss and five valid waves',()=>{
  assert.equal(CONTENT.items.length, 17);assert.equal(CONTENT.enemies.length,4);assert.equal(CONTENT.waves.length,5);assert.deepEqual(validateContent(CONTENT),[]);
});
test('CFG: duplicate and disconnected shapes, invalid references and stats rejected',()=>{
  for(const mutate of [c=>c.items[0].shape.push({x:0,y:0}),c=>c.items[0].shape.push({x:4,y:4}),c=>c.items[0].weight=NaN,c=>c.items[0].weapon.cooldown=0,c=>c.waves[0].push('missing'),c=>c.enemies[0].hp=Infinity,c=>c.items[1].id=c.items[0].id,c=>c.event.chanceBps=10001]){
    const c=clone(CONTENT);mutate(c);assert.ok(validateContent(c).length);
  }
});
test('RNG: xorshift32 reference vector and state validation',()=>{
  let state=1;const values=[];for(let i=0;i<5;i++){const r=nextUint32(state);state=r.state;values.push(r.value);}
  assert.deepEqual(values,[270369,67634689,2647435461,307599695,2398689233]);
  assert.equal(RNG_VERSION,'xorshift32-fnv1a-utf16-v1'); assert.notEqual(normalizeSeed(0),0);
  for(const s of [-1,NaN,Infinity,1.2,4294967296])assert.throws(()=>normalizeSeed(s));
});
test('RNG: named streams replay independently of cosmetic consumption',()=>{
  const before=deriveSeed(42,'loot/wave-2/base');let cosmetic=deriveSeed(42,'cosmetic');
  for(let i=0;i<100;i++)cosmetic=nextUint32(cosmetic).state;
  assert.equal(deriveSeed(42,'loot/wave-2/base'),before);assert.notEqual(deriveSeed(42,'combat/wave-2'),before);
  assert.equal(deriveSeed(42,'中文命名'),deriveSeed(42,'中文命名'));
});
test('RNG: weighted sampling bounds, zero weights and invalid parameters',()=>{
  let state=127;const counts=[0,0,0];for(let i=0;i<20000;i++){const r=weightedIndex(state,[1,0,3]);state=r.state;counts[r.value]++;}
  assert.equal(counts[1],0);assert.ok(counts[2]>14000&&counts[2]<16000);
  for(const w of [[],[0,0],[-1,2],[NaN,1],[Infinity],[1.2]])assert.throws(()=>weightedIndex(1,w));
  for(const m of [0,-1,NaN,Infinity,1.5,4294967297])assert.throws(()=>randomInt(1,m));
  assert.equal(randomInt(1,1).value,0);
});

test('RNG: rejection sampling accounts for xorshift32 excluding zero',()=>{
  const rejected=nextUint32(67634689);assert.equal(rejected.value,2647435461);
  const sampled=randomInt(67634689,2147483648);
  assert.deepEqual(sampled,{state:307599695,value:307599694});
  assert.deepEqual(randomInt(1,4294967295),{state:270369,value:270368});
  assert.throws(()=>randomInt(1,4294967296));
  assert.equal(weightedIndex(1,[0,4294967295]).value,1);
});
