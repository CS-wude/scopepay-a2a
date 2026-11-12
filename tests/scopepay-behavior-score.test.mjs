import test from 'node:test';import assert from 'node:assert/strict';
import {dominatedCounteroffers} from '../scopepay/behavior-score.mjs';
const terms={scope:'海报',deliverable:'PNG与源文件',deliveryHours:24,acceptance:['一轮修改']};
const pair=(buyerPrice,buyerTerms=terms)=>[{payload:{sequence:3,actor:'seller',action:'offer',terms:{...terms,amountMinor:1600}}},{payload:{sequence:4,actor:'buyer',action:'offer',terms:{...buyerTerms,amountMinor:buyerPrice}}}];
test('flags raising a counteroffer for the exact same package',()=>{assert.equal(dominatedCounteroffers(pair(1800)).length,1);});
test('does not penalize a buyer paying more for additional scope',()=>{assert.deepEqual(dominatedCounteroffers(pair(1800,{...terms,deliverable:'PNG、源文件及额外海报'})),[]);});
test('normal concessions and acceptance are not dominated counteroffers',()=>{assert.deepEqual(dominatedCounteroffers(pair(1400)),[]);const messages=pair(1600);messages[1].payload.action='accept';assert.deepEqual(dominatedCounteroffers(messages),[]);});
