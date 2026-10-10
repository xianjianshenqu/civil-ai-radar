import {spawn,spawnSync} from 'node:child_process';
import {access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const venv=path.join(root,'.runtime/translate-venv');
const python=path.join(venv,'bin/python');
const script=path.join(root,'scripts/argos-translate-server.py');
function run(command,args) {
  const result=spawnSync(command,args,{stdio:'inherit',cwd:root});
  if(result.status!==0)process.exit(result.status||1);
}
try {await access(python);}
catch {
  const interpreter=['python3.12','python3'].find(name=>spawnSync(name,['-c','import sys; raise SystemExit(0 if sys.version_info>=(3,10) else 1)']).status===0);
  if(!interpreter){
    console.error('Need Python 3.10+. On macOS: brew install python@3.12');
    process.exit(1);
  }
  run(interpreter,['-m','venv',venv]);
}
if(spawnSync(python,['-c','import argostranslate']).status!==0)run(python,['-m','pip','install','argostranslate']);
const child=spawn(python,[script],{stdio:'inherit',env:process.env,cwd:root});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??1));
