import { researchSpent, researchItemIds } from '../content/research';
import { GameContent, RunState } from '../core/types';
import { availableStarters, contentForVersion, isResearchContent, researchContentFor, withResearch } from '../content/catalog';
import { validateInventory } from '../core/inventory';
import { evaluateLoadout } from '../core/loadout';
import { stepCombat } from '../core/combat';
import { canonicalJson } from '../core/save-codec';
import { normalizeSeed } from '../core/random';
import { SessionState } from './session';
import { SaveError } from './save-repository';
export interface RewardReceipt {key:string;runId:string;amount:number;}
export interface SessionSave {
  session:SessionState; rewardLedger:RewardReceipt[];
  tutorialSeen:boolean; seed:number; starter:string;
}
function object(value:unknown,label:string):asserts value is Record<string,unknown> {if(value===null||typeof value!=='object'||Array.isArray(value))throw new Error(label+' must be an object');}
function integer(value:unknown,label:string,min=0,max=Number.MAX_SAFE_INTEGER):asserts value is number {if(!Number.isSafeInteger(value)||(value as number)<min||(value as number)>max)throw new Error(label+' invalid integer');}
function id(value:unknown,label:string,max=200):asserts value is string {if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error(label+' invalid identifier');}
function stats(value:unknown):void {
  object(value,'stats');object(value.weapons,'stats.weapons');
  for(const key of ['damageTaken','shieldAbsorbed','healing','kills','comboTriggers','ticks'])integer(value[key],'stats.'+key);
  for(const entry of Object.values(value.weapons)){object(entry,'weaponStats');for(const key of ['base','combo','raw','overkill','attacks'])integer(entry[key],'weaponStats.'+key);if((entry.base as number)+(entry.combo as number)+(entry.overkill as number)!==entry.raw)throw new Error('Inconsistent report damage');}
}
export function validateSavedRun(value:unknown,content:GameContent):asserts value is RunState {
  object(value,'run');const run=value as unknown as RunState;
  id(run.id,'run.id',120);normalizeSeed(run.seed);
  if(run.contentVersion!==content.version)throw new Error('Run content mismatch');
  integer(run.revision,'run.revision');integer(run.wave,'run.wave',1,content.waves.length);
  integer(run.victories,'run.victories',0,content.waves.length);integer(run.nextSpawnIndex,'run.nextSpawnIndex',4);
  if(!['preparation','combat','loot','defeat','settlement'].includes(run.phase))throw new Error('Unknown run phase');
  object(run.inventory,'inventory');
  if(Array.isArray(run.inventory.instances)&&run.inventory.instances.some(instance=>!content.items.some(item=>item.id===instance?.defId)))throw new SaveError('incompatible','存档含未知装备；原始工单已保留，请使用匹配内容版本。');
  const errors=validateInventory(run.inventory,content);if(errors.length)throw new Error(errors.join('; '));
  if(run.inventory.width!==5||run.inventory.height!==6)throw new Error('Wrong inventory size');
  for(const instance of run.inventory.instances){if(instance.id!==run.id+'/item/'+instance.spawnIndex||instance.spawnIndex>=run.nextSpawnIndex)throw new Error('Invalid run instance identity');}
  if(!Array.isArray(run.processedCommandIds)||new Set(run.processedCommandIds).size!==run.processedCommandIds.length)throw new Error('Invalid command ledger');
  run.processedCommandIds.forEach(key=>id(key,'commandId'));
  if(run.processedCommandIds.length>run.revision)throw new Error('Command ledger exceeds run revision');
  if(!Array.isArray(run.reports)||run.reports.length>content.waves.length)throw new Error('Invalid wave reports');
  run.reports.forEach((report,index)=>{object(report,'report');if(report.wave!==index+1||!['victory','defeat','timeout'].includes(report.outcome))throw new Error('Invalid report ordering');integer(report.remainingHp,'remainingHp');stats(report.stats);if(index<run.reports.length-1&&report.outcome!=='victory')throw new Error('Reports after defeat');});
  if(run.reports.filter(report=>report.outcome==='victory').length!==run.victories)throw new Error('Victory count mismatch');
  const loadout=evaluateLoadout(run.inventory,content);
  if(run.hp!==null)integer(run.hp,'run.hp',0,loadout.maxHp);
  else if(!((run.phase==='preparation'||(run.phase==='settlement'&&run.settlement?.reason==='abandoned'&&run.combat===null))&&run.wave===1&&run.reports.length===0))throw new Error('Missing carried HP');
  if(typeof run.lootEvent!=='boolean'||!Array.isArray(run.loot))throw new Error('Invalid loot');
  if(run.phase==='loot'){
    if(run.victories!==run.wave||run.wave>=content.waves.length||run.loot.length!==3)throw new Error('Invalid loot phase');
    run.loot.forEach((option,index)=>{object(option,'lootOption');if(option.id!==run.id+'/loot/'+run.wave+'/'+index||!Array.isArray(option.itemIds)||option.itemIds.length!==2||option.itemIds.some(key=>!content.items.some(item=>item.id===key&&item.unlocked)))throw new Error('Invalid loot option');});
  }else if(run.loot.length)throw new Error('Loot outside loot phase');
  if(run.phase==='preparation'&&(run.combat!==null||run.reports.length!==run.wave-1||run.victories!==run.wave-1))throw new Error('Invalid preparation checkpoint');
  if(run.phase==='combat'&&(run.reports.length!==run.wave-1||run.victories!==run.wave-1))throw new Error('Invalid combat progression');
  if(run.phase==='combat'||run.phase==='loot'||run.phase==='defeat'){
    if(run.combat===null)throw new Error('Missing combat checkpoint');
  }
  if(run.combat!==null){
    const combat=run.combat;stepCombat(combat,0);
    if(combat.deadlineTick!==content.limits.deadlineTick||combat.tick>combat.deadlineTick||combat.hp<0||combat.hp!==run.hp)throw new Error('Invalid combat checkpoint bounds');
    if(combat.stats.ticks!==combat.tick||combat.rng===0)throw new Error('Invalid combat counters');
    if(combat.enemies.length!==content.waves[run.wave-1].length)throw new Error('Wrong wave enemies');
    combat.enemies.forEach((enemy,index)=>{
      const expected=content.enemies.find(def=>def.id===content.waves[run.wave-1][index])!;
      for(const key of ['id','name','color','damage','armor','cooldown','behavior','enrageThresholdBps','enragedCooldown'] as const)if(enemy[key]!==expected[key])throw new Error('Saved enemy definition mismatch');
      if(enemy.maxHp!==expected.hp)throw new Error('Saved enemy max HP mismatch');
    });
    if(run.phase==='combat'){
      if(combat.outcome!=='active'||combat.hp<=0||combat.tick>=combat.deadlineTick||!combat.enemies.some(enemy=>enemy.hp>0))throw new Error('Invalid active combat');
      if(loadout.weapons.length!==combat.weapons.length||loadout.consumables.length!==combat.consumables.length)throw new Error('Runtime equipment mismatch');
      for(const weapon of loadout.weapons){const live=combat.weapons.find(w=>w.instanceId===weapon.instanceId);if(!live||Object.keys(weapon).some(key=>canonicalJson(weapon[key as keyof typeof weapon])!==canonicalJson(live[key as keyof typeof weapon])))throw new Error('Saved weapon mismatch');}
      for(const supply of loadout.consumables){const live=combat.consumables.find(c=>c.instanceId===supply.instanceId);if(!live||Object.keys(supply).some(key=>canonicalJson(supply[key as keyof typeof supply])!==canonicalJson(live[key as keyof typeof supply])))throw new Error('Saved consumable mismatch');}
      for(const key of ['maxHp','reduction','critBps','critMultiplierBps','shieldCap','killShield','killShieldCap'] as const)if(combat[key]!==loadout[key])throw new Error('Saved loadout mismatch');
    }
    if(combat.outcome==='victory'&&(combat.hp<=0||combat.enemies.some(enemy=>enemy.hp>0)))throw new Error('Invalid victory checkpoint');
    if(combat.outcome==='defeat'&&combat.hp!==0)throw new Error('Invalid defeat HP');
    if(combat.outcome==='timeout'&&(combat.tick!==combat.deadlineTick||combat.hp<=0||!combat.enemies.some(enemy=>enemy.hp>0)))throw new Error('Invalid timeout checkpoint');
    if(run.phase==='loot'&&combat.outcome!=='victory')throw new Error('Loot without victory');
    if(run.phase==='defeat'&&!['defeat','timeout'].includes(combat.outcome))throw new Error('Defeat without terminal combat');
  }
  if(run.phase==='defeat'&&(run.reports.length!==run.wave||run.victories!==run.wave-1))throw new Error('Invalid defeat progression');
  if(run.phase==='settlement'){
    object(run.settlement,'settlement');const settlement=run.settlement;
    if(settlement.key!==run.id+'/settlement'||!['victory','defeat','timeout','abandoned'].includes(settlement.reason)||typeof settlement.claimed!=='boolean')throw new Error('Invalid settlement');
    if(settlement.baseCoins!==4*run.victories+(settlement.reason==='victory'?12:0))throw new Error('Invalid settlement amount');
    if(['defeat','timeout'].includes(settlement.reason)&&(run.combat?.outcome!==settlement.reason||run.reports.length!==run.wave||run.victories!==run.wave-1))throw new Error('Invalid defeat settlement');
    if(settlement.reason==='victory'&&run.combat?.outcome!=='victory')throw new Error('Victory settlement without combat victory');
    if(settlement.reason==='victory'&&(run.victories!==content.waves.length||run.wave!==content.waves.length))throw new Error('Incomplete victory settlement');
  }else if(run.settlement!==null)throw new Error('Settlement in wrong phase');
}
export function validateSessionSave(value:unknown,content:GameContent):asserts value is SessionSave {
  canonicalJson(value);object(value,'payload');object(value.session,'session');
  const session=value.session as unknown as SessionState;
  integer(session.wallet,'wallet');integer(session.nextRun,'nextRun',1);integer(session.nextCommand,'nextCommand',1);
  if(session.run!==null){let runContent=contentForVersion(content,session.run.contentVersion);if(!runContent)throw new SaveError('incompatible','工单内容版本未知；原数据已保留。');if(session.run.researchUnlocks!==undefined){if(!isResearchContent(runContent)||!Array.isArray(session.run.researchUnlocks))throw new Error('Invalid research snapshot');runContent=withResearch(runContent,session.run.researchUnlocks);}else if(isResearchContent(runContent))throw new Error('Missing research snapshot');validateSavedRun(session.run,runContent);const sequence=Number(session.run.id.split('-').pop());if(!Number.isSafeInteger(sequence)||sequence<1||sequence>=session.nextRun)throw new Error('Invalid run sequence');}
  if(typeof value.tutorialSeen!=='boolean')throw new Error('Invalid tutorial flag');normalizeSeed(value.seed as number);
  const spent=researchSpent(session.research);
  const unlocked=researchItemIds(session.research);
  if(session.run?.researchUnlocks?.some(id=>!unlocked.includes(id)))throw new Error('Run research not owned');
  const menuContent=session.research?.mode==='research'?withResearch(researchContentFor(content),unlocked):content;
  if(!availableStarters(menuContent).some(item=>item.id===value.starter))throw new Error('Invalid starter');
  if(!Array.isArray(value.rewardLedger))throw new Error('Invalid reward ledger');
  const keys=new Set<string>();let wallet=0;
  for(const receipt of value.rewardLedger){object(receipt,'receipt');id(receipt.key,'receipt.key');id(receipt.runId,'receipt.runId',120);integer(receipt.amount,'receipt.amount',0,32);if(receipt.key!==receipt.runId+'/settlement'||keys.has(receipt.key))throw new Error('Invalid reward identity');keys.add(receipt.key);wallet+=receipt.amount;integer(wallet,'ledger wallet');}
  if(wallet-spent!==session.wallet)throw new Error('Wallet must equal durable reward ledger minus researched blueprints');
  if(session.run?.settlement){const receipt=value.rewardLedger.find(r=>r.key===session.run!.settlement!.key);if(session.run.settlement.claimed!==!!receipt||(receipt&&receipt.amount!==session.run.settlement.baseCoins))throw new Error('Settlement and reward ledger disagree');}
}
