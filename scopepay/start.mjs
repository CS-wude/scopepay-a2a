import {fork} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,openSync,closeSync,unlinkSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {Store} from './store.mjs';
import {loadIdentity} from './identity.mjs';
import {Model} from './model.mjs';
import {BraintreePSP,FixturePSP,PaymentService} from './payment.mjs';
import {requestAgent} from './agent.mjs';
import {createApp} from './app.mjs';
import {lanAddresses} from './network.mjs';

export function agentEnvironment(env){
  const allowed=['PATH','TMPDIR','TEMP','TMP','LANG','LC_ALL','MODEL_BASE_URL','MODEL_API_KEY','MODEL_NAME','HTTP_PROXY','HTTPS_PROXY','NO_PROXY','NODE_USE_ENV_PROXY','SSL_CERT_FILE','NODE_EXTRA_CA_CERTS'];
  return Object.fromEntries(allowed.filter(k=>env[k]!==undefined).map(k=>[k,env[k]]));
}
export async function startCluster(options={}){
  const env=options.env??process.env,modelMode=options.modelMode??env.SCOPEPAY_MODEL_MODE??'fixture',paymentMode=options.paymentMode??env.SCOPEPAY_PAYMENT_MODE??'fixture';
  if(!['fixture','sandbox'].includes(paymentMode))throw new Error('Only fixture or sandbox payments are supported');
  new Model({mode:modelMode,baseURL:env.MODEL_BASE_URL,apiKey:env.MODEL_API_KEY,name:env.MODEL_NAME});
  const root=options.root??fileURLToPath(new URL(`../.scopepay/${paymentMode}-${modelMode}/`,import.meta.url));mkdirSync(root,{recursive:true,mode:0o700});
  const lock=join(root,'cluster.lock');
  if(existsSync(lock)){
    const owner=Number(readFileSync(lock,'utf8'));let alive=true;try{process.kill(owner,0);}catch(e){if(e.code==='ESRCH')alive=false;}
    if(alive)throw new Error('ScopePay instance is already running for this data directory');unlinkSync(lock);
  }
  const fd=openSync(lock,'wx',0o600);writeFileSync(fd,String(process.pid));closeSync(fd);
  let store,server;const children=[];let closing=false;
  const close=async()=>{
    if(closing)return;closing=true;
    await Promise.all(children.map(child=>new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);child.kill('SIGTERM');setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL');resolve();},3000).unref();})));
    if(server)await new Promise(r=>server.close(r));store?.close();try{unlinkSync(lock);}catch{}
  };
  try{
    const identities={buyer:loadIdentity(join(root,'buyer'),'buyer'),seller:loadIdentity(join(root,'seller'),'seller')};
    const publicIdentities=Object.fromEntries(Object.entries(identities).map(([r,i])=>[r,{id:i.id,publicKey:i.publicKey}]));
    const tokens={buyer:randomBytes(32).toString('hex'),seller:randomBytes(32).toString('hex')},buyerToken=randomBytes(32).toString('hex'),sellerToken=randomBytes(32).toString('hex');
    store=new Store(join(root,'main.sqlite'));const psp=options.psp??(paymentMode==='sandbox'?new BraintreePSP(env):new FixturePSP());
    const payments=new PaymentService({store,psp,identities:publicIdentities});
    const metadata={modelMode,paymentMode,agents:[],startedAt:new Date().toISOString()};let buyerURL;
    const host=options.host??'127.0.0.1';if(!['127.0.0.1','0.0.0.0'].includes(host))throw new Error('Invalid listen host');
    const app=createApp({store,payments,identities:publicIdentities,tokens,metadata,allowedAddresses:['127.0.0.1',...(host==='0.0.0.0'?lanAddresses():[])],modelEnv:{...env,SCOPEPAY_MODEL_MODE:modelMode},driver:run=>requestAgent(buyerURL,buyerToken,{type:'start',runId:run.id},run.id),turn:(role,input,id)=>requestAgent(metadata.agents.find(a=>a.role===role).url,role==='buyer'?buyerToken:sellerToken,input,id)});
    server=await new Promise((resolve,reject)=>{const s=app.listen(options.port??Number(env.SCOPEPAY_PORT??8980),host,()=>resolve(s));s.once('error',reject);});
    const url=`http://127.0.0.1:${server.address().port}`;
    async function launch(role,extra){
      const peer=publicIdentities[role==='buyer'?'seller':'buyer'];
      const config={role,identity:identities[role],peer,modelMode,taskFile:join(root,role,'tasks.sqlite'),paymentURL:url,internalToken:tokens[role],...extra};
      const configFile=join(root,role,'runtime.json');writeFileSync(configFile,JSON.stringify(config),{mode:0o600});
      const child=fork(fileURLToPath(new URL('./agent-process.mjs',import.meta.url)),[configFile],{env:agentEnvironment(env),stdio:['ignore','ignore','ignore','ipc']});children.push(child);
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error(`${role} startup timed out`)),15000);
        child.once('message',msg=>{clearTimeout(timer);if(msg.type==='ready')resolve(msg);else reject(new Error(`${role} startup failed`));});
        child.once('exit',()=>{clearTimeout(timer);reject(new Error(`${role} stopped during startup`));});
      });
    }
    const seller=await launch('seller',{port:options.sellerPort??Number(env.SCOPEPAY_SELLER_PORT??8982),incomingToken:sellerToken});
    const buyer=await launch('buyer',{port:options.buyerPort??Number(env.SCOPEPAY_BUYER_PORT??8981),incomingToken:buyerToken,sellerURL:seller.url,sellerToken});buyerURL=buyer.url;
    metadata.agents.push(buyer,seller);
    for(const child of children)child.on('exit',()=>{if(!closing){store.setSetting('paused',true);metadata.agentError='An agent process stopped. New payments paused; restart the app after reviewing records.';}});
    return {url,store,payments,metadata,close};
  }catch(e){await close();throw e;}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const envFile=new URL('../.env',import.meta.url);if(existsSync(envFile))process.loadEnvFile(envFile);
  try{
    const cluster=await startCluster();console.log(`ScopePay A2A: ${cluster.url} · model=${cluster.metadata.modelMode} · payments=${cluster.metadata.paymentMode}`);
    process.on('SIGINT',async()=>{await cluster.close();process.exit(0);});process.on('SIGTERM',async()=>{await cluster.close();process.exit(0);});
  }catch(e){console.error(/already running|Only fixture|configuration|startup|EADDRINUSE/.test(e.message)?e.message:'ScopePay startup failed; inspect configuration and local port availability.');process.exitCode=1;}
}
