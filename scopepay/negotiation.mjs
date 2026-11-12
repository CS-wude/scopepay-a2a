// Finite package domain (book chapters 4/6), private utility and reservation
// boundaries (5/11), time-dependent concession (9). No PSP authority here.
import {digest,signDocument,verifyDocument} from './identity.mjs';

const integer=(n,min=0)=>Number.isSafeInteger(n)&&n>=min;
const own=(o,k)=>Object.hasOwn(o,k);
const exact=(o,keys)=>o&&Object.getPrototypeOf(o)===Object.prototype&&Object.keys(o).sort().join(',')===keys.split(',').sort().join(',');
function requireThat(ok,message){if(!ok)throw new Error(message);}

export function validateDomain(d){
  requireThat(d&&Object.getPrototypeOf(d)===Object.prototype,'Invalid negotiation domain');
  const {sourceHash,serviceHash,...base}=d;
  requireThat(serviceHash===undefined||typeof serviceHash==='string'&&/^[a-f0-9]{64}$/.test(serviceHash),'Invalid service hash');
  requireThat(exact(base,'id,version,contractVersion,currency,priceMinMinor,priceMaxMinor,priceStepMinor,required,packages')&&(sourceHash===undefined||typeof sourceHash==='string'&&/^[a-f0-9]{64}$/.test(sourceHash)),'Invalid negotiation domain');
  requireThat(typeof d.id==='string'&&d.id.length>0&&d.id.length<=100&&integer(d.version,1)&&integer(d.contractVersion,1)&&d.currency==='USD','Invalid domain identity');
  requireThat(integer(d.priceMinMinor)&&integer(d.priceMaxMinor)&&integer(d.priceStepMinor,1)&&d.priceMaxMinor>=d.priceMinMinor,'Invalid price grid');
  requireThat((d.priceMaxMinor-d.priceMinMinor)/d.priceStepMinor<=10000,'Price grid too large');
  requireThat(Array.isArray(d.required)&&d.required.every(x=>typeof x==='string')&&new Set(d.required).size===d.required.length,'Invalid required scope');
  requireThat(Array.isArray(d.packages)&&d.packages.length>0&&d.packages.length<=64,'Invalid packages');
  const ids=new Set();
  for(const p of d.packages){
    requireThat(exact(p,'id,scope,dueAt,extraRevisions')&&typeof p.id==='string'&&p.id.length>0&&!ids.has(p.id),'Invalid package identity');ids.add(p.id);
    requireThat(Array.isArray(p.scope)&&p.scope.every(x=>typeof x==='string')&&new Set(p.scope).size===p.scope.length&&d.required.every(x=>p.scope.includes(x)),'Package removes required scope');
    requireThat(integer(p.dueAt,1)&&integer(p.extraRevisions),'Invalid package terms');
  }
  requireThat(d.packages.length*(1+(d.priceMaxMinor-d.priceMinMinor)/d.priceStepMinor)<=20000,'Candidate domain too large');
  return d;
}
export function validatePolicy(d,p,role){
  validateDomain(d);
  const keys=role==='buyer'?'role,version,capMinor,remainingMinor,latestDueAt,disagreementMinor,values':'role,version,minMarginMinor,disagreementMinor,costs,available';
  requireThat(['buyer','seller'].includes(role)&&exact(p,keys)&&p.role===role&&integer(p.version,1)&&integer(p.disagreementMinor),'Invalid private policy');
  const table=role==='buyer'?p.values:p.costs;
  requireThat(table&&Object.getPrototypeOf(table)===Object.prototype&&Object.keys(table).length===d.packages.length&&d.packages.every(x=>own(table,x.id)&&integer(table[x.id])),'Incomplete private utility table');
  if(role==='buyer')requireThat(integer(p.capMinor)&&integer(p.remainingMinor)&&integer(p.latestDueAt,1),'Invalid buyer authorization');
  else requireThat(integer(p.minMarginMinor)&&Array.isArray(p.available)&&new Set(p.available).size===p.available.length&&p.available.every(id=>d.packages.some(x=>x.id===id)),'Invalid seller authorization');
  return p;
}
function candidate(d,c){
  requireThat(exact(c,'packageId,amountMinor')&&d.packages.some(x=>x.id===c.packageId)&&integer(c.amountMinor)&&c.amountMinor>=d.priceMinMinor&&c.amountMinor<=d.priceMaxMinor&&(c.amountMinor-d.priceMinMinor)%d.priceStepMinor===0,'Invalid candidate');
  return d.packages.find(x=>x.id===c.packageId);
}
function score(d,p,c){
  const pack=candidate(d,c);
  if(p.role==='buyer'){
    if(c.amountMinor>Math.min(p.capMinor,p.remainingMinor)||pack.dueAt>p.latestDueAt)return null;
    const u=p.values[c.packageId]-c.amountMinor;return u>=p.disagreementMinor?u:null;
  }
  if(!p.available.includes(c.packageId))return null;
  const u=c.amountMinor-p.costs[c.packageId];return u>=Math.max(p.minMarginMinor,p.disagreementMinor)?u:null;
}
export function evaluate(d,p,c){validatePolicy(d,p,p.role);return score(d,p,c);}
export function candidates(d,p){
  validatePolicy(d,p,p.role);const result=[];
  for(const pack of d.packages)for(let price=d.priceMinMinor;price<=d.priceMaxMinor;price+=d.priceStepMinor){
    const c={packageId:pack.id,amountMinor:price},utility=score(d,p,c);if(utility!==null)result.push({...c,utility});
  }
  return result;
}

export class Negotiator{
  constructor({domain,policy,identity,peer,sessionId,expiresAt,maxTurns=12,beta=1,acceptFirst=false}){
    validatePolicy(domain,policy,identity.id);
    requireThat(['buyer','seller'].includes(identity.id)&&peer.id!==identity.id&&['buyer','seller'].includes(peer.id)&&typeof sessionId==='string'&&sessionId.length>0,'Invalid parties');
    requireThat(integer(expiresAt,1)&&integer(maxTurns,2)&&maxTurns<=50&&Number.isFinite(beta)&&beta>0&&beta<=100,'Invalid negotiation limits');
    // Copy policy: later caller mutation cannot silently increase authorization.
    this.domain=structuredClone(domain);this.policy=structuredClone(policy);this.identity=identity;this.peer=peer;this.sessionId=sessionId;this.expiresAt=expiresAt;this.maxTurns=maxTurns;this.beta=beta;
    this.history=[];this.terminal=false;this.options=candidates(this.domain,this.policy);
    this.acceptFirst=acceptFirst===true;
  }
  act(incoming=null,now=Date.now(),hint=null){
    requireThat(!this.terminal,'Session terminated');
    if(incoming){
      const m=verifyDocument(incoming,this.peer.publicKey);
      requireThat(exact(m,'type,sessionId,domainHash,actor,policyVersion,sequence,parentHash,expiresAt,candidate')&&m.sessionId===this.sessionId&&m.domainHash===digest(this.domain)&&m.actor===this.peer.id&&integer(m.policyVersion,1)&&m.expiresAt===this.expiresAt,'Peer binding mismatch');
      requireThat(m.sequence===this.history.length+1&&m.parentHash===(this.history.length?digest(this.history.at(-1).payload):null),'Stale or out of order message');
      requireThat(['offer','accept','reject'].includes(m.type),'Invalid negotiation action');
      if(m.type==='offer'||m.type==='accept')candidate(this.domain,m.candidate);else requireThat(m.candidate===null,'Invalid rejection');
      if(m.type==='accept'){
        const previous=this.history.at(-1)?.payload;
        requireThat(now<this.expiresAt&&previous?.type==='offer'&&digest(previous.candidate)===digest(m.candidate)&&score(this.domain,this.policy,m.candidate)!==null,'Acceptance does not match valid offer');
      }
      this.history.push(structuredClone(incoming));
      if(m.type!=='offer'){this.terminal=true;return {state:m.type==='accept'?'agreed':'rejected',candidate:m.candidate};}
    }else requireThat(this.history.length===0,'Peer response required');
    if(now>=this.expiresAt)return this.send('reject',null);
    if(!this.options.length)return this.send('reject',null);
    const utilities=this.options.map(x=>x.utility),best=Math.max(...utilities),floor=Math.min(...utilities);
    const progress=Math.min(1,this.history.length/(this.maxTurns-1));
    const target=best-(best-floor)*Math.pow(progress,1/this.beta);
    const offer=incoming?.payload;
    if(offer?.type==='offer'){
      const u=score(this.domain,this.policy,offer.candidate);
      if(u!==null&&(this.acceptFirst||u>=target||this.history.length>=this.maxTurns-1))return this.send('accept',offer.candidate);
    }
    // Allow the final counteroffer, then one accept/reject response. Otherwise
    // a late-conceding peer can exhaust the window before seeing our boundary.
    if(this.history.length>=this.maxTurns)return this.send('reject',null);
    // Only own utility + public peer offer used; never opponent's hidden table.
    // The first public offer is a weak preference signal, not a revealed value.
    // Preserve it when two packages cost us the same utility: this lets a peer
    // receive a preferred bundle without sacrificing our concession target.
    const preferred=this.history.find(e=>e.payload.actor===this.peer.id&&e.payload.type==='offer')?.payload.candidate.packageId;
    const choices=this.options.filter(c=>c.utility>=target).sort((a,b)=>{
      const sameA=a.packageId===preferred?1:0,sameB=b.packageId===preferred?1:0;
      return a.utility-b.utility||sameB-sameA||a.packageId.localeCompare(b.packageId)||a.amountMinor-b.amountMinor;
    });
    const choice=choices.find(c=>hint&&c.packageId===hint.packageId&&c.amountMinor===hint.amountMinor)??choices[0];return this.send('offer',{packageId:choice.packageId,amountMinor:choice.amountMinor});
  }
  send(type,c){
    const msg=signDocument({type,sessionId:this.sessionId,domainHash:digest(this.domain),actor:this.identity.id,policyVersion:this.policy.version,sequence:this.history.length+1,parentHash:this.history.length?digest(this.history.at(-1).payload):null,expiresAt:this.expiresAt,candidate:c},this.identity.privateKey);
    this.history.push(msg);if(type!=='offer')this.terminal=true;
    return {state:type==='accept'?'agreed':type==='reject'?'rejected':'negotiating',candidate:c,message:msg};
  }
}
