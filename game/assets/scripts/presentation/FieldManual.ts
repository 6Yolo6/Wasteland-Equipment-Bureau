import { Category, GameContent, ItemDef, Placement } from '../core/types';
import { getItem } from '../content/catalog';
import { seconds } from './RuleReadout';

export type ManualTab = 'items' | 'links' | 'rules';
export type ManualFilter = 'all' | 'weapon' | 'supply';
export interface ManualExample { defId:string; x:number; y:number; rotation:Placement['rotation']; }
export interface ManualEntry { id:string; title:string; subtitle:string; lines:string[]; itemId?:string; relatedIds?:string[]; example?:ManualExample[]; }
export const CATEGORY_NAMES:Record<Category,string>={weapon:'武器',armor:'防护',support:'支援',consumable:'补给',module:'模块',device:'装置'};
const ex=(defId:string,x:number,y:number,rotation:Placement['rotation']=0):ManualExample=>({defId,x,y,rotation});

/** Descriptions project the current configuration. Reading the manual never creates a run or spends resources. */
export function definitionLines(item:ItemDef,content:GameContent):string[] {
  const e=item.effects, lines:string[]=[item.description];
  if(item.weapon){
    const w=item.weapon;
    lines.push('基础攻击：每'+seconds(w.cooldown/10)+'秒，主目标'+w.damage+'伤害；最多命中'+w.targets+'个存活敌人。');
    if(w.splash)lines.push('溅射：另一个存活敌人受到'+w.splash+'基础伤害；只有一个敌人时没有溅射。');
    lines.push('自动选敌：按敌人出现顺序攻击存活目标；先等首次冷却，不是开战立刻开火。');
    lines.push('武器伤害加成先计入，再算暴击，最后扣敌人护甲；每次命中至少1伤害。');
  }
  if(e.shield)lines.push('每波开场护盾 +'+e.shield+'；护盾不带到下一波，按当时装配重新计算。');
  if(e.reduction)lines.push('每次来袭减伤 +'+e.reduction+'；全背包合计最多'+content.limits.reduction+'，减伤后仍至少承受1伤害。');
  if(e.maxHp)lines.push('最大生命 +'+e.maxHp+'；全背包上限'+content.limits.maxHp+'。装卸不回血，卸下时超出上限的生命被扣除。');
  if(e.adjacentHasteBps)lines.push('正交贴边武器平均冷却 -'+e.adjacentHasteBps/100+'%；斜角无效，同类电池取最高值，不重复叠加。');
  if(e.adjacentDamage)lines.push('每件对正交贴边武器伤害 +'+e.adjacentDamage+'；角铁对同一武器合计最多+3。');
  if(e.killShield)lines.push('每次击杀回收护盾 +'+e.killShield+'；同类叠加，每波实际回收总额最多'+content.limits.killShield+'，溢出不计入额度。');
  if(e.critBps)lines.push('全背包暴击率 +'+e.critBps/100+'%；总上限'+content.limits.critBps/100+'%。暴击150%，向下取整。');
  if(e.emergencyHeal)lines.push('急救触发：受生命伤害后仍存活且血量≤'+(e.healThresholdBps||0)/100+'%，回复'+e.emergencyHeal+'；不是低血量开战立即回血。护盾受击和致死不触发。');
  if(e.emergencyShield)lines.push('应急护盾：护盾为0且即将承受存活敌人攻击时，先补'+e.emergencyShield+'盾（总护盾上限'+content.limits.shield+'），再按减伤→护盾→生命结算；有盾、仅开战或敌人已被击杀时不触发。');
  if(e.emergencyShield)lines.push('同类按装备获得顺序逐个检查：一个补盾后，其他不重复触发；不是低血急救，不需要先受生命伤害。');
  if(e.periodicHeal)lines.push('定时治疗：每'+seconds((e.healEveryTicks||0)/10)+'秒回复'+e.periodicHeal+'，每波'+e.healCharges+'次。满血实际回复0，但仍消耗一次机会。');
  if(e.pierceCharges)lines.push(item.lifetime==='single-use'
    ? '穿甲供给：整次出勤'+e.pierceCharges+'份。首次基础攻击捕获的主目标、多目标或溅射目标中有任一存活有甲敌人才消耗；整次攻击所有目标共用一份，忽略'+e.pierce+'护甲。无甲攻击不消耗，未触发跨波保留。'
    : '穿甲供给：每波'+e.pierceCharges+'份，强化接下来的基础攻击，忽略'+e.pierce+'护甲；按武器获得顺序，多目标与溅射共用一份，无甲也消耗。');
  if(e.pierceCharges)lines.push('惯性齿组C04追加不是基础攻击，不使用穿甲效果，也不消耗穿甲供给。');
  if(item.category==='consumable'&&e.healCharges)lines.push((e.emergencyShield?'补盾供给：':'治疗供给：')+(item.lifetime==='single-use'?'整次出勤':'每波')+e.healCharges+'次。');
  if(item.category==='consumable')lines.push(item.lifetime==='single-use'?'一次性：整次出勤仅使用一次。用后本波结束从背包移除，不能撤销找回；未触发可以留到下一波。':'每波补给设备：每波重置次数，物品不消失；不能把本波剩余次数累积到下波。');
  if(item.id==='I15')lines.push('封装急救包不是废布急救匣，不参与洁净急救组合；小体积和单次急救量换取后续波次无法再用。');
  lines.push('必须放进背包才生效；备存不参加战斗。旋转只改变形状朝向，不改变基础效果。');
  const links=manualLinks(content).filter(link=>link.relatedIds?.includes(item.id));
  for(const link of links)lines.push('相关联动：'+link.title+'。'+link.subtitle);
  if(item.weapon)lines.push('所有来源合计：平均冷却缩短最多'+content.limits.hasteBps/100+'%，单武器伤害加成最多+'+content.limits.weaponBonus+'；多格接触同一配件只算一次。');
  return lines;
}

export function manualItems(content:GameContent,filter:ManualFilter='all'):ManualEntry[] {
  return content.items.filter(i=>filter==='all'||(filter==='weapon'?i.category==='weapon':i.category!=='weapon')).map(item=>({
    id:item.id,title:item.name,itemId:item.id,
    subtitle:CATEGORY_NAMES[item.category]+' · '+item.shape.length+'格 · '+(item.lifetime==='single-use'?'出勤一次':item.category==='consumable'?'每波补给':'常驻设备'),
    lines:definitionLines(item,content),
  }));
}
export function manualLinks(content:GameContent):ManualEntry[] {
  const battery=getItem(content,'I07'),iron=getItem(content,'I13');
  const entries:ManualEntry[]=[
    {id:'L01',title:'直接供电',subtitle:'电池贴武器：平均冷却 -'+(battery.effects.adjacentHasteBps||0)/100+'%',relatedIds:[battery.id,...content.items.filter(i=>i.weapon).map(i=>i.id)],example:[ex('I03',1,1),ex('I07',1,2)],lines:['中心：任意武器。电池与武器任意占用格上下左右共边即可。','不需要铜线。斜角、隔空不算；同类电池不叠加。','按0.1秒步长模拟但保留定点余量，缩短的是平均间隔，不保证每次等长。','可与错峰检修合计；总冷却缩短上限'+content.limits.hasteBps/100+'%。此直接效果不列入四种组合数量。']},
    {id:'L02',title:'配重加伤',subtitle:'角铁贴武器：每件伤害 +'+(iron.effects.adjacentDamage||0),relatedIds:[iron.id,...content.items.filter(i=>i.weapon).map(i=>i.id)],example:[ex('I03',1,2),ex('I13',3,2)],lines:['中心：任意武器。角铁与武器正交贴边；配件之间接触不能传递加成。','多个角铁可叠加，同一武器由角铁提供最多+3。多条接触边不会重复计算。','角铁可同时参与惯性齿组，基础加伤与第三击追加分别结算。','所有来源合计单武器伤害加成最多+'+content.limits.weaponBonus+'。']},
  ];
  const recipes:Record<string,{ids:string[];example:ManualExample[];lines:string[]}>={
    C01:{ids:['I05',...content.items.filter(i=>i.weapon).map(i=>i.id)],example:[ex('I03',1,1),ex('I05',1,2)],lines:['中心：任意武器。蜂窝护板正交贴该武器，武器伤害+2。','同一武器贴多块护板不重复加伤。护板本身的开场护盾与减伤独立生效。']},
    C02:{ids:['I12','I07',...content.items.filter(i=>i.weapon).map(i=>i.id)],example:[ex('I01',2,0),ex('I07',1,1),ex('I12',1,2),ex('I03',0,3)],lines:['中心：铜线。电池、两件不同武器都必须正交贴同一铜线，不要求武器互贴。','同一武器接触两格也只算一件；超过两件按获得顺序选前两件。','选中两把武器的平均冷却再缩短10%。每把各开火一次，延后最早将出手的存活敌人攻击；同一武器连发不能代替另一把。','次数每波重置，配件不消失。']},
    C03:{ids:['I09','I10','I11'],example:[ex('I09',1,2),ex('I10',0,1),ex('I11',3,2)],lines:['中心：废布急救匣。盐水与除锈药匣都必须正交贴同一急救匣；配件互贴不够。','只增加急救回复量+6，不改变触发血线与次数，不加强盐水或穿甲。','封装急救包不是急救匣，不能替代它拼成此组合。']},
    C04:{ids:['I03','I08','I13'],example:[ex('I03',1,2),ex('I08',1,1),ex('I13',3,2)],lines:['中心：振齿短刃。回收器与角铁都正交贴同一短刃。','每第3次基础攻击追加5伤害；扣目标护甲，至少1伤害。追加不是新一次基础攻击，不再消耗穿甲药、不递归触发。','计数每波从零开始，回收器与角铁的独立效果仍生效。']},
  };
  for(const combo of content.combos){const recipe=recipes[combo.id];if(!recipe)continue;entries.push({id:combo.id,title:combo.name,subtitle:combo.description,relatedIds:recipe.ids,example:recipe.example,lines:[combo.description,...recipe.lines,'全局最多启用'+combo.limit+'组；超额按中心装备获得顺序选择，不按你最后拖动的顺序。']});}
  return entries;
}
export function manualRules(content:GameContent):ManualEntry[] {
  const singleUseItems=content.items.filter(item=>item.lifetime==='single-use');
  return [
    {id:'R01',title:'出勤流程与胜负',subtitle:'整备 → 自动战斗 → 三选一补给 → 五波清场',lines:['每波先整理5×6背包，至少放一把武器才可出击；开战后不能移动、旋转或手动使用装备。','在'+seconds(content.limits.deadlineTick/10)+'秒内清场即胜；生命耗尽或未清场超时失败。倒计时不会逐秒增加敌人伤害。','首波按装配满血开局，其后保留生命；每波护盾重算，普通补给次数重置，一次性物品不补。','三选一方案内的两件物品全入备存，满包不丢物。','武器基础火力不是唯一收益：正交贴护板可加2伤害，角铁每件加'+(content.items.find(item=>item.id==='I13')?.effects.adjacentDamage||0)+'（每把最多3），电池缩短冷却；为共边留位置，再决定堆武器还是带配件。','当前为开发试玩：图鉴可看全部配置，是否可掉落看详情。已有本机存档；未接入永久解锁、金币消费或真实广告。']},
    {id:'R02',title:'伤害顺序与出手时序',subtitle:'无盾遇袭先应急补盾 → 减伤 → 护盾 → 生命 → 急救',lines:['敌人各自按固定间隔攻击装备员，不攻击背包装备。存活敌人即将出手且玩家无盾时，先检查应急补盾；再扣减伤（仍至少1），由护盾吸收，剩余扣生命。有盾时不使用应急补给。','受生命伤害且仍存活才检查低血急救；致死不能复活。多个急救按装备获得顺序逐个检查，不满足血线的保留次数。','同一0.1秒模拟步：先定时治疗，再武器按获得顺序开火，再存活敌人按出现顺序出手，最后判定胜负。','武器杀死已到攻击时刻的敌人，可阻止那一击；错峰检修在武器开火后干预敌人出手。','武器从左起命中存活敌人；暴击倍率150%，穿甲只减护甲，不是直接额外伤害。']},
    {id:'R03',title:'邻接、叠加与上限',subtitle:'上下左右共边；斜角、隔空不生效',lines:['多格装备只需任意占用格共边；同一对物品有多条边仍只算一邻接。配件之间不会隔空传导。','电池同类不叠加；角铁同一武器最多+3；护板同武器只+2且最多'+(content.combos.find(c=>c.id==='C01')?.limit||0)+'把。','冷却缩短合计上限'+content.limits.hasteBps/100+'%，暴击率上限'+content.limits.critBps/100+'%，单武器伤害加成上限+'+content.limits.weaponBonus+'。','全背包减伤上限'+content.limits.reduction+'、开场护盾上限'+content.limits.shield+'、最大生命上限'+content.limits.maxHp+'、每波实际回收护盾上限'+content.limits.killShield+'。','备存不生效；旋转预览、查看手册、装备详情和战报不修改布局或次数。']},
    {id:'R04',title:'补给设备与一次性物品',subtitle:'已收录'+content.items.length+'件 / '+singleUseItems.length+'种一次性；每波补次数 ≠ 出勤一次',lines:['废布急救匣、盐水滴瓶、除锈药匣属于每波补给设备：每波重置各自次数，设备留在背包。',...singleUseItems.map(item=>item.name+'：'+item.description),'一次性物品整次出勤只用一次；用后本波结束移除，未触发跨波保留。急救与泡沫记录使用次数，破甲记录穿甲供给；任一种用尽都不再补充。','两类都自动触发，不存在点击物品立刻治疗、补盾或破甲；只有放进背包才会使用。','一次性消耗会写入战报，战斗卡片显示剩余0与已用尽；消耗不可通过撤销、补给重放或换波恢复。']},
    ...content.enemies.map(enemy=>({id:enemy.id,title:enemy.name,subtitle:'生命'+enemy.hp+' · 护甲'+enemy.armor+' · 每'+seconds(enemy.cooldown/10)+'秒攻击'+enemy.damage,lines:['基础生命 '+enemy.hp+'，护甲 '+enemy.armor+'；普通攻击 '+enemy.damage+'，间隔 '+seconds(enemy.cooldown/10)+'秒。','所有攻击都指向装备员；每个敌人独立倒计时，首次也需等待完整间隔。',...(enemy.behavior==='boss'?['生命严格低于'+(enemy.enrageThresholdBps||0)/100+'%后过载，攻击间隔改为'+seconds((enemy.enragedCooldown||0)/10)+'秒；伤害不增加，已蓄积的攻击进度保留。']:['本类型没有隐藏的随机出手或随倒计时递增的伤害。']),'出现波次：'+content.waves.map((wave,i)=>wave.includes(enemy.id)?i+1:0).filter(Boolean).join('、')+'。']})),
  ];
}
export function manualEntries(content:GameContent,tab:ManualTab,filter:ManualFilter='all'):ManualEntry[] {
  return tab==='items'?manualItems(content,filter):tab==='links'?manualLinks(content):manualRules(content);
}
