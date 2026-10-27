'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto=require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const configPath = path.join(root, 'toolchains.local.json');
const local = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath,'utf8')) : {};
const compilerCandidates = [
  local.typescript && path.resolve(local.typescript),
  path.join(root,'node_modules','typescript'),
  local.creator && path.join(path.dirname(local.creator),'resources','resources','3d','engine','node_modules','typescript'),
].filter(Boolean);
const tsDir = compilerCandidates.find(p=>fs.existsSync(path.join(p,'lib','typescript.js')));
if (!tsDir) throw new Error('TypeScript compiler missing. Configure typescript in toolchains.local.json (validated baseline 4.9.5).');
const ts = require(path.join(tsDir,'lib','typescript.js'));
const logRoot = path.join(root,'logs','phase-2'); fs.mkdirSync(logRoot,{recursive:true});
const stamp = new Date().toISOString().replace(/[:.]/g,'-');
let transcript = 'TypeScript '+ts.version+'\n';
function output(s) { transcript += s; process.stdout.write(s); }
const exclusions = new Set(['node_modules','bin','obj','dist','target','.git']);
function walk(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>exclusions.has(e.name)?[]:e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]); }
function checkBoundaries() {
  const violations=[];
  for (const file of walk(path.join(root,'game','assets','scripts')).filter(f=>f.endsWith('.ts')&&!f.includes(path.sep+'presentation'+path.sep))) {
    const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    const banned = new Set(['window','document','localStorage','sessionStorage','tap','cc','Date','setTimeout','setInterval','requestAnimationFrame','fetch','XMLHttpRequest']);
    function visit(node) {
      if (ts.isIdentifier(node) && banned.has(node.text) && !(ts.isPropertyAssignment(node.parent)&&node.parent.name===node)) violations.push(path.relative(root,file)+': forbidden runtime '+node.text);
      if (ts.isPropertyAccessExpression(node)&&node.expression.getText(source)==='Math'&&node.name.text==='random') violations.push(path.relative(root,file)+': Math.random');
      if (ts.isImportDeclaration(node)) {
        const spec=node.moduleSpecifier.text;
        if (!spec.startsWith('.') || /presentation|adapters/.test(spec)) violations.push(path.relative(root,file)+': forbidden import '+spec);
      }
      ts.forEachChild(node,visit);
    }
    visit(source);
  }
  if (violations.length) throw new Error(violations.join('\n'));
}
let code=1;
try {
  checkBoundaries(); output('AST dependency/runtime boundary check passed.\n');
  const config=ts.readConfigFile(path.join(root,'tsconfig.core.json'),ts.sys.readFile);
  if(config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText,'\n'));
  const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,root);
  const program=ts.createProgram(parsed.fileNames,parsed.options);
  const result=program.emit();
  const diagnostics=[...parsed.errors,...ts.getPreEmitDiagnostics(program),...result.diagnostics];
  if (diagnostics.length) { output(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>root,getNewLine:()=> '\n'})); }
  else {
    output('Strict core TypeScript compilation passed.\n');
    const game=path.join(root,'game'),compiled=path.join(root,'.test-build');
    const sourceFiles=program.getSourceFiles().map(source=>path.resolve(source.fileName)).filter(file=>{const relative=path.relative(game,file);return relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);});
    const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const sources=Object.fromEntries(sourceFiles.map(file=>[path.relative(game,file).split(path.sep).join('/'),hash(file)]));
    const outputs=Object.fromEntries(sourceFiles.filter(file=>!file.endsWith('.d.ts')).map(file=>{const rel=path.relative(path.join(game,'assets','scripts'),file).replace(/\.ts$/,'.js').split(path.sep).join('/');return [rel,hash(path.join(compiled,rel))];}));
    fs.writeFileSync(path.join(compiled,'compilation-manifest.json'),JSON.stringify({compiler:ts.version,sources,outputs},null,2)+'\n');
    if (process.argv.includes('--check-only')) code=0;
    else {
      const files=walk(path.join(root,'game','tests')).filter(p=>p.endsWith('.test.cjs')).sort();
      if(!files.length) throw new Error('No tests found; refusing false pass');
      const test=spawnSync(local.node || process.execPath,['--test','--test-reporter=tap',...files],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024,windowsHide:true});
      output(test.stdout || ''); output(test.stderr || '');
      if(test.error) throw test.error;
      code=test.status===0?0:1;
    }
  }
} catch(e) { output(String(e.stack || e)+'\n'); }
fs.writeFileSync(path.join(logRoot,'core-tests-'+stamp+'.log'),transcript);
const checkOnly=process.argv.includes('--check-only');
const count=(name)=>Number((transcript.match(new RegExp('^# '+name+' ([0-9]+)$','m'))||[])[1]||0);
fs.writeFileSync(path.join(logRoot,checkOnly?'core-check-latest.json':'core-tests-latest.json'),JSON.stringify({at:new Date().toISOString(),compiler:ts.version,mode:checkOnly?'compile-only':'unit-tests',exitCode:code,tests:count('tests'),passed:count('pass'),failed:count('fail'),log:'core-tests-'+stamp+'.log',scope:'Pure logic/controller only; not engine build, browser or TapTap validation'},null,2)+'\n');
process.exitCode=code;
