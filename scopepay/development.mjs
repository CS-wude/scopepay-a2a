import {startCluster} from './start.mjs';
const cluster=await startCluster({root:new URL('../.scopepay/v2-development/',import.meta.url).pathname,port:8990,buyerPort:8991,sellerPort:8992,modelMode:'fixture',paymentMode:'fixture',env:{PATH:process.env.PATH}});
console.log(`${cluster.url}/negotiate · deterministic negotiation · isolated fixture payment`);
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{await cluster.close();process.exit(0);});
