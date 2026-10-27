'use strict';
// Read-only gates: reject stale/incomplete evidence before starting a browser.
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');const crypto=require('node:crypto');
const excluded=new Set(['node_modules','bin','obj','dist','target','.git']);
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function contained(root,file){
 const base=fs.realpathSync(root),resolved=fs.realpathSync(file),relative=path.relative(base,resolved);
 assert(relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative),'Evidence path leaves its declared root: '+file);
 return resolved;
}
function files(root,predicate=()=>true){
 const out=[];
 function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(excluded.has(e.name))continue;const file=path.join(dir,e.name);contained(root,file);assert(!e.isSymbolicLink(),'Symlink not allowed in evidence: '+file);if(e.isDirectory())walk(file);else if(e.isFile()&&predicate(file))out.push(path.relative(root,file).split(path.sep).join('/'));}}
 walk(root);return out.sort();
}
function object(value,label){assert(value&&typeof value==='object'&&!Array.isArray(value),label+' must be an object');}
function sameSet(a,b,label){assert.deepEqual(a.slice().sort(),b.slice().sort(),label+' complete file set mismatch');}
function verifySources(base,manifest,actual,label){
 object(manifest,label);sameSet(Object.keys(manifest),actual,label);
 for(const [relative,hash] of Object.entries(manifest)){assert(/^[0-9a-f]{64}$/.test(hash),'Invalid hash: '+relative);const file=contained(base,path.join(base,relative));assert.equal(sha(file),hash,'Stale '+label+': '+relative);}
}
function verifyBuildEvidence(root,build){
 assert.equal(build.status,'BUILD_PASSED','Creator build has not passed');
 const game=path.join(root,'game'),assets=path.join(game,'assets'),logs=contained(path.join(root,'logs'),build.logs);
 const sourceManifest=JSON.parse(fs.readFileSync(path.join(logs,'source-manifest.json'),'utf8'));
 const actual=files(assets,file=>['.ts','.scene'].includes(path.extname(file))).map(file=>'assets/'+file).concat(files(path.join(game,'settings'),file=>path.extname(file)==='.json').map(file=>'settings/'+file),'package.json');
 assert(actual.includes('assets/scripts/content/catalog.ts'),'Missing catalog source');assert(actual.includes('assets/scripts/presentation/BureauRoot.ts'),'Missing scene controller source');
 verifySources(game,sourceManifest,actual,'Creator source');
 const index=contained(path.join(game,'build'),build.index_html);assert.equal(path.basename(index),'index.html','Expected build index');const output=path.dirname(index);
 const manifest=JSON.parse(fs.readFileSync(path.join(logs,'build-manifest.json'),'utf8'));object(manifest,'Build manifest');sameSet(Object.keys(manifest),files(output),'Build output');
 let bytes=0;for(const [relative,entry] of Object.entries(manifest)){object(entry,'Output entry');assert(Number.isSafeInteger(entry.bytes)&&entry.bytes>=0,'Invalid byte count');assert(/^[0-9a-f]{64}$/.test(entry.sha256),'Invalid output hash');const file=contained(output,path.join(output,relative));assert.equal(fs.statSync(file).size,entry.bytes,'Build output size: '+relative);assert.equal(sha(file),entry.sha256,'Build output hash: '+relative);bytes+=entry.bytes;}
 assert.equal(build.files,Object.keys(manifest).length,'Build file count');assert.equal(build.bytes,bytes,'Build total bytes');assert.equal(build.source_unchanged_during_build,true,'Source changed during Creator build');
 return {output,logs,sourceFiles:actual.length,buildFiles:build.files,bytes};
}
function verifyCompiledEvidence(root){
 const game=path.join(root,'game'),output=path.join(root,'.test-build');const manifest=JSON.parse(fs.readFileSync(path.join(output,'compilation-manifest.json'),'utf8'));object(manifest.sources,'Compiled sources');object(manifest.outputs,'Compiled output');
 // All non-engine TS files are in the pure program; BureauRoot alone imports cc.
 const actual=files(path.join(game,'assets','scripts'),file=>path.extname(file)==='.ts'&&path.basename(file)!=='BureauRoot.ts').map(file=>'assets/scripts/'+file);
 verifySources(game,manifest.sources,actual,'pure compilation source');verifySources(output,manifest.outputs,files(output,file=>path.extname(file)==='.js'),'pure compilation output');
 return {compiler:manifest.compiler,sourceFiles:actual.length,outputFiles:Object.keys(manifest.outputs).length};
}
module.exports={verifyBuildEvidence,verifyCompiledEvidence,files,sha};
