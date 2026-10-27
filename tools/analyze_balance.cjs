'use strict';
/** Deterministic policy audit, NOT human playtest or evidence of player win rates. */
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const {CONTENT,DEVELOPMENT_CONTENT,availableStarters}=require('../.test-build/content/catalog.js');
const {GameSession}=require('../.test-build/application/session.js');
const {transactInventory,validateInventory}=require('../.test-build/core/inventory.js');
const {evaluateLoadout,effectiveCooldown}=require('../.test-build/core/loadout.js');
const root=path.resolve(__dirname,'..');const seeds=[1,2,3,7,42,20261015];
const policies=['weapon-only-skip','initial-kit-skip','first-fit-first-loot'];
function accepted(session,action){const result=session.dispatch(action);assert(result.ok,result.reason);}
function fill(session,weaponOnly=false){
  const ids=session.state.run.inventory.stash.slice();
  for(const id of ids){
    const item=session.state.run.inventory.instances.find(i=>i.id===id),definition=session.content.items.find(i=>i.id===item.defId);
    if(weaponOnly&&definition.category!=='weapon')continue;
    let placed=false;
    for(const rotation of [0,90,180,270]){
      for(let y=0;y<6&&!placed;y++)for(let x=0;x<5&&!placed;x++){
        const inventory=session.state.run.inventory;
        const command={type:'place',instanceId:id,x,y,rotation,expectedRevision:inventory.revision};
        const candidate=transactInventory(inventory,command,session.content);
        if(!candidate.ok||candidate.swappedId)continue;
        accepted(session,{type:'inventory',command});placed=true;
      }
      if(placed)break;
    }
  }
  assert.deepEqual(validateInventory(session.state.run.inventory,session.content),[]);
}
function play(content,starter,seed,policy){
  const session=new GameSession(content);session.start(seed,starter);const waves=[];
  while(session.state.run.phase==='preparation'){
    fill(session,policy==='weapon-only-skip');
    const loadout=evaluateLoadout(session.state.run.inventory,content);
    accepted(session,{type:'start-combat'});session.advance(content.limits.deadlineTick);
    const run=session.state.run,combat=run.combat;
    waves.push({wave:run.wave,outcome:combat.outcome,hp:combat.hp,ticks:combat.tick,damageTaken:combat.stats.damageTaken,healing:combat.stats.healing,shieldAbsorbed:combat.stats.shieldAbsorbed,
      equipped:run.inventory.placements.length,weaponCount:loadout.weapons.length,combos:loadout.combos.map(c=>c.id),initialShield:loadout.initialShield,
      nominalWeaponDps:Number(loadout.weapons.reduce((sum,w)=>sum+10*(w.damage+w.bonusDamage)/effectiveCooldown(w),0).toFixed(2))});
    if(run.phase==='loot')accepted(session,policy==='first-fit-first-loot'?{type:'choose-loot',optionId:run.loot[0].id}:{type:'skip-loot'});
    else break;
  }
  if(session.state.run.phase==='defeat')accepted(session,{type:'finish-defeat'});
  const run=session.state.run;assert.equal(run.phase,'settlement');
  return {pool:content===CONTENT?'normal-locked':'development-all',contentVersion:content.version,starter,seed,policy,victory:run.settlement.reason==='victory',reason:run.settlement.reason,victories:run.victories,finalHp:run.hp,totalTicks:waves.reduce((sum,w)=>sum+w.ticks,0),waves};
}
const results=[];
for(const content of [CONTENT,DEVELOPMENT_CONTENT])for(const starter of availableStarters(content))for(const policy of policies)for(const seed of seeds)results.push(play(content,starter.id,seed,policy));
const summaries=[];
for(const content of [CONTENT,DEVELOPMENT_CONTENT])for(const starter of availableStarters(content))for(const policy of policies){
  const selected=results.filter(r=>r.contentVersion===content.version&&r.starter===starter.id&&r.policy===policy);
  const wins=selected.filter(r=>r.victory);
  summaries.push({pool:content===CONTENT?'normal-locked':'development-all',starter:starter.id,starterName:starter.name,policy,samples:selected.length,wins:wins.length,
    minCompletedWaves:Math.min(...selected.map(r=>r.victories)),maxCompletedWaves:Math.max(...selected.map(r=>r.victories)),
    meanFinalHp:Number((selected.reduce((sum,r)=>sum+r.finalHp,0)/selected.length).toFixed(2)),
    meanSimulationSeconds:Number((selected.reduce((sum,r)=>sum+r.totalTicks,0)/selected.length/10).toFixed(2))});
}
const report={at:new Date().toISOString(),scope:'Pure deterministic simulation of current source, not browser gameplay, human difficulty, native performance or player win rate.',
  seeds,policies:{'weapon-only-skip':'Equip only the initial weapon, skip all loot.','initial-kit-skip':'First-fit all four starting items; skip all loot.','first-fit-first-loot':'First-fit owned items, always receive the first real offered loot option; no replacement/repacking/combination optimization.'},
  sourceOverrides:false,samples:results.length,summaries,results};
const dir=path.join(root,'logs/phase-3');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'balance-policy-audit-'+report.at.replace(/[:.]/g,'-')+'.json');
fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');fs.writeFileSync(path.join(dir,'balance-policy-latest.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({scope:report.scope,samples:report.samples,seeds,log:file,summaries},null,2));
