import {verifyDocument} from './identity.mjs';
import {validateQuote,validateTaskSelection} from './domain.mjs';
import {CASES} from './fixtures.mjs';

// This surface is loopback-only, role authenticated, and never exposed to the browser.
export function mountGateway(app,{store,payments,identities,tokens,v2}){
  app.use('/internal',(req,res,next)=>{
    const role=Object.keys(tokens).find(r=>req.headers.authorization===`Bearer ${tokens[r]}`);
    if(!role)return res.status(401).json({error:'Agent authentication required'});
    req.agentRole=role;next();
  });
  app.post('/internal/:action',async(req,res)=>{
    try{
      const {runId}=req.body??{},run=store.getRun(runId);
      if(!run)throw new Error('Run not found');
      const role=req.agentRole,project=store.getProject(run.projectId);
      if(req.params.action==='v2_context'&&v2)return res.json(v2.context(runId,role));
      if(req.params.action==='v2_call'&&v2)return res.json(v2.consume(runId));
      if(req.params.action==='context'){
        const op=store.paymentForRun(runId);
        return res.json({run:{id:run.id,projectId:run.projectId,caseId:run.caseId,requestedSelection:run.requestedSelection??CASES[run.caseId]?.selection,modelMode:run.modelMode},project,policy:store.getPolicy(role),catalog:store.getPolicy('seller'),receipt:op?.receipt??null,payment:op?{operationId:op.id,state:op.state}:null});
      }
      if(req.params.action==='call'){
        const used=store.consumeModelCall(runId);return res.json({used});
      }
      if(req.params.action==='event'){
        const event=req.body.event;
        if(!event||!['a2a','quote','decision','delivery','review','authorization'].includes(event.type)||JSON.stringify(event).length>4000)throw new Error('Invalid event');
        store.event(runId,{...event,agent:role});return res.json({ok:true});
      }
      if(req.params.action==='quote'){
        if(role!=='seller')throw new Error('Seller role required');
        const q=verifyDocument(req.body.quote,identities.seller.publicKey);
        if(q.changeId!==runId||q.projectId!==run.projectId||q.buyerId!=='buyer'||q.sellerId!=='seller')throw new Error('Quote run binding mismatch');
        validateQuote(q,{project,sellerPolicy:store.getPolicy('seller')});
        validateTaskSelection(q.selection,run.requestedSelection??CASES[run.caseId]?.selection,store.getPolicy('buyer'));
        const hash=store.registerQuote(req.body.quote);return res.json({hash});
      }
      if(req.params.action==='pay'){
        if(role!=='seller')throw new Error('Seller role required');
        if(req.body.quote?.payload?.changeId!==runId||req.body.quote?.payload?.projectId!==run.projectId)throw new Error('Payment run binding mismatch');
        const receipt=await payments.execute({quote:req.body.quote,acceptance:req.body.acceptance,runId});
        store.patchRun(runId,{receipt,state:'paid'});return res.json({receipt});
      }
      res.status(404).json({error:'Unknown agent operation'});
    }catch(e){
      const safe=/budget|limit|paused|expired|version|unknown|superseded|signature|binding|locked|failed|policy|quote|role|Run not found/i.test(e.message)?e.message:'Agent operation failed';
      res.status(409).json({error:safe});
    }
  });
}
