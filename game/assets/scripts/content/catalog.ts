import { RESEARCH_BLUEPRINTS } from './research';
import { Cell, GameContent, ItemDef } from '../core/types';
const cells = (...coords: number[][]): Cell[] => coords.map(([x, y]) => ({ x, y }));
export const CONTENT: GameContent = {
  version: 'mvp-0.2.3',
  // Keep patch-version playtests on the same loot/combat seed streams; rules still have a new version.
  randomNamespace: 'mvp-0.2.0',
  items: [
    { id:'I01', name:'钉线发射器', shortName:'钉线', category:'weapon', shape:cells([0,0],[0,1]), color:'#eab15b', weight:14, unlocked:true, description:'每 1.2 秒造成 12 伤害。贴着护板放，火力更强。', weapon:{damage:12,cooldown:12,targets:1,splash:0}, effects:{} },
    { id:'I02', name:'折板霰器', shortName:'折板', category:'weapon', shape:cells([0,0],[0,1],[1,1]), color:'#dc8755', weight:11, unlocked:true, description:'每 2 秒造成 18 伤害，另一个目标受到 6 点溅射。', weapon:{damage:18,cooldown:20,targets:1,splash:6}, effects:{} },
    { id:'I03', name:'振齿短刃', shortName:'振齿', category:'weapon', shape:cells([0,0],[1,0]), color:'#ddb16c', weight:14, unlocked:true, description:'每 0.7 秒造成 7 伤害。与回收器、角铁组成惯性齿组。', weapon:{damage:7,cooldown:7,targets:1,splash:0}, effects:{} },
    { id:'I04', name:'余热喷嘴', shortName:'余热', category:'weapon', shape:cells([0,0],[1,0],[0,1]), color:'#ef805e', weight:10, unlocked:false, description:'每 1.6 秒对最多 3 个目标各造成 5 伤害。', weapon:{damage:5,cooldown:16,targets:3,splash:0}, effects:{} },
    { id:'I05', name:'蜂窝护板', shortName:'护板', category:'armor', shape:cells([0,0],[1,0],[0,1],[1,1]), color:'#81a58f', weight:12, unlocked:true, description:'每波护盾 +16，受到的每次伤害 -1；邻接武器伤害 +2。', effects:{shield:16,reduction:1} },
    { id:'I06', name:'隔热披片', shortName:'披片', category:'armor', shape:cells([0,0],[1,0],[1,1]), color:'#769e8a', weight:10, unlocked:true, description:'最大生命 +12。反复装卸不会恢复生命。', effects:{maxHp:12} },
    { id:'I07', name:'蜂针电池', shortName:'电池', category:'support', shape:cells([0,0]), color:'#79bcc2', weight:13, unlocked:true, description:'每波护盾 +2；正交贴边的武器平均冷却 -10%。斜角不通电，同类不叠加。', effects:{shield:2,adjacentHasteBps:1000} },
    { id:'I08', name:'弹簧回收器', shortName:'回收', category:'support', shape:cells([0,0],[1,0]), color:'#82bbb4', weight:10, unlocked:true, description:'每次击杀护盾 +4，同类合计每波最多回收 20 护盾。', effects:{killShield:4} },
    { id:'I09', name:'废布急救匣', shortName:'急救', category:'consumable', shape:cells([0,0],[1,0]), color:'#c0a4c9', weight:13, unlocked:true, description:'受伤后存活且生命不高于 40% 时回复 18，每件每波一次。', effects:{healThresholdBps:4000,emergencyHeal:18,healCharges:1} },
    { id:'I10', name:'盐水滴瓶', shortName:'盐水', category:'consumable', shape:cells([0,0],[0,1]), color:'#a59dc5', weight:8, unlocked:false, description:'每 8 秒回复 5，每波 4 次。满血也会消耗一次。', effects:{periodicHeal:5,healEveryTicks:80,healCharges:4} },
    { id:'I11', name:'除锈药匣', shortName:'除锈', category:'consumable', shape:cells([0,0]), color:'#b7a3bd', weight:9, unlocked:true, description:'每波强化 3 次基础攻击：忽略 1 护甲。多目标共用一次。', effects:{pierceCharges:3,pierce:1} },
    { id:'I12', name:'铜线接驳器', shortName:'铜线', category:'module', shape:cells([0,0],[1,0]), color:'#7fafc1', weight:8, unlocked:false, description:'每波护盾 +5；铜线同时贴电池与两把武器，组成错峰检修回路。', effects:{shield:5} },
    { id:'I13', name:'配重角铁', shortName:'角铁', category:'module', shape:cells([0,0],[0,1],[1,1]), color:'#91a9be', weight:10, unlocked:true, description:'邻接武器伤害 +1，每把武器由角铁提供的加成最多 +3。', effects:{adjacentDamage:1} },
    { id:'I14', name:'旧式侦测盘', shortName:'侦测', category:'device', shape:cells([0,0],[1,0],[2,0],[1,1]), color:'#b5bc7f', weight:6, unlocked:false, description:'暴击率 +5%，暴击造成 150% 伤害。', effects:{critBps:500} },
    { id:'I15', name:'封装急救包', shortName:'封救', category:'consumable', shape:cells([0,0]), color:'#d7acc0', weight:6, unlocked:false, lifetime:'single-use', description:'一次性：受生命伤害后仍存活且生命不高于40%，自动回复26。整次出勤仅用一次；用后本波结束移除，未触发可留到下一波。', effects:{healThresholdBps:4000,emergencyHeal:26,healCharges:1} },
    { id:'I16', name:'破甲封筒', shortName:'破甲', category:'consumable', shape:cells([0,0]), color:'#d6b783', weight:6, unlocked:true, lifetime:'single-use', description:'一次性：首次基础攻击预定的主目标、多目标或溅射中有存活有甲敌人时，整次攻击共用一份忽略3护甲。无甲攻击和齿组追加不消耗；用后本波结束移除，未触发跨波保留。', effects:{pierce:3,pierceCharges:1} },
    { id:'I17', name:'应急泡沫罐', shortName:'泡沫', category:'consumable', shape:cells([0,0],[0,1]), color:'#a5c8c1', weight:6, unlocked:true, lifetime:'single-use', description:'一次性：护盾为0且即将承受存活敌人攻击时，先补24护盾（不超过护盾上限），再按减伤、护盾、生命结算。有盾不触发；同类按获得顺序检查，用后本波结束移除，未触发跨波保留。', effects:{emergencyShield:24,healCharges:1} },
  ],
  enemies: [
    {id:'E01', name:'钩索拾荒机', hp:60, damage:5, cooldown:20, armor:0, color:'#ac9475', behavior:'normal'},
    {id:'E02', name:'冲铆搬运机', hp:104, damage:11, cooldown:32, armor:0, color:'#bb856a', behavior:'heavy'},
    {id:'E03', name:'厚壳巡检机', hp:122, damage:6, cooldown:27, armor:2, color:'#839994', behavior:'armored'},
    {id:'B01', name:'炉芯回收车', hp:440, damage:12, cooldown:27, armor:1, color:'#db7756', behavior:'boss', enrageThresholdBps:5000, enragedCooldown:20},
  ],
  waves: [['E01','E01'],['E01','E02'],['E01','E01','E03'],['E02','E03','E03'],['B01']],
  combos: [
    {id:'C01',name:'屏护射位',limit:3,description:'武器邻接蜂窝护板：该武器伤害 +2。最多 3 把。'},
    {id:'C02',name:'错峰检修',limit:1,description:'铜线同时贴电池与两把武器：两武器平均冷却 -10%；各开火一次后，最近一次敌方攻击延后 0.3 秒，每波最多 3 次。',relay:{delayTicks:3,maxPulses:3}},
    {id:'C03',name:'洁净急救',limit:1,description:'急救匣同时邻接盐水与除锈药匣：回复量 +6。'},
    {id:'C04',name:'惯性齿组',limit:1,description:'短刃同时邻接回收器与角铁：每第 3 次基础攻击追加 5 伤害。'},
  ],
  limits:{hasteBps:2000,critBps:3500,reduction:3,weaponBonus:6,shield:80,maxHp:200,killShield:20,deadlineTick:450},
  event:{chanceBps:3500,weaponWeightMultiplier:2},
};
export function getItem(content: GameContent, id: string): ItemDef {
  const item = content.items.find(i => i.id === id);
  if (!item) throw new Error('Unknown item: ' + id);
  return item;
}
export function validateContent(content: GameContent): string[] {
  const errors: string[] = [];
  const integer = (n: number, min = 0) => Number.isSafeInteger(n) && n >= min;
  const unique = (ids: string[], label: string) => { if (new Set(ids).size !== ids.length || ids.some(id => !id)) errors.push(label + ': duplicate/empty ID'); };
  if (!content.version) errors.push('Missing content version');
  if (content.randomNamespace !== undefined && (typeof content.randomNamespace !== 'string' || !content.randomNamespace.trim())) errors.push('Invalid random namespace');
  unique(content.items.map(i => i.id), 'items'); unique(content.enemies.map(i => i.id), 'enemies'); unique(content.combos.map(i => i.id), 'combos');
  for (const item of content.items) {
    const label = 'item/' + item.id;
    if (!integer(item.weight,1)) errors.push(label + ': invalid weight');
    if (!['weapon','armor','support','consumable','module','device'].includes(item.category)) errors.push(label + ': invalid category');
    const keys = item.shape.map(c => c.x + ',' + c.y);
    if (!keys.length || new Set(keys).size !== keys.length || item.shape.some(c => !integer(c.x) || !integer(c.y))) errors.push(label + ': invalid shape');
    else {
      const visited = new Set<string>([keys[0]]);
      let changed = true;
      while (changed) { changed = false; for (const c of item.shape) if (!visited.has(c.x+','+c.y) && [[1,0],[-1,0],[0,1],[0,-1]].some(([x,y]) => visited.has((c.x+x)+','+(c.y+y)))) { visited.add(c.x+','+c.y); changed=true; } }
      if (visited.size !== keys.length) errors.push(label + ': disconnected shape');
    }
    if ((item.category === 'weapon') !== !!item.weapon) errors.push(label + ': weapon/category mismatch');
    if (item.weapon && (!integer(item.weapon.damage,1)||!integer(item.weapon.cooldown,1)||!integer(item.weapon.targets,1)||!integer(item.weapon.splash))) errors.push(label + ': invalid weapon');
    for (const [key,value] of Object.entries(item.effects)) if (!integer(value) || value > 1000000) errors.push(label + ': invalid effect/' + key);
    if (item.lifetime !== undefined && item.lifetime !== 'single-use') errors.push(label + ': invalid lifetime');
    if (item.lifetime === 'single-use') {
      // A single-use supply must configure exactly one supported effect, with one charge.
      const effectKeys = Object.keys(item.effects), e = item.effects;
      const onlyEffects = (...keys: string[]) => effectKeys.length === keys.length && effectKeys.every(key => keys.includes(key));
      const heal = onlyEffects('emergencyHeal','healCharges','healThresholdBps') && integer(e.emergencyHeal || 0,1) && e.healCharges === 1 && integer(e.healThresholdBps || 0,1) && (e.healThresholdBps || 0) <= 10000;
      const pierce = onlyEffects('pierce','pierceCharges') && integer(e.pierce || 0,1) && e.pierceCharges === 1;
      const shield = onlyEffects('emergencyShield','healCharges') && integer(e.emergencyShield || 0,1) && e.healCharges === 1;
      if (item.category !== 'consumable' || ![heal,pierce,shield].some(Boolean)) errors.push(label + ': unsupported single-use effect');
    }
    if (item.effects.periodicHeal && (!integer(item.effects.healEveryTicks || 0,1)||!integer(item.effects.healCharges || 0,1))) errors.push(label + ': invalid periodic heal');
  }
  for (const e of content.enemies) {
    if (![e.hp,e.damage,e.cooldown].every(n=>integer(n,1)) || !integer(e.armor)) errors.push('enemy/' + e.id + ': invalid stats');
    if (!['normal','heavy','armored','boss'].includes(e.behavior)) errors.push('enemy/' + e.id + ': invalid behavior');
    if (e.behavior==='boss' && (!integer(e.enragedCooldown || 0,1)||!integer(e.enrageThresholdBps || 0,1)||(e.enrageThresholdBps || 0)>10000)) errors.push('enemy/' + e.id + ': invalid boss phase');
  }
  if (content.waves.length !== 5) errors.push('Expected exactly five waves');
  for (const [index,wave] of content.waves.entries()) if (!wave.length || wave.some(id=>!content.enemies.some(e=>e.id===id))) errors.push('wave/'+index+': invalid reference');
  for (const [key,value] of Object.entries(content.limits)) if (!integer(value,1)) errors.push('limit/'+key+': invalid');
  if (content.limits.hasteBps > 9000 || content.limits.critBps > 10000) errors.push('Invalid basis-point cap');
  if (!integer(content.event.chanceBps)||content.event.chanceBps>10000||!integer(content.event.weaponWeightMultiplier,1)) errors.push('Invalid event');
  if (content.combos.some(c=>!integer(c.limit,1))) errors.push('Invalid combo limit');
  for (const combo of content.combos) if (combo.relay && (combo.id !== 'C02' || !integer(combo.relay.delayTicks,1) || !integer(combo.relay.maxPulses,1))) errors.push('Invalid relay configuration');
  return errors;
}

/** Phase-2 development pool, deliberately not a permanent unlock/profile implementation. */
export const DEVELOPMENT_CONTENT: GameContent = {...CONTENT, version: CONTENT.version + "-dev-all", randomNamespace: (CONTENT.randomNamespace || CONTENT.version) + '-dev-all', items: CONTENT.items.map(item => ({...item, unlocked: true}))};

/** Initial weapon choices follow the active content pool, never a fixed ID whitelist. */
export function availableStarters(content:GameContent):ItemDef[] {
  return content.items.filter(item=>item.category==='weapon'&&item.unlocked&&!!item.weapon).slice().sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
}

/** Layout tuning for NEW runs. Legacy definitions above remain immutable for saved runs. */
const tunedDamage:Record<string,number>={I01:9,I02:14,I03:5,I04:8};
export const BALANCED_CONTENT:GameContent={
  ...CONTENT, version:'mvp-0.3.0',
  items:CONTENT.items.map(item=>{
    if(item.weapon){
      const weapon={...item.weapon,damage:tunedDamage[item.id]};
      const description='每 '+(weapon.cooldown/10)+' 秒对最多 '+weapon.targets+' 个目标各造成 '+weapon.damage+' 伤害。'+(weapon.splash?'另一个目标受到 '+weapon.splash+' 点溅射。':'')+'正交贴护板、角铁或电池可提高火力。';
      return {...item,weapon,description};
    }
    if(item.id==='I13')return {...item,effects:{...item.effects,adjacentDamage:2},description:'邻接武器伤害 +2，每把武器由角铁提供的加成最多 +3。'};
    return item;
  }),
};
export const BALANCED_DEVELOPMENT_CONTENT:GameContent={...BALANCED_CONTENT,version:BALANCED_CONTENT.version+'-dev-all',randomNamespace:DEVELOPMENT_CONTENT.randomNamespace,items:BALANCED_CONTENT.items.map(item=>({...item,unlocked:true}))};
/** Opt-in growth rules. A run snapshots its owned research to keep its loot pool fixed. */
export const LEGACY_RESEARCH_CONTENT:GameContent={...BALANCED_CONTENT,version:'mvp-0.4.0-research'};
export const LEGACY_GROWTH_DEVELOPMENT_CONTENT:GameContent={...BALANCED_DEVELOPMENT_CONTENT,version:'mvp-0.4.0-dev-all'};
/** Only the last two waves gain pressure. Keep all old definitions and seed streams intact. */
const PRESSURE_CONTENT:GameContent={
  ...BALANCED_CONTENT,
  enemies:BALANCED_CONTENT.enemies.map(enemy=>enemy.id==='B01'?{...enemy,hp:480}:enemy).concat([
    {...BALANCED_CONTENT.enemies.find(enemy=>enemy.id==='E02')!,id:'E04',name:'强化冲铆搬运机',hp:112,damage:12},
    {...BALANCED_CONTENT.enemies.find(enemy=>enemy.id==='E03')!,id:'E05',name:'强化厚壳巡检机',hp:132,damage:7},
  ]),
  waves:BALANCED_CONTENT.waves.map((wave,index)=>index===3?['E04','E05','E05']:wave.slice()),
};
export const RESEARCH_CONTENT:GameContent={...PRESSURE_CONTENT,version:'mvp-0.4.1-research'};
export const GROWTH_DEVELOPMENT_CONTENT:GameContent={...PRESSURE_CONTENT,version:'mvp-0.4.1-dev-all',randomNamespace:DEVELOPMENT_CONTENT.randomNamespace,items:PRESSURE_CONTENT.items.map(item=>({...item,unlocked:true}))};
export function isResearchContent(content:GameContent):boolean {
  return content.version===RESEARCH_CONTENT.version||content.version===LEGACY_RESEARCH_CONTENT.version;
}
export function researchContentFor(content:GameContent):GameContent {
  return content.version===LEGACY_GROWTH_DEVELOPMENT_CONTENT.version?LEGACY_RESEARCH_CONTENT:RESEARCH_CONTENT;
}
export function withResearch(content:GameContent,itemIds:readonly string[]):GameContent {
  if(!isResearchContent(content)||new Set(itemIds).size!==itemIds.length||itemIds.some(id=>!RESEARCH_BLUEPRINTS.some(entry=>entry.itemId===id)))throw new Error('Invalid run research snapshot');
  return {...content,items:content.items.map(item=>({...item,unlocked:item.unlocked||itemIds.includes(item.id)}))};
}
/** Only explicit, same-pool historical versions are accepted; unknown versions stay blocked. */
export function contentForVersion(content:GameContent,version:string):GameContent|undefined {
  if(version===content.version)return content;
  if(content.version===GROWTH_DEVELOPMENT_CONTENT.version||content.version===LEGACY_GROWTH_DEVELOPMENT_CONTENT.version){
    if(content.version===GROWTH_DEVELOPMENT_CONTENT.version&&version===LEGACY_GROWTH_DEVELOPMENT_CONTENT.version)return LEGACY_GROWTH_DEVELOPMENT_CONTENT;
    if(version===LEGACY_RESEARCH_CONTENT.version)return LEGACY_RESEARCH_CONTENT;
    if(content.version===GROWTH_DEVELOPMENT_CONTENT.version&&version===RESEARCH_CONTENT.version)return RESEARCH_CONTENT;
    if(version===BALANCED_DEVELOPMENT_CONTENT.version)return BALANCED_DEVELOPMENT_CONTENT;
    if(version===DEVELOPMENT_CONTENT.version)return DEVELOPMENT_CONTENT;
  }
  if(content.version===BALANCED_CONTENT.version&&version===CONTENT.version)return CONTENT;
  if(content.version===BALANCED_DEVELOPMENT_CONTENT.version&&version===DEVELOPMENT_CONTENT.version)return DEVELOPMENT_CONTENT;
  return undefined;
}
export function compatibleContentVersions(content:GameContent):string[] {
  if(content.version===GROWTH_DEVELOPMENT_CONTENT.version)return [RESEARCH_CONTENT.version,LEGACY_GROWTH_DEVELOPMENT_CONTENT.version,LEGACY_RESEARCH_CONTENT.version,BALANCED_DEVELOPMENT_CONTENT.version,DEVELOPMENT_CONTENT.version];
  if(content.version===LEGACY_GROWTH_DEVELOPMENT_CONTENT.version)return [LEGACY_RESEARCH_CONTENT.version,BALANCED_DEVELOPMENT_CONTENT.version,DEVELOPMENT_CONTENT.version];
  if(content.version===BALANCED_CONTENT.version)return [CONTENT.version];
  if(content.version===BALANCED_DEVELOPMENT_CONTENT.version)return [DEVELOPMENT_CONTENT.version];
  return [];
}
