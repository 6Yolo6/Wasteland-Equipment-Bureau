/** Synchronous local key/value capability. Errors must propagate, never masquerade as success. */
export interface StoragePort {
  get(key:string):string|null;
  set(key:string,value:string):void;
  remove(key:string):void;
}
export interface NativeKeyValue {
  getItem(key:string):string|null;
  setItem(key:string,value:string):void;
  removeItem(key:string):void;
}
