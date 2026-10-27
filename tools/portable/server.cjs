/** Offline friend playtest server. Node built-ins only; serves game assets, never runtime or source. */
'use strict';
const fs=require('node:fs');const fsp=require('node:fs/promises');const path=require('node:path');
const http=require('node:http');const crypto=require('node:crypto');const {execFile}=require('node:child_process');
const HOST='127.0.0.1',PORT=4187;
const TYPES={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf'};
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
function inventory(root){
 const result=[];
 function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.isSymbolicLink())throw Error('Package symlink rejected');const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(e.isFile())result.push(path.relative(root,p).split(path.sep).join('/'));else throw Error('Unsupported package entry');}}
 walk(root);return result.sort();
}
function verifyPackage(root){
 root=fs.realpathSync(root);
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'package-manifest.json'),'utf8'));
 if(manifest.format!==1||manifest.app!=='wasteland-bureau-friend-playtest'||manifest.version!=='0.4.1'||manifest.port!==PORT||!manifest.files||Array.isArray(manifest.files)||typeof manifest.files!=='object')throw Error('Invalid package manifest');
 const expected=Object.keys(manifest.files).sort();
 if(JSON.stringify(inventory(root))!==JSON.stringify([...expected,'package-manifest.json'].sort()))throw Error('Incomplete or modified package file set');
 for(const name of expected){
  if(!name||name.includes('\\')||name.split('/').some(p=>!p||p==='.'||p==='..')||path.posix.isAbsolute(name)||name.includes(':'))throw Error('Invalid manifest path');
  const e=manifest.files[name];if(!e||!Number.isSafeInteger(e.bytes)||e.bytes<0||!/^[a-f0-9]{64}$/.test(e.sha256))throw Error('Invalid manifest entry');
  const file=path.join(root,name);if(fs.statSync(file).size!==e.bytes||hash(fs.readFileSync(file))!==e.sha256)throw Error('Package integrity failed: '+name);
 }
 for(const name of ['game/index.html','runtime/node.exe','runtime/Node-LICENSE.txt','server.cjs','Start.cmd','开始试玩.cmd','试玩说明.txt','licenses/Cocos-Engine-LICENSE.txt'])if(!manifest.files[name])throw Error('Missing required file: '+name);
 return manifest;
}
function createGameServer(directory,marker){
 const root=fs.realpathSync(directory);
 return http.createServer(async(req,res)=>{
  const end=(code,body='',type='text/plain; charset=utf-8')=>{res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'});res.end(req.method==='HEAD'?undefined:body);};
  try{
   const port=res.socket.localPort;
   if(![HOST+':'+port,'localhost:'+port].includes(req.headers.host))return end(403,'Invalid host');
   if(!['GET','HEAD'].includes(req.method))return end(405,'Method not allowed');
   if(!req.url.startsWith('/')||req.url.startsWith('//'))return end(400,'Invalid URL');
   let decoded;try{decoded=decodeURIComponent(req.url.split('?')[0]);}catch{return end(400,'Invalid encoding');}
   if(decoded.includes('\\')||decoded.includes('\0')||decoded.split('/').some(p=>p==='.'||p==='..'))return end(403,'Forbidden path');
   if(decoded==='/__bureau_info')return end(200,JSON.stringify(marker),'application/json; charset=utf-8');
   if(decoded==='/favicon.ico')return end(204);
   const file=path.resolve(root,'.'+(decoded==='/'?'/index.html':decoded));
   const real=await fsp.realpath(file),rel=path.relative(root,real);
   if(!rel||rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))return end(403,'Forbidden');
   if(!(await fsp.stat(real)).isFile())return end(404,'Not found');
   if(req.method==='HEAD')return end(200,'',TYPES[path.extname(real)]||'application/octet-stream');
   const data=await fsp.readFile(real);return end(200,data,TYPES[path.extname(real)]||'application/octet-stream');
  }catch(e){return end(['ENOENT','ENOTDIR','EISDIR'].includes(e.code)?404:500,'Not found');}
 });
}
function browserOpen(url){
 // URL is fixed by this program, never composed from requests, arguments or remote data.
 execFile(path.join(process.env.SystemRoot||'C:\\Windows','System32','cmd.exe'),['/d','/c','start','',url],{windowsHide:true},error=>{if(error)console.log('请手动在浏览器打开：'+url);});
}
async function main(){
 if(process.argv.slice(2).some(a=>a!=='--no-open'))throw Error('Only --no-open is supported');
 if(process.platform!=='win32'||process.arch!=='x64')throw Error('This package requires Windows x64.');
 console.log('正在检查试玩包完整性，请稍候……');
 const manifest=verifyPackage(__dirname),identity=hash(fs.readFileSync(path.join(__dirname,'package-manifest.json')));
 const marker={app:manifest.app,version:manifest.version,packageId:identity};
 const server=createGameServer(path.join(__dirname,'game'),marker),url='http://'+HOST+':'+PORT;
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(PORT,HOST,resolve);});}
 catch(error){
  if(error.code!=='EADDRINUSE')throw error;
  const response=await fetch(url+'/__bureau_info',{signal:AbortSignal.timeout(2000)}).catch(()=>null);
  const existing=response?.ok?await response.json().catch(()=>null):null;
  if(!existing||existing.app!==marker.app||existing.packageId!==identity)throw Error('4187 端口被其他程序或不同版本占用，请关闭占用程序后再启动。本程序不会终止其他进程。');
  console.log('试玩包已经运行：'+url);if(!process.argv.includes('--no-open'))browserOpen(url);return;
 }
 console.log('废土装备局 0.4.1 朋友试玩版已启动：'+url+'\n请保留此窗口。退出游戏后按 Ctrl+C 停止服务。\n存档保存在浏览器；勿清除该站点的数据。');
 if(!process.argv.includes('--no-open'))browserOpen(url);
 process.once('SIGINT',()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
}
if(require.main===module)main().catch(e=>{console.error('启动失败：'+e.message);process.exitCode=1;});
module.exports={createGameServer,verifyPackage,inventory,hash,PORT};
