import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {defaultPolicies,validatePolicies,appliedProject} from './domain.mjs';
import {digest} from './identity.mjs';

export class Store {
  constructor(file) {
    this.file=file; mkdirSync(dirname(file),{recursive:true,mode:0o700});
    this.db=new DatabaseSync(file);chmodSync(file,0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,doc TEXT NOT NULL,locked TEXT);
      CREATE TABLE IF NOT EXISTS policies(id TEXT PRIMARY KEY,doc TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,state TEXT NOT NULL,doc TEXT NOT NULL,created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,doc TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS quotes(change_id TEXT NOT NULL,version INTEGER NOT NULL,hash TEXT UNIQUE NOT NULL,doc TEXT NOT NULL,PRIMARY KEY(change_id,version));
      CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,change_id TEXT UNIQUE NOT NULL,project_id TEXT NOT NULL,quote_hash TEXT UNIQUE NOT NULL,amount INTEGER NOT NULL,budget_id TEXT NOT NULL,state TEXT NOT NULL,doc TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(id TEXT PRIMARY KEY,doc TEXT NOT NULL);`);
    if(!this.db.prepare('SELECT id FROM policies LIMIT 1').get())this.setPolicies(defaultPolicies());
  }
  tx(fn) {this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  close(){this.db.close();}
  setPolicies(policies){
    validatePolicies(policies);
    if(this.db.prepare("SELECT id FROM payments WHERE state IN ('reserved','unknown') LIMIT 1").get())throw new Error('Pending payment prevents policy update');
    for(const [role,policy]of Object.entries(policies))this.db.prepare('INSERT OR REPLACE INTO policies(id,doc) VALUES(?,?)').run(role,JSON.stringify(policy));
  }
  getPolicy(role){return JSON.parse(this.db.prepare('SELECT doc FROM policies WHERE id=?').get(role).doc);}
  createProject(project){this.db.prepare('INSERT INTO projects(id,doc) VALUES(?,?)').run(project.id,JSON.stringify(project));return project;}
  getProject(id){const r=this.db.prepare('SELECT doc FROM projects WHERE id=?').get(id);if(!r)throw new Error('Project not found');return JSON.parse(r.doc);}
  projectList(){return this.db.prepare('SELECT doc FROM projects ORDER BY rowid DESC').all().map(r=>JSON.parse(r.doc));}
  resetProject(id){const r=this.db.prepare('SELECT locked FROM projects WHERE id=?').get(id);if(r?.locked)throw new Error('Pending payment prevents reset');return true;}
  createRun(projectId,extra={}){
    this.getProject(projectId);const id=randomUUID(),created=new Date().toISOString();
    const doc={id,projectId,state:'requested',created,...extra};
    this.db.prepare('INSERT INTO runs VALUES(?,?,?,?,?)').run(id,projectId,doc.state,JSON.stringify(doc),created);return doc;
  }
  patchRun(id,patch){const row=this.db.prepare('SELECT doc FROM runs WHERE id=?').get(id);if(!row)throw new Error('Run not found');const doc={...JSON.parse(row.doc),...patch};this.db.prepare('UPDATE runs SET state=?,doc=? WHERE id=?').run(doc.state,JSON.stringify(doc),id);return doc;}
  getRun(id){const r=this.db.prepare('SELECT doc FROM runs WHERE id=?').get(id);if(!r)return null;return {...JSON.parse(r.doc),events:this.db.prepare('SELECT doc FROM events WHERE run_id=? ORDER BY seq').all(id).map(x=>JSON.parse(x.doc))};}
  runList(){return this.db.prepare('SELECT id FROM runs ORDER BY created DESC LIMIT 30').all().map(r=>this.getRun(r.id));}
  event(runId,event){const doc={at:new Date().toISOString(),...event};this.db.prepare('INSERT INTO events(run_id,doc) VALUES(?,?)').run(runId,JSON.stringify(doc));return doc;}
  registerQuote(envelope){
    const q=envelope.payload,hash=digest(q);
    this.db.prepare('INSERT OR IGNORE INTO quotes VALUES(?,?,?,?)').run(q.changeId,q.quoteVersion,hash,JSON.stringify(envelope));return hash;
  }
  latestQuote(changeId){const r=this.db.prepare('SELECT hash,doc FROM quotes WHERE change_id=? ORDER BY version DESC LIMIT 1').get(changeId);return r?{hash:r.hash,...JSON.parse(r.doc)}:null;}
  paymentForChange(changeId){const r=this.db.prepare('SELECT doc FROM payments WHERE change_id=?').get(changeId);return r?JSON.parse(r.doc):null;}
  paymentById(id){const r=this.db.prepare('SELECT doc FROM payments WHERE id=?').get(id);return r?JSON.parse(r.doc):null;}
  paymentCount(){return this.db.prepare('SELECT COUNT(*) AS n FROM payments').get().n;}
  paymentForRun(id){return this.db.prepare('SELECT doc FROM payments').all().map(r=>JSON.parse(r.doc)).find(p=>p.runId===id);}
  consumeModelCall(id){return this.tx(()=>{const run=this.getRun(id);if(!run)throw new Error('Run not found');const used=run.modelCalls??0;if(used>=8)throw new Error('Model call limit reached');this.patchRun(id,{modelCalls:used+1});return used+1;});}
  budgetUsed(id='buyer-policy'){return this.db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE budget_id=? AND state!='failed'").get(id).total;}
  reservePayment({quote,acceptance,runId}){
    return this.tx(()=>{
      const existing=this.paymentForChange(quote.changeId);if(existing)return {operation:existing,created:false};
      const p=this.db.prepare('SELECT doc,locked FROM projects WHERE id=?').get(quote.projectId);
      if(!p)throw new Error('Project not found');
      if(JSON.parse(p.doc).version!==quote.baseVersion)throw new Error('Stale project version');
      if(p.locked)throw new Error('Project locked by another change');
      const policy=this.getPolicy('buyer');
      if(policy.version!==acceptance.policyVersion||quote.amountMinor>policy.singleCapMinor||this.budgetUsed(policy.id)+quote.amountMinor>policy.totalCapMinor)throw new Error('Buyer budget or policy exceeded');
      const op={id:`sp-${randomUUID()}`,changeId:quote.changeId,projectId:quote.projectId,
        quoteHash:digest(quote),amountMinor:quote.amountMinor,currency:'USD',state:'reserved',quote,acceptance,runId,createdAt:new Date().toISOString()};
      this.db.prepare('INSERT INTO payments VALUES(?,?,?,?,?,?,?,?)').run(op.id,op.changeId,op.projectId,op.quoteHash,op.amountMinor,policy.id,op.state,JSON.stringify(op));
      this.db.prepare('UPDATE projects SET locked=? WHERE id=?').run(op.id,op.projectId);
      return {operation:op,created:true};
    });
  }
  markPayment(id,state,patch={}){
    const update=()=>{
      const current=this.paymentById(id);if(!current)throw new Error('Payment not found');
      // Verified/failed are terminal. A delayed network result cannot regress them.
      if(['verified','failed'].includes(current.state))return current;
      const op={...current,...patch,state};this.db.prepare('UPDATE payments SET state=?,doc=? WHERE id=?').run(state,JSON.stringify(op),id);
      if(state==='failed')this.db.prepare('UPDATE projects SET locked=NULL WHERE id=? AND locked=?').run(op.projectId,id);return op;
    };
    return this.db.isTransaction?update():this.tx(update);
  }
  commitChange(id,receipt){return this.tx(()=>{
    const op=this.paymentById(id);if(op.state==='verified')return op.receipt;
    const row=this.db.prepare('SELECT doc,locked FROM projects WHERE id=?').get(op.projectId),project=JSON.parse(row.doc);
    if(row.locked!==id||project.version!==op.quote.baseVersion)throw new Error('Project version changed during payment');
    this.db.prepare('UPDATE projects SET doc=?,locked=NULL WHERE id=?').run(JSON.stringify(appliedProject(project,op.quote.selection)),project.id);
    this.markPayment(id,'verified',{receipt});return receipt;
  });}
  setSetting(id,value){this.db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run(id,JSON.stringify(value));}
  getSetting(id,fallback){const r=this.db.prepare('SELECT doc FROM settings WHERE id=?').get(id);return r?JSON.parse(r.doc):fallback;}
}
