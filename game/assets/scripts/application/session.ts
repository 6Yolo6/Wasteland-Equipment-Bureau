import { contentForVersion, GROWTH_DEVELOPMENT_CONTENT, LEGACY_GROWTH_DEVELOPMENT_CONTENT, isResearchContent, researchContentFor, withResearch } from '../content/catalog';
import { RESEARCH_BLUEPRINTS, ResearchProfile, researchItemIds } from '../content/research';
import { GameContent, RunState } from '../core/types';
import { advanceRun, applyRunCommand, createRun, RunAction, RunCommand, RunResult } from '../core/run';
export interface SessionState { run:RunState|null; wallet:number; nextRun:number; nextCommand:number; research?:ResearchProfile; }
export interface SessionOptions { initialState?:SessionState; namespace?:string|(()=>string); commit?:(next:SessionState,checkpoint:boolean)=>void; }
/** Pure session orchestration; persistence is injected and confirmed before publication. */
export class GameSession {
  state:SessionState={run:null,wallet:0,nextRun:1,nextCommand:1};
  constructor(private readonly defaultContent:GameContent,private readonly options:SessionOptions={}){if(options.initialState)this.state=options.initialState;}
  get content():GameContent {
    if(!this.state.run)return this.defaultContent;
    const resolved=contentForVersion(this.defaultContent,this.state.run.contentVersion);
    if(!resolved)throw new Error('Unknown run content version');
    return this.state.run.researchUnlocks?withResearch(resolved,this.state.run.researchUnlocks):resolved;
  }
  get supportsResearch():boolean {return this.defaultContent.version===GROWTH_DEVELOPMENT_CONTENT.version||this.defaultContent.version===LEGACY_GROWTH_DEVELOPMENT_CONTENT.version;}
  get newRunContent():GameContent {
    return this.supportsResearch&&this.state.research?.mode==='research'?withResearch(researchContentFor(this.defaultContent),researchItemIds(this.state.research)):this.defaultContent;
  }
  private canResearch():boolean {return this.supportsResearch&&(!this.state.run||(this.state.run.phase==='settlement'&&!!this.state.run.settlement?.claimed));}
  setResearchMode(mode:'sandbox'|'research'):{ok:boolean;reason?:string} {
    if(!this.canResearch())return {ok:false,reason:'请先结束工单并领取结算，再选择研究路线。'};
    if(mode!=='sandbox'&&mode!=='research')return {ok:false,reason:'未知路线模式。'};
    if(this.state.research?.mode===mode)return {ok:true};
    this.publish({...this.state,research:{mode,purchases:this.state.research?.purchases.slice()||[]}});return {ok:true};
  }
  purchaseResearch(id:string):{ok:boolean;reason?:string} {
    if(!this.canResearch())return {ok:false,reason:'研究只能在工单结算后的菜单进行。'};
    const blueprint=RESEARCH_BLUEPRINTS.find(entry=>entry.id===id);
    if(!blueprint)return {ok:false,reason:'未知蓝图。'};
    const profile=this.state.research||{mode:'sandbox' as const,purchases:[]};
    if(profile.purchases.includes(id))return {ok:false,reason:'蓝图已经研究，不会重复扣款。'};
    if(this.state.wallet<blueprint.cost)return {ok:false,reason:'金币不足，继续出勤后再来研究。'};
    this.publish({...this.state,wallet:this.state.wallet-blueprint.cost,research:{mode:profile.mode,purchases:[...profile.purchases,id]}});return {ok:true};
  }
  private publish(next:SessionState,checkpoint=true):void {this.options.commit?.(next,checkpoint);this.state=next;}
  start(seed:number,starterId:string):RunState {
    if(this.state.run && this.state.run.phase!=='settlement')throw new Error('Finish the current run before starting another');
    if(this.state.run?.settlement && !this.state.run.settlement.claimed)throw new Error('Claim or explicitly finish the current settlement first');
    if(!Number.isSafeInteger(this.state.nextRun+1))throw new Error('Run sequence exhausted');
    const namespace=typeof this.options.namespace==='function'?this.options.namespace():this.options.namespace;
    let run=createRun((namespace?namespace+'-run-':'run-')+this.state.nextRun,seed,starterId,this.newRunContent);
    if(isResearchContent(this.newRunContent))run={...run,researchUnlocks:researchItemIds(this.state.research)};
    this.publish({...this.state,run,nextRun:this.state.nextRun+1});return run;
  }
  dispatch(action:RunAction):RunResult {
    const run=this.state.run;if(!run)throw new Error('No active run');
    const command:RunCommand={commandId:run.id+'/cmd/'+this.state.nextCommand,runId:run.id,expectedRevision:run.revision,action};
    return this.submit(command);
  }
  submit(command:RunCommand):RunResult {
    const run=this.state.run;if(!run)throw new Error('No active run');
    const result=applyRunCommand(run,command,this.content);
    if(!result.ok||result.duplicate)return result;
    let nextCommand=this.state.nextCommand+1;
    while(result.state.processedCommandIds.includes(run.id+'/cmd/'+nextCommand))nextCommand++;
    if(!Number.isSafeInteger(nextCommand))throw new Error('Command sequence exhausted');
    const wallet=this.state.wallet+(result.coinsAdded||0);
    if(!Number.isSafeInteger(wallet)||wallet<0)throw new Error('Wallet overflow');
    this.publish({...this.state,run:result.state,wallet,nextCommand});return result;
  }
  advance(ticks:number):void {
    if(this.state.run){const run=advanceRun(this.state.run,ticks,this.content);if(run!==this.state.run)this.publish({...this.state,run},run.phase!=='combat');}
  }
}
/** Presentation supplies foreground frame duration. Never catch up after pause. */
export class FixedStepDriver {
  private debt=0;
  readonly reasons=new Set<string>();
  constructor(private readonly onTicks:(ticks:number)=>void,readonly tickSeconds=0.1,readonly maxCatchUp=5){
    if(typeof onTicks!=='function'||!Number.isFinite(tickSeconds)||tickSeconds<=0||!Number.isSafeInteger(maxCatchUp)||maxCatchUp<1)throw new Error('Invalid fixed-step driver configuration');
  }
  pause(reason:string):void {this.reasons.add(reason);this.debt=0;}
  resume(reason:string):void {this.reasons.delete(reason);this.debt=0;}
  update(dt:number):number {
    if(this.reasons.size||!Number.isFinite(dt)||dt<=0){this.debt=0;return 0;}
    // A long suspension cannot apply unseen damage. Discard excessive wall time.
    if(dt>1){this.pause('resume-confirmation');return 0;}
    this.debt+=dt;
    const ticks=Math.min(this.maxCatchUp,Math.floor((this.debt+1e-9)/this.tickSeconds));
    this.debt=Math.min(this.debt-ticks*this.tickSeconds,this.tickSeconds*this.maxCatchUp);
    if(ticks>0)this.onTicks(ticks);
    return ticks;
  }
  reset():void {this.debt=0;}
}
