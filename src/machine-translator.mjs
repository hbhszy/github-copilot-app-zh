import { createHash } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { EdgeTranslator, edgeInstallation } from './edge-translator.mjs';
import { createMachinePolicy } from './machine-policy.mjs';

export class MachineTranslator {
  constructor(local, {enabled=true, idleMs=60000, hostFactory, installation, onStatus=()=>{}}={}) {
    this.local=local; this.enabled=enabled; this.idleMs=Math.max(1000,idleMs); this.hostFactory=hostFactory ?? ((info)=>new EdgeTranslator(local,info));
    this.installationProvider=installation ?? (()=>edgeInstallation(local));
    this.policy=createMachinePolicy(); this.onStatus=onStatus; this.cache=new Map(); this.tail=Promise.resolve();
    this.state={enabled,engine:'edge-local',state:enabled?'idle':'disabled',hits:0,translated:0,rejected:0,failures:0,cached:0};
  }
  status() { return {...this.state}; }
  update(fields) { Object.assign(this.state,fields); this.onStatus(this.status()); }
  init() {
    this.initializing ??= this._init().catch(error=>{this.initializing=null;throw error});
    return this.initializing;
  }
  async _init() {
    const started=performance.now();
    this.info=await this.installationProvider();
    this.fingerprint=this.info.fingerprint+'|policy:'+this.policy.version;
    this.file=join(this.local,'machine-cache.json');
    try {
      const data=JSON.parse(await readFile(this.file,'utf8'));
      if(data.version===1 && data.fingerprint===this.fingerprint && Array.isArray(data.entries)) {
        for(const [key,value] of data.entries.slice(-5000)) if(typeof key==='string' && value && typeof value.text==='string' && this.policy.valid(value.text,value.result,value.context)) this.cache.set(key,value);
      }
    } catch {}
    this.update({cached:this.cache.size,initMs:Math.round(performance.now()-started)});
  }
  cacheKey(text,context) { return createHash('sha256').update(JSON.stringify([context,text])).digest('hex'); }
  cached(text,context) {
    const value=this.cache.get(this.cacheKey(text,context));
    return value?.text===text && this.policy.valid(text,value.result,context) ? value.result : null;
  }
  async translate(text,context) {
    if(this.closed || !this.enabled || typeof context!=='string' || context.length>200 || !this.policy.eligible(text,context))return null;
    if(!this.info && Date.now()<(this.retryAfter??0))return null;
    const started=performance.now();
    // Cache hits must not sit behind a cold engine or unrelated uncached text.
    try { await this.init(); } catch { /* The serialized path records failure/backoff. */ }
    if(this.closed)return null;
    const hit=this.cached(text,context);
    if(hit) {this.update({hits:this.state.hits+1,lastCacheMs:Math.round(performance.now()-started)});return hit;}
    const operation=this.tail.then(()=>this._translate(text,context));
    this.tail=operation.catch(()=>{});
    return operation;
  }
  warmup() {
    if(this.closed || !this.enabled)return Promise.resolve(false);
    if(this.warming)return this.warming;
    const op=this.tail.then(async()=>{
      if(this.closed || Date.now()<(this.retryAfter??0))return false;
      const started=performance.now();
      try {
        await this.init();
        if(this.closed)return false;
        this.host ??= this.hostFactory(this.info);
        this.update({state:'warming'});
        await this.host.start();
        if(this.closed)return false;
        this.update({state:'ready',warmupMs:Math.round(performance.now()-started),engineTimings:this.host.timings});
        return true;
      }catch(error){
        if(!this.closed){this.retryAfter=Date.now()+60000;this.update({state:'unavailable',error:error.message,failures:this.state.failures+1});}
        await this.host?.close().catch(()=>{});this.host=null;return false;
      }finally{this.armIdle();}
    });
    this.tail=op.catch(()=>{});
    this.warming=op.finally(()=>{this.warming=null});
    return this.warming;
  }
  armIdle() {
    clearTimeout(this.idleTimer);
    const generation=this.idleGeneration=(this.idleGeneration||0)+1;
    if(!this.host || this.closed)return;
    this.idleTimer=setTimeout(()=>{
      const op=this.tail.then(async()=>{
        if(generation!==this.idleGeneration || this.closed)return;
        if(this.host){await this.host.close();this.host=null;}
        this.update({state:'idle'});
      });
      this.tail=op.catch(()=>{});
    },this.idleMs);
    this.idleTimer.unref?.();
  }
  async _translate(text,context) {
    if(this.closed || !this.enabled || typeof context!=='string' || context.length>200 || !this.policy.eligible(text,context)) return null;
    if(!this.info && Date.now() < (this.retryAfter ?? 0)) return null;
    clearTimeout(this.idleTimer);
    this.idleGeneration=(this.idleGeneration||0)+1;
    const started=performance.now();
    try {
      await this.init();
      const key=this.cacheKey(text,context);
      const cached=this.cache.get(key);
      if(cached?.text===text && this.policy.valid(text,cached.result,context)) { this.update({hits:this.state.hits+1}); return cached.result; }
      if(Date.now() < (this.retryAfter ?? 0)) return null;
      if(this.closed) return null;
      this.host ??= this.hostFactory(this.info);
      this.update({state:this.host.ready?'translating':'loading',error:null});
      const prepared=this.policy.prepare(text,context);
      const output=prepared.restore(await this.host.translate(prepared.text));
      if(this.closed) return null;
      if(!output) { this.update({state:'ready',rejected:this.state.rejected+1}); return null; }
      this.cache.set(key,{text,result:output,context});
      while(this.cache.size>5000) this.cache.delete(this.cache.keys().next().value);
      await writeFile(this.file+'.tmp',JSON.stringify({version:1,fingerprint:this.fingerprint,entries:[...this.cache]}));
      await rename(this.file+'.tmp',this.file);
      const elapsed=Math.round(performance.now()-started);
      this.update({state:'ready',translated:this.state.translated+1,cached:this.cache.size,lastTranslationMs:elapsed,
        firstTranslationMs:this.state.firstTranslationMs??elapsed,engineTimings:this.host.timings});
      return output;
    } catch(error) {
      if(!this.closed) {
        this.retryAfter=Date.now()+60000;
        this.update({state:'unavailable',error:error.message,failures:this.state.failures+1});
      }
      await this.host?.close().catch(()=>{}); this.host=null;
      return null;
    } finally {
      this.armIdle();
    }
  }
  async close() {
    this.closed=true; clearTimeout(this.idleTimer);
    await this.host?.close().catch(()=>{});
    await this.tail; this.host=null;
    this.update({state:'stopped'});
  }
}
