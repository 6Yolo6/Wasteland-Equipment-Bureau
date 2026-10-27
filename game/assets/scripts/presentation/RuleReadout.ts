import { CombatEvent, ConsumableRuntime, GameContent, InventoryState, RunState, WeaponLoadout } from '../core/types';
import { getItem } from '../content/catalog';
import { attackSeconds, buildAdjacency, evaluateLoadout } from '../core/loadout';

export const seconds = (value:number):string => value.toFixed(2).replace(/0$/, '').replace(/\.0$/, '');
export const weaponTiming = (weapon:Pick<WeaponLoadout,'cooldown'|'hasteBps'>):string => seconds(attackSeconds(weapon))+'秒';
/** Both charge counters can exhaust a single-use item; piercing never increments used. */
export const singleUseSpent = (supply:Pick<ConsumableRuntime,'singleUse'|'used'|'pierceUsed'>):boolean => !!supply.singleUse && (supply.used > 0 || supply.pierceUsed > 0);
export function supplyRemaining(supply:ConsumableRuntime):string[] {
  const lines:string[]=[];
  if(supply.pierceCharges)lines.push('穿甲供给剩余 '+Math.max(0,supply.pierceCharges-supply.pierceUsed)+'/'+supply.pierceCharges+'份');
  if(supply.charges)lines.push((supply.emergencyShield?'补盾':'治疗')+'供给剩余 '+Math.max(0,supply.charges-supply.used)+'/'+supply.charges+'次');
  return lines;
}
export interface ItemInspection { placed:boolean; status:string; active:boolean; lines:string[]; peers:string[]; }
/** A read-only projection. Inspecting or hovering must never consume RNG, charges or commands. */
export function inspectItem(inv:InventoryState, content:GameContent, id:string):ItemInspection {
  const instance=inv.instances.find(item=>item.id===id);
  if(!instance)throw new Error('Missing inspected item');
  const item=getItem(content,instance.defId), loadout=evaluateLoadout(inv,content), graph=buildAdjacency(inv,content);
  const placed=inv.placements.some(p=>p.instanceId===id), neighbors=graph.get(id)||[];
  const def=(target:string)=>getItem(content,inv.instances.find(i=>i.id===target)!.defId);
  const weapons=loadout.weapons.filter(w=>neighbors.includes(w.instanceId));
  const named=(target:string)=>def(target).shortName;
  let status=placed?'已装备 · 基础效果生效':'在备存 · 当前不生效';
  let active=placed;const lines:string[]=[];let peers:string[]=[];
  if(!placed)lines.push('先放入背包，备存中的物品不参加战斗。');
  const own=loadout.weapons.find(w=>w.instanceId===id);
  if(item.weapon){
    lines.push('基础：'+item.weapon.damage+' 伤害 / '+seconds(item.weapon.cooldown/10)+'秒');
    if(own){
      lines.push('装配：'+(own.damage+own.bonusDamage)+' 伤害 / 平均 '+weaponTiming(own));
      const batteries=neighbors.filter(target=>def(target).id==='I07');
      lines.push(batteries.length?'供电已接通：电池×'+batteries.length+'（同类不叠加）':'未接电池：正交贴边可缩短冷却');
      peers=neighbors.filter(target=>['I05','I07','I12','I13'].includes(def(target).id));
      if(own.bonusDamage)lines.push('布局伤害加成 +'+own.bonusDamage+'，已计入装配伤害。');
      if(own.hasteBps)lines.push('平均冷却 -'+(own.hasteBps/100)+'%；按0.1秒步长保留余量，不吞加速。');
    }
    lines.push(item.weapon.targets>1?'每次命中前 '+item.weapon.targets+' 个存活目标。':'自动攻击左起第一个存活敌人。');
    if(item.weapon.splash)lines.push('另一个存活目标受到 '+item.weapon.splash+' 基础溅射伤害。');
    lines.push('命中后再扣敌人护甲，普通命中至少造成1伤害。');
  }else if(item.id==='I07'){
    peers=weapons.map(w=>w.instanceId);active=placed&&weapons.length>0;
    status=!placed?status:active?'供电已接通 · '+weapons.length+' 把武器':'供电未接通 · 需要贴边';
    lines.push('正交共边才供电；斜角、隔空不算。');
    lines.push('自身护盾 +'+(item.effects.shield||0)+'，不依赖供电连线。');
    for(const w of weapons)lines.push(named(w.instanceId)+'：'+seconds(w.cooldown/10)+' → '+weaponTiming(w)+'（装配均值）');
    lines.push('电池直接供电不需要铜线；铜线用于进阶检修回路。');
    lines.push('同类电池不叠加；总冷却缩短上限 '+content.limits.hasteBps/100+'%。');
  }else if(item.id==='I12'){
    const batteries=neighbors.filter(target=>def(target).id==='I07');
    const circuit=loadout.circuits?.find(c=>c.anchorId===id);
    peers=[...batteries,...weapons.map(w=>w.instanceId)];active=!!circuit;
    status=circuit?'错峰检修已接通':'错峰检修未接通';
    lines.push((batteries.length?'已满足':'还缺')+'：电池正交贴铜线（'+batteries.length+'/1）');
    lines.push((weapons.length>=2?'已满足':'还缺')+'：两把武器正交贴铜线（'+Math.min(weapons.length,2)+'/2）');
    lines.push('必须是两件武器，不是一把武器接触两个格子。');
    if(circuit){
      lines.push('接线武器：'+circuit.weaponIds.map(named).join('、'));
      lines.push('两把各开火一次 → 最近一次敌方攻击延后 '+seconds(circuit.delayTicks/10)+'秒。');
      lines.push('每波最多 '+circuit.maxPulses+' 次；同一把连续开火不能替代另一把。');
    }else if(placed&&batteries.length&&weapons.length>=2)lines.push('全局回路已达上限；按装备获得顺序确定生效对象。');
    lines.push('该两把武器平均冷却 -10%，整局只启用1条回路。');
  }else if(item.id==='I05'){
    const combos=loadout.combos.filter(c=>c.id==='C01'&&c.participants.includes(id));
    peers=combos.map(c=>c.anchorId);status=placed?'屏护射位 · '+peers.length+' 把武器':status;
    lines.push('放入即提供护盾 +'+item.effects.shield+'、每次减伤 '+item.effects.reduction+'。');
    lines.push('正交邻接武器伤害 +2；同武器不重复，最多3把。');
    lines.push(peers.length?'生效武器：'+peers.map(named).join('、'):'尚无获选邻接武器；检查贴边和组合上限。');
  }else{
    lines.push(item.description);
    if(item.category==='consumable')lines.push(item.lifetime==='single-use'?'一次性：自动触发，整次出勤仅用一次；用后本波结束移除，未触发保留。不能撤销取回。':'每波补给：自动触发，不需要点击；次数每波重置，设备本身不消失。');
    if(item.effects.emergencyHeal)lines.push('必须先受到生命伤害且仍存活；护盾受击、满血或致死不触发。');
    if(item.effects.emergencyShield){
      lines.push('护盾为0且存活敌人即将攻击才补盾；先补'+item.effects.emergencyShield+'盾（总上限'+content.limits.shield+'），再按减伤→护盾→生命结算。有盾不触发，不要求低血量或先受生命伤害。');
      lines.push('同类按装备获得顺序检查，一个补盾后其他不重复触发；未触发可留到下一波。');
    }
    if(item.effects.healCharges)lines.push((item.effects.emergencyShield?'补盾':'治疗')+'供给：'+(item.lifetime==='single-use'?'整次出勤':'每波')+item.effects.healCharges+'次。');
    if(item.effects.pierceCharges)lines.push('穿甲供给：'+(item.lifetime==='single-use'?'整次出勤':'每波')+item.effects.pierceCharges+'份，忽略'+item.effects.pierce+'护甲。');
    if(item.lifetime==='single-use'&&item.effects.pierceCharges)lines.push('首次基础攻击捕获的主目标、多目标或溅射中有任一存活有甲敌人才消耗；整次攻击所有目标共用一份。无甲攻击不消耗；C04追加不使用、不消耗穿甲。');
    if(item.id==='I10')lines.push('满血也会用掉该次治疗机会，战报会写明实际回复0。');
    if(item.id==='I11')lines.push('按武器获得顺序供给；同一次多目标和溅射共用一份。敌人无甲也会消耗；C04追加不使用、不消耗穿甲。');
    if(item.id==='I13')peers=weapons.map(w=>w.instanceId);
  }
  if(item.id==='I03')lines.push('惯性齿组配方：同一把短刃同时贴回收器与角铁，每第3次基础攻击追加5伤害。');
  if(item.id==='I09')lines.push('洁净急救配方：同一急救匣同时贴盐水与除锈药匣，回复量+6，触发条件不变。');
  if(item.id==='I10'||item.id==='I11')lines.push('三件医疗联动：盐水、除锈药匣都贴同一急救匣，急救回复量+6。');
  if(item.id==='I08'||item.id==='I13')lines.push('三件机械联动：回收器、角铁都贴同一把短刃，第3次基础攻击追加5伤害。');
  const combos=loadout.combos.filter(combo=>combo.participants.includes(id));
  for(const combo of combos){
    if(combo.id==='C02'&&item.id==='I12')continue;
    lines.push('组合生效：'+combo.name+'。'+combo.description);
    peers.push(...combo.participants.filter(target=>target!==id&&neighbors.includes(target)));
  }
  return {placed,status,active,lines,peers:Array.from(new Set(peers))};
}

export function placementChanges(before:InventoryState, after:InventoryState, content:GameContent):string[] {
  const old=evaluateLoadout(before,content), next=evaluateLoadout(after,content), lines:string[]=[];
  for(const weapon of next.weapons){
    const previous=old.weapons.find(w=>w.instanceId===weapon.instanceId), name=getItem(content,weapon.defId).shortName;
    if(!previous)lines.push(name+'加入：'+(weapon.damage+weapon.bonusDamage)+'伤害 / '+weaponTiming(weapon));
    else if(previous.bonusDamage!==weapon.bonusDamage||previous.hasteBps!==weapon.hasteBps)lines.push(name+' '+(previous.damage+previous.bonusDamage)+'→'+(weapon.damage+weapon.bonusDamage)+'伤害，'+weaponTiming(previous)+'→'+weaponTiming(weapon));
  }
  for(const weapon of old.weapons)if(!next.weapons.some(w=>w.instanceId===weapon.instanceId))lines.push(getItem(content,weapon.defId).shortName+'离开背包，不再攻击');
  if(old.initialShield!==next.initialShield)lines.push('开场护盾 '+old.initialShield+' → '+next.initialShield);
  if((old.circuits?.length||0)!==(next.circuits?.length||0))lines.push(next.circuits?.length?'错峰检修回路接通':'错峰检修回路断开');
  return lines.length?lines:['位置变化；当前伤害与冷却不变。'];
}

export interface JournalEntry { event:CombatEvent; text:string; tone:'normal'|'damage'|'heal'|'relay'; }
export function describeEvent(event:CombatEvent, run:RunState, content:GameContent):JournalEntry|null {
  const name=(id?:string):string=>{
    if(id==='player')return '装备员';
    const enemy=run.combat?.enemies.find(e=>e.instanceId===id);if(enemy)return enemy.name+'#'+(enemy.spawnIndex+1);
    const item=run.inventory.instances.find(i=>i.id===id);
    const runtime=run.combat?.consumables.find(s=>s.instanceId===id);
    const defId=item?.defId||runtime?.defId;return defId?getItem(content,defId).shortName:(id||'设备');
  };
  const runtime=run.combat?.consumables.find(s=>s.instanceId===event.source);
  const sourceDefId=run.inventory.instances.find(item=>item.id===event.source)?.defId||runtime?.defId;
  const sourceDef=sourceDefId?getItem(content,sourceDefId):undefined;
  const singleUse=!!runtime?.singleUse||sourceDef?.lifetime==='single-use';
  const pierce=runtime?.pierce||sourceDef?.effects.pierce||1;
  const emergencyShield=runtime?.emergencyShield||sourceDef?.effects.emergencyShield||0;
  let text='',tone:JournalEntry['tone']='normal';
  if(event.type==='damage'){
    tone='damage';
    text=event.target==='player'?name(event.source)+' 攻击'+event.raw+' → 减伤'+event.blocked+' / 护盾-'+event.absorbed+' / 生命-'+event.amount:name(event.source)+' → '+name(event.target)+' -'+event.amount+(event.detail==='splash'?'（溅射）':event.detail==='C04'?'（齿组追加）':'');
  }else if(event.type==='heal'){tone='heal';text=name(event.source)+' '+(event.detail==='periodic'?'定时':'低血量')+'回复 +'+event.amount+'，剩'+event.remaining+'次'+(event.amount===0?'（满血仍耗次）':'');}
  else if(event.type==='consume'&&event.detail==='single-use')text=name(event.source)+(sourceDef?.effects.pierceCharges||runtime?.pierceCharges?' 整次出勤穿甲供给已消耗；已用尽，本波结束移除':' 已用尽：整次出勤一次，本波结束移除');
  else if(event.type==='consume'&&(event.detail==='pierce'||runtime?.pierceCharges||sourceDef?.effects.pierceCharges))text=name(event.source)+' 强化 '+name(event.target)+'：整次攻击共用一份，忽略'+pierce+'护甲，剩'+event.remaining+'份'+(singleUse?'；整次出勤供给已消耗，已用尽，本波结束移除':'');
  else if(event.type==='consume')text=name(event.source)+' 已使用，剩'+(event.remaining??0)+'次'+(singleUse?'；整次出勤供给已消耗，已用尽，本波结束移除':'');
  else if(event.type==='relay'){tone='relay';text='错峰检修 → '+name(event.target)+' 攻击延后'+seconds((event.amount||0)/10)+'秒，剩'+event.remaining+'次';}
  else if(event.type==='shield'&&emergencyShield){tone='heal';text=name(event.source)+' 应急补盾 +'+(event.amount||0)+'（上限限幅），先补盾再结算来袭；剩'+(event.remaining??(runtime?runtime.charges-runtime.used:0))+'次'+(singleUse?'，已用尽，本波结束移除':'');}
  else if(event.type==='shield'&&(event.amount||0)>0){tone='heal';text='击杀回收：护盾 +'+event.amount;}
  else if(event.type==='enrage'){tone='damage';text=name(event.source||event.target)+' 炉芯过载：攻击间隔缩短';}
  else if(event.type==='combo'){tone='relay';text='惯性齿组：第3次基础攻击触发追加命中';}
  else if(event.type==='kill')text=name(event.target)+' 已停止运作';
  else if(event.type==='terminal')text=event.detail==='victory'?'本区清场完成':event.detail==='timeout'?'撤离时限已到，未清场，本波失败':'装备员生命耗尽，本波失败';
  else if(event.type==='attack'&&event.detail==='critical')text=name(event.source)+' 暴击触发';
  return text?{event:{...event},text,tone}:null;
}
/** Retain a bounded journal across empty frame batches; dedupe by run/wave/sequence. */
export class BattleJournal {
  entries:JournalEntry[]=[];
  private key='';private sequence=0;
  capture(run:RunState|null,content:GameContent):void {
    if(!run?.combat)return;
    const key=run.id+'/'+run.wave;
    if(key!==this.key){this.key=key;this.sequence=0;this.entries=[];}
    for(const event of run.combat.events){
      if(event.seq<=this.sequence)continue;
      this.sequence=event.seq;
      const entry=describeEvent(event,run,content);if(entry)this.entries.push(entry);
    }
    if(this.entries.length>160)this.entries=this.entries.slice(-160);
  }
  reset():void {this.entries=[];this.key='';this.sequence=0;}
}
