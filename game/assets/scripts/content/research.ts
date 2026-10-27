/** Immutable blueprint prices: permanent choices, never permanent combat stat bonuses. */
export interface ResearchBlueprint {id:string;itemId:string;route:string;name:string;cost:number;description:string;}
export interface ResearchProfile {mode:'sandbox'|'research';purchases:string[];}
export const RESEARCH_BLUEPRINTS:readonly ResearchBlueprint[]=[
  {id:'relay',itemId:'I12',route:'检修控场',name:'铜线接驳器',cost:8,description:'开放错峰检修：铜线贴电池与两把武器，协同延后敌人出手。'},
  {id:'heat',itemId:'I04',route:'余热压制',name:'余热喷嘴',cost:16,description:'开放群体火力；同时成为新工单可选起手武器。'},
  {id:'scan',itemId:'I14',route:'余热压制',name:'旧式侦测盘',cost:24,description:'暴击设备进入掉落池；占格换火力，不直接增加永久暴击。'},
  {id:'saline',itemId:'I10',route:'急救续航',name:'盐水滴瓶',cost:12,description:'开放周期恢复，并可与急救匣、除锈药匣组成洁净急救。'},
  {id:'medkit',itemId:'I15',route:'急救续航',name:'封装急救包',cost:12,description:'开放紧凑的一次性急救；需在局内获得并放入背包才生效。'},
];
export function researchSpent(profile:ResearchProfile|undefined):number {
  if(profile===undefined)return 0;
  if(!profile||typeof profile!=='object'||!['sandbox','research'].includes(profile.mode)||!Array.isArray(profile.purchases)||new Set(profile.purchases).size!==profile.purchases.length)throw new Error('Invalid research profile');
  let total=0;
  for(const id of profile.purchases){const blueprint=RESEARCH_BLUEPRINTS.find(entry=>entry.id===id);if(!blueprint)throw new Error('Unknown research blueprint');total+=blueprint.cost;}
  return total;
}
export function researchItemIds(profile:ResearchProfile|undefined):string[] {
  researchSpent(profile);
  return (profile?.purchases||[]).map(id=>RESEARCH_BLUEPRINTS.find(entry=>entry.id===id)!.itemId).sort();
}
