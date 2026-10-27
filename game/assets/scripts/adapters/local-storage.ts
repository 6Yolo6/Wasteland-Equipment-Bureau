import { NativeKeyValue, StoragePort } from '../ports/storage';
/** Inject cc.sys.localStorage in the composition root; no DOM or platform detection here. */
export class LocalStorageAdapter implements StoragePort {
  constructor(private readonly storage:NativeKeyValue){}
  get(key:string):string|null {const value=this.storage.getItem(key);if(value!==null&&typeof value!=='string')throw new Error('Storage returned a non-string');return value;}
  set(key:string,value:string):void {this.storage.setItem(key,value);}
  remove(key:string):void {this.storage.removeItem(key);}
}
