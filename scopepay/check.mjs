import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const files=[...readdirSync('scopepay').filter(f=>f.endsWith('.mjs')).map(f=>'scopepay/'+f),...readdirSync('scopepay/public').filter(f=>/\.(?:js|mjs)$/.test(f)).map(f=>'scopepay/public/'+f)];
for(const file of files){const r=spawnSync(process.execPath,['--check',file],{stdio:'pipe'});if(r.status!==0){console.error(`Syntax check failed: ${file}`);process.exit(1);}}
console.log(`ScopePay syntax checks passed: ${files.length} modules`);
