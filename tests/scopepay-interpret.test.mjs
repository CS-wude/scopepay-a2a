import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretRequest} from '../scopepay/interpret.mjs';
const env={SCOPEPAY_MODEL_MODE:'live',MODEL_BASE_URL:'https://model.example/v1',MODEL_API_KEY:'private-test',MODEL_NAME:'model'};
test('interpretation validates structured intent and sends neither authorization nor costs',async()=>{
  let body;
  const intent={french:true,color:true,rush:true,mandatoryToday:false,extraSeconds:0,uncertain:false,wrap:false};
  const v=await interpretRequest('调蓝 加法语 最好今晚',env,async(_url,opts)=>{body=JSON.parse(opts.body);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(intent)}}]}));});
  assert.deepEqual(v,intent);assert.equal(JSON.stringify(body).includes('private-test'),false);assert.equal(JSON.stringify(body).includes('capMinor'),false);
});
test('invalid/provider model output stops interpretation without fallback or secret exposure',async()=>{
  for(const content of ['not json',JSON.stringify({french:true,capMinor:999999}),JSON.stringify({french:true,color:false,rush:false,mandatoryToday:true,extraSeconds:0,uncertain:false})]){
    await assert.rejects(()=>interpretRequest('test',env,async()=>new Response(JSON.stringify({choices:[{message:{content}}]}))),/interpretation failed/);
  }
  await assert.rejects(()=>interpretRequest('test',env,async()=>{throw new Error('private-test');}),e=>!e.message.includes('private-test'));
  assert.equal(await interpretRequest('test',{}),null);
});
