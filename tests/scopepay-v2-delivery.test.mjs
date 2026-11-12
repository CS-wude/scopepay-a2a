import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryAction} from '../scopepay/v2-agent.mjs';
import {createIdentity,verifyDocument,digest} from '../scopepay/identity.mjs';
import {FRENCH_SRT} from '../scopepay/fixtures.mjs';
import {parseSrt,wrapSrt,validateSrt} from '../scopepay/subtitles.mjs';

test('subtitle reflow produces actual artifact with identical words and exact cue timing',()=>{
  const srt=wrapSrt(FRENCH_SRT);validateSrt(FRENCH_SRT,srt);
  const before=parseSrt(FRENCH_SRT),after=parseSrt(srt);
  for(let i=0;i<before.length;i++){assert.equal(before[i].text.replace(/\s+/g,' '),after[i].text.replace(/\s+/g,' '));assert.ok(after[i].text.split('\n').every(x=>x.length<=42));}
});

test('paid delivery repairs malformed structure on the original operation before signing',async()=>{
  let calls=0;const values=new Map(),identity=createIdentity('seller');
  const result=await deliveryAction({input:{type:'v2_deliver',runId:'run'},role:'seller',identity,
    store:{get:k=>values.get(k),set:(k,v)=>{values.set(k,v);return v;}},
    internal:async action=>{assert.equal(action,'v2_context');return {session:{candidate:{packageId:'standard'},domain:{packages:[{id:'standard',scope:['french']}]}},receipt:{state:'verified',transactionId:'original',agreementHash:'accepted'}};},
    model:{mode:'fixture',call:async()=>({value:{srt:++calls===1?'broken':FRENCH_SRT}})}});
  assert.equal(calls,2);const m=verifyDocument(result.manifest,identity.publicKey);assert.equal(m.transactionId,'original');assert.equal(m.srtHash,digest(FRENCH_SRT));
});
test('delivery never starts without verified original payment',async()=>{
  await assert.rejects(()=>deliveryAction({input:{type:'v2_deliver',runId:'r'},role:'seller',internal:async()=>({session:{},receipt:{state:'unknown'}})}),/Verified/);
});
