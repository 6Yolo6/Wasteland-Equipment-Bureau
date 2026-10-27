'use strict';
const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');const local=JSON.parse(fs.readFileSync(path.join(root,'toolchains.local.json'),'utf8'));
const ts=require(path.join(path.dirname(local.creator),'resources/resources/3d/engine/node_modules/typescript/lib/typescript.js'));
const config=ts.parseJsonConfigFileContent({compilerOptions:{target:'ES2019',module:'ESNext',lib:['ES2019','DOM'],strict:true,noEmit:true,experimentalDecorators:true,moduleResolution:'node',skipLibCheck:true,types:[]},include:['game/assets/scripts/**/*.ts','verification/EngineSmoke/temp/declarations/*.d.ts']},ts.sys,root);
const program=ts.createProgram(config.fileNames,config.options);const diagnostics=[...config.errors,...ts.getPreEmitDiagnostics(program)];
const text=diagnostics.length?ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>root,getNewLine:()=> '\n'}):'Cocos 3.8.8 declaration typecheck passed with TypeScript '+ts.version+'. This is not runtime verification.\n';
process.stdout.write(text);fs.mkdirSync(path.join(root,'logs/phase-2'),{recursive:true});fs.writeFileSync(path.join(root,'logs/phase-2/cocos-typecheck-latest.log'),text);process.exitCode=diagnostics.length?1:0;
