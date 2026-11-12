// Isolated deterministic acceptance workspace. Never silently substitutes for live models.
import {startCluster} from './start.mjs';
const c=await startCluster({root:new URL('../.scopepay/market-ui-acceptance/',import.meta.url).pathname,port:8997,buyerPort:8998,sellerPort:8999,modelMode:'fixture',paymentMode:'fixture',env:{PATH:process.env.PATH}});
console.log(c.url+'/market · deterministic test models / fixture payments');
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{await c.close();process.exit(0);});
