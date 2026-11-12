import test from 'node:test';
import assert from 'node:assert/strict';
const m=await import('../scopepay/model.mjs').catch(()=>({}));
const s=await import('../scopepay/subtitles.mjs').catch(()=>({}));
const f=await import('../scopepay/fixtures.mjs').catch(()=>({}));

test('live model requires configuration and errors never expose provider secrets',async()=>{
  assert.equal(typeof m.Model,'function','structured model adapter required');
  assert.throws(()=>new m.Model({mode:'live'}),/configuration/i);
  const model=new m.Model({mode:'live',baseURL:'https://models.example/v1',apiKey:'secret-test',name:'test',fetchImpl:async()=>{throw new Error('secret-test');}});
  await assert.rejects(model.call('seller','offer',{selection:{color:true,french:true,rush:true}},{used:0}),e=>!e.message.includes('secret-test')&&/provider/i.test(e.message));
});
test('fixture model is labeled, enforces schema and stops after eight shared calls',async()=>{
  assert.equal(typeof m.Model,'function','model adapter required');
  const model=new m.Model({mode:'fixture'}),budget={used:0};
  const result=await model.call('seller','offer',{selection:{color:true,french:true,rush:true}},budget);
  assert.equal(result.source,'fixture');assert.equal(result.value.selection.french,true);
  for(let i=1;i<8;i++)await model.call('seller','offer',{selection:{color:true,french:true,rush:true}},budget);
  await assert.rejects(model.call('seller','offer',{},budget),/limit/i);
  const invalid=new m.Model({mode:'live',baseURL:'https://models.example/v1',apiKey:'x',name:'x',fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({selection:{color:true,french:true,rush:true},reason:'x',price:1})}}]}))});
  await assert.rejects(invalid.call('seller','offer',{}, {used:0}),/schema/i);
});
test('SRT delivers actual French cues and rejects changed timing, empty cues or insufficient content',()=>{
  assert.equal(typeof s.validateSrt,'function','SRT validation required');
  assert.equal(s.validateSrt(f.SOURCE_SRT,f.FRENCH_SRT).cueCount,5);
  assert.throws(()=>s.validateSrt(f.SOURCE_SRT,f.FRENCH_SRT.replace('00:00:05,000','00:00:06,000')),/timing/i);
  assert.throws(()=>s.validateSrt(f.SOURCE_SRT,'1\n00:00:00,000 --> 00:00:05,000\n'),/empty|content/i);
  assert.throws(()=>s.validateSrt(f.SOURCE_SRT,f.FRENCH_SRT.replace(/Découvrez[^\n]+/,'x')),/content/i);
});
