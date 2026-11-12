import {existsSync} from 'node:fs';
import {startCluster} from './start.mjs';
const envFile=new URL('../.env',import.meta.url);if(existsSync(envFile))process.loadEnvFile(envFile);
const cluster=await startCluster({root:new URL('../.scopepay/v2-live-development/',import.meta.url).pathname,host:'0.0.0.0',port:8994,buyerPort:8995,sellerPort:8996,modelMode:'live',paymentMode:'fixture',env:process.env});
console.log(`${cluster.url}/negotiate · live model assistance · isolated fixture payment`);
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{await cluster.close();process.exit(0);});
