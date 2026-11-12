import { randomUUID } from 'node:crypto';
import { signDocument,digest,canonical } from './identity.mjs';

export function defaultProject() {
  return {id:randomUUID(),version:1,name:'Aurora · 30s product film',
    scope:{durationSeconds:30,colorRevisionsRemaining:1,frenchIncluded:false,due:'standard'},
    originalAgreement:'30-second product film. One color revision included. English subtitles. Standard delivery tomorrow.'};
}
export function defaultPolicies() {
  return {buyer:{id:'buyer-policy',version:1,singleCapMinor:1000,totalCapMinor:2000,
    required:['french_subtitles'],allowStandard:true},seller:{id:'seller-policy',version:1,
    rates:{french_subtitles:1000,rush:500,color_revision:0},allowStandard:true}};
}
export function validatePolicies(policies) {
  const b = policies?.buyer, s = policies?.seller;
  if (!b || !s || !Number.isSafeInteger(b.singleCapMinor) || b.singleCapMinor < 0 || b.singleCapMinor > 2000 ||
    !Number.isSafeInteger(b.totalCapMinor) || b.totalCapMinor < b.singleCapMinor || b.totalCapMinor > 10000 ||
    !Array.isArray(b.required) || b.required.some(x => x !== 'french_subtitles') ||
    typeof b.allowStandard !== 'boolean' || !Number.isSafeInteger(b.version) || b.version < 1 ||
    !Number.isSafeInteger(s.version) || s.version < 1 || s.rates.french_subtitles !== 1000 ||
    s.rates.rush !== 500 || s.rates.color_revision !== 0 || s.allowStandard !== true) throw new Error('Invalid owner policies');
  return policies;
}
export function priceChange(project,selection,policy) {
  if (!selection || Object.keys(selection).sort().join(',') !== 'color,french,rush' ||
    Object.values(selection).some(x=>typeof x !== 'boolean')) throw new Error('Invalid scope selection');
  if (!selection.color && !selection.french && !selection.rush) throw new Error('Empty change');
  const items=[];
  if(selection.color) {
    if(project.scope.colorRevisionsRemaining < 1) throw new Error('Included color revision already used; clarification required');
    items.push({code:'color_revision',description:'Included blue color revision',amountMinor:0});
  }
  if(selection.french && !project.scope.frenchIncluded) items.push({code:'french_subtitles',description:'Additional French SRT',amountMinor:policy.rates.french_subtitles});
  if(selection.rush) items.push({code:'rush',description:'Rush delivery today',amountMinor:policy.rates.rush});
  return {currency:'USD',amountMinor:items.reduce((a,b)=>a+b.amountMinor,0),items,selection};
}
export function makeQuote({project,changeId,selection,buyerId,sellerPolicy,quoteVersion=1,expiresAt},identity) {
  const price = priceChange(project,selection,sellerPolicy);
  const issued = Date.now();
  return signDocument({schemaVersion:1,type:'quote_offer',projectId:project.id,changeId,
    baseVersion:project.version,quoteVersion,buyerId,sellerId:identity.id,
    issuedAt:new Date(issued).toISOString(),expiresAt:expiresAt??new Date(issued+600000).toISOString(),
    priceVersion:sellerPolicy.version,...price},identity.privateKey);
}
export function validateQuote(quote,{project,sellerPolicy,now=Date.now()}) {
  if (quote.type !== 'quote_offer' || quote.schemaVersion !== 1 || quote.projectId !== project.id ||
    quote.baseVersion !== project.version || quote.priceVersion !== sellerPolicy.version ||
    !Number.isSafeInteger(quote.quoteVersion) || quote.quoteVersion < 1 ||
    !Number.isFinite(Date.parse(quote.expiresAt)) || Date.parse(quote.expiresAt) <= now ||
    !Number.isFinite(Date.parse(quote.issuedAt)) || Date.parse(quote.issuedAt) > now+30000 ||
    Date.parse(quote.expiresAt)-Date.parse(quote.issuedAt) > 600000 ||
    typeof quote.changeId !== 'string' || quote.changeId.length > 80) throw new Error('Stale, expired or invalid quote');
  const expected = priceChange(project,quote.selection,sellerPolicy);
  if (quote.currency !== 'USD' || quote.amountMinor !== expected.amountMinor ||
    canonical(quote.items) !== canonical(expected.items)) throw new Error('Quote price mismatch');
  return quote;
}
export function validateBuyerPolicy(quote,buyerPolicy,buyerId='buyer') {
  if(quote.buyerId !== buyerId) throw new Error('Buyer identity mismatch');
  if(buyerPolicy.required.includes('french_subtitles') && !quote.selection.french) throw new Error('Missing required subtitles');
  if(!buyerPolicy.allowStandard && !quote.selection.rush) throw new Error('Required deadline not met');
  if(quote.amountMinor > buyerPolicy.singleCapMinor) throw new Error('Buyer budget exceeded');
  return quote;
}
export function validateTaskSelection(selection,requested,policy){
  if(!selection||!requested||selection.color!==requested.color||selection.french!==requested.french||
    (selection.rush!==requested.rush&&!(requested.rush===true&&selection.rush===false&&policy.allowStandard)))throw new Error('Task scope changed outside owner request');
  return selection;
}
export function makeAcceptance(envelope,buyerPolicy,identity) {
  const quote=validateBuyerPolicy(envelope.payload,buyerPolicy,identity.id);
  return signDocument({schemaVersion:1,type:'quote_acceptance',projectId:quote.projectId,
    changeId:quote.changeId,baseVersion:quote.baseVersion,buyerId:identity.id,sellerId:quote.sellerId,
    quoteHash:digest(quote),policyVersion:buyerPolicy.version,acceptedAt:new Date().toISOString()},identity.privateKey);
}
export function appliedProject(project,selection) {
  return {...project,version:project.version+1,scope:{...project.scope,
    colorRevisionsRemaining:project.scope.colorRevisionsRemaining-(selection.color?1:0),
    frenchIncluded:project.scope.frenchIncluded||selection.french,due:selection.rush?'rush':'standard'}};
}
