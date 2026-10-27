/** schema-1 canonical JSON: sorted keys, ASCII-escaped UTF-16 strings, safe integer numbers.
 * CRC32 detects accidental corruption only. It is NOT authentication or anti-cheat.
 */
export const CHECKSUM_ALGORITHM='crc32-ascii-json-v1';
function quote(value:string):string {return JSON.stringify(value).replace(/[\u007f-\uffff]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));}
export function canonicalJson(value:unknown):string {
  if(value===null)return 'null';
  if(typeof value==='boolean')return value?'true':'false';
  if(typeof value==='string')return quote(value);
  if(typeof value==='number'){if(!Number.isSafeInteger(value))throw new Error('Save numbers must be safe integers');return String(value);}
  if(Array.isArray(value)){
    if(Object.keys(value).length!==value.length)throw new Error('Sparse or extended save array');
    return '['+value.map(canonicalJson).join(',')+']';
  }
  if(typeof value==='object'){
    const object=value as Record<string,unknown>;
    if(Object.getPrototypeOf(object)!==Object.prototype&&Object.getPrototypeOf(object)!==null)throw new Error('Save must contain plain objects');
    return '{'+Object.keys(object).sort().map(key=>quote(key)+':'+canonicalJson(object[key])).join(',')+'}';
  }
  throw new Error('Unsupported value in save');
}
export function crc32Ascii(value:string):string {
  let crc=0xffffffff;
  for(let i=0;i<value.length;i++){
    const code=value.charCodeAt(i);if(code>127)throw new Error('CRC input must be ASCII');
    crc^=code;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  return ((crc^0xffffffff)>>>0).toString(16).padStart(8,'0');
}
export function checksum(value:unknown):string {return crc32Ascii(canonicalJson(value));}
