'use strict';
const fs=require('node:fs/promises');const path=require('node:path');const http=require('node:http');
const TYPES={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf'};
function createLocalServer(directory,onError=()=>{}) {
  const root=path.resolve(directory);
  return http.createServer(async(req,res)=>{
    try {
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
      const url=new URL(req.url,'http://127.0.0.1');if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
      const pathname=decodeURIComponent(url.pathname);const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
      const real=await fs.realpath(file);const relative=path.relative(root,real);
      if(!relative||relative.startsWith('..')||path.isAbsolute(relative)){res.writeHead(403);res.end();return;}
      const data=await fs.readFile(real);res.writeHead(200,{'Content-Type':TYPES[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:data);
    }catch(error){onError({url:req.url,error:error.code||error.message});res.writeHead(404);res.end('Not found');}
  });
}
module.exports={createLocalServer};
