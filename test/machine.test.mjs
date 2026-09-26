import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMachinePolicy } from '../src/machine-policy.mjs';
import { MachineTranslator } from '../src/machine-translator.mjs';
async function removeFixture(local) {
  await rm(join(local,'machine-cache.json'),{force:true});
  await rm(join(local,'machine-cache.json.tmp'),{force:true});
  await rmdir(local);
}

test('catalog prose preserves inline literals without relaxing other contexts',()=>{
  const p=createMachinePolicy(),context='page:catalog-description-v1:#text';
  const source='Use `twg` and reports/index.html with https://example.com/docs after 30 seconds.';
  assert.equal(p.eligible(source,context),true);
  assert.equal(p.eligible(source,'settings:general-help:#text'),false);
  assert.equal(p.eligible('`const x = 1;`',context),false);
  const prepared=p.prepare(source,context);
  assert.ok(!prepared.text.includes('https:'));
  assert.ok(!prepared.text.includes('index.html'));
  const result=prepared.restore('在 30 秒后将 {CPZH0} 和 {CPZH1} 与 {CPZH2} 一起使用。');
  assert.equal(result,'在 30 秒后将 `twg` 和 reports/index.html 与 https://example.com/docs 一起使用。');
  assert.equal(p.valid(source,result,context),true);
  assert.equal(p.valid(source,result.replace('example.com','evil.com'),context),false);
  assert.equal(p.valid(source,result.replace('30','3'),context),false);
  assert.equal(p.valid(source,result),false);
  assert.equal(p.eligible('Inspect background activity. '.repeat(25),context),true);
  assert.equal(p.eligible('Inspect background activity. '.repeat(25),'settings:general-test:#text'),false);
});

test('catalog cache restart retains literal validation and never starts the engine for a hit',async()=>{
  const local=await mkdtemp(join(tmpdir(),'copilot-zh-test-'));
  const context='page:catalog-description-v1:#text',source='Use reports/index.html for deployment notes.';
  let calls=0;
  const options={installation:async()=>({fingerprint:'catalog'}),hostFactory:()=>({ready:true,translate:async()=>{calls++;return '部署说明参见 {CPZH0}。'},close:async()=>{}})};
  try {
    const first=new MachineTranslator(local,options);
    assert.equal(await first.translate(source,context),'部署说明参见 reports/index.html。');await first.close();
    const second=new MachineTranslator(local,options);
    assert.equal(await second.translate(source,context),'部署说明参见 reports/index.html。');await second.close();
    assert.equal(calls,1);
  } finally {await removeFixture(local);}
});

test('glossary, placeholders, numbers and shortcuts survive; corrupt outputs fail closed',()=>{
  const p=createMachinePolicy();
  for(const value of ['C:\\my files','https://example.com','person@example.com','const x = 1;','OnlyWord','Already 中文'])assert.equal(p.eligible(value),false,value);
  assert.equal(p.eligible('Thorough','popup:auto-optimization:#text'),true);
  assert.equal(p.eligible('Thorough','settings:general-test:#text'),true);
  assert.equal(p.eligible('Diagnostics','settings:navigation:#text'),true);
  assert.equal(p.eligible('Thorough','unclassified'),false);
  assert.equal(p.eligible('Thorough',null),false);
  assert.equal(p.eligible('Inspect\nbackground activity.','settings:general-test:#text'),true);
  assert.equal(p.eligible('C:\\private','popup:auto-optimization:#text'),false);
  const prepared=p.prepare('Open {count} branches with Ctrl+Shift+P after 30 seconds.');
  assert.ok(prepared.text.includes('{count}'));
  assert.ok(prepared.text.includes('30'));
  const output=prepared.restore('在 30 秒后使用 Ctrl+Shift+P 打开 {count} 个{CPZH0}。');
  assert.equal(output,'在 30 秒后使用 Ctrl+Shift+P 打开 {count} 个分支。');
  assert.equal(prepared.restore('打开分支'),null);
  assert.equal(p.valid('Keep 30 days.','保留 3 天。'),false);
  assert.equal(p.valid('Open {count} files.','打开文件。'),false);
  assert.equal(p.valid('Help me.','翻译\n额外说明'),false);
});

test('settings form glossary fixes technical terms while preserving URLs and JSON examples',()=>{
  const p=createMachinePolicy(),context='settings:form-chrome-v2:#text';
  const wire=p.prepare('Wire API',context);
  assert.equal(wire.restore('{CPZH0}'),'API 协议');
  const help='Pick the wire format this endpoint speaks. Most OpenAI-compatible gateways are Chat Completions; OpenAI\'s own GPT-5 series uses Responses.';
  const prepared=p.prepare(help,context);
  assert.ok(!prepared.text.includes('wire format'));
  assert.ok(!prepared.text.includes('Chat Completions'));
  assert.ok(!prepared.text.includes('Responses'));
  const restored=prepared.restore('选择此端点使用的 {CPZH0}。大多数 OpenAI-compatible 网关使用 {CPZH1}；OpenAI 自己的 GPT-5 系列使用 {CPZH2}。');
  assert.match(restored,/协议格式/);assert.match(restored,/Chat Completions/);assert.match(restored,/Responses/);
  const literal=p.prepare('Use https://api.openai.com/v1 with {"X-Org": "acme"}.',context);
  const literalOut=literal.restore('将 {CPZH0} 与 {CPZH1} 一起使用。');
  assert.match(literalOut,/https:\/\/api\.openai\.com\/v1/);assert.match(literalOut,/\{"X-Org": "acme"\}/);
});

test('concurrent duplicates and restart use cache; model fingerprint invalidates it',async()=>{
  const local=await mkdtemp(join(tmpdir(),'copilot-zh-test-'));
  let calls=0,starts=0;
  const options={installation:async()=>({fingerprint:'model-1'}),hostFactory:()=>{starts++;return{ready:true,translate:async()=>{calls++;return '自动隐藏非活动面板。'},close:async()=>{}}}};
  try{
    const a=new MachineTranslator(local,options);
    assert.deepEqual(await Promise.all([a.translate('Automatically hide inactive panels.','settings:general-test:#text'),a.translate('Automatically hide inactive panels.','settings:general-test:#text')]),['自动隐藏非活动面板。','自动隐藏非活动面板。']);
    assert.equal(calls,1);await a.close();
    const b=new MachineTranslator(local,options);
    assert.equal(await b.translate('Automatically hide inactive panels.','settings:general-test:#text'),'自动隐藏非活动面板。');
    assert.equal(starts,1);await b.close();
    const c=new MachineTranslator(local,{...options,installation:async()=>({fingerprint:'model-2'})});
    await c.translate('Automatically hide inactive panels.','settings:general-test:#text');assert.equal(calls,2);await c.close();
  }finally{await removeFixture(local)}
});

test('unavailable backend backs off and idle backend releases its resources',async()=>{
  const local=await mkdtemp(join(tmpdir(),'copilot-zh-test-'));
  let starts=0,closed=0;
  try{
    const failed=new MachineTranslator(local,{installation:async()=>({fingerprint:'failure'}),hostFactory:()=>{starts++;return{translate:async()=>{throw Error('offline')},close:async()=>{closed++}}}});
    assert.equal(await failed.translate('An unknown setting.','settings:test'),null);
    assert.equal(await failed.translate('Another unknown setting.','settings:test'),null);
    assert.equal(starts,1);assert.equal(closed,1);await failed.close();
    const idle=new MachineTranslator(local,{idleMs:1000,installation:async()=>({fingerprint:'idle'}),hostFactory:()=>({translate:async()=> '新的设置。',close:async()=>{closed++}})});
    await idle.translate('A new setting.','settings:test');
    await new Promise(r=>setTimeout(r,1150));
    assert.equal(closed,2);assert.equal(idle.status().state,'idle');await idle.close();
  }finally{await removeFixture(local)}
});

test('cache hits bypass an engine warmup and concurrent requests share one initialization',async()=>{
  const local=await mkdtemp(join(tmpdir(),'copilot-zh-test-'));
  let engine,release,started;
  const entered=new Promise(resolve=>{started=resolve});
  const gate=new Promise(resolve=>{release=resolve});
  let installs=0,starts=0;
  try{
    const seed=new MachineTranslator(local,{installation:async()=>({fingerprint:'fast-cache'}),hostFactory:()=>({translate:async()=> '已缓存的设置。',close:async()=>{}})});
    await seed.translate('A cached setting.','settings:test');await seed.close();
    engine=new MachineTranslator(local,{
      installation:async()=>{installs++;return {fingerprint:'fast-cache'}},
      hostFactory:()=>({start:async()=>{starts++;started();await gate},translate:async()=> '新的设置。',close:async()=>{release()}})
    });
    const warm=engine.warmup();assert.equal(engine.warmup(),warm);
    await entered;
    const hit=await Promise.race([engine.translate('A cached setting.','settings:test'),new Promise((_,reject)=>setTimeout(()=>reject(Error('cache blocked behind warmup')),300))]);
    assert.equal(hit,'已缓存的设置。');assert.equal(engine.status().state,'warming');
    const miss=engine.translate('A new setting.','settings:test');
    release();assert.equal(await warm,true);assert.equal(await miss,'新的设置。');
    assert.equal(installs,1);assert.equal(starts,1);
    assert.equal(typeof engine.status().warmupMs,'number');
  }finally{release();await engine?.close();await removeFixture(local)}
});

test('warmup respects disabled mode, missing engine backoff, and shutdown',async()=>{
  const local=await mkdtemp(join(tmpdir(),'copilot-zh-test-'));
  try{
    const disabled=new MachineTranslator(local,{enabled:false,installation:async()=>{throw Error('must not inspect installation')}});
    assert.equal(await disabled.warmup(),false);await disabled.close();
    let starts=0;
    const missing=new MachineTranslator(local,{installation:async()=>({fingerprint:'missing'}),hostFactory:()=>({start:async()=>{starts++;throw Error('missing model')},close:async()=>{}})});
    assert.equal(await missing.warmup(),false);assert.equal(await missing.warmup(),false);assert.equal(starts,1);await missing.close();
    let release;
    const gate=new Promise(resolve=>{release=resolve});
    const closing=new MachineTranslator(local,{installation:async()=>({fingerprint:'closing'}),hostFactory:()=>({start:()=>gate,close:async()=>{release()}})});
    const warm=closing.warmup();await closing.init();await new Promise(r=>setTimeout(r,10));
    await closing.close();assert.equal(await warm,false);assert.equal(closing.status().state,'stopped');
  }finally{await removeFixture(local)}
});
