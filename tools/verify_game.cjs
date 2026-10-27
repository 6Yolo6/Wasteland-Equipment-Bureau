/** Exercises the real Creator Web Mobile build with pointer input, no replacement game or mocked engine. */
'use strict';
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const {createLocalServer}=require('./lib/local-game-server.cjs');
const {pollUntil}=require('./lib/async-poll.cjs');
const root=path.resolve(__dirname,'..');const local=JSON.parse(fs.readFileSync(path.join(root,'toolchains.local.json'),'utf8'));
const {verifyBuildEvidence,verifyCompiledEvidence}=require('./lib/build-evidence.cjs');
const build=JSON.parse(fs.readFileSync(path.join(root,'logs/phase-2/creator-game-latest.json'),'utf8'));
const buildEvidence=verifyBuildEvidence(root,build);
const compiledEvidence=verifyCompiledEvidence(root);
const {chromium}=require(path.join(local.browserAutomationModules,'playwright'));
const {GROWTH_DEVELOPMENT_CONTENT:CONTENT, RESEARCH_CONTENT, LEGACY_GROWTH_DEVELOPMENT_CONTENT}=require('../.test-build/content/catalog.js');
const {transactInventory,addInstances}=require('../.test-build/core/inventory.js');
const {evaluateLoadout,effectiveCooldown,attackSeconds}=require('../.test-build/core/loadout.js');
const {GameSession}=require('../.test-build/application/session.js');
const {DEVELOPMENT_CONTENT}=require('../.test-build/content/catalog.js');
const {makeLegacySaveFixture,makeGrowthSaveFixture,PHASES}=require('./lib/legacy-save-fixtures.cjs');
const {SAVE_KEYS}=require('../.test-build/application/save-repository.js');
const stamp=new Date().toISOString().replace(/[:.]/g,'-');const logs=path.join(root,'logs/phase-2','browser-game-'+stamp);fs.mkdirSync(logs,{recursive:true});
const report={scope:'Real Cocos Web Mobile build in local Chrome. Pointer-driven five-wave development playthrough, not TapTap or a real phone.',started:new Date().toISOString(),checks:[],pageErrors:[],consoleErrors:[],consoleWarnings:[],requestFailures:[],externalRequests:[],httpErrors:[],screenshots:[],status:'NOT_RUN'};
report.logs=logs;report.buildEvidence=build.logs;report.evidenceGate={build:buildEvidence,compilation:compiledEvidence};
const friendPackage=process.env.FRIEND_PACKAGE_DIR?path.resolve(process.env.FRIEND_PACKAGE_DIR):null;
if(friendPackage){
 const portable=require(path.join(friendPackage,'server.cjs'));const m=portable.verifyPackage(friendPackage);const original=JSON.parse(fs.readFileSync(path.join(build.logs,'build-manifest.json'),'utf8'));
 assert.deepEqual(Object.keys(m.files).filter(p=>p.startsWith('game/')).map(p=>p.slice(5)).sort(),Object.keys(original).sort());
 for(const [name,entry] of Object.entries(original))assert.deepEqual(m.files['game/'+name],entry,'Packaged build differs: '+name);
 report.friendPackage={directory:friendPackage,packageId:portable.hash(fs.readFileSync(path.join(friendPackage,'package-manifest.json')))};
}
const server=friendPackage?null:createLocalServer(path.dirname(build.index_html),e=>report.httpErrors.push(e));
let browser,page;
function loadoutScore(inv){const l=evaluateLoadout(inv,CONTENT);return l.weapons.reduce((v,w)=>v+10*((w.damage+w.bonusDamage)*w.targets+w.splash+w.thirdHitDamage/3)/effectiveCooldown(w),0)+l.initialShield*0.2+l.reduction*8+l.maxHp*0.05+l.killShield*0.8+l.consumables.reduce((v,c)=>v+c.emergencyHeal*0.18+c.periodicHeal*c.charges*0.15,0);}
function fillPlan(start){
  let inventory=start;const moves=[];
  const stash=start.stash.slice().sort((a,b)=>{
    const ai=CONTENT.items.find(i=>i.id===start.instances.find(v=>v.id===a).defId),bi=CONTENT.items.find(i=>i.id===start.instances.find(v=>v.id===b).defId);
    return Number(bi.category==='weapon')-Number(ai.category==='weapon')||ai.id.localeCompare(bi.id);
  });
  for(const id of stash){
    let best=null;
    for(const rotation of [0,90,180,270])for(let y=0;y<6;y++)for(let x=0;x<5;x++){
      const result=transactInventory(inventory,{type:'place',instanceId:id,x,y,rotation,expectedRevision:inventory.revision},CONTENT);
      if(!result.ok||result.swappedId)continue;
      const score=loadoutScore(result.state);
      if(!best||score>best.score)best={score,state:result.state,move:{id,x,y,rotation}};
    }
    if(best){inventory=best.state;moves.push(best.move);}
  }
  return {inventory,moves,score:loadoutScore(inventory)};
}
async function frame(){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function snapshot(){return page.evaluate(()=>({screen:window.__qa.screen,contentVersion:window.__qa.content.version,seed:window.__qa.seed,starter:window.__qa.starter,research:window.__qa.session.state.research,researchOpen:window.__qa.researchOpen,researchConfirm:window.__qa.researchConfirm,guidePage:window.__qa.guidePage,lootCollapsed:window.__qa.lootCollapsed,persistenceError:window.__qa.persistenceError,persistenceStatus:window.__qa.persistenceStatus,journal:window.__qa.journal.entries,selectedId:window.__qa.selectedId,rotation:window.__qa.rotation,run:window.__qa.session.state.run,wallet:window.__qa.session.state.wallet,paused:[...window.__qa.driver.reasons],hits:window.__qa.hits.map(({id,x,y,w,h,enabled,itemId,label})=>({id,x,y,w,h,enabled,itemId,label}))}));}
async function point(x,y){return page.evaluate(({x,y})=>{const r=document.getElementById('GameCanvas').getBoundingClientRect(),s=Math.min(r.width/720,r.height/1280);return {x:r.x+(r.width-720*s)/2+x*s,y:r.y+(r.height-1280*s)/2+y*s};},{x,y});}
async function click(id){await frame();const state=await snapshot();const hit=state.hits.find(h=>h.id===id);assert(hit&&hit.enabled,'Missing/enabled button '+id);const p=await point(hit.x+hit.w/2,hit.y+hit.h/2);await page.mouse.click(p.x,p.y);await frame();}
async function shot(name){const file=path.join(logs,name+'.png');await page.screenshot({path:file});report.screenshots.push(file);}

async function restoreFromReload(label,{resume=false}={}){
  let before=await snapshot();
  if(before.run?.phase==='combat'&&before.paused.length===0){await click('pause-combat');before=await snapshot();}
  assert.equal(before.persistenceError,null,'Pre-reload storage must be healthy');
  const confirmed=await page.evaluate(()=>window.__qa.checkpoint());assert.equal(confirmed,true,'Real save checkpoint must succeed');
  const expected=(await snapshot()).run,wallet=before.wallet;
  await page.reload({waitUntil:'load',timeout:30000});
  await pollUntil(()=>page.evaluate(async()=>{if(typeof System==='undefined')return false;const cc=await System.import('cc');return !!cc.director.getScene()?.getChildByName('Canvas')?.getComponent('BureauRoot')?.presenter;}),{timeoutMs:45000,label:'restored BureauRoot scene'});
  await page.evaluate(async()=>{const cc=await System.import('cc');window.__qa=cc.director.getScene().getChildByName('Canvas').getComponent('BureauRoot').presenter;});await frame();
  const restored=await snapshot();assert.equal(restored.persistenceError,null,'Reload must accept genuine save');assert.deepEqual(restored.run,expected,'Reload keeps whole run including RNG and counters');assert.equal(restored.wallet,wallet);
  if(restored.run?.phase==='combat'){
    assert(restored.paused.includes('resume-confirmation'));const tick=restored.run.combat.tick;await page.waitForTimeout(350);assert.equal((await snapshot()).run.combat.tick,tick,'No unseen catch-up after reload');
    if(resume)await click('resume-combat');
  }
  await shot('save-'+label);report.checks.push('Local save reload '+label+': complete run and wallet restored; no replay or background catch-up');
}

async function starterScenarios(){
  assert.equal((await snapshot()).screen,'menu');
  const expected=CONTENT.items.filter(item=>item.category==='weapon'&&item.unlocked).map(item=>'starter-'+item.id).sort();
  for(const width of [320,360]){
    await page.setViewportSize({width,height:800});await frame();
    const state=await snapshot();assert.deepEqual(state.hits.filter(hit=>hit.id.startsWith('starter-')&&!['starter-prev','starter-next'].includes(hit.id)).map(hit=>hit.id).sort(),expected);
    assert(expected.includes('starter-I04'));await click('starter-I04');assert.equal(await page.evaluate(()=>window.__qa.starter),'I04');await shot('starter-all-four-'+width);
  }
  await restoreFromReload('starter-nozzle-selection');assert.equal(await page.evaluate(()=>window.__qa.starter),'I04');
  await click('start-run');assert.equal((await snapshot()).run.inventory.instances[0].defId,'I04');
  const item=(await snapshot()).run.inventory.instances[0];await dragItem(item.id,0,0);await click('start-combat');
  let state=await snapshot();assert.equal(state.run.combat.weapons[0].defId,'I04');assert.equal(state.run.combat.weapons[0].targets,3);
  await restoreFromReload('starter-nozzle-combat');await shot('starter-nozzle-restored');
  await click('resume-combat');await click('abandon-run');await click('confirm-abandon');await click('claim-and-menu');
  await click('starter-I01');await page.setViewportSize({width:720,height:1280});await frame();
  report.checks.push('All four unlocked initial weapons reachable at 320/360px; I04 selection, actual placement/combat and persisted reload verified');
}

async function researchScenarios(){
  assert.equal((await snapshot()).screen,'menu');
  let state=await snapshot();assert.equal(state.wallet,32,'research spends actually earned five-wave coins');
  const entry=state.hits.find(hit=>hit.id==='open-research');assert(entry&&entry.h===64&&entry.w===656);assert.match(entry.label,/装备解锁/);await shot('equipment-unlock-menu-360');
  await click('open-research');await shot('research-menu-360');
  await click('research-relay');assert.equal((await snapshot()).researchConfirm,'relay');
  await page.keyboard.press('Escape');await frame();assert.equal((await snapshot()).researchOpen,true);assert.equal((await snapshot()).wallet,32);
  await click('research-relay');await shot('research-relay-confirmation');await click('research-confirm');
  state=await snapshot();assert.equal(state.wallet,24);assert.deepEqual(state.research.purchases,['relay']);
  assert.equal(state.hits.find(hit=>hit.id==='research-relay').enabled,false);
  await click('research-mode-growth');assert.equal((await snapshot()).research.mode,'research');
  await click('research-close');assert(!(await snapshot()).hits.some(hit=>hit.id==='starter-I04'));
  await restoreFromReload('research-first-purchase');state=await snapshot();assert.equal(state.wallet,24);assert.deepEqual(state.research.purchases,['relay']);
  await click('open-research');await click('research-heat');await click('research-confirm');
  state=await snapshot();assert.equal(state.wallet,8);assert.deepEqual(state.research.purchases,['relay','heat']);
  assert.equal(state.hits.find(hit=>hit.id==='research-scan').enabled,false,'insufficient coins cannot open purchase');
  for(const viewport of [{width:320,height:720},{width:1280,height:720}]){
    await page.setViewportSize(viewport);await frame();await frame();await shot('research-menu-'+viewport.width);
  }
  await page.setViewportSize({width:360,height:800});await frame();await click('research-close');
  assert((await snapshot()).hits.some(hit=>hit.id==='starter-I04'));await click('starter-I04');
  await restoreFromReload('research-nozzle-selection');await click('start-run');state=await snapshot();
  assert.equal(state.run.contentVersion,RESEARCH_CONTENT.version);assert.deepEqual(state.run.researchUnlocks,['I04','I12']);
  assert.equal(state.run.inventory.instances[0].defId,'I04');assert(!state.hits.some(hit=>hit.id==='open-research'));
  await equipPlan();await shot('research-run-preparation');await click('start-combat');
  await pollUntil(async()=>(await snapshot()).run.phase!=='combat',{timeoutMs:65000,label:'research naturally earns first supply'});
  state=await snapshot();assert.equal(state.run.phase,'loot');
  const unlocked=new Set(RESEARCH_CONTENT.items.filter(item=>item.unlocked).map(item=>item.id).concat(['I04','I12']));
  assert(state.run.loot.flatMap(option=>option.itemIds).every(id=>unlocked.has(id)));
  await click('view-loot-equipment');await shot('research-pending-loot-inspection');
  await restoreFromReload('research-pending-loot');state=await snapshot();assert.deepEqual(state.run.researchUnlocks,['I04','I12']);assert.equal(state.wallet,8);
  await click('abandon-run');await click('confirm-abandon');await click('claim-and-menu');state=await snapshot();assert.equal(state.wallet,12);
  await click('open-research');await click('research-mode-sandbox');await click('research-close');
  assert((await snapshot()).hits.some(hit=>hit.id==='starter-I04'));await click('starter-I01');
  await restoreFromReload('research-preserved-in-sandbox');state=await snapshot();assert.equal(state.research.mode,'sandbox');assert.deepEqual(state.research.purchases,['relay','heat']);assert.equal(state.wallet,12);
  report.checks.push('Equipment unlock entry: prominent 64px primary button, progress and wallet, actual pointer confirmation and 320px/landscape screenshots');
  report.checks.push('Research pointer flow: earned 32 coins, cancel then confirm one-time purchases, insufficient-fund guard, 320px/landscape layouts and durable mode/blueprints');
  report.checks.push('Research new run: unlocked nozzle starter, frozen 14-item loot pool, natural wave victory, supply inspection/reload, 4-coin settlement and sandbox switch preserve research');
}

async function storageFaultScenarios(origin){
  const main=page;
  for(const kind of ['future','corrupt']){
    const context=await browser.newContext({viewport:{width:320,height:800},isMobile:true,hasTouch:true});
    try{
      await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();report.externalRequests.push(route.request().url());return route.abort();});
      page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());if(m.type()==='warning')report.consoleWarnings.push(m.text());});page.on('requestfailed',r=>report.requestFailures.push(r.url()));await page.goto(origin,{waitUntil:'load'});
      await pollUntil(()=>page.evaluate(async()=>{if(typeof System==='undefined')return false;const cc=await System.import('cc');return !!cc.director.getScene()?.getChildByName('Canvas')?.getComponent('BureauRoot')?.presenter;}),{timeoutMs:45000,label:'fault test scene'});
      await page.evaluate(kind=>{const keys=['bureau.preview.v1.current','bureau.preview.v1.backup','bureau.preview.v1.pending'];keys.forEach(key=>localStorage.removeItem(key));localStorage.setItem(keys[0],kind==='future'?'{"schemaVersion":99,"checksumAlgorithm":"unknown-future"}':'broken-save');},kind);
      await page.reload({waitUntil:'load'});
      await pollUntil(()=>page.evaluate(async()=>{if(typeof System==='undefined')return false;const cc=await System.import('cc');return !!cc.director.getScene()?.getChildByName('Canvas')?.getComponent('BureauRoot')?.presenter;}),{timeoutMs:45000,label:'fault recovery scene'});
      await page.evaluate(async()=>{const cc=await System.import('cc');window.__qa=cc.director.getScene().getChildByName('Canvas').getComponent('BureauRoot').presenter;});await frame();
      const state=await snapshot();assert(state.persistenceError);assert.deepEqual(state.hits.map(h=>h.id),['retry-storage']);assert.equal(state.run,null);
      const raw=await page.evaluate(()=>localStorage.getItem('bureau.preview.v1.current'));await click('retry-storage');assert.equal(await page.evaluate(()=>localStorage.getItem('bureau.preview.v1.current')),raw);assert((await snapshot()).persistenceError);await shot('save-'+kind+'-blocked-320');
      report.checks.push('Isolated storage fault injection '+kind+': 320px blocking UI; retry keeps original bytes; no silent new run');
    }finally{await context.close();page=main;}
  }
}


async function legacySaveScenarios(origin){
 const main=page;report.legacySaves=[];
 for(const phase of PHASES){
  const fixture=makeLegacySaveFixture(phase),context=await browser.newContext({viewport:{width:320,height:800},isMobile:true,hasTouch:true});
  try{
   await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();report.externalRequests.push(route.request().url());return route.abort();});
   // New isolated context; inject a genuine old envelope before the engine's first load.
   await context.addInitScript(({slots,expectedOrigin})=>{if(location.origin!==expectedOrigin||sessionStorage.getItem('legacy-fixture-injected'))return;for(const [key,value] of Object.entries(slots))if(value!==null)localStorage.setItem(key,value);sessionStorage.setItem('legacy-fixture-injected','1');},{slots:fixture.slots,expectedOrigin:origin});
   page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());if(m.type()==='warning')report.consoleWarnings.push(m.text());});page.on('requestfailed',r=>report.requestFailures.push(r.url()));await page.goto(origin,{waitUntil:'load',timeout:30000});
   await pollUntil(()=>page.evaluate(async()=>{if(typeof System==='undefined')return false;const cc=await System.import('cc');return !!cc.director.getScene()?.getChildByName('Canvas')?.getComponent('BureauRoot')?.presenter;}),{timeoutMs:45000,label:'legacy '+phase+' scene'});
   await page.evaluate(async()=>{const cc=await System.import('cc');window.__qa=cc.director.getScene().getChildByName('Canvas').getComponent('BureauRoot').presenter;});await frame();
   let state=await snapshot();assert.equal(state.persistenceError,null);assert.deepEqual(state.run,fixture.expected.run);assert.equal(state.wallet,fixture.expected.wallet);assert.equal(state.contentVersion,phase==='settlement-claimed'?CONTENT.version:DEVELOPMENT_CONTENT.version);
   const raw=await page.evaluate(keys=>Object.fromEntries(keys.map(key=>[key,localStorage.getItem(key)])),Object.values(SAVE_KEYS));assert.deepEqual(raw,fixture.slots,'Legacy first load must preserve all original slots');
   if(phase==='combat'){assert(state.paused.includes('resume-confirmation'));const tick=state.run.combat.tick;await page.waitForTimeout(350);assert.equal((await snapshot()).run.combat.tick,tick);assert.equal(state.run.combat.weapons.find(w=>w.defId==='I03').damage,7);}
   await shot('legacy-'+phase+'-320');await restoreFromReload('legacy-'+phase);
   const envelope=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),SAVE_KEYS.current);assert.equal(envelope.contentVersion,CONTENT.version);assert.equal(envelope.payload.session.run.contentVersion,DEVELOPMENT_CONTENT.version);
   if(phase==='combat'){
    const before=(await snapshot()).run;await click('resume-combat');await pollUntil(async()=>(await snapshot()).run.combat.tick>=before.combat.tick+3,{timeoutMs:5000,label:'legacy resumed ticks'});await click('pause-combat');state=await snapshot();const control=new GameSession(DEVELOPMENT_CONTENT,{initialState:fixture.expected});control.advance(state.run.combat.tick-before.combat.tick);const comparable=run=>({...run,revision:0,combat:{...run.combat,events:[]}});assert.deepEqual(comparable(state.run),comparable(control.state.run),'Browser resumes old scheduler, RNG, counters and damage; frame batch revisions/events are intentionally excluded');
   }
   if(phase==='loot'){await click('skip-loot');assert.equal((await snapshot()).run.phase,'preparation');assert.equal((await snapshot()).contentVersion,DEVELOPMENT_CONTENT.version);}
   if(phase==='settlement-unclaimed'){await click('claim-and-menu');assert.equal((await snapshot()).wallet,32);await restoreFromReload('legacy-victory-claimed');assert.equal((await snapshot()).wallet,32);}
   else if(phase!=='settlement-claimed'){if((await snapshot()).paused.length)await click('resume-combat');await click('abandon-run');await click('confirm-abandon');await click('claim-and-menu');}
   const wallet=(await snapshot()).wallet;assert.equal((await snapshot()).screen,'menu');await click('start-run');state=await snapshot();assert.equal(state.run.contentVersion,CONTENT.version);assert.equal(state.wallet,wallet);const weapon=state.run.inventory.instances.find(i=>i.defId==='I03');await dragItem(weapon.id,0,0);await click('start-combat');await page.waitForFunction(()=>window.__qa.session.state.run.combat.tick>=2);await click('pause-combat');state=await snapshot();assert.equal(state.run.combat.weapons[0].damage,5);await shot('legacy-'+phase+'-new-run-tuned');
   report.legacySaves.push({phase,oldVersion:fixture.contentVersion,newVersion:CONTENT.version,originalBytesPreserved:true,reloadedOldRules:true,newRunDamage:5,walletBeforeNewRun:wallet});
   report.checks.push('Isolated genuine legacy '+phase+': original envelope intact on load, old rules/counters restored, next save upgrades only envelope, next run uses tuned rules');
  }finally{await context.close();page=main;}
 }
}

async function growthLegacySaveScenarios(origin){
 const main=page;report.growthLegacySaves=[];
 for(const research of [false,true])for(const phase of ['combat','loot','settlement-claimed']){
  const fixture=makeGrowthSaveFixture(research,phase),context=await browser.newContext({viewport:{width:320,height:800},isMobile:true,hasTouch:true});
  try{
   await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();report.externalRequests.push(route.request().url());return route.abort();});
   await context.addInitScript(({slots,origin})=>{if(location.origin!==origin||sessionStorage.getItem('growth-fixture-injected'))return;for(const [key,value]of Object.entries(slots))if(value!==null)localStorage.setItem(key,value);sessionStorage.setItem('growth-fixture-injected','1');},{slots:fixture.slots,origin});
   page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());if(m.type()==='warning')report.consoleWarnings.push(m.text());});page.on('requestfailed',r=>report.requestFailures.push(r.url()));await page.goto(origin,{waitUntil:'load',timeout:30000});
   await pollUntil(()=>page.evaluate(async()=>{if(typeof System==='undefined')return false;const cc=await System.import('cc');return !!cc.director.getScene()?.getChildByName('Canvas')?.getComponent('BureauRoot')?.presenter;}),{timeoutMs:45000,label:'0.4 legacy '+phase});
   await page.evaluate(async()=>{const cc=await System.import('cc');window.__qa=cc.director.getScene().getChildByName('Canvas').getComponent('BureauRoot').presenter;});await frame();
   let state=await snapshot();assert.equal(state.persistenceError,null);assert.deepEqual(state.run,fixture.expected.run);assert.equal(state.wallet,fixture.expected.wallet);assert.deepEqual(await page.evaluate(keys=>Object.fromEntries(keys.map(k=>[k,localStorage.getItem(k)])),Object.values(SAVE_KEYS)),fixture.slots);
   if(research){assert.deepEqual(state.research.purchases,['relay']);assert.deepEqual(state.run.researchUnlocks,['I12']);}
   await shot('legacy-040-'+(research?'research':'sandbox')+'-'+phase);await restoreFromReload('legacy-040-'+(research?'research':'sandbox')+'-'+phase);
   assert.equal((await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),SAVE_KEYS.current)).contentVersion,CONTENT.version);
   if(phase==='combat'){
    assert((await snapshot()).paused.includes('resume-confirmation'));const before=(await snapshot()).run;await click('resume-combat');await pollUntil(async()=>(await snapshot()).run.combat.tick>=before.combat.tick+3,{timeoutMs:5000,label:'0.4 resumed ticks'});await click('pause-combat');state=await snapshot();const control=new GameSession(LEGACY_GROWTH_DEVELOPMENT_CONTENT,{initialState:fixture.expected});control.advance(state.run.combat.tick-before.combat.tick);const comparable=run=>({...run,revision:0,combat:{...run.combat,events:[]}});assert.deepEqual(comparable(state.run),comparable(control.state.run));
   }
   if(phase!=='settlement-claimed'){if((await snapshot()).paused.length)await click('resume-combat');await click('abandon-run');await click('confirm-abandon');await click('claim-and-menu');}
   const wallet=(await snapshot()).wallet;await click('start-run');state=await snapshot();assert.equal(state.wallet,wallet);assert.equal(state.run.contentVersion,research?RESEARCH_CONTENT.version:CONTENT.version);if(research)assert.deepEqual(state.run.researchUnlocks,['I12']);
   report.growthLegacySaves.push({research,phase,oldVersion:fixture.contentVersion,newVersion:state.run.contentVersion,originalSlotsPreserved:true,ownedBlueprintPreserved:research,wallet});report.checks.push('Legacy 0.4 '+(research?'research':'sandbox')+' '+phase+': original slots and old rules preserved, reload upgrades envelope only, new work order uses 0.4.1; no user storage');
  }finally{await context.close();page=main;}
 }
}

async function selectStash(id){
  for(let tries=0;tries<30;tries++){
    const state=await snapshot();if(state.hits.some(h=>h.id==='stash-item-'+id)){await click('stash-item-'+id);return;}
    const pageIndex=Math.floor(state.run.inventory.stash.indexOf(id)/8);
    assert(pageIndex>=0,'Expected stash item '+id);
    const visible=state.hits.filter(h=>h.itemId&&h.id.startsWith('stash-item-'));
    const currentIndex=visible.length?Math.floor(state.run.inventory.stash.indexOf(visible[0].itemId)/8):0;
    await click(currentIndex<pageIndex?'stash-next':'stash-prev');
  }
  throw new Error('Cannot navigate stash');
}
async function dragItem(id,x,y,rotation=0){
  let state=await snapshot();
  if(state.run.inventory.stash.includes(id))await selectStash(id);
  else {const h=state.hits.find(h=>h.itemId===id);assert(h);await click(h.id);}
  state=await snapshot();for(let turns=0;state.rotation!==rotation&&turns<4;turns++){await click('rotate');state=await snapshot();}
  const hit=state.hits.find(h=>h.itemId===id&&h.id.startsWith('stash-item-'))||state.hits.find(h=>h.itemId===id);
  assert(hit,'Missing item hit');const start=await point(hit.x+hit.w/2,hit.y+hit.h/2),target=await point(48+x*72+34,416+y*72+34);
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(target.x,target.y,{steps:10});await frame();await page.mouse.up();await frame();
}
async function equipPlan(){const before=await snapshot();const plan=fillPlan(before.run.inventory);for(const move of plan.moves){await dragItem(move.id,move.x,move.y,move.rotation);const actual=(await snapshot()).run.inventory.placements.find(p=>p.instanceId===move.id);assert(actual&&actual.x===move.x&&actual.y===move.y&&actual.rotation===move.rotation,'Actual UI placement differs from legal plan');}}

async function clearBoard(){
  for(let n=0;n<40;n++){const state=await snapshot();if(!state.run.inventory.placements.length)return;const id=state.run.inventory.placements[0].instanceId;await click(state.hits.find(h=>h.itemId===id).id);await click('unequip');}
  throw new Error('Unexpected board size');
}
function copperOffer(seed){
  // Offline planning ONLY. This independent session never replaces the browser's run or stats.
  const sim=new GameSession(CONTENT);sim.start(seed,'I01');
  const layout=[[0,0],[1,0],[0,2],[1,2]];
  for(let i=0;i<4;i++){const inv=sim.state.run.inventory;const result=sim.dispatch({type:'inventory',command:{type:'place',instanceId:inv.instances[i].id,x:layout[i][0],y:layout[i][1],rotation:0,expectedRevision:inv.revision}});assert(result.ok);}
  assert(sim.dispatch({type:'start-combat'}).ok);sim.advance(450);if(sim.state.run.phase!=='loot')return -1;
  return sim.state.run.loot.findIndex(o=>o.itemIds.includes('I12')&&o.itemIds.some(id=>CONTENT.items.find(i=>i.id===id).category==='weapon'));
}
async function manualScenarios(){
  for(const width of [360,320]){
    await page.setViewportSize({width,height:800});await frame();
    const before=JSON.stringify((await snapshot()).run);await click('open-manual');
    const itemIds=[];
    for(let listPage=0;listPage<Math.ceil(CONTENT.items.length/5);listPage++){
      const entries=(await snapshot()).hits.filter(h=>h.id.startsWith('manual-entry-')).map(h=>h.id);
      for(const id of entries){
        itemIds.push(id);await click(id);
        if(['I15','I16','I17'].some(def=>id==='manual-entry-'+def))await shot('manual-'+id.replace('manual-entry-','')+'-'+width);
        for(let guard=0;guard<12;guard++){
          const next=(await snapshot()).hits.find(h=>h.id==='manual-entry-next');if(!next?.enabled)break;await click('manual-entry-next');
          assert(guard<11,'Unbounded manual text pagination');
        }
        await click('manual-index');
      }
      if(listPage<Math.ceil(CONTENT.items.length/5)-1)await click('manual-next');
    }
    assert.equal(new Set(itemIds).size,CONTENT.items.length);assert.equal(itemIds.length,CONTENT.items.length);
    await click('manual-filter-weapon');assert.equal((await snapshot()).hits.filter(h=>h.id.startsWith('manual-entry-')).length,4);
    await click('manual-tab-links');await shot('manual-link-index-'+width);
    const linkIds=[];
    for(let listPage=0;listPage<2;listPage++){
      const entries=(await snapshot()).hits.filter(h=>h.id.startsWith('manual-entry-')).map(h=>h.id);
      for(const id of entries){linkIds.push(id);await click(id);if(id==='manual-entry-C02')await shot('manual-relay-'+width);if(id==='manual-entry-C03')await shot('manual-medical-'+width);await click('manual-index');}
      if(listPage===0)await click('manual-next');
    }
    assert.deepEqual(linkIds,['manual-entry-L01','manual-entry-L02','manual-entry-C01','manual-entry-C02','manual-entry-C03','manual-entry-C04']);
    await click('manual-tab-rules');await click('manual-next');await click('manual-entry-B01');await shot('manual-boss-'+width);
    await page.keyboard.press('z');await page.keyboard.press('r');await page.mouse.click(...Object.values(await point(85,451)));await frame();
    assert.equal(JSON.stringify((await snapshot()).run),before,'Manual must not mutate run');
    await page.keyboard.press('Escape');await frame();assert.equal(await page.evaluate(()=>window.__qa.manualOpen),false);
  }
  await page.setViewportSize({width:720,height:1280});await frame();
  report.checks.push('320/360px real manual: all 17 equipment details, 6 links and boss rules reachable; paging/filtering/read-only and Escape verified');
}
function singleOffer(seed){
  const sim=new GameSession(CONTENT);sim.start(seed,'I01');
  let inv=sim.state.run.inventory;assert(sim.dispatch({type:'inventory',command:{type:'place',instanceId:inv.instances[0].id,x:0,y:0,rotation:0,expectedRevision:inv.revision}}).ok);
  assert(sim.dispatch({type:'start-combat'}).ok);sim.advance(450);if(sim.state.run.phase!=='loot')return null;
  const option=sim.state.run.loot.findIndex(o=>o.itemIds.includes('I15'));if(option<0)return null;
  assert(sim.dispatch({type:'choose-loot',optionId:sim.state.run.loot[option].id}).ok);
  inv=sim.state.run.inventory;const single=inv.instances.find(i=>i.defId==='I15');
  assert(sim.dispatch({type:'inventory',command:{type:'place',instanceId:single.id,x:2,y:0,rotation:0,expectedRevision:inv.revision}}).ok);
  assert(sim.dispatch({type:'start-combat'}).ok);sim.advance(450);
  const runtime=sim.state.run.combat.consumables.find(c=>c.instanceId===single.id);
  return runtime?.used===1?{option,expectedOutcome:sim.state.run.combat.outcome}:null;
}
async function singleUseScenario(){
  await click('starter-I01');let seed=(await snapshot()).seed,plan=null,clicks=0;
  for(;clicks<128;clicks++){plan=singleOffer(seed);if(plan)break;seed=(Math.imul(seed,1664525)+1013904223)>>>0;}
  assert(plan,'Need a naturally offered single-use supply with unchanged enemies');for(let n=0;n<clicks;n++)await click('new-seed');assert.equal((await snapshot()).seed,seed);
  await click('start-run');const first=(await snapshot()).run.inventory.instances.find(i=>i.defId==='I01');await dragItem(first.id,0,0);await click('start-combat');
  await pollUntil(async()=> (await snapshot()).run.phase!=='combat',{timeoutMs:65000,label:'single-use route first real wave'});
  const offer=(await snapshot()).run.loot[plan.option];assert(offer.itemIds.includes('I15'));await click('loot-'+plan.option);
  let state=await snapshot();const item=state.run.inventory.instances.find(i=>i.defId==='I15');assert(item);await dragItem(item.id,2,0);await click('start-combat');
  await click('open-manual');const frozen=JSON.stringify((await snapshot()).run);await page.waitForTimeout(300);assert.equal(JSON.stringify((await snapshot()).run),frozen);await click('manual-close');
  await pollUntil(async()=> (await snapshot()).run.combat.consumables.find(c=>c.instanceId===item.id)?.used===1,{timeoutMs:65000,label:'real one-shot emergency activation'});
  state=await snapshot();assert.equal(state.run.combat.consumables.find(c=>c.instanceId===item.id).used,1);
  if(state.run.phase==='combat'){
    await click('pause-combat');const paused=JSON.stringify((await snapshot()).run);await click('open-manual');await shot('manual-paused-combat');await click('manual-close');assert.equal(JSON.stringify((await snapshot()).run),paused);assert((await snapshot()).paused.includes('user'));await click('resume-combat');
    await shot('single-use-consumed-in-combat');
  }
  await pollUntil(async()=> (await snapshot()).run.phase!=='combat',{timeoutMs:65000,label:'real one-shot wave boundary'});
  state=await snapshot();assert.equal(state.run.combat.outcome,plan.expectedOutcome);assert(!state.run.inventory.instances.some(i=>i.id===item.id));assert(!state.run.inventory.placements.some(i=>i.instanceId===item.id));assert(!state.run.inventory.stash.includes(item.id));assert.equal(state.run.inventory.history.length,0);
  assert(state.journal.some(entry=>entry.event.detail==='single-use'&&entry.text.includes('封救')));await shot('single-use-wave-complete');
  if(state.run.phase==='loot'){await click('skip-loot');assert(!(await snapshot()).run.inventory.instances.some(i=>i.id===item.id));}
  report.singleUse={seed,itemId:item.id,outcome:state.run.combat.outcome,used:1,removedAtWaveBoundary:true};
  await click('abandon-run');await click('confirm-abandon');await click('claim-and-menu');
  report.checks.push('Single-use I15 naturally acquired through seeded loot and pointer input: actual HP-triggered heal, read-only battle manual, pause preservation, journal feedback and permanent wave-boundary removal; no item grants or stat overrides');
}
function simulateSupplyRoute(seed,defId){
  const sim=new GameSession(CONTENT);sim.start(seed,'I01');
  for(const [index,x,y] of [[0,0,0],[1,1,0],[2,0,2],[3,1,2]]){const inv=sim.state.run.inventory;const item=inv.instances.find(i=>i.spawnIndex===index);assert(sim.dispatch({type:'inventory',command:{type:'place',instanceId:item.id,x,y,rotation:0,expectedRevision:inv.revision}}).ok);}
  assert(sim.dispatch({type:'start-combat'}).ok);sim.advance(450);if(sim.state.run.phase!=='loot')return null;
  const option=sim.state.run.loot.findIndex(o=>o.itemIds.includes(defId));if(option<0)return null;
  assert(sim.dispatch({type:'choose-loot',optionId:sim.state.run.loot[option].id}).ok);
  let inv=sim.state.run.inventory;const item=inv.instances.find(i=>i.defId===defId);assert(sim.dispatch({type:'inventory',command:{type:'place',instanceId:item.id,x:3,y:3,rotation:0,expectedRevision:inv.revision}}).ok);
  const outcomes=[];let triggerWave=0;
  for(let wave=2;wave<=3;wave++){
    assert(sim.dispatch({type:'start-combat'}).ok);sim.advance(450);const run=sim.state.run,runtime=run.combat.consumables.find(c=>c.instanceId===item.id);outcomes.push(run.combat.outcome);
    if((runtime?.used||0)+(runtime?.pierceUsed||0)>0){triggerWave=wave;break;}
    if(run.phase!=='loot')return null;assert(sim.dispatch({type:'skip-loot'}).ok);
  }
  return triggerWave?{option,triggerWave,outcomes}:null;
}
async function supplyVarietyScenarios(){
  report.supplyVariety=[];
  for(const defId of ['I16','I17']){
    await click('starter-I01');let seed=(await snapshot()).seed,plan=null,changes=0;
    for(;changes<128;changes++){plan=simulateSupplyRoute(seed,defId);if(plan)break;seed=(Math.imul(seed,1664525)+1013904223)>>>0;}
    assert(plan,'Need normal seeded offer for '+defId);for(let i=0;i<changes;i++)await click('new-seed');assert.equal((await snapshot()).seed,seed);
    await click('start-run');let state=await snapshot();const ids=state.run.inventory.instances.map(i=>i.id);
    for(const [index,x,y]of[[0,0,0],[1,1,0],[2,0,2],[3,1,2]])await dragItem(ids[index],x,y);
    await click('start-combat');await pollUntil(async()=>(await snapshot()).run.phase!=='combat',{timeoutMs:65000,label:defId+' naturally earn first-wave loot'});
    state=await snapshot();assert(state.run.loot[plan.option].itemIds.includes(defId));await shot(defId+'-earned-loot');await click('loot-'+plan.option);
    state=await snapshot();const item=state.run.inventory.instances.find(i=>i.defId===defId);assert(item);await dragItem(item.id,3,3);await click('inspect-item');await shot(defId+'-inspection');await click('detail-close');
    for(let wave=2;wave<=plan.triggerWave;wave++){
      await click('start-combat');
      if(wave===plan.triggerWave){
        await pollUntil(async()=>{const c=(await snapshot()).run.combat.consumables.find(c=>c.instanceId===item.id);return(c?.used||0)+(c?.pierceUsed||0)===1;},{timeoutMs:65000,label:defId+' actual automatic trigger'});
        state=await snapshot();if(state.run.phase==='combat'){await click('combat-journal');await shot(defId+'-trigger-journal');await click('journal-close');}
      }
      await pollUntil(async()=>(await snapshot()).run.phase!=='combat',{timeoutMs:65000,label:defId+' wave '+wave+' boundary'});
      state=await snapshot();assert.equal(state.run.combat.outcome,plan.outcomes[wave-2]);
      if(wave<plan.triggerWave){assert(state.run.inventory.instances.some(i=>i.id===item.id),'Untriggered one-shot must survive wave');assert.equal(state.run.combat.consumables.find(c=>c.instanceId===item.id).pierceUsed,0);await shot(defId+'-unarmored-wave-retained');await click('skip-loot');}
    }
    state=await snapshot();const runtime=state.run.combat.consumables.find(c=>c.instanceId===item.id);assert.equal(runtime.used+runtime.pierceUsed,1);assert(!state.run.inventory.instances.some(i=>i.id===item.id));assert(!state.run.inventory.placements.some(i=>i.instanceId===item.id));assert(!state.run.inventory.stash.includes(item.id));assert.equal(state.run.inventory.history.length,0);
    const entries=state.journal.filter(e=>e.event.source===item.id);assert(entries.some(e=>e.event.detail==='single-use'));assert(entries.some(e=>e.text.includes(CONTENT.items.find(i=>i.id===defId).shortName)));
    if(defId==='I16')assert(entries.some(e=>e.event.detail==='pierce'));else assert(entries.some(e=>e.event.type==='shield'&&e.event.amount===24));
    await shot(defId+'-wave-boundary-removed');report.supplyVariety.push({defId,seed,menuSeedChanges:changes,triggerWave:plan.triggerWave,outcomes:plan.outcomes,used:runtime.used,pierceUsed:runtime.pierceUsed,removedAtWaveBoundary:true,events:entries});
    if(state.run.phase==='loot'){await click('skip-loot');assert(!(await snapshot()).run.inventory.instances.some(i=>i.id===item.id));}
    await click('abandon-run');await click('confirm-abandon');await click('claim-and-menu');
  }
  report.checks.push('I16 and I17 earned from actual seeded loot and equipped by pointer: armor-gated one-shot piercing retained through unarmored wave, pre-hit emergency foam shielding, real journals and wave-boundary permanent removal; configured enemy stats, no item grants');
}

async function feedbackScenarios(){
  await page.setViewportSize({width:360,height:800});await frame();await click('starter-I03');await click('start-run');
  let state=await snapshot(),ids=Object.fromEntries(state.run.inventory.instances.map(i=>[i.defId,i.id]));
  await dragItem(ids.I03,0,0);await dragItem(ids.I07,2,1);assert.equal(evaluateLoadout((await snapshot()).run.inventory,CONTENT).weapons[0].hasteBps,0);
  await shot('battery-diagonal-360');await dragItem(ids.I07,1,1);assert.equal(attackSeconds(evaluateLoadout((await snapshot()).run.inventory,CONTENT).weapons[0]),0.63);
  await shot('battery-connected-360');await click('inspect-item');await shot('battery-details-360');await click('detail-close');
  await click('open-guide');await click('guide-next');await shot('guide-battery-360');await click('guide-next');await click('guide-next');await click('guide-next');await shot('guide-circuit-360');await click('guide-next');await shot('guide-recipes-360');await click('guide-close');
  await dragItem(ids.I05,2,0);await dragItem(ids.I09,0,3);await click('start-combat');
  await page.waitForFunction(()=>window.__qa.session.state.run.combat.tick>=63);
  state=await snapshot();assert(state.run.combat.weapons[0].attacks>=10,'Real 0.7s blade must gain attacks from battery');report.battery={seed:state.run.seed,tick:state.run.combat.tick,attacks:state.run.combat.weapons[0].attacks,meanSeconds:0.63};
  await shot('battery-combat-360');await click('abandon-run');await click('confirm-abandon');await click('claim-and-menu');
  report.checks.push('360px battery diagonal/edge inspection and real short-blade cadence gain, no state or damage overrides');
  await page.setViewportSize({width:720,height:1280});await frame();await click('starter-I01');
  let candidate=(await snapshot()).seed,choice=-1,clicks=0;
  for(;clicks<128;clicks++){choice=copperOffer(candidate);if(choice>=0)break;candidate=(Math.imul(candidate,1664525)+1013904223)>>>0;}
  assert(choice>=0,'No naturally earned copper/weapon offer found');for(let i=0;i<clicks;i++)await click('new-seed');assert.equal((await snapshot()).seed,candidate);
  await click('start-run');state=await snapshot();ids=Object.fromEntries(state.run.inventory.instances.map(i=>[i.defId,i.id]));
  await dragItem(ids.I01,0,0);await dragItem(ids.I05,1,0);await dragItem(ids.I07,0,2);await dragItem(ids.I09,1,2);await click('start-combat');
  await page.waitForFunction(()=>window.__qa.session.state.run.phase==='loot',null,{timeout:60000});state=await snapshot();
  assert.equal(state.run.loot[choice].itemIds.includes('I12'),true);await shot('circuit-earned-loot');await click('loot-'+choice);await clearBoard();
  state=await snapshot();const wire=state.run.inventory.instances.find(i=>i.defId==='I12').id;
  const other=state.run.inventory.instances.find(i=>i.spawnIndex>=4&&CONTENT.items.find(d=>d.id===i.defId).category==='weapon').id;
  await dragItem(ids.I01,2,0);await dragItem(wire,1,2);await dragItem(ids.I07,1,1);
  let pose=null;const inv=(await snapshot()).run.inventory;
  for(const rotation of [0,90,180,270])for(let y=0;y<6;y++)for(let x=0;x<5;x++){if(pose)continue;const r=transactInventory(inv,{type:'place',instanceId:other,x,y,rotation,expectedRevision:inv.revision},CONTENT);if(r.ok&&!r.swappedId&&evaluateLoadout(r.state,CONTENT).circuits.length===1)pose={x,y,rotation};}
  assert(pose,'Cannot legally wire naturally earned gear');await dragItem(other,pose.x,pose.y,pose.rotation);
  await click((await snapshot()).hits.find(h=>h.itemId===wire).id);assert.equal(evaluateLoadout((await snapshot()).run.inventory,CONTENT).circuits.length,1);await shot('circuit-preparation');await click('inspect-item');await shot('circuit-inspection');await click('detail-close');
  await click('start-combat');await page.waitForFunction(()=>window.__qa.session.state.run.combat.circuits[0].pulses>=2,null,{timeout:20000});await shot('circuit-combat');
  await click('combat-journal');state=await snapshot();const pulses=state.journal.filter(e=>e.event.type==='relay');assert(pulses.length>=2);assert(pulses.every(e=>e.event.amount===3));
  report.circuit={seed:candidate,menuSeedChanges:clicks,naturallyEarnedWeapon:state.run.inventory.instances.find(i=>i.id===other).defId,runtime:state.run.combat.circuits,pulses};await shot('circuit-journal');await click('journal-close');
  await click('abandon-run');await click('confirm-abandon');await click('claim-and-menu');
  report.checks.push('Naturally earned copper + second weapon assembled through real pointer input; repeated C02 pulses visibly delay real enemy intents');
}

(async()=>{
  try {
    if(server)await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin='http://127.0.0.1:'+(server?server.address().port:4187);report.origin=origin;
    if(friendPackage){const info=await (await fetch(origin+'/__bureau_info')).json();assert.equal(info.packageId,report.friendPackage.packageId,'Wrong packaged server');}
    browser=await chromium.launch({executablePath:local.chrome,headless:true,chromiumSandbox:true,timeout:30000});report.browserVersion=browser.version();
    const context=await browser.newContext({viewport:{width:720,height:1280},deviceScaleFactor:1,hasTouch:true,isMobile:true});
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();report.externalRequests.push(route.request().url());return route.abort();});
    page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());if(m.type()==='warning')report.consoleWarnings.push(m.text());});page.on('requestfailed',r=>report.requestFailures.push(r.url()));
    await page.goto(origin,{waitUntil:'load',timeout:30000});
    await pollUntil(()=>page.evaluate(async()=>{if(typeof System==='undefined')return false;const cc=await System.import('cc');return !!cc.director.getScene()?.getChildByName('Canvas')?.getComponent('BureauRoot')?.presenter;}),{timeoutMs:45000,label:'real BureauRoot scene ready'});
    await page.evaluate(async()=>{const cc=await System.import('cc');window.__qa=cc.director.getScene().getChildByName('Canvas').getComponent('BureauRoot').presenter;});await frame();
    assert.equal(await page.evaluate(()=>window.__qa.content.version),CONTENT.version,'Browser must be running current content');
    await manualScenarios();
    assert.equal((await snapshot()).screen,'menu');assert.equal(await page.evaluate(async()=> (await System.import('cc')).profiler.isShowingStats()),false,'Profiler must not cover gameplay controls');await shot('01-menu');report.checks.push('Real BureauRoot scene initialized and menu rendered');
    await click('start-run');assert.equal((await snapshot()).run.phase,'preparation');
    assert.equal((await snapshot()).guidePage,0);const tutorialRun=JSON.stringify((await snapshot()).run);
    for(let guide=0;guide<6;guide++){await shot('guide-'+(guide+1));if(guide<5)await click('guide-next');}
    await page.keyboard.press('z');assert.equal(JSON.stringify((await snapshot()).run),tutorialRun);await click('guide-close');
    report.checks.push('Six-page first-run guide shown, skippable/replayable, without changing run state');
    const start=(await snapshot()).run;const ids=Object.fromEntries(start.inventory.instances.map(i=>[i.defId,i.id]));
    await dragItem(ids.I01,0,0);await dragItem(ids.I05,1,0);await dragItem(ids.I07,0,2);await dragItem(ids.I09,1,2);
    let state=await snapshot();assert.equal(state.run.inventory.placements.length,4);assert(evaluateLoadout(state.run.inventory,CONTENT).combos.some(c=>c.id==='C01'));
    const beforeInvalid=JSON.stringify(state.run.inventory);await dragItem(ids.I09,4,5);assert.equal(JSON.stringify((await snapshot()).run.inventory),beforeInvalid,'Invalid drag must preserve inventory');
    await click('rotate');const beforeRotate=(await snapshot()).run.inventory.revision;assert.equal((await snapshot()).rotation,90);assert.equal((await snapshot()).run.inventory.revision,beforeRotate);
    const kitHit=(await snapshot()).hits.find(h=>h.itemId===ids.I09);await click(kitHit.id);assert.equal((await snapshot()).run.inventory.placements.find(p=>p.instanceId===ids.I09).rotation,90);await click('undo');assert.equal((await snapshot()).run.inventory.placements.find(p=>p.instanceId===ids.I09).rotation,0);
    await click((await snapshot()).hits.find(h=>h.itemId===ids.I07).id);await shot('02-preparation');await click('inspect-item');await shot('battery-inspection');await click('detail-close');
    report.checks.push('Pointer equip, C01 activation, battery recipient inspection, invalid drop rollback, rotation preview/commit and undo');
    await restoreFromReload('preparation');
    await click('start-combat');await page.waitForFunction(()=>window.__qa.session.state.run.combat.tick>=3);await click('pause-combat');const frozen=(await snapshot()).run.combat.tick;await page.waitForTimeout(400);assert.equal((await snapshot()).run.combat.tick,frozen);await shot('03-paused');await restoreFromReload('combat-paused');await click('resume-combat');report.checks.push('Pause freezes real combat ticks and explicit resume works');
    await page.waitForFunction(()=>window.__qa.session.state.run.combat.tick>=24);
    await shot('04-combat');await click('combat-journal');const journalTick=(await snapshot()).run.combat.tick;
    await page.waitForTimeout(350);assert.equal((await snapshot()).run.combat.tick,journalTick);assert((await snapshot()).journal.some(e=>e.event.type==='damage'));
    await shot('combat-journal');await click('journal-close');await click('open-guide');const guideTick=(await snapshot()).run.combat.tick;await page.waitForTimeout(250);assert.equal((await snapshot()).run.combat.tick,guideTick);await page.keyboard.press('Escape');
    report.checks.push('Real combat damage journal persists and both journal/rulebook pause only their own simulation reason');
    while(true){
      await page.waitForFunction(()=>window.__qa.session.state.run.phase!=='combat',null,{timeout:65000});state=await snapshot();
      if(state.run.phase==='settlement'||state.run.phase==='defeat')break;
      assert.equal(state.run.phase,'loot');if(state.run.wave===1)await shot('05-loot');
      // Inspect every naturally earned supply before claiming; never dispatch fake loot or battle outcomes.
      const pending=JSON.stringify(state.run),beforeWallet=state.wallet;
      await click('view-loot-equipment');state=await snapshot();
      assert.equal(state.lootCollapsed,true);assert.equal(JSON.stringify(state.run),pending);
      assert(!state.hits.some(hit=>['start-combat','rotate','undo','unequip','skip-loot','loot-0'].includes(hit.id)));
      const bagHit=state.hits.find(hit=>hit.id.startsWith('bag-item-'));assert(bagHit);
      await click(bagHit.id);await click('inspect-item');await shot('loot-wave-'+state.run.wave+'-equipment-detail');
      await page.keyboard.press('Escape');await frame();assert.equal((await snapshot()).lootCollapsed,true);
      const stashHit=(await snapshot()).hits.find(hit=>hit.id.startsWith('stash-item-'));
      if(stashHit){await click(stashHit.id);await click('inspect-item');await click('detail-manual');await page.keyboard.press('Escape');await frame();}
      for(const viewport of [{width:320,height:720},{width:1280,height:720}]){
        await page.setViewportSize(viewport);await frame();await frame();
        state=await snapshot();assert.equal(state.lootCollapsed,true);
        await page.keyboard.press('r');await page.keyboard.press('z');await frame();
        assert.equal(JSON.stringify((await snapshot()).run),pending);
        await shot('loot-wave-'+state.run.wave+'-equipment-'+viewport.width);
      }
      await page.setViewportSize({width:360,height:800});await frame();
      await click('abandon-run');await page.keyboard.press('Escape');await frame();
      assert.equal((await snapshot()).lootCollapsed,true);
      await click('return-loot');state=await snapshot();assert.equal(state.lootCollapsed,false);
      assert.equal(JSON.stringify(state.run),pending);assert.equal(state.wallet,beforeWallet);
      await page.keyboard.press('Escape');await frame();assert.equal((await snapshot()).lootCollapsed,true);
      await page.keyboard.press('Escape');await frame();assert.equal((await snapshot()).lootCollapsed,false);
      if(state.run.wave===1){
        await click('view-loot-equipment');await restoreFromReload('loot-inspection-pending');
        state=await snapshot();assert.equal(state.lootCollapsed,false);
        assert.deepEqual(state.run,JSON.parse(pending));assert.equal(state.wallet,beforeWallet);
      }
      report.checks.push('Wave '+state.run.wave+' pending supply: collapse/return, owned-item rules, nested manual, Escape, narrow/landscape UI and read-only safeguards preserve exact rewards');

      let best={index:0,score:-Infinity};
      state.run.loot.forEach((option,index)=>{
        const additions=option.itemIds.map((defId,k)=>({id:state.run.id+'/item/'+(state.run.nextSpawnIndex+k),defId,spawnIndex:state.run.nextSpawnIndex+k}));
        const result=addInstances(state.run.inventory,additions,CONTENT);assert(result.ok);const score=fillPlan(result.state).score;if(score>best.score)best={index,score};
      });
      await click('loot-'+best.index);await equipPlan();if((await snapshot()).run.wave===5)await shot('06-boss-preparation');await click('start-combat');
    }
    report.playthrough={seed:state.run.seed,phase:state.run.phase,victories:state.run.victories,reports:state.run.reports,settlement:state.run.settlement};
    assert.equal(state.run.phase,'settlement','Default development seed must be winnable without ad or stat overrides');assert.equal(state.run.victories,5);assert.equal(state.run.settlement.baseCoins,32);await shot('07-victory');
    await restoreFromReload('settlement-unclaimed');
    await click('claim-and-menu');state=await snapshot();assert.equal(state.screen,'menu');assert.equal(state.wallet,32);report.checks.push('Five real rendered waves won with configured '+CONTENT.version+' rules and no stat overrides; loot and 32-coin settlement committed via pointer input');
    await restoreFromReload('settlement-claimed');
    for(const viewport of [{width:360,height:800},{width:320,height:720},{width:1280,height:720}]){
      await page.setViewportSize(viewport);await frame();await frame();await shot('menu-'+viewport.width+'x'+viewport.height);
      const dims=await page.evaluate(()=>{const c=document.getElementById('GameCanvas').getBoundingClientRect();return {width:c.width,height:c.height};});assert(dims.width>0&&dims.height>0);
    }
    await page.setViewportSize({width:360,height:800});await frame();await click('start-run');assert.equal((await snapshot()).run.phase,'preparation');
    const narrowId=(await snapshot()).run.inventory.stash[0];await selectStash(narrowId);const narrowBefore=JSON.stringify((await snapshot()).run.inventory);await page.keyboard.press('r');await frame();assert.equal((await snapshot()).rotation,90);assert.equal(JSON.stringify((await snapshot()).run.inventory),narrowBefore);
    await click('abandon-run');const behind=await point(80,450);await page.mouse.click(behind.x,behind.y);await page.keyboard.press('z');await frame();assert.equal(JSON.stringify((await snapshot()).run.inventory),narrowBefore);await page.keyboard.press('Escape');await frame();assert(!(await snapshot()).paused.includes('confirm-abandon'));
    await click('abandon-run');await click('cancel-abandon');assert.equal((await snapshot()).run.phase,'preparation');await click('abandon-run');await click('confirm-abandon');assert.equal((await snapshot()).run.settlement.reason,'abandoned');await click('claim-and-menu');assert.equal((await snapshot()).wallet,32);report.checks.push('Narrow-screen pointer and keyboard input, modal click/key blocking, Escape cancellation, abandon/cancel, no duplicate wallet reward');
    // Research uses exactly the naturally earned 32-coin win, before other routes earn more.
    await researchScenarios();
    await feedbackScenarios();
    await singleUseScenario();await supplyVarietyScenarios();
    await starterScenarios();
    await legacySaveScenarios(origin);await growthLegacySaveScenarios(origin);
    await storageFaultScenarios(origin);
    assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.consoleErrors,[]);assert.deepEqual(report.httpErrors,[]);assert.deepEqual(report.requestFailures,[]);assert.deepEqual(report.externalRequests,[]);report.checks.push('No uncaught exception, console error or failed/external request');report.status='BROWSER_GAME_PASSED';
  }catch(error){report.status='BROWSER_GAME_FAILED';report.error=error.stack||String(error);if(page)await shot('failure').catch(()=>{});if(page)report.lastState=await snapshot().catch(()=>null);process.exitCode=1;}
  finally{if(browser)await browser.close().catch(()=>{});if(server){if(server.closeAllConnections)server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}report.finished=new Date().toISOString();fs.writeFileSync(path.join(logs,'result.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(root,'logs/phase-2/browser-game-latest.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks,error:report.error,logs,pageErrors:report.pageErrors,consoleErrors:report.consoleErrors},null,2));}
})();
