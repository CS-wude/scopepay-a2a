import test from 'node:test';
import assert from 'node:assert/strict';
import {runEvaluation} from '../scopepay/evaluate.mjs';
test('development benchmark protects bundled preference tradeoffs and owner boundaries',()=>{
  const report=runEvaluation();assert.equal(report.runs,180);
  assert.equal(report.rows.filter(r=>r.hardViolation).length,0);
  const bundles=report.groups.find(g=>g.id==='B6');assert.equal(bundles.pareto,30);assert.ok(bundles.meanScore>.85);
  assert.equal(report.groups.find(g=>g.id==='B3').agreed,0);
});
