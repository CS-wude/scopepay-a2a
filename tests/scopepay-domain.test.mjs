import test from 'node:test';
import assert from 'node:assert/strict';
const domain = await import('../scopepay/domain.mjs').catch(() => ({}));
const identity = await import('../scopepay/identity.mjs').catch(() => ({}));

test('scopepay prices included revision at 0, subtitles at 1000 and rush total 1500 cents', () => {
  assert.equal(typeof domain.priceChange, 'function', 'pricing implementation is required');
  const project = domain.defaultProject();
  const policy = domain.defaultPolicies().seller;
  assert.equal(domain.priceChange(project,{color:true,french:false,rush:false},policy).amountMinor,0);
  assert.equal(domain.priceChange(project,{color:true,french:true,rush:false},policy).amountMinor,1000);
  assert.equal(domain.priceChange(project,{color:true,french:true,rush:true},policy).amountMinor,1500);
  assert.throws(() => domain.priceChange(project,{color:true,french:true,rush:false,amountMinor:1},policy));
});

test('scopepay signed quote and acceptance bind exact scope, amount, identity, version and expiry', () => {
  assert.equal(typeof identity.createIdentity, 'function', 'signing identity is required');
  const buyer = identity.createIdentity('buyer'), seller = identity.createIdentity('seller');
  const project = domain.defaultProject(), policies = domain.defaultPolicies();
  const quote = domain.makeQuote({project,changeId:'change-1',selection:{color:true,french:true,rush:false},buyerId:'buyer',sellerPolicy:policies.seller},seller);
  assert.equal(identity.verifyDocument(quote,seller.publicKey).amountMinor,1000);
  const accepted = domain.makeAcceptance(quote,policies.buyer,buyer);
  assert.equal(identity.verifyDocument(accepted,buyer.publicKey).quoteHash,identity.digest(quote.payload));
  assert.throws(() => identity.verifyDocument({...quote,payload:{...quote.payload,amountMinor:1}},seller.publicKey));
  assert.throws(() => identity.verifyDocument(quote,buyer.publicKey));
  assert.throws(() => domain.validateQuote({...quote.payload,amountMinor:1},{project,sellerPolicy:policies.seller}));
  assert.throws(() => domain.validateQuote({...quote.payload,baseVersion:0},{project,sellerPolicy:policies.seller}));
  assert.throws(() => domain.validateQuote({...quote.payload,expiresAt:'2000-01-01T00:00:00Z'},{project,sellerPolicy:policies.seller}));
  const incomplete = domain.makeQuote({project,changeId:'change-2',selection:{color:true,french:false,rush:false},buyerId:'buyer',sellerPolicy:policies.seller},seller);
  assert.throws(() => domain.makeAcceptance(incomplete,policies.buyer,buyer),/required/i);
  const costly = domain.makeQuote({project,changeId:'change-3',selection:{color:true,french:true,rush:true},buyerId:'buyer',sellerPolicy:policies.seller},seller);
  assert.throws(() => domain.makeAcceptance(costly,policies.buyer,buyer),/budget/i);
});
