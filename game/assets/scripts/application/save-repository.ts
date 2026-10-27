import { canonicalJson, checksum, CHECKSUM_ALGORITHM } from '../core/save-codec';
import { RNG_VERSION } from '../core/random';
import { StoragePort } from '../ports/storage';
export const SAVE_KEYS={current:'bureau.preview.v1.current',backup:'bureau.preview.v1.backup',pending:'bureau.preview.v1.pending'};
export type SaveSlot=keyof typeof SAVE_KEYS;
export interface SaveEnvelope<T> {
  schemaVersion:1; revision:number; contentVersion:string; rngVersion:string; installId:string;
  checksumAlgorithm:string; payload:T; extensions:Record<string,unknown>; checksum:string;
}
export interface LoadedSave<T> {envelope:SaveEnvelope<T>|null; source:SaveSlot|'new'; raw:Record<SaveSlot,string|null>; message:string;}
export class SaveError extends Error {
  constructor(readonly code:'future'|'corrupt'|'conflict'|'incompatible'|'storage'|'stale',message:string){super(message);this.name='SaveError';}
}
const slots:SaveSlot[]=['current','backup','pending'];
function plain(value:unknown):value is Record<string,unknown> {return value!==null&&typeof value==='object'&&!Array.isArray(value);}
export function sealSave<T>(body:Omit<SaveEnvelope<T>,'checksum'>):SaveEnvelope<T> {return {...body,checksum:checksum(body)};}
/** One-process serial commit with complete readback. No cross-process CAS / physical durability claim. */
export class SaveRepository<T> {
  private head:SaveEnvelope<T>|null=null;
  private loaded=false;
  private blocked=false;
  constructor(private readonly storage:StoragePort,readonly contentVersion:string,private readonly validatePayload:(value:unknown)=>void,private readonly compatibleVersions:readonly string[]=[]){}
  private read():Record<SaveSlot,string|null> {
    try{return {current:this.storage.get(SAVE_KEYS.current),backup:this.storage.get(SAVE_KEYS.backup),pending:this.storage.get(SAVE_KEYS.pending)};}
    catch{throw new SaveError('storage','无法读取本地存档；原数据未主动覆盖。');}
  }
  private decode(raw:string):SaveEnvelope<T> {
    const value:unknown=JSON.parse(raw);
    if(!plain(value)||value.schemaVersion!==1||!Number.isSafeInteger(value.revision)||(value.revision as number)<1||
      typeof value.installId!=='string'||!/^local-[a-z0-9-]{8,80}$/.test(value.installId)||
      value.checksumAlgorithm!==CHECKSUM_ALGORITHM||typeof value.checksum!=='string'||!plain(value.extensions))throw new Error('Invalid save envelope');
    const {checksum:expected,...body}=value;
    if(checksum(body)!==expected)throw new Error('Checksum mismatch');
    if((value.contentVersion!==this.contentVersion&&!this.compatibleVersions.includes(value.contentVersion as string))||value.rngVersion!==RNG_VERSION)throw new SaveError('incompatible','存档内容或随机算法版本不兼容；请使用匹配版本。');
    this.validatePayload(value.payload);return value as unknown as SaveEnvelope<T>;
  }
  load():LoadedSave<T> {
    this.blocked=true;
    const raw=this.read();
    // Inspect ALL slots for future schema before checksum / payload validation.
    for(const slot of slots){try{const v=raw[slot]===null?null:JSON.parse(raw[slot]!);if(plain(v)&&typeof v.schemaVersion==='number'&&v.schemaVersion>1)throw new SaveError('future','发现较新版本存档；停止写入，请升级程序。');}catch(error){if(error instanceof SaveError)throw error;}}
    const valid:{slot:SaveSlot;envelope:SaveEnvelope<T>}[]=[];
    let incompatible:SaveError|null=null;
    for(const slot of slots){if(raw[slot]===null)continue;try{valid.push({slot,envelope:this.decode(raw[slot]!)});}catch(error){if(error instanceof SaveError&&error.code==='incompatible')incompatible=error;}}
    if(incompatible)throw incompatible;
    if(!valid.length){
      if(slots.some(slot=>raw[slot]!==null))throw new SaveError('corrupt','全部存档无法验证；原始数据已保留，未静默重置。');
      this.head=null;this.loaded=true;this.blocked=false;return {envelope:null,source:'new',raw,message:'本地存档就绪；暂无历史工单。'};
    }
    const ids=new Set(valid.map(v=>v.envelope.installId));if(ids.size!==1)throw new SaveError('conflict','存档身份冲突；停止写入，保留各槽。');
    for(let i=0;i<valid.length;i++)for(let j=i+1;j<valid.length;j++){
      if(valid[i].envelope.revision===valid[j].envelope.revision&&canonicalJson(valid[i].envelope)!==canonicalJson(valid[j].envelope))throw new SaveError('conflict','同修订号存档内容冲突；停止写入。');
    }
    valid.sort((a,b)=>b.envelope.revision-a.envelope.revision||slots.indexOf(a.slot)-slots.indexOf(b.slot));
    const chosen=valid[0];this.head=chosen.envelope;this.loaded=true;this.blocked=false;
    return {envelope:this.head,source:chosen.slot,raw,message:chosen.slot==='current'?'已恢复本地工单。':chosen.slot==='pending'?'已从中断提交恢复；不会重复领取金币。':'已从备份恢复，可能回退最近进度。'};
  }
  get revision():number {return this.head?.revision||0;}
  private writeVerified(slot:SaveSlot,envelope:SaveEnvelope<T>):void {
    const encoded=canonicalJson(envelope);this.storage.set(SAVE_KEYS[slot],encoded);
    const readback=this.storage.get(SAVE_KEYS[slot]);
    if(readback===null||canonicalJson(this.decode(readback))!==encoded)throw new Error('Save readback mismatch: '+slot);
  }
  commit(payload:T,installId:string,baseRevision:number):SaveEnvelope<T> {
    if(!this.loaded||this.blocked)throw new SaveError('storage','存档未就绪；请重新读取恢复。');
    if(baseRevision!==this.revision)throw new SaveError('stale','存档修订号已变化；拒绝旧快照。');
    this.validatePayload(payload);
    const previous=this.head;
    if(previous&&previous.installId!==installId)throw new SaveError('conflict','禁止覆盖其他存档身份。');
    const revision=this.revision+1;if(!Number.isSafeInteger(revision))throw new SaveError('stale','存档修订号已耗尽。');
    const next=sealSave({schemaVersion:1,revision,contentVersion:this.contentVersion,rngVersion:RNG_VERSION,installId,checksumAlgorithm:CHECKSUM_ALGORITHM,payload,extensions:previous?.extensions||{}});
    this.decode(canonicalJson(next));
    // Re-read before writing. Detect ordinary stale tabs; not an atomic cross-process lock.
    const disk=this.read();const old=previous?canonicalJson(previous):null;
    const observed=slots.map(slot=>disk[slot]).filter(value=>value!==null);
    for(const text of observed){try{const parsed=JSON.parse(text!);if(plain(parsed)&&typeof parsed.schemaVersion==='number'&&parsed.schemaVersion>1)throw new SaveError('future','另一程序写入新版存档；停止写入。');const env=this.decode(text!);if(env.installId!==installId||env.revision>baseRevision||(env.revision===baseRevision&&canonicalJson(env)!==old))throw new SaveError('conflict','其他页面修改了存档；停止写入并重新读取。');}catch(error){if(error instanceof SaveError)throw error;}}
    if(previous&&!observed.some(text=>{try{return canonicalJson(this.decode(text!))===old;}catch{return false;}}))throw new SaveError('conflict','已验证存档被外部移除；拒绝覆盖。');
    if(!previous&&observed.length)throw new SaveError('conflict','初始化后发现新存档；先重新读取。');
    this.blocked=true;
    try{
      // Do not rewrite the only verified backup during fallback recovery.
      const backupAlreadyValid=previous&&disk.backup!==null&&(()=>{try{return canonicalJson(this.decode(disk.backup!))===old;}catch{return false;}})();
      if(previous&&!backupAlreadyValid)this.writeVerified('backup',previous);
      this.writeVerified('pending',next);
      this.writeVerified('current',next);
      this.head=next;this.blocked=false;
      // A verified current commit is already successful even if candidate cleanup fails.
      try{this.storage.remove(SAVE_KEYS.pending);}catch{}
      return next;
    }catch{throw new SaveError('storage','本次保存未确认；游戏已暂停。请重新读取各槽恢复，勿重复发奖。');}
  }
}
