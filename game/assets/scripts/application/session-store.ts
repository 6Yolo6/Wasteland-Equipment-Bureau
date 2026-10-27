import { compatibleContentVersions } from '../content/catalog';
import { GameContent } from '../core/types';
import { SessionState } from './session';
import { SaveRepository } from './save-repository';
import { RewardReceipt, SessionSave, validateSessionSave } from './save-validation';
import { StoragePort } from '../ports/storage';
export class SessionStore {
  readonly repository:SaveRepository<SessionSave>;
  installId:string;
  tutorialSeen=false; seed=20261015; starter='I01';
  message='本地存档就绪。';
  private ledger:RewardReceipt[]=[];
  private savedTick=-1;
  constructor(storage:StoragePort,content:GameContent,newInstallId:string){
    this.installId=newInstallId;
    this.repository=new SaveRepository(storage,content.version,value=>validateSessionSave(value,content),compatibleContentVersions(content));
  }
  load():SessionState|null {
    const loaded=this.repository.load();this.message=loaded.message;
    if(!loaded.envelope){this.ledger=[];this.savedTick=-1;return null;}
    const envelope=loaded.envelope,payload=envelope.payload;
    this.installId=envelope.installId;
    if(payload.session.run&&!payload.session.run.id.startsWith(this.installId+'-run-'))throw new Error('存档安装身份与工单不一致。');
    if(payload.rewardLedger.some(receipt=>!receipt.runId.startsWith(this.installId+'-run-')))throw new Error('奖励账本安装身份不一致。');
    this.ledger=payload.rewardLedger;this.tutorialSeen=payload.tutorialSeen;this.seed=payload.seed;this.starter=payload.starter;
    this.savedTick=payload.session.run?.combat?.tick??-1;
    return payload.session;
  }
  save(state:SessionState,checkpoint=true):void {
    const tick=state.run?.phase==='combat'?state.run.combat!.tick:-1;
    // Commands/boundaries always save; foreground combat checkpoints at most one simulated second apart.
    if(!checkpoint&&tick>=0&&this.savedTick>=0&&tick-this.savedTick<10)return;
    const ledger=this.ledger.slice(),settlement=state.run?.settlement;
    if(settlement?.claimed&&!ledger.some(receipt=>receipt.key===settlement.key))ledger.push({key:settlement.key,runId:state.run!.id,amount:settlement.baseCoins});
    const payload:SessionSave={session:state,rewardLedger:ledger,tutorialSeen:this.tutorialSeen,seed:this.seed,starter:this.starter};
    this.repository.commit(payload,this.installId,this.repository.revision);
    this.ledger=ledger;this.savedTick=tick;this.message='本地已保存 · 修订 '+this.repository.revision;
  }
}
