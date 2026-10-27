import { GameContent, InventoryCommand, ItemInstance, LootOption, RunState, Settlement, WaveReport } from './types';
import { addInstances, beginPreparation, createInventory, transactInventory, validateInventory } from './inventory';
import { evaluateLoadout } from './loadout';
import { createCombat, stepCombat } from './combat';
import { deriveSeed, normalizeSeed, randomInt, weightedIndex } from './random';
import { availableStarters, validateContent } from '../content/catalog';
export type RunAction =
  | { type: 'inventory'; command: InventoryCommand }
  | { type: 'start-combat' }
  | { type: 'choose-loot'; optionId: string }
  | { type: 'skip-loot' }
  | { type: 'finish-defeat' }
  | { type: 'abandon' }
  | { type: 'claim-settlement' };
export interface RunCommand { commandId: string; runId: string; expectedRevision: number; action: RunAction; }
export interface RunResult { ok: boolean; state: RunState; reason?: string; duplicate?: boolean; coinsAdded?: number; }
export function createRun(id: string, seed: number, starterId: string, content: GameContent): RunState {
  if (typeof id !== 'string' || !id.trim() || id.length > 120 || typeof starterId!=='string') throw new Error('Invalid run identity or starter');
  const errors=validateContent(content); if(errors.length) throw new Error(errors.join('; '));
  if(!availableStarters(content).some(item=>item.id===starterId))throw new Error('Invalid or locked initial weapon');
  normalizeSeed(seed);
  const instances: ItemInstance[]=[starterId,'I05','I07','I09'].map((defId,i)=>({id:id+'/item/'+i,defId,spawnIndex:i}));
  return {id,seed,contentVersion:content.version,revision:0,phase:'preparation',wave:1,victories:0,inventory:createInventory(instances),nextSpawnIndex:4,hp:null,combat:null,loot:[],lootEvent:false,reports:[],settlement:null,processedCommandIds:[]};
}
function lootForWave(state:RunState, content:GameContent): {loot:LootOption[];event:boolean} {
  const event=state.wave===2 && randomInt(deriveSeed(state.seed,(content.randomNamespace||content.version)+'/event/wave-2'),10000).value < content.event.chanceBps;
  const pool=content.items.filter(i=>i.unlocked).slice().sort((a,b)=>a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const weights=pool.map(i=>i.weight*(event&&i.category==='weapon'?content.event.weaponWeightMultiplier:1));
  let rng=deriveSeed(state.seed,(content.randomNamespace||content.version)+'/loot/wave-'+state.wave+'/base');
  const loot:LootOption[]=[];
  for(let option=0;option<3;option++){
    const itemIds:string[]=[];
    for(let index=0;index<2;index++){const draw=weightedIndex(rng,weights);rng=draw.state;itemIds.push(pool[draw.value].id);}
    loot.push({id:state.id+'/loot/'+state.wave+'/'+option,itemIds});
  }
  return {loot,event};
}
function settlement(state:RunState, reason:Settlement['reason']):Settlement {
  return {key:state.id+'/settlement',reason,baseCoins:4*state.victories+(reason==='victory'?12:0),claimed:false};
}
function report(state:RunState):WaveReport {
  const c=state.combat!; return {wave:state.wave,outcome:c.outcome,stats:c.stats,remainingHp:c.hp};
}
export function advanceRun(state:RunState, ticks:number, content:GameContent):RunState {
  if(!Number.isSafeInteger(ticks)||ticks<0||ticks>10000) throw new Error('Invalid tick batch');
  if(state.phase!=='combat'||!state.combat||ticks===0)return state;
  if(state.contentVersion!==content.version)throw new Error('Content version mismatch');
  if(!Number.isSafeInteger(state.revision)||state.revision<0||state.revision===Number.MAX_SAFE_INTEGER)throw new Error('Run revision exhausted');
  const combat=stepCombat(state.combat,ticks);
  let next:RunState={...state,combat,hp:combat.hp,revision:state.revision+1};
  if(combat.outcome==='active')return next;
  // Consume only at a wave boundary; retain runtime counters for inspection during combat.
  // Remove from every inventory collection and discard undo snapshots so spent items cannot return.
  const spent=new Set(combat.consumables.filter(s=>s.singleUse&&(s.used>0||s.pierceUsed>0)).map(s=>s.instanceId));
  if(spent.size){
    const inv=next.inventory;
    if(inv.revision===Number.MAX_SAFE_INTEGER)throw new Error('Inventory revision exhausted');
    next={...next,inventory:{...inv,revision:inv.revision+1,instances:inv.instances.filter(i=>!spent.has(i.id)),placements:inv.placements.filter(p=>!spent.has(p.instanceId)),stash:inv.stash.filter(id=>!spent.has(id)),history:[]}};
  }
  next={...next,reports:[...next.reports,report(next)]};
  if(combat.outcome!=='victory') return {...next,phase:'defeat'};
  next={...next,victories:next.victories+1};
  if(next.wave===content.waves.length) return {...next,phase:'settlement',settlement:settlement(next,'victory')};
  const dropped=lootForWave(next,content);
  return {...next,phase:'loot',loot:dropped.loot,lootEvent:dropped.event};
}
export function applyRunCommand(state:RunState, command:RunCommand, content:GameContent):RunResult {
  const no=(reason:string):RunResult=>({ok:false,state,reason});
  if(!command || typeof command!=='object')return no('操作无效');
  if(command.runId!==state.id)return no('不是当前出勤');
  if(typeof command.commandId!=='string'||!command.commandId.trim()||command.commandId.length>200)return no('操作编号无效');
  if(state.processedCommandIds.includes(command.commandId))return {ok:true,state,duplicate:true,coinsAdded:0};
  if(!Number.isSafeInteger(command.expectedRevision)||command.expectedRevision!==state.revision)return no('界面已更新，请重新操作');
  if(state.contentVersion!==content.version)return no('内容版本不一致');
  if(state.revision===Number.MAX_SAFE_INTEGER)return no('操作版本已达上限');
  const action=command.action;
  if(!action||typeof action!=='object')return no('操作内容无效');
  let next:RunState=state;let coinsAdded=0;
  switch(action.type){
    case 'inventory': {
      if(state.phase!=='preparation')return no('只有整备阶段可以调整装备');
      const result=transactInventory(state.inventory,action.command,content);
      if(!result.ok)return no(result.reason||'无法放置');
      const maxHp=evaluateLoadout(result.state,content).maxHp;
      next={...state,inventory:result.state,hp:state.hp===null?null:Math.min(state.hp,maxHp)};
      break;
    }
    case 'start-combat': {
      if(state.phase!=='preparation')return no('当前不在整备阶段');
      const errors=validateInventory(state.inventory,content); if(errors.length)return no(errors.join('; '));
      const loadout=evaluateLoadout(state.inventory,content);
      if(!loadout.weapons.length)return no('至少把一件武器放进背包，再出击');
      const enemies=content.waves[state.wave-1].map(id=>content.enemies.find(e=>e.id===id)!);
      const combat=createCombat(loadout,enemies,deriveSeed(state.seed,(content.randomNamespace||content.version)+'/combat/wave-'+state.wave),state.hp,content.limits.deadlineTick);
      next={...state,phase:'combat',inventory:beginPreparation(state.inventory),combat,hp:combat.hp,loot:[],lootEvent:false};
      break;
    }
    case 'choose-loot':
    case 'skip-loot': {
      if(state.phase!=='loot')return no('补给已领取或尚未出现');
      let inventory=state.inventory;let nextSpawnIndex=state.nextSpawnIndex;
      if(action.type==='choose-loot'){
        const option=state.loot.find(o=>o.id===action.optionId);if(!option)return no('补给选项已失效');
        const instances=option.itemIds.map(defId=>{const spawnIndex=nextSpawnIndex++;return {id:state.id+'/item/'+spawnIndex,defId,spawnIndex};});
        const result=addInstances(inventory,instances,content);if(!result.ok)return no(result.reason||'补给领取失败');inventory=result.state;
      }
      next={...state,phase:'preparation',wave:state.wave+1,inventory:beginPreparation(inventory),nextSpawnIndex,loot:[],lootEvent:false,combat:null};
      break;
    }
    case 'finish-defeat':
      if(state.phase!=='defeat')return no('不是待结算的失败战斗');
      next={...state,phase:'settlement',settlement:settlement(state,state.combat?.outcome==='timeout'?'timeout':'defeat')};break;
    case 'abandon':
      if(state.phase==='settlement')return no('本局已经结束');
      next={...state,phase:'settlement',settlement:settlement(state,'abandoned'),loot:[]};break;
    case 'claim-settlement':
      if(state.phase!=='settlement'||!state.settlement)return no('尚未到结算阶段');
      if(state.settlement.claimed)return no('基础金币已领取');
      coinsAdded=state.settlement.baseCoins;next={...state,settlement:{...state.settlement,claimed:true}};break;
    default:return no('未知操作');
  }
  next={...next,revision:state.revision+1,processedCommandIds:[...state.processedCommandIds,command.commandId]};
  return {ok:true,state:next,coinsAdded};
}
