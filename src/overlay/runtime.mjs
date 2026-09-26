// Observer, machine queue and public API. All ownership decisions are delegated
// to classifier.resolve(); this layer only schedules work and applies decisions.
export function createOverlayRuntime(model, catalog, classifier, translator) {
  const { doc, view, options } = model;
  const { attrs, emptyLabels, catalogPanels } = model.config;
  const machine = model.machine;
  const life = model.lifecycle;

  function currentValue(node,name) {
    return name==='#text' ? node.nodeValue : node.getAttribute(name);
  }
  function requestMachine(node,name,current,resolution) {
    if(!machine.enabled)return;
    const element=name==='#text'?node.parentElement:node;
    const resolved=resolution || classifier.resolve(element,name);
    const context=resolved.context;
    if(!context||!machine.policy.eligible(current.trim(),context))return;
    const key=context+'\n'+current;
    let seen=machine.seen.get(node);
    if(!seen){seen=new Map();machine.seen.set(node,seen);}
    if(seen.get(name)===key)return;
    if(machine.queue.size>=128){machine.overflow=true;return;}
    seen.set(name,key);
    const id=++machine.nextId;
    machine.queue.set(id,{id,node,name,current,text:current.trim(),context,state:'queued',attempts:0});
    machine.notifyPending=true;
  }
  function forgetMachine(request) {
    const seen=machine.seen.get(request.node);
    if(seen?.get(request.name)===request.context+'\n'+request.current)seen.delete(request.name);
  }

  function textNode(node) {
    if(!node.nodeValue?.trim())return;
    const element=node.parentElement;
    const resolution=classifier.resolve(element,'#text');
    const immediate=translator.immediate(node,'#text',node.nodeValue,resolution);
    if(immediate!=null)translator.set(node,'#text',node.nodeValue,immediate.value,null,immediate.dict);
    else if(resolution.route==='ui')requestMachine(node,'#text',node.nodeValue,resolution);
  }
  function element(element) {
    for(const name of attrs) {
      const value=element.getAttribute(name);
      if(!value)continue;
      const sidebarValue=classifier.sidebarInlineTemplate(value,element);
      if(sidebarValue!=null){translator.set(element,name,value,sidebarValue);continue;}
      const resolution=classifier.resolve(element,name);
      if(resolution.route!=='ui'||!resolution.dict)continue;
      // Structural region labels are used by both Copilot and our own
      // classifiers. Only mutate labels exposed on actual controls.
      if(name==='aria-label'&&!element.matches('button,input,textarea,[contenteditable],[role="menuitem"]')&&
          !(element.matches('[role="option"]')&&classifier.fixedPopup(element))&&!classifier.workspacePanelTab(element))continue;
      const templated=classifier.inlineTemplate(value,element);
      const translated=templated ?? translator.translate(value,resolution.dict,true);
      if(translated!=null)translator.set(element,name,value,translated,null,resolution.dict);
      else requestMachine(element,name,value,resolution);
    }
  }
  function scan(root) {
    if(root.nodeType===3){textNode(root);return;}
    if(root.nodeType!==1&&root.nodeType!==9)return;
    if(root.nodeType===1)element(root);
    const walker=doc.createTreeWalker(root,1|4,{
      acceptNode(node) {
        if(node.nodeType===1&&classifier.excluded(node,false)) {
          element(node);
          return 2;
        }
        return 1;
      }
    });
    while(walker.nextNode()) {
      const node=walker.currentNode;
      if(node.nodeType===3)textNode(node);else element(node);
    }
  }

  function recordAllowed(node,name,record) {
    const element=name==='#text'?node.parentElement:node;
    const resolution=classifier.resolve(element,name);
    if(record.context)return resolution.context===record.context;
    const immediate=translator.immediate(node,name,record.original,resolution);
    if(immediate?.value===record.translated)return true;
    return Boolean(resolution.dict&&(!record.dict||resolution.dict===record.dict));
  }
  function reconcileRecords(roots) {
    for(const [node,fields] of model.records) {
      if(!node.isConnected){model.records.delete(node);continue;}
      if(!roots.some(root=>root===node||root.contains?.(node)))continue;
      for(const [name,record] of fields) {
        if(recordAllowed(node,name,record))continue;
        translator.restoreField(node,name,record);
        fields.delete(name);
        machine.seen.get(node)?.delete(name);
      }
      if(!fields.size)model.records.delete(node);
    }
  }
  function flush() {
    if(!life.enabled)return;
    catalog.reset();
    const started=view.performance.now();
    const roots=[...model.pending];model.pending.clear();
    reconcileRecords(roots);
    for(const root of roots) {
      if(!root.isConnected)continue;
      if(roots.some(other=>other!==root&&other.contains?.(root)))continue;
      scan(root);
    }
    for(const leaf of doc.querySelectorAll('[data-testid^="repository-group-children-"] > [role="treeitem"][aria-disabled="true"]')) {
      if(leaf.childNodes.length===1&&leaf.firstChild.nodeType===3&&emptyLabels.includes(leaf.textContent.trim()))textNode(leaf.firstChild);
    }
    for(const action of doc.querySelectorAll('[data-testid="repository-group-new-workspace-action"][aria-label]'))element(action);
    // Message bodies are protected as user/model content. Process only the
    // explicitly identified chrome controls that live inside those subtrees.
    for(const control of doc.querySelectorAll('[data-testid="assistant-reasoning-toggle"],button[data-base-ui-tooltip-trigger][aria-label]')) {
      if(!classifier.messageChromeControl(control))continue;
      element(control);
      for(const child of control.childNodes) {
        if(child.nodeType===3)textNode(child);
        else if(child.nodeType===1)scan(child);
      }
    }
    // The chat composer is intentionally inside protected rich-text/prose
    // content. Its draft text must never be scanned, but its app-owned
    // placeholder is safe and needs an explicit pass because the walker prunes
    // the protected editor subtree.
    for(const composer of doc.querySelectorAll('[role="textbox"][contenteditable="true"][data-lexical-editor][aria-placeholder]'))element(composer);
    for(const node of model.records.keys())if(!node.isConnected)model.records.delete(node);
    model.stats.passes++;
    model.stats.duration+=view.performance.now()-started;
    if(machine.notifyPending) {
      machine.notifyPending=false;
      try{options.onMachinePending?.();}catch{/* periodic drain remains the fallback */}
    }
  }
  function queue(node) {
    if(!life.enabled||!node)return;
    model.pending.add(node);
    if(!life.scheduled) {
      life.scheduled=true;
      view.queueMicrotask(()=>{life.scheduled=false;flush();});
    }
  }

  const observer=new view.MutationObserver(mutations=>{
    for(const mutation of mutations) {
      if(mutation.type==='childList') {
        const target=mutation.target;
        const panel=target.nodeType===1&&target.closest('main [role="tabpanel"]');
        if(doc.location?.pathname==='/extensions'&&panel&&catalogPanels.has(model.originalAttr(panel,'aria-label'))&&!classifier.protectedContent(target)) {
          queue(target.closest('li,[class~="group/row"],section')||target);
        } else {
          for(const node of mutation.addedNodes)queue(node);
          if(mutation.removedNodes.length)queue(mutation.target);
        }
      } else {
        if(mutation.type==='characterData'&&classifier.protectedContent(mutation.target.parentElement))continue;
        if(mutation.attributeName==='class') {
          const relevant=value=>(value||'').split(/\s+/).filter(c=>['prose','markdown-body','monaco-editor','cm-editor','xterm','group/card','group/row','pointer-events-none','invisible'].includes(c)).sort().join(' ');
          if(relevant(mutation.oldValue)===relevant(mutation.target.getAttribute('class')))continue;
        }
        const name=mutation.type==='characterData'?'#text':mutation.attributeName;
        const prior=model.records.get(mutation.target)?.get(name);
        const current=currentValue(mutation.target,name);
        if(prior?.translated===current)continue;
        if(['id','aria-label','aria-labelledby','aria-describedby','aria-controls'].includes(mutation.attributeName))queue(doc.body);
        else if(name==='#text') {
          const element=mutation.target.parentElement;
          queue(element?.closest('[role="dialog"][aria-labelledby]')||element?.parentElement||mutation.target);
        } else queue(mutation.target);
      }
    }
  });

  function status() {
    return {
      version:model.dictionary.version,
      enabled:life.enabled,
      ready:life.ready,
      reason:life.reason,
      translated:model.stats.translated,
      tracked:model.records.size,
      passes:model.stats.passes,
      workMs:Math.round(model.stats.duration*100)/100,
      machine:{enabled:machine.enabled,queued:machine.queue.size,applied:machine.applied,skipped:machine.skipped,overflow:machine.overflow,refills:machine.refills,expired:machine.expired}
    };
  }
  function explain(node,name='#text') {
    catalog.reset();
    const element=name==='#text'?(node?.nodeType===3?node.parentElement:node):node;
    const resolution=classifier.resolve(element,name);
    if(resolution.route==='protected')return {route:'protected',context:null};
    if(resolution.route==='data')return {route:resolution.catalog?.kind==='data'?'catalog-data':'data',context:null};
    if(resolution.route==='account-template')return {route:'account-template-only',context:null};
    const text=name==='#text'?(node.nodeType===3?(model.records.get(node)?.get(name)?.original??node.nodeValue):model.originalContent(node)):model.originalAttr(node,name);
    const immediate=translator.immediate(node,name,text,resolution);
    if(immediate!=null)return {route:'dictionary',context:null};
    const context=resolution.context;
    return {route:!context?'unclassified':machine.policy?.eligible((text||'').trim(),context)?'machine':'text-filter',context};
  }
  function drainMachine(limit=8) {
    if(!life.enabled||!machine.enabled)return [];
    catalog.reset();
    for(const [id,request] of [...machine.queue]) {
      const {node,name,current,context}=request;
      const element=name==='#text'?node.parentElement:node;
      const value=currentValue(node,name);
      if(!node.isConnected||current!==value||classifier.resolve(element,name).context!==context) {
        machine.queue.delete(id);forgetMachine(request);continue;
      }
      if(request.state==='inflight'&&Date.now()-request.startedAt>=120000) {
        machine.queue.delete(id);machine.expired++;
        if(request.attempts<2){request.id=++machine.nextId;request.state='queued';machine.queue.set(request.id,request);}else machine.skipped++;
      }
    }
    if(machine.overflow&&machine.queue.size<=64) {
      machine.overflow=false;machine.refills++;scan(doc.body);
    }
    const result=[];
    for(const request of machine.queue.values()) {
      if(request.state!=='queued'||Date.now()<(request.nextAt||0))continue;
      request.state='inflight';request.attempts++;request.startedAt=Date.now();
      result.push({instance:machine.instance,id:request.id,text:request.text,context:request.context});
      if(result.length>=Math.min(16,Math.max(1,limit)))break;
    }
    return result;
  }
  function applyMachine(result) {
    if(!life.enabled||result.instance!==machine.instance)return false;
    catalog.reset();
    const request=machine.queue.get(result.id);
    if(!request||request.state!=='inflight')return false;
    const {node,name,current,text,context}=request;
    machine.queue.delete(request.id);
    const element=name==='#text'?node.parentElement:node;
    const value=currentValue(node,name);
    const resolution=classifier.resolve(element,name);
    if(!node.isConnected||current!==value||resolution.context!==context){forgetMachine(request);return false;}
    const override=translator.immediate(node,name,current,resolution);
    if(override!=null) {
      translator.set(node,name,current,override.value,null,override.dict);
      forgetMachine(request);
      return false;
    }
    if(!result.translation||!machine.policy.valid(text,result.translation,context)) {
      machine.skipped++;
      if(request.attempts<2){request.state='queued';request.nextAt=Date.now()+60000;machine.queue.set(request.id,request);}
      return false;
    }
    const start=current.indexOf(text);
    translator.set(node,name,current,current.slice(0,start)+result.translation+current.slice(start+text.length),context);
    forgetMachine(request);machine.applied++;return true;
  }
  function dispose() {
    life.enabled=false;life.ready=false;
    observer.disconnect();life.waiting?.disconnect();
    if(life.timer!=null)view.clearTimeout(life.timer);
    model.pending.clear();machine.queue.clear();machine.overflow=false;
    for(const [node,fields] of model.records)for(const [name,record] of fields)translator.restoreField(node,name,record);
    model.records.clear();
    return status();
  }
  const api={
    version:model.dictionary.version,
    get enabled(){return life.enabled;},
    status,
    originalText:node=>{
      const record=model.records.get(node)?.get('#text');
      return record&&node.nodeValue===record.translated?record.original:node.nodeValue;
    },
    originalAttribute:(element,name)=>model.originalAttr(element,name),
    explain,drainMachine,applyMachine,dispose
  };

  function start() {
    if(!life.enabled)return;
    if(!options.test&&(!doc.querySelector('#root')||!doc.querySelector('#sidebar-heading'))) {
      if(!life.waiting) {
        life.waiting=new view.MutationObserver(start);
        life.waiting.observe(doc.body,{childList:true,subtree:true});
        life.timer=view.setTimeout(()=>{
          life.waiting.disconnect();life.enabled=false;
          life.reason='Unsupported UI: expected Copilot root/sidebar markers';
        },30000);
      }
      return;
    }
    life.waiting?.disconnect();
    if(life.timer!=null)view.clearTimeout(life.timer);
    life.ready=true;
    observer.observe(doc.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeOldValue:true,
      attributeFilter:[...attrs,'hidden','aria-hidden','data-open','data-closed','role','id','class','translate','contenteditable',
        'aria-labelledby','aria-describedby','aria-controls','aria-pressed','data-selected','data-section-id','data-section-heading',
        'data-component','data-testid','data-machine-translate','data-file-path','data-diff','data-message-id','data-message-role',
        'data-selectable','data-lexical-editor','inert','data-carousel-card','data-customize-category-header-row']});
    queue(doc.body);
  }
  return {api,start,scan,queue};
}

export function installCopilotChinese(dictionary, doc = document, options = {}) {
  const view=doc.defaultView||window;
  const previous=view.__copilotChinese;
  if(previous?.version===dictionary.version&&previous.enabled)return previous.status();
  previous?.dispose();
  const model=createOverlayModel(dictionary,doc,options);
  const catalog=createCatalogSurface(model);
  const classifier=createOverlayClassifier(model,catalog);
  const translator=createOverlayTranslator(model,classifier,catalog);
  const runtime=createOverlayRuntime(model,catalog,classifier,translator);
  view.__copilotChinese=runtime.api;
  if(doc.body)runtime.start();else doc.addEventListener('DOMContentLoaded',runtime.start,{once:true});
  return runtime.api.status();
}
