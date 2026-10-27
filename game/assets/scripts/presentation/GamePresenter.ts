import { RESEARCH_BLUEPRINTS } from '../content/research';
import { GameContent, InventoryState, ItemDef, Placement, Rotation } from '../core/types';
import { availableStarters, getItem } from '../content/catalog';
import { normalizeShape, occupiedCells, transactInventory } from '../core/inventory';
import { attackSeconds, effectiveCooldown, evaluateLoadout } from '../core/loadout';
import { BattleJournal, inspectItem, placementChanges, seconds, singleUseSpent, supplyRemaining, weaponTiming } from './RuleReadout';
import { CATEGORY_NAMES, ManualTab, ManualFilter, manualEntries } from './FieldManual';
import { GameSession, FixedStepDriver } from '../application/session';
import { RunAction } from '../core/run';
import { SessionStore } from '../application/session-store';

export interface Painter {
  begin():void; end():void;
  rect(x:number,y:number,w:number,h:number,fill:string,stroke?:string,radius?:number):void;
  line(x:number,y:number,x2:number,y2:number,color:string,width?:number):void;
  circle(x:number,y:number,r:number,fill:string,stroke?:string):void;
  polygon(points:number[][],fill:string,stroke?:string):void;
  text(value:string,x:number,y:number,size:number,color:string,align?:'left'|'center'|'right',bold?:boolean,maxWidth?:number):void;
}
export interface HitRegion { id:string; x:number; y:number; w:number; h:number; label:string; enabled:boolean; onClick:()=>void; itemId?:string; }
interface PointerState { x:number; y:number; startX:number; startY:number; hit:HitRegion|null; itemId:string|null; dragging:boolean; offsetX:number; offsetY:number; }
const C={bg:'#0b1217',panel:'#131e24',panel2:'#19282e',line:'#2b3e43',muted:'#849a9e',text:'#e3e8da',orange:'#efb35f',green:'#96c4a4',red:'#ed8a74',blue:'#83b8c4'};
const BAG={x:48,y:416,pitch:72,cell:68,cols:5,rows:6};
const ROSTER={x:32,y:928,w:156,h:76,gap:10};
const phaseName={preparation:'整备中',combat:'交战中',loot:'回收中',defeat:'出勤中止',settlement:'工单结算'};
const categoryName=CATEGORY_NAMES;
function inside(x:number,y:number,r:{x:number;y:number;w:number;h:number}):boolean{return x>=r.x&&y>=r.y&&x<r.x+r.w&&y<r.y+r.h;}
function tint(hex:string,factor:number):string {
  return '#'+[1,3,5].map(i=>Math.round(parseInt(hex.slice(i,i+2),16)*factor).toString(16).padStart(2,'0')).join('');
}
export class GamePresenter {
  readonly session:GameSession;
  readonly driver:FixedStepDriver;
  hits:HitRegion[]=[];
  screen:'menu'|'run'='menu';
  seed=20261015;
  starter='I01';
  starterPage=0;
  selectedId:string|null=null;
  rotation:Rotation=0;
  stashPage=0;
  toast='拖入背包，或点选装备后点击格子。';
  toastSeconds=0;
  confirmAbandon=false;
  guidePage:number|null=null;
  tutorialSeen=false;
  manualOpen=false;
  manualTab:ManualTab='items';
  manualFilter:ManualFilter='all';
  manualPage=0;
  manualEntryId:string|null=null;
  manualTextPage=0;
  detailId:string|null=null;
  detailPage=0;
  journalOpen=false;
  journalPage=0;
  equipmentPage=0;
  lootCollapsed=false;
  researchOpen=false;
  researchConfirm:string|null=null;
  readonly journal=new BattleJournal();
  private pointer:PointerState|null=null;
  private elapsed=0;
  private lastPhase='';
  persistenceError:string|null=null;
  persistenceStatus='仅本次会话；未接本地存档。';
  get content():GameContent {return this.screen==='run'?this.session.content:this.session.newRunContent;}
  constructor(private readonly defaultContent:GameContent,private readonly store?:SessionStore){
    let initialState;
    const content=defaultContent;
    if(store){try{initialState=store.load()||undefined;this.tutorialSeen=store.tutorialSeen;this.seed=store.seed;this.starter=store.starter;this.persistenceStatus=store.message;}catch(error){this.persistenceError=String((error as Error).message||error);}}
    this.session=new GameSession(content,{initialState,namespace:store?()=>store.installId:undefined,commit:store?(next,checkpoint)=>{if(this.persistenceError)throw new Error(this.persistenceError);store.tutorialSeen=this.tutorialSeen;store.seed=this.seed;store.starter=this.starter;store.save(next,checkpoint);this.persistenceStatus=store.message;}:undefined});
    this.driver=new FixedStepDriver(ticks=>this.session.advance(ticks));
    if(initialState?.run&&!(initialState.run.phase==='settlement'&&initialState.run.settlement?.claimed)){
      this.screen='run';this.seed=initialState.run.seed;this.journal.capture(initialState.run,this.content);this.toast=store!.message;this.toastSeconds=6;
      if(initialState.run.phase==='combat')this.driver.pause('resume-confirmation');
    }
  }
  private persistenceFailed(error:unknown):void {this.persistenceError=String((error as Error).message||error);this.pointer=null;this.driver.pause('storage');}
  checkpoint():boolean {
    if(!this.store)return true;
    if(this.persistenceError)return false;
    try{this.store.tutorialSeen=this.tutorialSeen;this.store.seed=this.seed;this.store.starter=this.starter;this.store.save(this.session.state);this.persistenceStatus=this.store.message;return true;}
    catch(error){this.persistenceFailed(error);return false;}
  }
  private retryStorage():void {
    if(!this.store)return;
    try{
      const state=this.store.load();if(state)this.session.state=state;
      else this.session.state={run:null,wallet:0,nextRun:1,nextCommand:1};
      this.tutorialSeen=this.store.tutorialSeen;this.seed=this.store.seed;this.starter=this.store.starter;
      this.persistenceError=null;this.persistenceStatus=this.store.message;this.screen=this.session.state.run&&!(this.session.state.run.settlement?.claimed)?'run':'menu';
      this.selectedId=null;this.guidePage=null;this.manualOpen=false;this.journalOpen=false;this.detailId=null;this.confirmAbandon=false;this.lootCollapsed=false;this.researchOpen=false;this.researchConfirm=null;
      this.driver.reasons.clear();this.driver.reset();this.journal.reset();this.journal.capture(this.session.state.run,this.content);
      if(this.session.state.run?.phase==='combat')this.driver.pause('resume-confirmation');
    }catch(error){this.persistenceFailed(error);}
  }
  private notify(text:string):void{this.toast=text;this.toastSeconds=4;}
  private act(action:RunAction):boolean {
    if(this.persistenceError)return false;
    let result;try{result=this.session.dispatch(action);}catch(error){this.persistenceFailed(error);return false;}
    if(!result.ok){this.notify(result.reason||'操作没有生效');return false;}
    this.driver.reset();return true;
  }
  start():void {
    if(this.persistenceError)return;
    try{this.session.start(this.seed,this.starter);}catch(error){this.persistenceFailed(error);return;}this.screen='run';this.selectedId=null;this.stashPage=0;this.rotation=0;this.lootCollapsed=false;
    this.driver.reasons.clear();this.driver.reset();this.journal.reset();this.equipmentPage=0;this.notify('邻接是上下左右共边；电池可直接给武器供电。');
    if(!this.tutorialSeen)this.openGuide();
  }
  update(dt:number):void {
    if(!Number.isFinite(dt)||dt<0)return;
    this.elapsed+=Math.min(dt,0.1);this.toastSeconds=Math.max(0,this.toastSeconds-dt);
    if(this.persistenceError){this.driver.reset();return;}
    if(this.screen==='run'&&this.session.state.run?.phase==='combat'){try{this.driver.update(dt);}catch(error){this.persistenceFailed(error);return;}}else this.driver.reset();
    this.journal.capture(this.session.state.run,this.content);
    const phase=this.session.state.run?.phase||'';
    if(phase!==this.lastPhase){this.pointer=null;this.selectedId=null;this.confirmAbandon=false;this.lootCollapsed=false;this.lastPhase=phase;}
  }
  background(hidden:boolean):void {
    if(hidden){this.pointer=null;this.driver.pause('background');this.checkpoint();}
    else {this.driver.resume('background');if(this.session.state.run?.phase==='combat')this.driver.pause('resume-confirmation');}
  }
  cancelPointer():void {this.pointer=null;}
  private select(id:string):void {
    const run=this.session.state.run!;this.selectedId=id;
    this.rotation=run.inventory.placements.find(p=>p.instanceId===id)?.rotation||0;
    this.notify(getItem(this.content,run.inventory.instances.find(i=>i.id===id)!.defId).description);
  }
  private bagTarget(x:number,y:number,offsetX=0,offsetY=0):{x:number;y:number}|null {
    if(!inside(x,y,{x:BAG.x,y:BAG.y,w:BAG.pitch*BAG.cols,h:BAG.pitch*BAG.rows}))return null;
    return {x:Math.floor((x-BAG.x)/BAG.pitch)-offsetX,y:Math.floor((y-BAG.y)/BAG.pitch)-offsetY};
  }
  private place(id:string,x:number,y:number):boolean {
    const run=this.session.state.run!;
    const ok=this.act({type:'inventory',command:{type:'place',instanceId:id,x,y,rotation:this.rotation,expectedRevision:run.inventory.revision}});
    if(ok)this.notify(placementChanges(run.inventory,this.session.state.run!.inventory,this.content).slice(0,2).join('；'));
    return ok;
  }
  pointerDown(x:number,y:number):void {
    const hit=[...this.hits].reverse().find(h=>h.enabled&&inside(x,y,h))||null;
    const itemId=hit?.itemId||null;
    let offsetX=0,offsetY=0;
    if(itemId){
      const p=this.session.state.run?.inventory.placements.find(p=>p.instanceId===itemId);
      if(p){offsetX=Math.max(0,Math.floor((x-BAG.x)/BAG.pitch)-p.x);offsetY=Math.max(0,Math.floor((y-BAG.y)/BAG.pitch)-p.y);}
      if(this.selectedId!==itemId)this.select(itemId);
    }
    this.pointer={x,y,startX:x,startY:y,hit,itemId,dragging:false,offsetX,offsetY};
  }
  pointerMove(x:number,y:number):void {
    if(!this.pointer)return;
    this.pointer.x=x;this.pointer.y=y;
    if(this.session.state.run?.phase==='preparation'&&this.pointer.itemId&&Math.hypot(x-this.pointer.startX,y-this.pointer.startY)>9)this.pointer.dragging=true;
  }
  pointerUp(x:number,y:number):void {
    const pointer=this.pointer;this.pointer=null;if(!pointer)return;
    if(pointer.dragging&&pointer.itemId){
      const target=this.bagTarget(x,y,pointer.offsetX,pointer.offsetY);
      if(target)this.place(pointer.itemId,target.x,target.y);
      else if(inside(x,y,{x:28,y:898,w:664,h:202})){
        const run=this.session.state.run!;
        if(run.inventory.placements.some(p=>p.instanceId===pointer.itemId)&&this.act({type:'inventory',command:{type:'stash',instanceId:pointer.itemId,expectedRevision:run.inventory.revision}}))this.notify('已收回备存区，装备不会丢失。');
      } else this.notify('已取消移动，装备保留在原位置。');
      return;
    }
    if(pointer.hit&&pointer.hit.enabled&&inside(x,y,pointer.hit)){pointer.hit.onClick();return;}
    if(this.confirmAbandon||this.driver.reasons.size)return;
    if(this.screen==='run'&&this.session.state.run?.phase==='preparation'&&this.selectedId){const target=this.bagTarget(x,y);if(target)this.place(this.selectedId,target.x,target.y);}
  }
  key(key:string):void {
    if(this.researchOpen){if(key==='Escape'){if(this.researchConfirm)this.researchConfirm=null;else this.researchOpen=false;}return;}
    if(this.manualOpen||this.guidePage!==null||this.detailId!==null||this.journalOpen){if(key==='Escape')this.closeOverlay();return;}
    if(key==='Escape'){this.pointer=null;this.selectedId=null;if(this.confirmAbandon){this.confirmAbandon=false;this.driver.resume('confirm-abandon');}else if(this.screen==='run'&&this.session.state.run?.phase==='loot'){this.toggleLoot();}return;}
    if(this.confirmAbandon||this.driver.reasons.size)return;
    if(this.screen==='run'&&this.session.state.run?.phase==='preparation'){
      if(key.toLowerCase()==='r'&&this.selectedId)this.rotate();
      if((key.toLowerCase()==='z')&&this.session.state.run.inventory.history.length)this.undo();
    }
  }
  private rotate():void{this.rotation=((this.rotation+90)%360) as Rotation;this.notify('旋转预览 '+this.rotation+'° · 点击目标格确认，取消不改原装备。');}
  private undo():void {
    const inv=this.session.state.run!.inventory;
    if(this.act({type:'inventory',command:{type:'undo',expectedRevision:inv.revision}})){this.selectedId=null;this.notify('已撤销上一步，物品与备存顺序一并恢复。');}
  }
  private button(p:Painter,id:string,label:string,x:number,y:number,w:number,h:number,onClick:()=>void,style:'primary'|'secondary'|'danger'='secondary',enabled=true):void {
    const fill=style==='primary'?C.orange:style==='danger'?'#422b28':C.panel2;
    p.rect(x,y,w,h,enabled?fill:C.panel,enabled?(style==='primary'?C.orange:C.line):'#223136',10);
    p.text(label,x+w/2,y+h/2,20,enabled?(style==='primary'?C.bg:style==='danger'?C.red:C.text):'#52656a','center',style==='primary',w-16);
    this.hits.push({id,x,y,w,h,label,enabled,onClick});
  }
  private wrapped(p:Painter,text:string,x:number,y:number,width:number,size=18,color=C.muted,maxLines=4):void {
    let line='';let units=0;let row=0;
    for(const char of text){const u=char.charCodeAt(0)>255?1:0.57;if(units+u>width/size){p.text(line,x,y+row*(size+10),size,color);row++;line='';units=0;if(row>=maxLines)return;}line+=char;units+=u;}
    if(line)p.text(line,x,y+row*(size+10),size,color);
  }
  draw(p:Painter):void {
    this.hits=[];p.begin();p.rect(0,0,720,1280,C.bg);
    for(let x=0;x<720;x+=48)p.line(x,0,x,1280,'#101b20');
    for(let y=0;y<1280;y+=48)p.line(0,y,720,y,'#101b20');
    this.header(p);
    if(this.persistenceError)this.storageDialog(p);
    else if(this.researchOpen)this.researchDialog(p);
    else if(this.manualOpen)this.fieldManual(p);
    else if(this.guidePage!==null)this.guide(p);
    else if(this.detailId!==null)this.itemDetails(p);
    else if(this.journalOpen)this.journalDialog(p);
    else if(this.confirmAbandon)this.abandonDialog(p);
    else if(this.screen==='run'&&this.session.state.run?.phase==='combat'&&this.driver.reasons.size)this.pauseDialog(p);
    else if(this.screen==='menu')this.menu(p);else this.run(p);
    p.end();
  }
  private header(p:Painter):void {
    p.rect(32,35,45,45,C.orange,undefined,5);
    p.line(43,46,66,46,C.bg,4);p.line(43,55,61,55,C.bg,4);p.line(43,64,66,64,C.bg,4);
    p.text('废土装备局',94,52,31,C.text,'left',true);
    p.text('WASTELAND EQUIPMENT BUREAU',95,82,10,C.muted);
    p.rect(533,37,155,29,'#26372f','#405846',5);p.text('开发验证 · 非原生包',610,52,13,C.green,'center');
    this.button(p,'open-manual','资料手册',362,67,161,36,()=>this.openManual());
    this.button(p,'open-guide','规则 / 教程  ?',535,67,153,36,()=>this.openGuide());
    p.line(32,109,688,109,C.line);
  }
  private menu(p:Painter):void {
    p.text('SHIFT 014   /   夜班出勤',42,151,16,C.orange);
    p.text('把零件摆好，',42,222,49,C.text,'left',true);
    p.text('把废土守住。',42,287,49,C.text,'left',true);
    if(this.session.supportsResearch){
      const profile=this.session.state.research,owned=profile?.purchases.length||0;
      const affordable=RESEARCH_BLUEPRINTS.filter(bp=>!profile?.purchases.includes(bp.id)&&bp.cost<=this.session.state.wallet).length;
      this.button(p,'open-research','装备解锁  ·  '+owned+'/'+RESEARCH_BLUEPRINTS.length+'  ·  '+this.session.state.wallet+' 金币'+(affordable?'  · 可解锁':'  →'),32,313,656,64,()=>{this.pointer=null;this.researchOpen=true;this.researchConfirm=null;},'primary');
    }
    else p.text('给旧设备接线，用攻击节奏干预敌人的检修窗口。',44,345,19,C.muted);
    p.rect(32,387,656,312,C.panel,C.line,15);
    p.rect(55,410,286,266,'#0e191d',C.line,9);
    for(let y=0;y<4;y++)for(let x=0;x<5;x++)p.rect(70+x*51,432+y*54,45,47,'#17272a','#30423f',4);
    this.miniEquipment(p,getItem(this.content,'I01'),92,454,46,0);
    this.miniEquipment(p,getItem(this.content,'I05'),168,504,46,0);
    this.miniEquipment(p,getItem(this.content,'I07'),271,445,38,0);
    this.miniEquipment(p,getItem(this.content,'I09'),91,620,34,0);
    p.line(333,539,382,539,C.orange,3);p.polygon([[376,531],[388,539],[376,547]],C.orange);
    this.robot(p,517,526,1.1,'#ad8565',true);
    p.text('装配 → 自动战斗 → 回收',500,641,16,C.muted,'center');
    if(this.session.supportsResearch)p.text('金币解锁新装备 · 研究路线下局入池，不直接赠装',360,683,15,C.orange,'center');
    p.text(this.session.state.research?.mode==='research'?'01  研究路线 · 选择起手武器':'01  自由试玩 · 选择起手武器',33,739,23,C.text,'left',true);
    const starters=availableStarters(this.content),compact=starters.length>3;
    const perPage=compact?4:3,pages=Math.max(1,Math.ceil(starters.length/perPage));
    this.starterPage=Math.max(0,Math.min(this.starterPage,pages-1));
    starters.slice(this.starterPage*perPage,(this.starterPage+1)*perPage).forEach((item,index)=>{
      const id=item.id,chosen=this.starter===id;
      const x=compact?32+(index%2)*334:32+index*222,y=compact?772+Math.floor(index/2)*102:772;
      const w=compact?322:212,h=compact?94:201;
      p.rect(x,y,w,h,chosen?'#2d2b21':C.panel,chosen?C.orange:C.line,12);
      this.miniEquipment(p,item,x+18,y+15,compact?17:28,0);
      p.text(chosen?'已选择':'选择',x+w-14,y+20,13,chosen?C.orange:C.muted,'right');
      const nameX=x+(compact?78:18),nameY=y+(compact?39:111);
      p.text(item.name,nameX,nameY,compact?22:21,C.text,'left',true,compact?228:180);
      const weapon=item.weapon!;
      const description=id==='I01'?'稳定单点 · 容易搭配':id==='I02'?'溅射压制 · 大块火力':id==='I03'?'高频近战 · 紧凑灵活':weapon.targets>1?'多目标扫射 · 群体压制':'单点输出 · 自由装配';
      p.text(description,nameX,y+(compact?72:151),compact?16:14,C.muted,'left',false,compact?228:190);
      this.hits.push({id:'starter-'+id,x,y,w,h,label:item.name,enabled:true,onClick:()=>{this.starter=id;this.checkpoint();}});
    });
    if(pages>1){
      this.button(p,'starter-prev','上一组',32,978,160,30,()=>{this.starterPage--;},'secondary',this.starterPage>0);
      p.text((this.starterPage+1)+' / '+pages,360,994,14,C.muted,'center');
      this.button(p,'starter-next','下一组',528,978,160,30,()=>{this.starterPage++;},'secondary',this.starterPage<pages-1);
    }
    p.text('随附：蜂窝护板 / 蜂针电池 / 废布急救匣',34,1013,17,C.muted);
    p.text('出勤种子  '+this.seed,34,1066,16,C.orange);
    this.button(p,'new-seed','换一张工单',500,1040,188,48,()=>{this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;});
    this.button(p,'start-run','领取工单  ·  开始整备  →',32,1120,656,76,()=>this.start(),'primary',availableStarters(this.content).some(item=>item.id===this.starter));
    p.text(this.content.version+' · '+this.content.items.length+' 件装备 · '+(this.store?'本机自动保存':'刷新不保存'),360,1230,16,C.muted,'center');
    p.text((this.store?'本地金币 ':'本次预览金币 ')+this.session.state.wallet+' · 首次出勤有可跳过手册，右上角随时重看',360,1259,13,'#849a9e','center');
  }
  private researchAction(action:()=>{ok:boolean;reason?:string}):boolean {
    try{const result=action();if(!result.ok){this.notify(result.reason||'研究未生效');return false;}}
    catch(error){this.persistenceFailed(error);return false;}
    return true;
  }
  private researchDialog(p:Painter):void {
    this.hits=[];
    p.rect(32,150,656,1070,C.panel,C.line,16);
    const wallet=this.session.state.wallet,profile=this.session.state.research;
    p.text('装备解锁 · 局外成长',61,195,29,C.text,'left',true);
    p.text('可用金币 '+wallet+' · 结算赚取，装备解锁永久保留',61,243,20,C.orange);
    p.text('研究路线下局入池；不直接赠装，不加永久属性。',61,283,17,C.muted);
    const changeMode=(mode:'sandbox'|'research')=>{
      const old=this.starter;
      if(mode==='research'&&this.starter==='I04'&&!profile?.purchases.includes('heat'))this.starter='I01';
      if(!this.researchAction(()=>this.session.setResearchMode(mode)))this.starter=old;
      this.starterPage=0;
    };
    this.button(p,'research-mode-sandbox','自由试玩 · 全开放',61,315,288,48,()=>changeMode('sandbox'),profile?.mode!=='research'?'primary':'secondary');
    this.button(p,'research-mode-growth','装备解锁路线',367,315,288,48,()=>changeMode('research'),profile?.mode==='research'?'primary':'secondary');
    if(this.researchConfirm){
      const bp=RESEARCH_BLUEPRINTS.find(entry=>entry.id===this.researchConfirm)!;
      p.text('解锁 '+bp.name+'？',61,452,27,C.text,'left',true,594);
      this.wrapped(p,bp.description,61,519,594,23,C.muted,5);
      p.text('花费 '+bp.cost+' 金币 · 剩余 '+(wallet-bp.cost),61,729,25,C.orange);
      p.text('解锁路线的新工单生效；进入掉落池，不直接赠装。',61,785,18,C.muted);
      this.button(p,'research-cancel','暂不解锁',61,928,288,61,()=>{this.researchConfirm=null;});
      this.button(p,'research-confirm','确认解锁 / 扣除金币',367,928,288,61,()=>{if(this.researchAction(()=>this.session.purchaseResearch(bp.id)))this.researchConfirm=null;},'primary',wallet>=bp.cost);
    }else{
      RESEARCH_BLUEPRINTS.forEach((bp,i)=>{
        const y=386+i*136,owned=!!profile?.purchases.includes(bp.id);
        p.rect(61,y,594,124,C.panel2,C.line,10);
        p.text(bp.route+' · '+bp.name,78,y+26,21,owned?C.green:C.text,'left',true,407);
        this.wrapped(p,bp.description,78,y+60,398,17,C.muted,2);
        this.button(p,'research-'+bp.id,owned?'已解锁':bp.cost+' 金币',496,y+40,143,54,()=>{this.researchConfirm=bp.id;},owned?'secondary':'primary',!owned&&wallet>=bp.cost);
      });
      p.text('自由试玩已全开放；切换解锁路线才应用解锁进度。',61,1088,16,C.muted);
    }
    this.button(p,'research-close','返回出勤菜单',61,1140,594,54,()=>{this.researchOpen=false;this.researchConfirm=null;},'primary');
  }
  private run(p:Painter):void {
    const run=this.session.state.run!;
    for(let wave=1;wave<=5;wave++){
      const x=60+(wave-1)*148;const active=wave===run.wave;const done=wave<=run.victories;
      if(wave<5)p.line(x+16,151,x+132,151,done?'#78997c':C.line,2);
      p.circle(x,151,14,done?C.green:active?C.orange:C.panel2,active?C.orange:C.line);
      p.text(String(wave),x,151,14,active||done?C.bg:C.muted,'center',true);
      p.text(wave===5?'炉芯首领':'回收区 '+wave,x,184,13,active?C.orange:C.muted,'center');
    }
    if(run.phase==='preparation')this.preparation(p);
    if(run.phase==='combat')this.combat(p);
    if(run.phase==='loot'){if(this.lootCollapsed)this.preparation(p,true);else this.loot(p);}
    if(run.phase==='defeat')this.defeat(p);
    if(run.phase==='settlement')this.settlement(p);
    if(run.phase!=='settlement'){
      this.hits.push({id:'abandon-run',x:527,y:209,w:161,h:42,label:'结束本局',enabled:true,onClick:()=>{this.confirmAbandon=true;this.driver.pause('confirm-abandon');}});
      p.text('结束本局  ↗',681,227,16,C.muted,'right');
    }
  }
  private preparation(p:Painter,readOnly=false):void {
    const run=this.session.state.run!;const inv=run.inventory;const loadout=evaluateLoadout(inv,this.content);
    p.text(readOnly?'已有装备 · 物资待领取':'出勤前，检查装备。',32,227,29,C.text,'left',true);
    p.rect(32,262,656,105,C.panel,C.line,10);
    p.text(readOnly?'第 '+run.wave+' 波已完成 · 补给方案保留，不会重抽':'下一波情报 · '+(this.content.limits.deadlineTick/10)+'秒内清场，超时失败',51,283,14,C.orange);
    const enemyNames=this.content.waves[run.wave-1].map(id=>this.content.enemies.find(e=>e.id===id)!.name).join('  /  ');
    p.text(readOnly?'先看背包与备存，再决定领取哪份物资。':enemyNames,51,311,19,C.text,'left',false,617);
    p.text(readOnly?'当前只读：可查装备规则与联动；领取后再整理、出击。':'所有敌人攻击装备员；先扣减伤，再扣护盾，最后扣生命。',51,345,15,C.muted);
    p.text('生命 '+(run.hp===null?loadout.maxHp:run.hp)+' / '+loadout.maxHp,39,389,18,C.green);
    p.text('护盾 '+loadout.initialShield,238,389,18,C.blue);
    p.text('火力 '+loadout.weapons.length+' 件',401,389,18,C.orange);
    p.text('减伤 '+loadout.reduction,679,389,18,C.muted,'right');
    p.rect(32,402,387,463,'#101b20',C.line,12);
    for(let y=0;y<6;y++)for(let x=0;x<5;x++){
      p.rect(BAG.x+x*BAG.pitch,BAG.y+y*BAG.pitch,BAG.cell,BAG.cell,'#19262b','#304146',5);
      p.circle(BAG.x+x*BAG.pitch+BAG.cell/2,BAG.y+y*BAG.pitch+BAG.cell/2,2,'#324248');
    }
    for(const placement of inv.placements){
      const instance=inv.instances.find(i=>i.id===placement.instanceId)!;const def=getItem(this.content,instance.defId);
      const selected=this.selectedId===instance.id;
      const occupied=occupiedCells(placement,def);
      for(const cell of occupied){
        const x=BAG.x+cell.x*BAG.pitch,y=BAG.y+cell.y*BAG.pitch;
        p.rect(x+2,y+2,BAG.cell-4,BAG.cell-4,tint(def.color,selected?0.50:0.30),selected?C.orange:def.color,5);
        this.hits.push({id:'bag-item-'+instance.id+'-'+cell.x+'-'+cell.y,x,y,w:BAG.cell,h:BAG.cell,label:def.name,enabled:true,itemId:instance.id,onClick:()=>{
          if(!readOnly&&this.selectedId===instance.id&&this.rotation!==placement.rotation)this.place(instance.id,placement.x,placement.y);else this.select(instance.id);
        }});
      }
      const top=occupied.slice().sort((a,b)=>a.y-b.y||a.x-b.x)[0];
      this.itemSymbol(p,def,BAG.x+top.x*BAG.pitch+34,BAG.y+top.y*BAG.pitch+25,15);
      p.text(def.shortName,BAG.x+top.x*BAG.pitch+34,BAG.y+top.y*BAG.pitch+51,14,C.text,'center',true,62);
    }
    this.preparationReadout(p,inv);
    this.stash(p);
    if(readOnly){
      p.text('只是暂时收起：没有放弃物资，也没有推进关卡。',360,1129,17,C.orange,'center');
      this.button(p,'return-loot','返回领取物资  →',32,1174,656,65,()=>this.toggleLoot(),'primary');
      p.text('点选装备查看收益 · 完整规则可展开 · Esc 返回领取',360,1260,15,C.muted,'center');
      return;
    }
    const hasSelected=!!this.selectedId;
    this.button(p,'rotate','旋转  R',32,1107,204,51,()=>this.rotate(),'secondary',hasSelected);
    this.button(p,'undo','撤销  Z',248,1107,204,51,()=>this.undo(),'secondary',inv.history.length>0);
    this.button(p,'unequip','收回备存',464,1107,224,51,()=>{
      if(this.selectedId&&this.act({type:'inventory',command:{type:'stash',instanceId:this.selectedId,expectedRevision:inv.revision}}))this.notify('已收回，装备仍在备存区。');
    },'secondary',!!this.selectedId&&inv.placements.some(i=>i.instanceId===this.selectedId));
    this.button(p,'start-combat','进入第 '+run.wave+' 波战斗  →',32,1174,656,65,()=>{
      if(this.act({type:'start-combat'})){this.selectedId=null;this.notify('装备自动运作，布局已锁定。');}
    },'primary',loadout.weapons.length>0);
    p.text(this.toast,360,1260,15,C.muted,'center',false,666);
    this.dragPreview(p);
  }
  private openManual(tab:ManualTab='items',entryId:string|null=null):void {
    this.pointer=null;this.manualOpen=true;this.manualTab=tab;this.manualFilter='all';this.manualPage=0;this.manualEntryId=entryId;this.manualTextPage=0;this.driver.pause('manual');
  }
  private openGuide():void {this.pointer=null;this.guidePage=0;this.driver.pause('guide');}
  private openItem(id:string):void {this.pointer=null;this.detailId=id;this.detailPage=0;this.driver.pause('item-detail');}
  private openJournal():void {this.pointer=null;this.journalOpen=true;this.journalPage=Math.max(0,Math.ceil(this.journal.entries.length/6)-1);this.driver.pause('journal');}
  private closeOverlay():void {
    this.pointer=null;
    if(this.manualOpen){this.manualOpen=false;this.manualEntryId=null;this.driver.resume('manual');}
    if(this.guidePage!==null){this.guidePage=null;this.tutorialSeen=true;this.driver.resume('guide');this.checkpoint();}
    if(this.detailId!==null){this.detailId=null;this.driver.resume('item-detail');}
    if(this.journalOpen){this.journalOpen=false;this.driver.resume('journal');}
  }
  private textRows(text:string,width:number,size:number):string[] {
    const rows:string[]=[];let line='',units=0;const limit=width/size;
    const measure=(value:string)=>Array.from(value).reduce((n,char)=>n+(char.charCodeAt(0)>255?1:0.57),0);
    // Keep numeric stats (0.63, 18/24, 40%) intact across wrapping boundaries.
    for(const token of text.match(/[A-Za-z0-9.%/+_-]+|./gu)||[]){
      const parts=measure(token)>limit?Array.from(token):[token];
      for(const part of parts){const u=measure(part);
        if(line&&units+u>limit&&!/^[，。！？；：、）】]$/.test(part)){rows.push(line);line='';units=0;}
        line+=part;units+=u;
      }
    }
    if(line)rows.push(line);return rows;
  }
  private preparationReadout(p:Painter,original:InventoryState):void {
    let inv=original,preview=false;
    const drag=this.pointer;
    if(drag?.dragging&&drag.itemId){const target=this.bagTarget(drag.x,drag.y,drag.offsetX,drag.offsetY);if(target){const result=transactInventory(original,{type:'place',instanceId:drag.itemId,x:target.x,y:target.y,rotation:this.rotation,expectedRevision:original.revision},this.content);if(result.ok){inv=result.state;preview=true;}}}
    const loadout=evaluateLoadout(inv,this.content);
    p.rect(433,402,255,463,C.panel,C.line,12);
    if(this.selectedId){
      const instance=inv.instances.find(i=>i.id===this.selectedId)!;const def=getItem(this.content,instance.defId);
      const info=inspectItem(inv,this.content,instance.id);
      p.text(preview?'放置预览 · 尚未提交':categoryName[def.category]+' · '+(info.placed?'背包中':'备存中'),449,427,14,preview?C.orange:def.color);
      p.text(def.name,449,460,24,C.text,'left',true,222);
      this.miniEquipment(p,def,451,481,23,this.rotation);p.text('预览朝向  '+this.rotation+'°',670,497,13,C.muted,'right');
      this.wrapped(p,info.status,449,562,222,20,info.active?C.green:C.orange,2);
      const own=loadout.weapons.find(w=>w.instanceId===instance.id);
      let notes=own?['伤害 '+own.damage+' → '+(own.damage+own.bonusDamage),'间隔 '+seconds(own.cooldown/10)+' → '+weaponTiming(own)+'均值',own.hasteBps?'加速已计入，不再吞取整余量':'贴电池可加速；贴护板加伤']:info.lines.slice(0,3);
      if(def.id==='I07')notes=[...info.lines.filter(line=>line.includes('→')).slice(0,2),info.active?'护盾+2；同类电池不叠加':'请把电池边缘贴到武器格子'];
      if(preview)notes=placementChanges(original,inv,this.content).slice(0,2);
      let y=620;
      for(const note of notes.slice(0,2)){const rows=this.textRows(note,220,18).slice(0,2);for(const row of rows){p.text(row,449,y,18,C.muted);y+=27;}y+=7;}
      this.button(p,'inspect-item','完整规则 / 生效对象',449,778,222,45,()=>this.openItem(instance.id));
      p.text('连线标记 = 实际正交接触',449,845,13,C.blue);
      this.connectionMarks(p,inv,instance.id,info.peers);
    }else{
      p.text('先摆对，再出勤。',449,436,20,C.text,'left',true);
      const powered=loadout.weapons.filter(w=>w.hasteBps>0).length;
      const checklist=[(loadout.weapons.length?'✓':'○')+' 放入至少1把武器',(powered?'✓':'○')+' 电池供电 '+powered+'把',(loadout.combos.some(c=>c.id==='C01')?'✓':'○')+' 武器贴护板加伤'];
      checklist.forEach((line,i)=>p.text(line,449,486+i*38,16,line.startsWith('✓')?C.green:C.muted));
      this.wrapped(p,'邻接 = 上下左右共边。斜角不算，多格装备接触任意一格即可。',449,619,220,17,C.text,4);
      this.button(p,'prep-guide','看布线示例',449,778,222,45,()=>{this.openGuide();this.guidePage=1;});
      p.text('点装备查看具体收益',449,845,14,C.muted);
    }
  }
  private connectionMarks(p:Painter,inv:InventoryState,id:string,peers:string[]):void {
    const cells=(itemId:string)=>{const placement=inv.placements.find(v=>v.instanceId===itemId);const instance=inv.instances.find(v=>v.id===itemId);return placement&&instance?occupiedCells(placement,getItem(this.content,instance.defId)):[];};
    for(const peer of peers){const a=cells(id),b=cells(peer);let drawn=false;
      for(const left of a){for(const right of b){if(Math.abs(left.x-right.x)+Math.abs(left.y-right.y)!==1)continue;
        const x=BAG.x+(left.x+right.x)*BAG.pitch/2+BAG.cell/2,y=BAG.y+(left.y+right.y)*BAG.pitch/2+BAG.cell/2;
        p.circle(x,y,8,C.blue);p.circle(x,y,3,C.bg);drawn=true;break;}if(drawn)break;}
    }
  }
  private guide(p:Painter):void {
    this.hits=[];const page=this.guidePage||0;
    const blade=getItem(this.content,'I03'),battery=getItem(this.content,'I07'),kit=getItem(this.content,'I09');
    const relay=this.content.combos.find(c=>c.id==='C02')!.relay!;
    const titles=['你的工作：让旧设备协同运作','先看共边，再看供电','补给与一次性物品：自动使用','读懂敌人，读懂撤离倒计时','进阶：错峰检修，不只堆伤害','三件套组合：先找中心装备'];
    const bullets:string[][]=[
      ['每波先整理5×6背包，开战后布局锁定，设备自动攻击。','武器、护板、电池通过实际接触形成联动；备存不生效，也不会被静默删除。','五波清场后领取基础金币。每波必须在'+(this.content.limits.deadlineTick/10)+'秒内完成。','散装火力有限：给护板、电池、角铁留共边；同样装备，换布局会改变输出。'],
      ['上下左右共边才算邻接，斜角、隔一格都不算。多格物品接触任意占用格即可。','电池直接贴武器就能供电，不需要先有铜线。相同电池不叠加。',blade.name+'：'+seconds(blade.weapon!.cooldown/10)+'秒 → 平均'+seconds(attackSeconds({...blade.weapon!,hasteBps:battery.effects.adjacentHasteBps||0}))+'秒。实际攻击以0.1秒步长交错，保留全部加速。','护板贴武器：伤害+2。点装备看生效对象，拖动时看放下后的实际变化。'],
      ['急救、盐水、除锈每波补次数；除锈无甲也耗。封救受伤存活且血≤40%回复26。','破甲封筒：基础攻击预定目标中有甲才用，整次攻击忽略3甲；无甲与C04不耗。','泡沫：无盾遇袭先补24盾（限幅），再减伤→盾→生命；有盾不耗，同类按获得顺序。','三种一次性出勤一次；用后波末移除，未触发跨波保留。自动使用，详情见资料手册。'],
      ['所有敌人都攻击装备员，各自按卡片上的伤害与间隔出手。下一击倒计时不是随机。','武器从左起攻击存活目标；霰器会溅射下一目标，喷嘴最多命中3名敌人。','敌人来袭：无盾先检查应急泡沫；再扣减伤、护盾吸收、剩余扣生命。急救仍需受伤后存活。','撤离倒计时就是本波'+(this.content.limits.deadlineTick/10)+'秒时限，不会逐秒增加伤害。清场则赢，生命耗尽或超时则输；首领低于半血才加快攻击。'],
      ['铜线必须同时正交贴一块电池和两件武器。两条接触边不等于两把武器。','接线武器平均冷却再缩短10%，与直接供电合计最多20%。','两把接线武器各开火一次，触发检修脉冲：把最早将攻击的存活敌人延后'+seconds(relay.delayTicks/10)+'秒。','每波最多'+relay.maxPulses+'次；一把连续开火不能代替另一把。拿速度换出手窗口，观察敌人倒计时与蓝色检修反馈。'],
      ['洁净急救：急救匣同时贴盐水滴瓶、除锈药匣。急救回复18→24，仍需受伤后存活且血量≤40%。','惯性齿组：短刃同时贴回收器、角铁。每第3次基础攻击追加5伤害，不多耗穿甲药，不递归触发。','两个配件都要贴到同一中心装备，配件互相接触不能代替。旋转可帮助凑出合法共边。','每种三件套最多启用1组。详情页会列出实际参与者；被动加伤不计入结算的主动联动次数。']
    ];
    p.rect(32,150,656,1070,C.panel,C.line,16);p.text('装备局 · 出勤手册  '+(page+1)+'/'+titles.length,61,196,16,C.orange);
    p.text(titles[page],61,249,28,C.text,'left',true,594);
    if(page===1){
      p.rect(61,292,594,253,'#0c181c',C.line,10);
      this.miniEquipment(p,blade,87,349,58,0);this.miniEquipment(p,battery,151,413,58,0);p.circle(180,409,8,C.blue);
      p.text('共边：通电',92,509,19,C.green,'left',true);
      this.miniEquipment(p,blade,367,349,58,0);this.miniEquipment(p,battery,495,413,58,0);
      p.text('斜角：不通电',374,509,19,C.red,'left',true);
    }else if(page===4){
      p.rect(61,292,594,253,'#0c181c',C.line,10);
      const x=91,y=322,s=36;
      this.miniEquipment(p,getItem(this.content,'I01'),x+2*(s+3),y,s,0);
      this.miniEquipment(p,battery,x+(s+3),y+(s+3),s,0);
      this.miniEquipment(p,getItem(this.content,'I12'),x+(s+3),y+2*(s+3),s,0);
      this.miniEquipment(p,blade,x,y+3*(s+3),s,0);
      p.text('两把各开火一次',367,352,22,C.text,'center',true);p.text('↓ 检修脉冲',410,398,21,C.blue,'center');
      p.text('敌方下一击延后'+seconds(relay.delayTicks/10)+'秒',410,449,20,C.blue,'center');p.text('合法布线示意 · 不修改你的出勤装备',88,520,13,C.muted);
    }else if(page===5){
      p.rect(61,292,594,253,'#0c181c',C.line,10);
      const s=28,d=s+3,x=89,y=324;
      this.miniEquipment(p,getItem(this.content,'I09'),x+d,y+2*d,s,0);
      this.miniEquipment(p,getItem(this.content,'I10'),x,y+d,s,0);
      this.miniEquipment(p,getItem(this.content,'I11'),x+3*d,y+2*d,s,0);
      this.miniEquipment(p,blade,370+d,y+2*d,s,0);
      this.miniEquipment(p,getItem(this.content,'I08'),370+d,y+d,s,0);
      this.miniEquipment(p,getItem(this.content,'I13'),370+3*d,y+2*d,s,0);
      p.text('洁净急救：回复 +6',195,488,22,C.green,'center',true);p.text('惯性齿组：每3击 +5',503,488,22,C.orange,'center',true);
      p.text('急救匣是中心',195,523,17,C.muted,'center');p.text('短刃是中心',503,523,17,C.muted,'center');
    }else{
      p.rect(61,292,594,253,'#0c181c',C.line,10);
      if(page===2){['I15','I16','I17'].forEach((id,i)=>{const item=getItem(this.content,id);this.miniEquipment(p,item,100+i*185,335,35,0);p.text(item.shortName,143+i*185,450,23,item.color,'center',true);p.text('自动触发',143+i*185,494,16,C.muted,'center');});}
      else if(page===3){this.robot(p,180,405,0.7,this.content.enemies[0].color);p.text('攻击 '+this.content.enemies[0].damage+' / 每'+seconds(this.content.enemies[0].cooldown/10)+'秒',421,371,24,C.orange,'center',true);p.text('减伤 → 护盾 → 生命',421,423,22,C.text,'center');p.text('倒计时归零 → 自动出手',421,476,18,C.muted,'center');}
      else{this.worker(p,160,406,1.1);p.text('布线整备 → 看敌方意图',446,362,22,C.text,'center',true);p.text('自动运作 → 回收补给',446,417,22,C.orange,'center');p.text('原创检修题材 · 固定规则可复盘',446,474,16,C.muted,'center');}
    }
    let y=593;
    for(let i=0;i<bullets[page].length;i++){p.circle(70,y+1,4,C.orange);const rows=this.textRows(bullets[page][i],550,24);for(const row of rows){p.text(row,87,y,24,C.text);y+=34;}y+=16;}
    this.button(p,'guide-manual','查全部装备 / 组合',61,992,594,49,()=>{this.closeOverlay();this.openManual();});
    this.button(p,'guide-prev','上一页',61,1063,179,57,()=>{this.guidePage=Math.max(0,page-1);},'secondary',page>0);
    this.button(p,'guide-next','下一页  →',259,1063,396,57,()=>{this.guidePage=Math.min(titles.length-1,page+1);},'primary',page<titles.length-1);
    this.button(p,'guide-close',page===titles.length-1?'我明白了，返回游戏':'先试一试（可随时重看）',61,1140,594,54,()=>this.closeOverlay());
  }
  private fieldManual(p:Painter):void {
    this.hits=[];
    p.rect(32,150,656,1070,C.panel,C.line,16);
    p.text('装备局 · 总资料手册 / 只读',61,195,17,C.orange);
    const tabs:ManualTab[]=['items','links','rules'];
    const labels=['装备与补给','全部联动','战斗与敌人'];
    tabs.forEach((tab,i)=>this.button(p,'manual-tab-'+tab,labels[i],61+i*201,230,192,49,()=>{this.manualTab=tab;this.manualPage=0;this.manualEntryId=null;this.manualTextPage=0;},this.manualTab===tab?'primary':'secondary'));
    const entries=manualEntries(this.content,this.manualTab,this.manualFilter);
    const entry=entries.find(e=>e.id===this.manualEntryId);
    if(entry){
      p.text(entry.title,61,326,29,C.text,'left',true,594);
      const subtitle=entry.itemId?entry.subtitle:entry.id.startsWith('R')?'固定规则 · 以下为当前配置':entry.example?'合法装配示例 · 每块颜色代表一件装备':'敌方基础数据 · 完整数值见正文';
      p.text(subtitle,61,367,18,C.muted,'left',false,594);
      let bodyY=416,maxRows=17;
      if(entry.itemId){
        const item=getItem(this.content,entry.itemId);
        this.miniEquipment(p,item,66,409,25,0);
        p.text(item.unlocked?'当前试玩可掉落':'配置已收录 · 当前掉落未开放',244,424,17,item.unlocked?C.green:C.orange,'left',false,400);
        p.text(item.lifetime==='single-use'?'一次性 · 用后本波结束移除':'放入背包才生效 · 备存不生效',244,461,16,C.muted,'left',false,400);
        bodyY=531;maxRows=14;
      }else if(entry.example){
        p.rect(61,392,594,166,'#0c181c',C.line,9);
        for(let y=0;y<5;y++)for(let x=0;x<5;x++)p.rect(72+x*29,402+y*29,26,26,'#17272a','#30423f',3);
        for(const place of entry.example)this.miniEquipment(p,getItem(this.content,place.defId),72+place.x*29,402+place.y*29,26,place.rotation);
        entry.example.forEach((place,i)=>p.text(getItem(this.content,place.defId).name,254,416+i*33,18,getItem(this.content,place.defId).color));
        bodyY=595;maxRows=12;
      }
      const rows=entry.lines.flatMap(line=>[...this.textRows('· '+line,575,22),'']);
      const pages=Math.max(1,Math.ceil(rows.length/maxRows));this.manualTextPage=Math.min(this.manualTextPage,pages-1);
      rows.slice(this.manualTextPage*maxRows,(this.manualTextPage+1)*maxRows).forEach((row,i)=>p.text(row,64,bodyY+i*31,22,C.text));
      this.button(p,'manual-entry-prev','上页',61,1021,151,48,()=>{this.manualTextPage--;},'secondary',this.manualTextPage>0);
      p.text((this.manualTextPage+1)+'/'+pages,244,1045,16,C.muted,'center');
      this.button(p,'manual-entry-next','下页',275,1021,151,48,()=>{this.manualTextPage++;},'secondary',this.manualTextPage<pages-1);
      this.button(p,'manual-index','返回目录',443,1021,212,48,()=>{this.manualEntryId=null;this.manualTextPage=0;});
    }else{
      if(this.manualTab==='items'){
        const filters:ManualFilter[]=['all','weapon','supply'];
        filters.forEach((filter,i)=>this.button(p,'manual-filter-'+filter,['全部','武器','装备 / 补给'][i],61+i*201,303,192,44,()=>{this.manualFilter=filter;this.manualPage=0;},this.manualFilter===filter?'primary':'secondary'));
      }
      const pages=Math.max(1,Math.ceil(entries.length/5));this.manualPage=Math.min(this.manualPage,pages-1);
      p.text((this.manualTab==='items'?'已收录 '+this.content.items.length+' 件 / '+this.content.items.filter(item=>item.lifetime==='single-use').length+' 种一次性；筛选 ':this.manualTab==='links'?'包括直接邻接效果与四种组合，共 ':'流程、伤害规则与敌人，共 ')+entries.length+' 条',61,385,17,C.muted);
      entries.slice(this.manualPage*5,this.manualPage*5+5).forEach((item,i)=>{
        const y=419+i*116;
        p.rect(61,y,594,105,C.panel2,C.line,10);
        p.text(item.title,79,y+27,23,C.text,'left',true,552);
        this.textRows(item.subtitle,552,17).slice(0,2).forEach((row,j)=>p.text(row,79,y+59+j*24,17,C.muted));
        this.hits.push({id:'manual-entry-'+item.id,x:61,y,w:594,h:105,label:item.title,enabled:true,onClick:()=>{this.manualEntryId=item.id;this.manualTextPage=0;}});
      });
      this.button(p,'manual-prev','上一页',61,1021,179,48,()=>{this.manualPage--;},'secondary',this.manualPage>0);
      p.text((this.manualPage+1)+'/'+pages,356,1045,17,C.muted,'center');
      this.button(p,'manual-next','下一页',474,1021,181,48,()=>{this.manualPage++;},'secondary',this.manualPage<pages-1);
    }
    p.text('查看不会消耗物品或推进战斗；关闭后保持原暂停状态',358,1104,15,C.muted,'center');
    this.button(p,'manual-close','关闭资料手册，返回游戏',61,1140,594,54,()=>this.closeOverlay(),'primary');
  }

  private itemDetails(p:Painter):void {
    this.hits=[];const run=this.session.state.run!,instance=run.inventory.instances.find(i=>i.id===this.detailId)!;
    const item=getItem(this.content,instance.defId),info=inspectItem(run.inventory,this.content,instance.id);
    const lines=info.lines.slice(),c=run.combat;
    const currentSupply=run.phase==='combat'?c?.consumables.find(s=>s.instanceId===instance.id):undefined;
    const spent=!!currentSupply&&singleUseSpent(currentSupply);
    p.rect(32,160,656,1055,C.panel,C.line,16);p.text('装备检查 · 只读 / 游戏暂停',62,206,16,C.orange);
    p.text(item.name,62,254,32,C.text,'left',true);p.text(spent?'一次性已用尽 · 等待本波结束移除':info.status,62,304,20,!spent&&info.active?C.green:C.orange);
    if(run.phase==='combat'&&c){
      const weapon=c.weapons.find(w=>w.instanceId===instance.id),supply=c.consumables.find(v=>v.instanceId===instance.id),circuit=c.circuits.find(v=>v.anchorId===instance.id);
      if(weapon)lines.unshift('当前：已开火'+weapon.attacks+'次，下一次在'+seconds(Math.max(0,weapon.nextAttackTick-c.tick)/10)+'秒后；暂停期间计时冻结。');
      if(supply)lines.unshift(...supplyRemaining(supply).map(line=>'当前：'+line+'。'));
      if(supply?.singleUse)lines.unshift(singleUseSpent(supply)?'一次性已用尽；整次出勤供给已消耗，本波结束移除，不会在下一波补充。':'一次性待触发；整次出勤仅一份，未使用可留到下一波。');
      if(circuit)lines.unshift('当前已检修'+circuit.pulses+'/'+circuit.maxPulses+'次，已等到'+circuit.firedWeaponIds.length+'/2把武器开火。');
    }
    const rows=lines.flatMap(line=>[...this.textRows('· '+line,575,24),'']);
    const pages=Math.max(1,Math.ceil(rows.length/18));this.detailPage=Math.min(this.detailPage,pages-1);
    rows.slice(this.detailPage*18,this.detailPage*18+18).forEach((row,i)=>p.text(row,64,357+i*35,24,C.text));
    if(pages>1){this.button(p,'detail-prev','上一页',63,1021,181,48,()=>{this.detailPage=Math.max(0,this.detailPage-1);},'secondary',this.detailPage>0);p.text((this.detailPage+1)+'/'+pages,356,1047,17,C.muted,'center');this.button(p,'detail-next','下一页',474,1021,181,48,()=>{this.detailPage=Math.min(pages-1,this.detailPage+1);},'secondary',this.detailPage<pages-1);}
    this.button(p,'detail-manual','在资料手册查看装备与配方',62,1077,593,36,()=>{this.closeOverlay();this.openManual('items',item.id);});
    this.button(p,'detail-close','返回，保持原布局与战斗状态',62,1124,593,61,()=>this.closeOverlay(),'primary');
  }
  private journalDialog(p:Painter):void {
    this.hits=[];p.rect(32,160,656,1055,C.panel,C.line,16);p.text('战斗复盘 · 已暂停',62,211,18,C.orange);
    p.text('每次变化，都能找到原因。',62,268,30,C.text,'left',true);
    p.text('保留本波最近160条有效事件，按模拟时间排列。',62,316,17,C.muted);
    const pages=Math.max(1,Math.ceil(this.journal.entries.length/6));this.journalPage=Math.min(this.journalPage,pages-1);
    this.journal.entries.slice(this.journalPage*6,this.journalPage*6+6).forEach((entry,i)=>{
      const y=377+i*105;p.text((entry.event.tick/10).toFixed(1)+'s',62,y,15,C.orange);
      this.wrapped(p,entry.text,131,y,510,22,entry.tone==='heal'?C.green:entry.tone==='relay'?C.blue:C.text,3);p.line(62,y+84,655,y+84,C.line);
    });
    if(!this.journal.entries.length)p.text('尚未发生攻击，等待设备完成首次蓄势。',62,398,19,C.muted);
    this.button(p,'journal-prev','较早事件',62,1034,186,53,()=>{this.journalPage=Math.max(0,this.journalPage-1);},'secondary',this.journalPage>0);
    p.text((this.journalPage+1)+'/'+pages,357,1062,17,C.muted,'center');
    this.button(p,'journal-next','较新事件',467,1034,187,53,()=>{this.journalPage=Math.min(pages-1,this.journalPage+1);},'secondary',this.journalPage<pages-1);
    this.button(p,'journal-close','关闭战报，继续原来的战斗',62,1132,592,60,()=>this.closeOverlay(),'primary');
  }
  private stash(p:Painter):void {
    const inv=this.session.state.run!.inventory;
    const pages=Math.max(1,Math.ceil(inv.stash.length/8));this.stashPage=Math.min(this.stashPage,pages-1);
    p.text('备存区',32,897,22,C.text,'left',true);p.text(inv.stash.length+' 件 · 不限容量',119,899,15,C.muted);
    if(pages>1){
      this.button(p,'stash-prev','‹',516,877,47,38,()=>{this.stashPage=Math.max(0,this.stashPage-1);},'secondary',this.stashPage>0);
      p.text((this.stashPage+1)+' / '+pages,598,897,14,C.muted,'center');
      this.button(p,'stash-next','›',638,877,50,38,()=>{this.stashPage=Math.min(pages-1,this.stashPage+1);},'secondary',this.stashPage<pages-1);
    }
    p.rect(28,921,664,174,'#0d171c',undefined,8);
    const ids=inv.stash.slice(this.stashPage*8,this.stashPage*8+8);
    ids.forEach((id,index)=>{
      const instance=inv.instances.find(i=>i.id===id)!;const item=getItem(this.content,instance.defId);
      const x=ROSTER.x+(index%4)*(ROSTER.w+ROSTER.gap),y=ROSTER.y+Math.floor(index/4)*87;
      p.rect(x,y,ROSTER.w,ROSTER.h,this.selectedId===id?'#333126':C.panel2,this.selectedId===id?C.orange:C.line,8);
      this.miniEquipment(p,item,x+12,y+12,12,0);
      p.text(item.shortName,x+65,y+26,19,C.text,'left',true,83);
      p.text(categoryName[item.category],x+65,y+53,13,item.color);
      this.hits.push({id:'stash-item-'+id,x,y,w:ROSTER.w,h:ROSTER.h,label:item.name,enabled:true,itemId:id,onClick:()=>this.select(id)});
    });
    if(!ids.length)p.text('备存为空 · 拖到这里可收回装备',360,1008,19,C.muted,'center');
  }
  private dragPreview(p:Painter):void {
    const drag=this.pointer;if(!drag?.dragging||!drag.itemId)return;
    const inv=this.session.state.run!.inventory;const instance=inv.instances.find(i=>i.id===drag.itemId)!;const def=getItem(this.content,instance.defId);
    const target=this.bagTarget(drag.x,drag.y,drag.offsetX,drag.offsetY);
    if(target){
      const result=transactInventory(inv,{type:'place',instanceId:drag.itemId,x:target.x,y:target.y,rotation:this.rotation,expectedRevision:inv.revision},this.content);
      for(const cell of normalizeShape(def.shape,this.rotation)){
        p.rect(BAG.x+(target.x+cell.x)*BAG.pitch+5,BAG.y+(target.y+cell.y)*BAG.pitch+5,BAG.cell-10,BAG.cell-10,result.ok?'#315447':'#63382f',result.ok?C.green:C.red,5);
      }
      p.text(result.ok?(result.swappedId?'松手交换':'松手放置'):'无法放置 · 松手保留原位',360,886,16,result.ok?C.green:C.red,'center');
    }else this.miniEquipment(p,def,drag.x-24,drag.y-86,28,this.rotation);
  }
  private combat(p:Painter):void {
    const run=this.session.state.run!,c=run.combat!;
    p.text('看住攻击节奏，守住检修窗口。',32,227,27,C.text,'left',true,490);
    p.rect(32,266,656,456,C.panel,C.line,14);
    const remaining=Math.max(0,(c.deadlineTick-c.tick)/10);
    p.text('撤离倒计时',51,292,17,C.orange);p.text('剩 '+remaining.toFixed(1)+' 秒',667,292,20,remaining<=10?C.red:C.orange,'right',true);
    p.text('限时 '+(c.deadlineTick/10)+' 秒 · 未清场即失败 · 不会随时间暗中加伤',51,322,15,C.muted);
    this.bar(p,52,341,614,6,1-c.tick/Math.max(1,c.deadlineTick),remaining<=10?C.red:C.orange);
    c.enemies.forEach((enemy,i)=>{
      const x=360+(i-(c.enemies.length-1)/2)*205,living=enemy.hp>0;
      const interval=enemy.enraged?enemy.enragedCooldown!:enemy.cooldown;
      const next=Math.max(0,(enemy.nextAttackTick-c.tick)/10);
      this.robot(p,x,419+(living?Math.sin(this.elapsed*2+i)*2:0),0.46,living?enemy.color:'#3b4547',enemy.behavior==='boss');
      p.text((i+1)+' '+enemy.name,x,469,15,living?C.text:C.muted,'center',true,196);
      this.bar(p,x-85,489,170,8,enemy.hp/enemy.maxHp,living?C.red:C.muted);
      p.text(enemy.hp+'/'+enemy.maxHp+'  护甲'+enemy.armor,x,516,15,C.muted,'center');
      p.text(living?'攻击 '+enemy.damage+' / 每'+seconds(interval/10)+'秒':'已停止运作',x,542,15,living?C.text:C.muted,'center');
      p.text(living?'→ 装备员 · '+next.toFixed(1)+'秒后攻击':'不再攻击',x,568,15,living&&next<=0.4?C.red:C.orange,'center',false,192);
      if(living&&enemy.enraged)p.text('半血过载 · 节奏加快',x,590,13,C.red,'center');
      const hit=this.journal.entries.slice().reverse().find(entry=>entry.event.target===enemy.instanceId&&entry.event.type==='damage'&&c.tick-entry.event.tick<=7);
      if(hit){p.text('-'+hit.event.amount,x+51,397-(c.tick-hit.event.tick)*2,24,C.orange,'center',true);if(c.tick-hit.event.tick<=2)p.line(125,668,x,440,C.orange,2);}
      const pulse=this.journal.entries.slice().reverse().find(entry=>entry.event.target===enemy.instanceId&&entry.event.type==='relay'&&c.tick-entry.event.tick<=12);
      if(pulse){p.line(x-89,602,x+89,602,C.blue,4);p.text('检修干预 +'+seconds((pulse.event.amount||0)/10)+'秒',x,620,14,C.blue,'center',true);}
    });
    this.worker(p,82,671,0.40);p.text('装备员  '+c.hp+'/'+c.maxHp,125,646,18,C.green,'left',true);
    p.text('护盾 '+c.shield+'  /  每次减伤 '+c.reduction,662,646,17,C.blue,'right');
    this.bar(p,125,667,537,12,c.hp/c.maxHp,C.green);
    const incoming=this.journal.entries.slice().reverse().find(entry=>entry.event.target==='player'&&entry.event.type==='damage'&&c.tick-entry.event.tick<=9);
    p.text(incoming?'本次受击：护盾 -'+incoming.event.absorbed+' / 生命 -'+incoming.event.amount:'无盾先应急补盾 → 减伤 → 护盾 → 生命',125,700,15,incoming?C.red:C.muted);
    const devices=[...c.weapons.map(w=>({id:w.instanceId,kind:'weapon'})),...c.consumables.map(s=>({id:s.instanceId,kind:'supply'})),...c.circuits.map(s=>({id:s.anchorId,kind:'relay'}))];
    const pages=Math.max(1,Math.ceil(devices.length/6));this.equipmentPage=Math.min(this.equipmentPage,pages-1);
    p.text('设备状态 · 点卡片看规则',32,753,21,C.text,'left',true);
    if(pages>1){this.button(p,'equipment-prev','‹',510,736,44,33,()=>{this.equipmentPage=Math.max(0,this.equipmentPage-1);},'secondary',this.equipmentPage>0);p.text((this.equipmentPage+1)+'/'+pages,594,753,14,C.muted,'center');this.button(p,'equipment-next','›',640,736,48,33,()=>{this.equipmentPage=Math.min(pages-1,this.equipmentPage+1);},'secondary',this.equipmentPage<pages-1);}
    devices.slice(this.equipmentPage*6,this.equipmentPage*6+6).forEach((device,i)=>{
      const x=32+(i%3)*223,y=781+Math.floor(i/3)*105;
      const instance=run.inventory.instances.find(item=>item.id===device.id)!,def=getItem(this.content,instance.defId);
      p.rect(x,y,211,96,C.panel,C.line,9);p.text(def.name,x+12,y+18,16,def.color,'left',true,187);
      if(device.kind==='weapon'){
        const w=c.weapons.find(v=>v.instanceId===device.id)!;
        p.text((w.damage+w.bonusDamage)+'伤害 / 均值'+weaponTiming(w),x+12,y+42,14,C.text,'left',false,188);
        p.text('下次 '+(Math.max(0,w.nextAttackTick-c.tick)/10).toFixed(1)+'秒 · 已开火'+w.attacks+'次',x+12,y+65,13,C.muted,'left',false,188);
        this.bar(p,x+12,y+82,187,5,1-Math.max(0,w.nextAttackTick-c.tick)/effectiveCooldown(w),def.color);
      }else if(device.kind==='supply'){
        const s=c.consumables.find(v=>v.instanceId===device.id)!;
        const spent=singleUseSpent(s), lifetime=s.singleUse?'出勤一次':'每波重置';
        const remaining=s.pierceCharges?Math.max(0,s.pierceCharges-s.pierceUsed):Math.max(0,s.charges-s.used);
        const total=s.pierceCharges||s.charges, unit=s.pierceCharges?'份':'次';
        p.text('剩 '+remaining+'/'+total+' '+unit+' · '+(spent?'已用尽':lifetime),x+12,y+44,15,spent?C.orange:C.text,'left',false,187);
        const rule=spent?'出勤供给已消耗 · 波末移除':s.pierceCharges?(s.singleUse?'有甲基础攻击':'下次基础攻击')+'忽略 '+s.pierce+' 护甲':s.emergencyShield?'无盾遇袭补 '+s.emergencyShield+' 盾（限幅）':s.emergencyHeal?'血≤'+s.thresholdBps/100+'% 时回复 '+s.emergencyHeal:'每'+seconds(s.everyTicks/10)+'秒回复 '+s.periodicHeal;
        p.text(rule,x+12,y+73,13,C.muted,'left',false,187);
      }else{
        const relay=c.circuits.find(v=>v.anchorId===device.id)!;
        p.text('检修 '+relay.pulses+'/'+relay.maxPulses+' 次 · 就绪'+relay.firedWeaponIds.length+'/2',x+12,y+44,14,C.blue);
        p.text('两把各开火 → 延后敌人攻击',x+12,y+73,12,C.muted);
      }
      this.hits.push({id:'combat-device-'+device.id,x,y,w:211,h:96,label:def.name,enabled:true,onClick:()=>this.openItem(device.id)});
    });
    p.rect(32,996,656,128,'#101c22',C.line,9);p.text('最近战报 · 反馈会保留，不再一闪即逝',47,1017,14,C.muted);
    const recent=this.journal.entries.slice(-3);
    if(!recent.length)p.text('设备正在蓄势；倒计时归零时自动出手。',47,1056,16,C.muted);
    recent.forEach((entry,i)=>p.text((entry.event.tick/10).toFixed(1)+'s  '+entry.text,47,1045+i*28,14,entry.tone==='heal'?C.green:entry.tone==='relay'?C.blue:entry.tone==='damage'?C.red:C.text,'left',false,625));
    this.button(p,'pause-combat','暂停战斗  Ⅱ',32,1143,316,64,()=>this.driver.pause('user'));
    this.button(p,'combat-journal','展开最近战报',365,1143,323,64,()=>this.openJournal());
    p.text('自动运作 · 普通补给每波重置 · 一次性用后移除 · 不自动满血',360,1240,15,C.muted,'center');
  }
  private toggleLoot():void {
    if(this.persistenceError||this.screen!=='run'||this.session.state.run?.phase!=='loot')return;
    this.pointer=null;this.selectedId=null;this.lootCollapsed=!this.lootCollapsed;
  }
  private loot(p:Painter):void {
    const run=this.session.state.run!;
    p.text('区域清理完毕。',32,232,32,C.text,'left',true);
    p.text('选一份回收物资。全部先送往备存区，不会挤掉旧装备。',32,287,18,C.muted);
    if(run.lootEvent)p.text('回收偏好已触发：本次武器掉落权重 ×2',32,330,18,C.orange);
    run.loot.forEach((option,i)=>{
      const y=365+i*202;
      p.rect(32,y,656,180,C.panel,C.line,13);p.text('补给方案 0'+(i+1),52,y+31,15,C.orange);
      option.itemIds.forEach((id,j)=>{const item=getItem(this.content,id);const x=53+j*257;this.miniEquipment(p,item,x,y+62,19,0);p.text(item.name,x+75,y+76,20,C.text,'left',true,177);p.text(categoryName[item.category],x+75,y+110,14,item.color);});
      this.button(p,'loot-'+i,'领取',555,y+58,112,78,()=>{if(this.act({type:'choose-loot',optionId:option.id})){this.stashPage=0;this.notify('补给已入备存，调整布局后再出击。');}},'primary');
    });
    p.text('剩余生命  '+run.hp+'    /    已完成 '+run.victories+' 波',360,1050,19,C.green,'center');
    this.button(p,'view-loot-equipment','暂时收起 / 查看已有装备',32,1078,656,56,()=>this.toggleLoot(),'primary');
    this.button(p,'skip-loot','放弃本次补给，继续整备',32,1150,656,56,()=>{this.act({type:'skip-loot'});});
    p.text('Esc 可收起查看 · 不会放弃、重抽或自动领取物资',360,1240,16,C.muted,'center');
  }
  private defeat(p:Painter):void {
    const run=this.session.state.run!;const c=run.combat!;
    p.text('本次出勤暂告一段落。',32,237,30,C.text,'left',true);
    p.rect(32,311,656,431,C.panel,C.line,15);this.worker(p,360,460,1.5);
    p.text(c.outcome==='timeout'?'撤离时限已到，未清场':'装备员失去行动能力',360,600,29,C.red,'center',true);
    p.text('抵达第 '+run.wave+' 波  ·  已清理 '+run.victories+' 个区域',360,658,21,C.muted,'center');
    this.wrapped(p,'没有装备会在整备中被静默丢弃。试试让武器靠近护板、电池，或者多带一件急救装备。',55,813,611,24,C.muted,4);
    this.button(p,'finish-defeat','结束出勤，查看战斗报告',32,1140,656,74,()=>{this.act({type:'finish-defeat'});},'primary');
    p.text('阶段 2 暂无复活广告；直接结算始终可用',360,1251,16,C.muted,'center');
  }
  private settlement(p:Painter):void {
    const run=this.session.state.run!;const s=run.settlement!;const win=s.reason==='victory';
    p.text(win?'回收完成，平安归局。':'工单已归档。',32,243,36,C.text,'left',true);
    p.text(win?'五个区域全部清理完毕。下一张工单，试试不同的布局。':s.reason==='abandoned'?'你主动结束了本次出勤。已经完成的区域仍计入基础奖励。':'这次收获的经验，会成为下一次的火力。',33,300,18,C.muted,'left',false,649);
    p.rect(32,354,656,146,win?'#22382d':C.panel,win?'#567e60':C.line,13);
    p.text('基础金币',56,391,18,C.muted);p.text('+'+s.baseCoins,56,452,52,C.orange,'left',true);
    p.text('区域 '+run.victories+' / 5',648,396,24,C.text,'right',true);
    p.text(win?'含通关额外 12 金币':'每个已胜区域 4 金币',648,449,16,C.muted,'right');
    p.text('出勤报告',32,552,23,C.text,'left',true);
    const totalTicks=run.reports.reduce((n,r)=>n+r.stats.ticks,0),damage=run.reports.reduce((n,r)=>n+Object.values(r.stats.weapons).reduce((v,w)=>v+w.base+w.combo,0),0);
    [['战斗时长',(totalTicks/10).toFixed(1)+' 秒'],['有效伤害',String(damage)],['主动联动次数',String(run.reports.reduce((n,r)=>n+r.stats.comboTriggers,0))]].forEach(([label,value],i)=>{
      const x=32+i*223;p.rect(x,581,211,94,C.panel,C.line,9);p.text(label,x+16,608,15,C.muted);p.text(value,x+16,648,25,C.text,'left',true);
    });
    run.reports.forEach((r,i)=>{
      const y=713+i*58;p.text('区域 0'+r.wave,46,y,18,C.muted);p.text(r.outcome==='victory'?'清理完毕':r.outcome==='timeout'?'撤离超时':'出勤中止',205,y,18,r.outcome==='victory'?C.green:C.red);
      p.text((r.stats.ticks/10).toFixed(1)+' 秒',476,y,17,C.muted,'right');p.text('余生命 '+r.remainingHp,672,y,17,C.muted,'right');p.line(33,y+24,687,y+24,C.line);
    });
    p.text('种子 '+run.seed+'   /   '+run.contentVersion,360,1057,16,C.muted,'center');
    this.button(p,'claim-and-menu',s.claimed?'返回装备局':'领取基础金币，返回装备局',32,1140,656,76,()=>{
      if(!s.claimed&&!this.act({type:'claim-settlement'}))return;
      this.screen='menu';this.selectedId=null;this.driver.reasons.clear();this.seed=(this.seed+617)>>>0;this.checkpoint();
    },'primary');
    p.text(this.store?'本机保存金币与工单；不含云同步、广告或永久成长。':'金币仅在本次预览内保留。',360,1251,15,C.muted,'center');
  }
  private storageDialog(p:Painter):void {
    this.hits=[];p.rect(0,110,720,1170,'#080e13');p.rect(48,360,624,520,C.panel,C.line,16);
    p.text('本地存档需要处理',360,428,30,C.red,'center',true);
    this.wrapped(p,this.persistenceError||'存档未确认。',80,495,560,22,C.text,6);
    this.wrapped(p,'已暂停出勤与金币操作；保留主档、备份和候选原始数据。重读可能恢复最近已验证快照，不补算后台伤害。',80,670,560,18,C.muted,4);
    this.button(p,'retry-storage','重新读取存档（不重置）',80,784,560,62,()=>this.retryStorage(),'primary');
  }
  private abandonDialog(p:Painter):void {
    this.hits=[];p.rect(0,110,720,1170,'#080e13');p.rect(48,399,624,408,C.panel,C.line,16);
    p.text('结束当前出勤？',360,463,30,C.text,'center',true);
    this.wrapped(p,'结束后本局装备回收，按已完成波数结算基础金币。不会退出整个预览。',80,535,560,22,C.muted,3);
    this.button(p,'cancel-abandon','继续出勤',79,690,267,66,()=>{this.confirmAbandon=false;this.driver.resume('confirm-abandon');});
    this.button(p,'confirm-abandon','结束并结算',374,690,266,66,()=>{this.confirmAbandon=false;this.driver.resume('confirm-abandon');this.act({type:'abandon'});},'danger');
  }
  private pauseDialog(p:Painter):void {
    this.hits=[];p.rect(0,110,720,1170,'#080e13');p.rect(48,415,624,380,C.panel,C.line,16);
    p.text('战斗已暂停',360,478,32,C.text,'center',true);
    this.wrapped(p,'装备与敌人已暂停。返回前台后不会补算伤害。',90,549,540,22,C.muted,3);
    this.button(p,'open-manual','暂停时查资料手册',91,615,538,48,()=>this.openManual());
    this.button(p,'resume-combat','继续战斗  →',91,686,538,64,()=>{this.driver.resume('user');this.driver.resume('resume-confirmation');},'primary',!this.driver.reasons.has('background'));
  }
  private bar(p:Painter,x:number,y:number,w:number,h:number,value:number,color:string):void {
    p.rect(x,y,w,h,'#26373b',undefined,h/2);if(value>0)p.rect(x,y,w*Math.max(0,Math.min(1,value)),h,color,undefined,h/2);
  }
  private miniEquipment(p:Painter,item:ItemDef,x:number,y:number,size:number,rotation:Rotation):void {
    const shape=normalizeShape(item.shape,rotation);
    shape.forEach(cell=>p.rect(x+cell.x*(size+3),y+cell.y*(size+3),size,size,tint(item.color,0.35),item.color,Math.min(4,size/5)));
    const top=shape[0];this.itemSymbol(p,item,x+top.x*(size+3)+size/2,y+top.y*(size+3)+size/2,size*0.28);
  }
  private itemSymbol(p:Painter,item:ItemDef,x:number,y:number,size:number):void {
    const c=item.color;
    if(item.category==='weapon'){p.rect(x-size,y-size*0.35,size*2,size*0.65,c,undefined,2);p.rect(x-size*0.5,y,size*0.5,size*0.85,c);p.line(x+size,y-size*0.6,x+size,y+size*0.25,c,2);}
    else if(item.category==='armor')p.polygon([[x-size,y-size],[x+size,y-size],[x+size*0.7,y+size*0.5],[x,y+size],[x-size*0.7,y+size*0.5]],c);
    else if(item.category==='consumable'){p.rect(x-size*0.28,y-size,size*0.56,size*2,c);p.rect(x-size,y-size*0.28,size*2,size*0.56,c);}
    else if(item.id==='I07')p.polygon([[x,y-size],[x-size*0.7,y+size*0.1],[x,y+size*0.1],[x-size*0.2,y+size],[x+size*0.75,y-size*0.15],[x,y-size*0.15]],c);
    else {p.circle(x,y,size,c);p.circle(x,y,size*0.42,tint(c,0.3));}
  }
  private robot(p:Painter,x:number,y:number,scale:number,color:string,boss=false):void {
    const rect=(dx:number,dy:number,w:number,h:number,fill:string,stroke?:string)=>p.rect(x+dx*scale,y+dy*scale,w*scale,h*scale,fill,stroke,4*scale);
    rect(-70,34,140,25,'#233039',color);rect(-83,18,27,48,'#26383d',color);rect(56,18,27,48,'#26383d',color);
    rect(-61,-61,122,108,tint(color,0.48),color);rect(-46,-43,92,35,'#142023',color);
    p.circle(x-24*scale,y-26*scale,8*scale,C.orange);p.circle(x+24*scale,y-26*scale,8*scale,C.orange);
    for(let i=0;i<3;i++)rect(-33+i*24,7,14,20,color);
    p.line(x,y-61*scale,x,y-84*scale,color,4*scale);p.circle(x,y-89*scale,6*scale,C.orange);
    if(boss){rect(-95,-45,26,58,tint(color,0.55),color);rect(69,-45,26,58,tint(color,0.55),color);p.circle(x,y+3*scale,24*scale,C.orange);p.circle(x,y+3*scale,13*scale,'#623627');}
  }
  private worker(p:Painter,x:number,y:number,scale:number):void {
    p.rect(x-43*scale,y-18*scale,86*scale,71*scale,'#4d655d','#8fae91',8*scale);
    p.circle(x,y-28*scale,36*scale,'#c6ad81');p.rect(x-42*scale,y-53*scale,84*scale,33*scale,'#6c8471','#a7b799',8*scale);
    p.rect(x-26*scale,y-31*scale,52*scale,15*scale,'#182f31',undefined,3*scale);p.rect(x-8*scale,y+4*scale,16*scale,29*scale,C.orange);
  }
}
