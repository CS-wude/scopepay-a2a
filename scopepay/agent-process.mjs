import {readFileSync} from 'node:fs';
import {startAgent} from './agent.mjs';
import {Model} from './model.mjs';
const config=JSON.parse(readFileSync(process.argv[2],'utf8'));
const model=new Model({mode:config.modelMode,baseURL:process.env.MODEL_BASE_URL,apiKey:process.env.MODEL_API_KEY,name:process.env.MODEL_NAME});
try{
  const agent=await startAgent({...config,model});
  process.send?.({type:'ready',role:config.role,url:agent.url,pid:process.pid});
  let closing=false;async function close(){if(closing)return;closing=true;await agent.close();process.exit(0);}
  process.on('SIGTERM',close);process.on('SIGINT',close);
  process.on('disconnect',()=>{const timer=setTimeout(()=>process.exit(0),2000);timer.unref();close();});
}catch{process.send?.({type:'error',role:config.role});process.exitCode=1;}
