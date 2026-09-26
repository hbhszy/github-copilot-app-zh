// All DOM ownership decisions live here. Runtime code asks for one resolution
// object instead of separately deciding dictionary scope and machine scope.
export function createOverlayClassifier(model, catalog) {
  const { doc } = model;
  const { common, settings, shortcuts, workflows, mywork, accountSettings } = model.labels;
  const { hardProtectedSelector, protectedSelector, formControlSelector, dialogDataSelector,
    shortcutModifier, shortcutKey, emptyLabels, fixedMenuRoots, fixedSubmenus } = model.config;

  function settingsDialog(element) {
    const dialog = element?.closest?.('[role="dialog"]');
    return dialog && ['Settings', '设置'].includes(model.dialogName(dialog)) ? dialog : null;
  }
  function settingsNavigationList(element) {
    const nav = element.closest('nav');
    const list = element.closest('ul');
    return nav && list && list === nav.querySelector('ul') ? list : null;
  }
  function settingsAccountSurface(element) {
    const dialog=settingsDialog(element);
    if(!dialog||element.closest('nav'))return null;
    for(const header of dialog.querySelectorAll('[data-settings-header="true"]')) {
      const root=header.parentElement,list=root?.querySelector(':scope > ul[role="list"]');
      if(!list||!root.contains(element)||model.originalContent(header.querySelector('h2')||header).trim()!=='Connected accounts')continue;
      if([...header.querySelectorAll('button[aria-haspopup="menu"]')].some(button=>model.originalContent(button).trim()==='Add account'))return {header,list};
    }
    return null;
  }
  function settingsAccountField(element,name) {
    const surface=settingsAccountSurface(element);if(!surface)return null;
    const {header,list}=surface;
    if(header.contains(element))return 'ui';
    const row=element.closest('li');
    if(!row||row.parentElement!==list)return 'data';
    const identity=row.querySelector('[data-component="Avatar"]')?.parentElement;
    if(!identity)return 'data';
    if(identity.contains(element)) {
      if(element.matches('button')&&name==='aria-label'&&model.originalAttr(element,name)==='Account actions')return 'ui';
      // The default badge is beside a name paragraph, never the paragraph itself.
      const badge=element.closest('span');
      return name==='#text'&&badge?.previousElementSibling?.matches('p')&&model.originalContent(badge).trim()==='Default'?'ui':'data';
    }
    const divider=identity.nextElementSibling;
    const billing=divider?.matches('hr')?divider.nextElementSibling:null;
    if(!billing?.contains(element))return 'data';
    const plan=element.closest('section');
    if(plan&&billing.contains(plan)) {
      const heading=plan.querySelector(':scope > h3');
      if(!heading||model.originalContent(heading).trim()!=='Plan')return 'data';
      if(heading.contains(element))return 'ui';
      const planName=heading.nextElementSibling;
      if(planName?.contains(element))return 'data';
      for(const meter of plan.querySelectorAll('[role="progressbar"]')) {
        const labelRow=meter.previousElementSibling,label=labelRow?.firstElementChild;
        if(label?.matches('span')&&labelRow.children.length===2&&label.contains(element))return 'ui';
      }
      const note=element.closest('p');
      return note&&note.parentElement===plan&&note!==planName&&note.querySelector('a[href]')?'ui':'data';
    }
    // A heading/help pair next to the fixed upgrade action is UI, not account data.
    for(const button of billing.querySelectorAll('button')) {
      if(model.originalContent(button).trim()!=='Upgrade plan')continue;
      const group=button.parentElement;
      if(group.querySelector('h3')&&group.contains(element))return 'ui';
    }
    return 'data';
  }
  function shortcutDialog(element) {
    const dialog = element?.closest?.('[role="dialog"]');
    if (!dialog || settingsDialog(element)) return null;
    const keycaps = [...dialog.querySelectorAll('kbd')].map(node => node.textContent.trim()).filter(Boolean);
    const title = [...dialog.querySelectorAll('h1,h2,h3,[role="heading"]')]
      .map(node => model.originalContent(node).trim()).find(Boolean) || '';
    const hasShortcutChrome = Boolean(dialog.querySelector('[role="tablist"]')) || ['Keyboard shortcuts','键盘快捷键'].includes(title);
    if (hasShortcutChrome && keycaps.length >= 2) return dialog;
    const leaves = [...dialog.querySelectorAll('*')]
      .filter(node => node.children.length === 0 && !node.matches('script,style,input,textarea'))
      .map(node => node.textContent.trim()).filter(Boolean);
    const modifiers = leaves.filter(text => shortcutModifier.test(text)).length;
    const keys = leaves.filter(text => shortcutKey.test(text)).length;
    return hasShortcutChrome && modifiers >= 2 && keys >= 5 ? dialog : null;
  }
  const shortcutKeyText = text => shortcutKey.test((text || '').trim());

  function commandPaletteDialog(element) {
    const dialog=element?.closest?.('[role="dialog"]');
    return dialog && ['Command palette',common['Command palette']].includes(model.dialogName(dialog)) ? dialog : null;
  }
  function commandPaletteField(element,name) {
    const dialog=commandPaletteDialog(element); if(!dialog)return null;
    if(element.matches('input') && name!=='#text')return 'ui';
    const group=element.closest('[role="group"]');
    if(!group)return element===dialog ? 'ui' : null;
    const headingId=group.getAttribute('aria-labelledby');
    const heading=headingId&&doc.getElementById(headingId);
    const groupName=heading&&model.originalContent(heading).trim();
    if(heading?.contains(element))return 'ui';
    const option=element.closest('[role="option"]');
    if(!option)return 'ui';
    if(groupName==='Recent'||groupName===common.Recent) {
      const source=name==='#text'?model.originalContent(element).trim():model.originalAttr(element,name);
      return source==='No project'||source===common['No project']?'ui':'data';
    }
    return 'ui';
  }

  function sessionInfoDialog(element) {
    const menu=element?.closest?.('[role="menu"]');
    if(menu&&menuKind(menu)==='session-info'&&menu.querySelector('dl')&&
        (element.closest('dl')||/^Copy (?:path|session name|session ID),/.test(model.originalAttr(element.closest('[role="menuitem"][aria-label]')||element,'aria-label')||'')))return menu;
    const dialog=element?.closest?.('[role="dialog"]');
    if(!dialog||settingsDialog(element)||shortcutDialog(element)||commandPaletteDialog(element))return null;
    const owner=dialog.id&&[...doc.querySelectorAll('[aria-controls]')].find(control=>(control.getAttribute('aria-controls')||'').split(/\s+/).includes(dialog.id));
    const ownerLabel=owner&&model.originalAttr(owner,'aria-label');
    const heading=[...dialog.querySelectorAll('h1,h2,h3,[role="heading"]')].map(node=>model.originalContent(node).trim()).find(Boolean);
    return /, session information$/.test(ownerLabel||'')||heading==='Session information'||heading===common['Session information']?dialog:null;
  }
  function sessionInfoTemplate(text,element) {
    if(!sessionInfoDialog(element))return null;
    const key=(text||'').trim();
    if(!key)return null;
    const untracked=key.match(/^(.+?) Untracked$/);
    if(untracked)return text.replace(key,`${untracked[1]} 未跟踪`);
    const cached=key.match(/^\((.+?) cached\)$/);
    if(cached)return text.replace(key,`（${cached[1]} 已缓存）`);
    const reasoning=key.match(/^\((.+?) reasoning\)$/);
    if(reasoning)return text.replace(key,`（${reasoning[1]} 推理）`);
    const branch=key.match(/^Copy branch,\s*(.+)$/);
    if(branch)return text.replace(key,`复制分支，${branch[1]}`);
    const copyData=key.match(/^Copy (base branch|path|session name|session ID),\s*(.+)$/);
    if(copyData) {
      const labels={'base branch':'基础分支','path':'路径','session name':'会话名称','session ID':'会话 ID'};
      return text.replace(key,()=>`复制${labels[copyData[1]]}，${copyData[2]}`);
    }
    if(key==='cached)')return text.replace(key,'已缓存)');
    if(key==='reasoning)')return text.replace(key,'推理)');
    return null;
  }
  function sessionInfoField(element,name) {
    const dialog=sessionInfoDialog(element);if(!dialog)return null;
    if(dialog.matches('[role="menu"]')&&!element.closest('dl')) {
      const item=element.closest('[role="menuitem"][aria-label]');
      const copy=item&&(model.originalAttr(item,'aria-label')||'').match(/^Copy (path|session name|session ID),\s*(.+)$/);
      if(!copy)return 'data';
      if(element===item&&name==='aria-label')return 'ui';
      const leaves=[...item.querySelectorAll('span')].filter(node=>!node.children.length&&model.originalContent(node).trim());
      const fixedLabel={path:'Path','session name':'Session name','session ID':'Session ID'}[copy[1]];
      return name==='#text'&&leaves.length>=2&&leaves[0]===element&&model.originalContent(element).trim()===fixedLabel?'ui':'data';
    }
    const source=name==='#text'?model.originalContent(element).trim():(model.originalAttr(element,name)||'').trim();
    if(!source)return null;
    if(element.closest('dt'))return 'ui';
    const branchButton=element.closest('button');
    if(branchButton&&/^Copy (?:branch|base branch|path|session name|session ID),/.test(model.originalAttr(branchButton,'aria-label')||'')) {
      return name==='aria-label'&&element===branchButton?'ui':'data';
    }
    if(element.closest('h1,h2,h3,[role="heading"]'))return 'ui';
    if(['Session information','from','Not enabled','Sent to model','Received from model','cached)','reasoning)'].includes(source))return 'ui';
    if(sessionInfoTemplate(source,element)!=null)return 'ui';
    if(element.closest('button'))return 'ui';
    if(element.closest('dd'))return 'data';
    if(/^(?:\d+(?:\.\d+)?[KMB]?|\d+%|[A-Za-z]:\\|origin\/)/.test(source))return 'data';
    return null;
  }

  function messageChromeControl(element) {
    const control=element?.closest?.('button');
    if(!control)return null;
    if(control.closest('[translate="no"],code,pre,[contenteditable]'))return null;
    if(control.matches('[data-testid="assistant-reasoning-toggle"]'))return 'reasoning';
    if(!control.matches('[data-base-ui-tooltip-trigger][aria-label]'))return null;
    const label=model.originalAttr(control,'aria-label')||'';
    if(!model.has(common,label))return null;
    return /^(?:Copy user message|Edit message|Bookmark to timeline|Share reply as secret gist|Copy assistant message|Fork (?:session|chat) from response)$/.test(label)?'message-action':null;
  }
  function messageInlineTemplate(text,element) {
    if(messageChromeControl(element)!=='reasoning')return null;
    const key=(text||'').trim();
    const match=key.match(/^Thought for (.+)$/);
    if(!match)return null;
    const duration=match[1].replace(/(\d+(?:\.\d+)?)m\b/g,'$1 分钟').replace(/(\d+(?:\.\d+)?)s\b/g,'$1 秒');
    return text.replace(key,`思考了 ${duration}`);
  }

  function composerControl(element) {
    if(!element)return null;
    let control=element.matches?.('[role="textbox"][contenteditable="true"][data-lexical-editor]')?element:null;
    if(!control) {
      const placeholder=element.closest?.('[data-rich-composer-placeholder="true"]');
      const wrapper=placeholder?.closest?.('[data-rich-composer-content-wrapper="true"]');
      control=wrapper?.querySelector?.('[role="textbox"][contenteditable="true"][data-lexical-editor]')||null;
    }
    return control;
  }
  function composerPlaceholderTemplate(text,element,name='#text') {
    if(!composerControl(element))return null;
    if(name==='#text'&&!element.closest('[data-rich-composer-placeholder="true"]'))return null;
    if(name!=='#text'&&!['placeholder','aria-placeholder'].includes(name))return null;
    if(element.closest('[translate="no"],code,pre'))return null;
    const key=(text||'').trim();
    const match=key.match(/^(Ask anything(?: or paste a URL)?\.) Use (.+?)(…|\.\.\.)$/);
    if(!match)return null;
    const pieces=match[2].split(/,\s*(?:or\s+)?|\s+or\s+/);
    const labels={
      '/ for commands':'/ 调用命令',
      '@ files':'@ 引用文件',
      '& sessions':'& 引用会话',
      '& for sessions':'& 引用会话',
      '@ for files':'@ 引用文件',
      '# for issues':'# 引用议题',
      '# issues':'# 引用议题'
    };
    if(!pieces.length||pieces.some(piece=>!labels[piece]))return null;
    const lead=match[1]==='Ask anything or paste a URL.'?'输入问题或粘贴链接。':'输入问题。';
    return text.replace(key,`${lead}使用 ${pieces.map(piece=>labels[piece]).join('，')}…`);
  }
  function composerField(element,name) {
    if(!['placeholder','aria-placeholder'].includes(name)||composerControl(element)!==element)return null;
    const source=model.originalAttr(element,name)||'';
    return composerPlaceholderTemplate(source,element,name)!=null?'ui':null;
  }

  function runOptionsField(element,name) {
    const menu=element.closest('[role="menu"]');
    if(!menu||menuKind(menu)!=='run-options')return null;
    const item=element.closest('[role="menuitem"]');
    if(!item)return 'ui';
    return item.parentElement?.getAttribute('role')==='none'?'data':'ui';
  }

  function workspacePanelTab(element) {
    const tab=element?.closest?.('[role="tab"]');
    if(!tab||!tab.closest('[data-testid="workspace-right-panel-content"]'))return null;
    const label=model.originalAttr(tab,'aria-label')||model.originalContent(tab).trim();
    return ['Changes','更改','Terminal','终端','Browser','浏览器','Files','文件','Side chat','侧边聊天','Insights','洞察','Canvas','画布'].includes(label)?tab:null;
  }
  function workspaceShellField(element,name) {
    if(name!=='#text'||!element.closest('[data-testid="workspace-right-panel-content"]'))return null;
    const source=model.originalContent(element).trim();
    return element.matches('h2')&&['Workspace',common.Workspace].includes(source)?'ui':null;
  }
  function workspaceAddTabField(element,name) {
    const menu=element.closest('[role="menu"]');
    if(!menu||menuKind(menu)!=='workspace-add-tab')return null;
    const group=element.closest('[role="group"]');
    if(!group)return element.closest('[role="menuitem"]')?'ui':'ui';
    const heading=group.querySelector(':scope > [role="presentation"]');
    if(heading?.contains(element))return 'ui';
    const item=element.closest('[role="menuitem"]');
    if(!item)return 'ui';
    const source=name==='#text'?model.originalContent(element).trim():(model.originalAttr(element,name)||'').trim();
    return [', issue','issue','，议题','议题'].includes(source)?'ui':'data';
  }
  function browserPanelField(element,name) {
    const panel=element?.closest?.('[role="tabpanel"]');
    if(!panel)return null;
    const label=model.originalAttr(panel,'aria-label');
    if(!['Browser',common.Browser].includes(label))return null;
    if(element.closest('iframe,webview'))return 'data';
    if(element.matches('input'))return name==='#text'?'data':'ui';
    if(element.closest('button,[role="radio"],[role="radiogroup"]'))return 'ui';
    if(name==='#text'&&element.closest('p'))return 'ui';
    return null;
  }

  function myWorkPane(element) {
    return doc.location?.pathname==='/mywork'?element?.closest?.('main [data-testid="my-work-list-pane"]'):null;
  }
  function myWorkViewControl(element) {
    const control=element?.closest?.('button[aria-haspopup="menu"]');
    if(!control||!myWorkPane(control)||control.closest('[data-testid="my-work-inbox-scroll-container"]'))return null;
    return /^Change view \(currently [a-z][a-z -]*\)$/.test(model.originalAttr(control,'aria-label')||'')?control:null;
  }
  function myWorkField(element,name) {
    if(!myWorkPane(element))return null;
    if(element.closest('[data-testid="my-work-inbox-scroll-container"]')) {
      const blank=element.closest('[data-size].items-center.justify-center');
      const content=blank?.firstElementChild;
      // Match the observed centered empty-state component, not issue rows or
      // arbitrary prose that happens to use the same English words.
      const dataOwner='button,a,[role="row"],[role="listitem"],[role="option"],[role="treeitem"]';
      if(name==='#text'&&blank&&blank.children.length===1&&content?.children.length===2&&
          !blank.closest(dataOwner)&&!blank.querySelector('button,a,input,textarea,select,[contenteditable]')&&
          model.originalContent(content.firstElementChild).trim()==='Nothing here'&&
          [...content.children].some(child=>child===element||child.contains(element)))return 'ui';
      return 'data';
    }
    const picker=element.closest('header button[role="combobox"][aria-haspopup="dialog"]');
    if(picker)return name==='#text'&&model.originalContent(picker).trim()==='All repositories'?'ui':'data';
    if(myWorkViewControl(element))return 'ui';
    return null;
  }
  function myWorkTemplate(text,element,name) {
    if(protectedContent(element)||myWorkField(element,name)!=='ui')return null;
    const key=(text||'').trim();
    if(name==='aria-label'&&myWorkViewControl(element)===element) {
      const view=key.match(/^Change view \(currently (list|board)\)$/);
      if(view)return text.replace(key,()=>`${mywork['Change view']}（当前：${view[1]==='list'?'列表':'看板'}）`);
    }
    if(name==='#text'&&element.closest('[data-testid="my-work-inbox-scroll-container"]')) {
      const filter=key.match(/^No items match "([\s\S]*)"\.$/);
      if(filter)return text.replace(key,()=>`没有符合“${filter[1]}”的项目。`);
    }
    return null;
  }

  function userMenuTrigger(element) {
    const trigger=element?.closest?.('button');
    const label=trigger&&model.originalAttr(trigger,'aria-label');
    return /^.+, open user menu$/.test((label||'').trim())?trigger:null;
  }
  function sessionOptionsTrigger(element) {
    const trigger=element?.closest?.('button[aria-haspopup="menu"]');
    return trigger&&/^.+, session options$/.test(model.originalAttr(trigger,'aria-label')||'')?trigger:null;
  }
  function userMenuField(element,name) {
    const trigger=userMenuTrigger(element);
    if(!trigger)return null;
    // The account name is data, even when it happens to be a dictionary key.
    // Only this fixed accessible action suffix is application-owned chrome.
    return element===trigger&&name==='aria-label'?'ui':'data';
  }
  function sidebarInlineTemplate(text,element) {
    if(userMenuTrigger(element)||sessionOptionsTrigger(element)||myWorkField(element,'aria-label')==='data'||settingsAccountField(element,'aria-label')==='data')return null;
    const key=(text||'').trim();
    if(!key)return null;
    if(element?.matches?.('[data-testid="repository-group-new-workspace-action"]')) {
      const match=key.match(/^New session in (.+)$/);
      if(match)return text.replace(key,'在 '+match[1]+' 中新建会话');
    }
    if(element?.matches?.('[data-testid="repository-group-create-from-action"]')) {
      const match=key.match(/^Create project from pull requests, branches, or issues in (.+)$/);
      if(match)return text.replace(key,`从 ${match[1]} 的拉取请求、分支或议题创建项目`);
    }
    const sessionInfo=key.match(/^(.+), session information$/);
    if(sessionInfo)return text.replace(key,sessionInfo[1]+'，会话信息');
    const sessionTitle=key.match(/^Session: (.+)$/);
    if(sessionTitle)return text.replace(key,'会话：'+sessionTitle[1]);
    return null;
  }
  function chromeInlineTemplate(text,element,name='#text') {
    const key=(text||'').trim();
    if(!key||!element)return null;
    if(name==='aria-label'&&sessionOptionsTrigger(element)===element&&!protectedContent(element)) {
      const session=key.match(/^(.+), session options$/);
      if(session)return text.replace(key,()=>`${session[1]}，会话选项`);
    }
    if(name==='aria-label'&&userMenuTrigger(element)===element&&!protectedContent(element)) {
      const account=key.match(/^(.+), open user menu$/);
      if(account)return text.replace(key,()=>`${account[1]}，打开用户菜单`);
    }
    if(element.matches?.('button[aria-haspopup="menu"]')) {
      const model=key.match(/^(.+?)\s+(Auto|Low|Medium|High|Extra High), model and reasoning$/);
      if(model) {
        const effort=model[2]==='Extra High'?common['Extra High']:common[model[2]];
        if(effort)return text.replace(key,`${model[1]} ${effort}，模型与推理`);
      }
    }
    if(element.matches?.('button[aria-haspopup="dialog"]')) {
      const quota=key.match(/^Chat messages quota:\s*(\d+(?:[.,]\d+)?)% used$/);
      if(quota)return text.replace(key,`聊天消息配额：已用 ${quota[1]}%`);
    }
    if(element.id==='js-global-screen-reader-notice') {
      const status=key.match(/^Model:\s*(.+?)\. Effort:\s*(Auto|Low|Medium|High|Extra High)\. AI credits:\s*(.+?)\. Context:\s*(.+?)\.$/);
      if(status) {
        const effort=status[2]==='Extra High'?common['Extra High']:common[status[2]];
        if(effort)return text.replace(key,`模型：${status[1]}。推理强度：${effort}。AI 点数：${status[3]}。上下文：${status[4]}。`);
      }
    }
    return null;
  }
  function globalChromeControl(element,name) {
    if(!element||element.closest('[role="treeitem"],[role="option"],[role="tab"],[data-testid*="project"],[data-testid*="repository"]'))return false;
    const button=element.closest('button');
    if(button) {
      if(button.matches('[role="combobox"],[role="radio"],[aria-pressed],[data-selected],[aria-haspopup]'))return false;
      const label=model.originalAttr(button,'aria-label')||'';
      if(/^(?:Project|Workspace|Branch):/.test(label)||/model and reasoning$/.test(label)||/, open user menu$/.test(label))return false;
      return name==='#text'||element===button;
    }
    return Boolean(element.closest('label'));
  }

  function settingsDataValue(element, text) {
    const dialog = settingsDialog(element), value = (text || '').trim();
    if (!dialog || !value) return false;
    for (const field of dialog.querySelectorAll('input,textarea,select')) if ((field.value || '').trim() === value) return true;
    for (const picker of dialog.querySelectorAll('[role="combobox"],[role="option"]')) if (model.originalContent(picker).trim() === value) return true;
    return false;
  }
  function settingsVisibleIdentity(element, value) {
    const dialog = settingsDialog(element), identity = (value || '').trim();
    if (!dialog || !identity) return false;
    if (settingsDataValue(element, identity)) return true;
    for (const node of dialog.querySelectorAll('span,p,h1,h2,h3,h4')) {
      if (node === element || node.contains(element) || element.contains?.(node)) continue;
      if (node.children.length === 0 && model.originalContent(node).trim() === identity) return true;
    }
    return false;
  }
  function settingsInlineTemplate(text, element) {
    const key = (text || '').trim();
    if (!settingsDialog(element) || !key) return null;
    if(element.matches('button')&&element.closest('section[data-section-id="accessibility-keyboard"]')) {
      const shortcut=key.match(/^(.*?), edit shortcut for (.+)$/);
      if(shortcut)return text.replace(key,()=>`${shortcut[1]}，编辑“${settings[shortcut[2]]||common[shortcut[2]]||shortcut[2]}”的快捷键`);
      const assign=key.match(/^Assign shortcut for (.+)$/);
      if(assign)return text.replace(key,()=>`为“${settings[assign[1]]||common[assign[1]]||assign[1]}”设置快捷键`);
    }
    if(element.matches('button')&&settingsPopupKind(element)) {
      const pair=key.match(/^([^,]+), (.+)$/);
      if(pair&&(settings[pair[1]]||common[pair[1]])) {
        const duration=pair[2].match(/^(\d+) (seconds?|minutes?)$/);
        const value=settingsPopupKind(element)==='settings-sound'?pair[2]:duration?`${duration[1]} ${duration[2].startsWith('second')?'秒':'分钟'}`:settings[pair[2]]||common[pair[2]]||pair[2];
        return text.replace(key,()=>`${settings[pair[1]]||common[pair[1]]}，${value}`);
      }
    }
    if (key === 'Skip to settings content') return text.replace(key, '跳到设置内容');
    const models = key.match(/^Models \((\d+)\)$/);
    if (models) return text.replace(key, `模型 (${models[1]})`);
    const edit = key.match(/^Edit (.+)$/);
    if (edit && settingsVisibleIdentity(element, edit[1])) return text.replace(key, '编辑 ' + edit[1]);
    const remove = key.match(/^Remove (.+)$/);
    if (remove && settingsVisibleIdentity(element, remove[1])) return text.replace(key, '移除 ' + remove[1]);
    const connected = key.match(/^Connected, (.+)$/);
    if (connected && settingsVisibleIdentity(element, connected[1])) return text.replace(key, '已连接，' + connected[1]);
    const testing=key.match(/^Testing connection, (.+)$/);
    if(testing&&element.matches('button'))return text.replace(key,()=>`正在测试连接，${testing[1]}`);
    const providerStatus = key.match(/^Model provider status checked: (\d+) connected\.$/);
    if (providerStatus) return text.replace(key, `模型提供商状态已检查：已连接 ${providerStatus[1]} 个。`);
    const githubAccount = key.match(/^Provided by your GitHub account (.+)\.$/);
    if (githubAccount) return text.replace(key, `由你的 GitHub 账户 ${githubAccount[1]} 提供。`);
    return null;
  }
  function settingsIdentityLike(text) {
    const value = (text || '').trim();
    return value.length <= 96 && /\d/.test(value) && /^[A-Za-z0-9][A-Za-z0-9 ._+/-]*$/.test(value);
  }
  function settingsFormChrome(element, name) {
    const dialog = settingsDialog(element);
    if (!dialog || element.closest('nav,' + dialogDataSelector)) return false;
    if (name !== '#text') {
      if (!['placeholder','aria-placeholder','title','aria-label'].includes(name)) return false;
      if (element.matches('input,textarea')) return !element.matches('[readonly]');
      if (element.matches('button') && ['title','aria-label'].includes(name)) {
        const value = model.originalAttr(element,name) || '';
        if (settingsInlineTemplate(value,element) !== null) return true;
        return /^(?:Add|Browse|Open|Close|Save|Cancel|Check|Choose|Select|Replace|Reset|Delete)\b/.test(value);
      }
      return false;
    }
    if (element.closest(formControlSelector)) return false;
    const text = model.originalContent(element).trim();
    if (!text || settingsDataValue(element,text) || settingsIdentityLike(text)) return false;
    if (element.closest('label,legend')) return true;
    let choiceOwner = element;
    for (let depth = 0; choiceOwner && choiceOwner !== dialog && depth < 3; depth++, choiceOwner = choiceOwner.parentElement) {
      if (choiceOwner.matches('section,nav,' + dialogDataSelector)) break;
      if (choiceOwner.querySelector('input[type="checkbox"],input[type="radio"],[role="checkbox"],[role="radio"]')) return true;
    }
    const button = element.closest('button');
    if (button && !button.matches('[aria-haspopup],[aria-pressed],[data-selected],[role="combobox"],[role="option"],[role="radio"]')) {
      if (text.includes(' ') || !/^[A-Za-z0-9_.:/@+-]+$/.test(text)) return true;
    }
    if (!text.includes(' ') && /^[A-Za-z0-9_.:/@+-]+$/.test(text)) return false;
    let owner = element;
    for (let depth = 0; owner && owner !== dialog && depth < 3; depth++, owner = owner.parentElement) {
      if (owner.matches('section,nav,' + dialogDataSelector)) return false;
      if (owner.querySelector(formControlSelector)) return true;
    }
    return false;
  }

  function protectedContent(element, attribute = false) {
    if (!element || element.closest(hardProtectedSelector)) return true;
    if (attribute && element.matches('input,textarea,[contenteditable]')) return Boolean(element.parentElement?.closest(protectedSelector));
    return Boolean(element.closest(protectedSelector));
  }
  function popupOwners(popup) {
    const owners = new Set((popup.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id => doc.getElementById(id)));
    if (popup.id) for (const control of doc.querySelectorAll('[aria-controls]')) {
      if (control.getAttribute('aria-controls').split(/\s+/).includes(popup.id)) owners.add(control);
    }
    return [...owners].filter(element => element?.matches('button,[role="button"],[role="menuitem"][aria-haspopup="menu"]') && !protectedContent(element) && !element.closest('[role="treeitem"],[role="option"],[role="tab"]'));
  }
  function settingsPopupKind(trigger) {
    if(!settingsDialog(trigger)||!trigger.matches('button'))return null;
    const label=model.originalAttr(trigger,'aria-label')||model.originalContent(trigger).trim();
    const account=settingsAccountSurface(trigger);
    if(account?.header.contains(trigger)&&label==='Add account')return 'settings-account-add';
    if(account?.list.contains(trigger)&&label==='Account actions')return 'settings-account-actions';
    const id=trigger.closest('section[data-section-id]')?.getAttribute('data-section-id')||'';
    if(!/^(general|sessions|accessibility)-/.test(id))return null;
    const prefix=label.split(',')[0].trim();
    if(['Session complete sound','Needs input sound'].includes(prefix))return 'settings-sound';
    return ['Find in workspace position','Verbosity','Tool permissions','New sessions remote access','Worktree location',
      'Show Copilot CLI Session','Archive merged sessions','Zoom','Error duration','Announcement duration'].includes(prefix)?'settings-choice':null;
  }
  function settingsPopupField(element,name) {
    const popup=element.closest('[role="menu"],[role="listbox"]');
    if(!popup)return null;
    const kind=popup.matches('[role="menu"]')?menuKind(popup):popupOwners(popup).map(settingsPopupKind).find(Boolean);
    if(!kind?.startsWith('settings-'))return null;
    if(kind==='settings-sound') {
      const item=element.closest('[role="menuitem"]');
      const text=item&&model.originalContent(item).trim();
      return {kind,field:item&&['Open audio file…','Open audio file...'].includes(text)?'ui':'data'};
    }
    return {kind,field:'ui'};
  }
  function menuKind(menu, visited = new Set()) {
    if (!menu || visited.has(menu) || visited.size>=6) return null;
    const next = new Set(visited); next.add(menu);
    for(const trigger of popupOwners(menu)) {
      const label=model.originalAttr(trigger,'aria-label') || model.originalContent(trigger).trim();
      const parent=trigger.closest('[role="menu"]');
      if(parent) {
        const parentKind=menuKind(parent,next);
        const prefix=(label||'').split(',')[0].trim();
        if(['user-actions','session-view'].includes(parentKind) && fixedSubmenus.has(prefix))return fixedSubmenus.get(prefix);
        if(parentKind==='model-picker' && (/^Effort\b/.test(prefix)||/^Effort/.test(label||'')))return 'reasoning-effort';
        continue;
      }
      if(/, open user menu$/.test(label || ''))return 'user-actions';
      if(/, session options$/.test(label||''))return 'session-info';
      const settingKind=settingsPopupKind(trigger);
      if(settingKind)return settingKind;
      if(/^Mode: (Interactive|Plan|Autopilot)(,|$)/.test(label || ''))return 'mode';
      if(/^Workspace: /.test(label || ''))return 'workspace-location';
      if(myWorkViewControl(trigger))return 'mywork-view';
      if(fixedMenuRoots.has(label))return fixedMenuRoots.get(label);
      const rootPrefix=(label||'').split(',')[0].trim();
      if(fixedMenuRoots.has(rootPrefix))return fixedMenuRoots.get(rootPrefix);
      if(/model and reasoning$/.test(label || ''))return 'model-picker';
    }
    return null;
  }
  function accountMenuItem(element) {
    const item=element.closest('[role="menuitem"]');
    return item?.querySelector('[data-component="Avatar"]') && menuKind(item.closest('[role="menu"]'))==='user-actions' ? item : null;
  }
  function accountUsage(text,element) {
    if(protectedContent(element))return null;
    const item=accountMenuItem(element);
    const match=item && model.originalAttr(item,'aria-label')?.match(/^(.+), (Chat messages used: (\d+(?:[.,]\d+)?)%)$/);
    if(!match || text.trim()!==match[2] || text.trim()===match[1])return null;
    return text.replace(match[2],'聊天消息已用：'+match[3]+'%');
  }
  function fixedPopup(element) {
    const list = element.closest('[role="listbox"]');
    if (list) {
      const label = model.originalAttr(list, 'aria-label');
      if (label === 'Auto optimization') return 'auto-optimization';
      const setting=popupOwners(list).map(settingsPopupKind).find(Boolean);
      if(setting)return setting;
      return null;
    }
    const menu = element.closest('[role="menu"]');
    if (!menu) return null;
    const kind=menuKind(menu);
    // Keep identity rows out of machine translation. Session metrics and copy
    // attributes have their own narrower classifier above.
    if(kind==='session-info')return null;
    if(kind==='model-picker') {
      const item=element.closest('[role="menuitemcheckbox"]');
      return item && ['Auto',common.Auto].includes(item.textContent.trim()) ? 'model-auto' : null;
    }
    if(kind==='user-actions' && accountMenuItem(element))return null;
    return kind;
  }
  function fixedContent(element) {
    if (!element.closest('main')) return null;
    if (doc.location?.pathname === '/workflows') {
      if (element.closest('[data-testid="workflow-gallery-card"]')) return 'workflow-gallery';
      const parent = element.parentElement;
      if (parent && [...parent.children].some(x => ['Set up automations','设置自动化'].includes(x.textContent.trim())) &&
          [...parent.querySelectorAll('button')].some(x => ['Start automating','开始创建自动化'].includes(x.textContent.trim()))) return 'workflow-intro';
    }
    const card = element.closest('button');
    if (doc.location?.pathname === '/' && card?.classList.contains('group/card') && card.querySelector('p') && model.originalAttr(card,'aria-label')) return 'starter-suggestion';
    return null;
  }
  function fixedTooltip(element) {
    const tip = element.closest('[role="tooltip"],[data-base-ui-focusable][data-side][tabindex="-1"]');
    if (!tip) return false;
    const tipText=model.originalContent(tip).trim();
    // Repository-row actions intentionally live inside protected project-tree
    // data. Base UI portals their short tooltips without an IDREF relation and
    // does not consistently expose data-popup-open on the trigger, so admit
    // only these exact app-owned tooltip strings when the corresponding known
    // action control exists. Repository/session identities remain protected.
    if (['New session',common['New session']].includes(tipText) && doc.querySelector('[data-testid="repository-group-new-workspace-action"]')) return true;
    if (['Create from...','Create from…',common['Create from...'],common['Create from…']].includes(tipText) && doc.querySelector('[data-testid="repository-group-create-from-action"]')) return true;
    const trustedTrigger=trigger=>{
      if(excluded(trigger,true)||myWorkField(trigger,'aria-label')==='data')return false;
      const label=model.originalAttr(trigger,'aria-label')||'';
      if(messageChromeControl(trigger)||fixedSettingsContext(trigger,'aria-label')||model.has(common,label))return true;
      const settingKind=settingsPopupKind(trigger);
      if(settingKind&&settingKind!=='settings-sound')return true;
      if(globalChromeControl(trigger,'aria-label'))return true;
      if(myWorkViewControl(trigger))return true;
      if(sidebarInlineTemplate(label,trigger)!=null)return true;
      const shortcut=label.match(/^(.+?),\s*(?:Ctrl|Control|Alt|Shift|Meta|Command)\b/);
      if(shortcut&&model.has(common,shortcut[1]))return true;
      return /^Mode: (?:Interactive|Plan|Autopilot)(?:,|$)/.test(label);
    };
    if (tip.id && [...doc.querySelectorAll('button[aria-describedby]')].some(trigger =>
      trigger.getAttribute('aria-describedby').split(/\s+/).includes(tip.id) && trustedTrigger(trigger))) return true;
    const triggers=[...doc.querySelectorAll('button[data-base-ui-tooltip-trigger][data-popup-open]')].filter(trustedTrigger);
    if(!triggers.length)return false;
    if(triggers.some(trigger=>{
      const label=model.originalAttr(trigger,'aria-label')||'';
      return tipText===label||tipText===common[label]||model.has(common,tipText);
    }))return true;
    const surfaces=[...new Set(doc.querySelectorAll('[role="tooltip"],[data-base-ui-focusable][data-side][tabindex="-1"]'))]
      .filter(node=>!node.closest('[hidden],[inert],[aria-hidden="true"],[data-closed]'));
    return triggers.length===1&&surfaces.length===1&&surfaces[0]===tip;
  }

  function excluded(element, attribute) {
    if(messageChromeControl(element))return false;
    if (protectedContent(element, attribute)) return true;
    const dialog = settingsDialog(element);
    const popup = fixedPopup(element);
    const menu = element.closest('[role="menu"]');
    if (!popup && menu && element.closest('[role="menuitemcheckbox"]') &&
        popupOwners(menu).some(trigger => /model and reasoning$/.test(model.originalAttr(trigger, 'aria-label') || ''))) return true;
    const sectionId = element.closest('section[data-section-id]')?.getAttribute('data-section-id') || '';
    if (dialog && !popup) {
      if (/^themes-/.test(sectionId) && element.closest('button,[role="radio"],[role="option"]')) return true;
      if (element.closest('[aria-pressed],[data-selected]') && !settingsNavigationList(element)) return true;
      if (/^(accounts|providers|model-providers)-/.test(sectionId)) {
        if (element.closest('[role="listbox"],[role="option"]')) return true;
        const picker = element.closest('[role="combobox"]');
        if (picker) {
          const label = model.originalContent(picker).trim();
          const actionLabel = attribute && picker === element ? (model.originalAttr(picker,'aria-label') || model.originalAttr(picker,'title') || '') : '';
          const fixedAction = /^(?:Add|Browse|Open|Close|Save|Cancel|Check|Choose|Select|Replace|Reset|Delete)\b/.test(actionLabel);
          if (!(model.has(settings,label) || model.has(common,label) || fixedAction)) return true;
        }
      }
    }
    const tree = element.closest('[role="treeitem"]');
    const emptyTree = tree && emptyLabels.includes(tree.textContent.trim());
    if (tree && !emptyTree && !tree.querySelector('#sidebar-group-quick-chats') && !element.closest('#sidebar-group-quick-chats')) return true;
    const emptyLabel = emptyLabels.includes(element.textContent.trim()) && !element.closest('button');
    if (!emptyLabel && element.closest('[id^="workspace-preview-trigger-"], [id^="sidebar-group-"]:not(#sidebar-group-quick-chats)')) return true;
    if (element.closest('[role="tab"], [role="option"]') && !dialog && !popup && !shortcutDialog(element) && !commandPaletteDialog(element) && !workspacePanelTab(element)) {
      if (!(doc.location?.pathname === '/extensions' && element.closest('main [role="tablist"]'))) return true;
    }
    const nav = element.closest('nav');
    if (dialog && nav && element.closest('button') && !settingsNavigationList(element)) return true;
    return false;
  }

  function dictionaryFor(element, attribute, name = attribute ? 'aria-label' : '#text', prevalidated = false) {
    if (!prevalidated && excluded(element, attribute)) return null;
    const settingPopup=settingsPopupField(element,name);
    if(settingPopup)return settingPopup.field==='ui'?(settingPopup.kind.startsWith('settings-account-')?accountSettings:settings):null;
    const accountField=settingsAccountField(element,name);
    if(accountField)return accountField==='ui'?accountSettings:null;
    const userField=userMenuField(element,name);
    if(userField)return userField==='ui'?common:null;
    const workField=myWorkField(element,name);
    if(workField)return workField==='ui'?mywork:null;
    const browserField=browserPanelField(element,name);
    if(browserField)return browserField==='ui'?common:null;
    if(workspaceShellField(element,name))return common;
    const workspaceField=workspaceAddTabField(element,name);
    if(workspaceField)return workspaceField==='ui'?common:null;
    if(workspacePanelTab(element))return common;
    const sessionField=sessionInfoField(element,name);
    if(sessionField)return sessionField==='ui'?common:null;
    const runField=runOptionsField(element,name);
    if(runField)return runField==='ui'?common:null;
    if(messageChromeControl(element))return common;
    const palette=commandPaletteField(element,name);
    if(palette)return palette==='ui'?common:null;
    const catalogField=catalog.field(element,name);
    if(catalogField)return catalogField.dict;
    if(accountMenuItem(element))return null;
    if(settingsDialog(element))return settings;
    if(shortcutDialog(element) && !shortcutKeyText(name==='#text'?model.originalContent(element):model.originalAttr(element,name)))return shortcuts;
    if(fixedTooltip(element))return common;
    if(fixedPopup(element))return common;
    const content=fixedContent(element);
    if(content)return content.startsWith('workflow-')?workflows:common;
    if(emptyLabels.includes(element.textContent.trim()) && element.closest('[role="tree"],aside'))return common;
    if(element.closest('[role="menu"]') && ['Start session in','在以下项目中开始会话'].includes(element.textContent.trim()))return common;
    if(attribute || element.closest('button,[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="tooltip"],label'))return common;
    if(element.closest('#sidebar-heading,#quick-links-heading,#sidebar-sessions-heading'))return common;
    if(element.matches('[role="treeitem"]') && element.children.length===0 && emptyLabels.includes(element.textContent.trim()))return common;
    const page=model.dictionary.pages?.[doc.location?.pathname];
    if(page && element.closest('main'))return page;
    return null;
  }
  function fixedSettingsContext(element,name) {
    const dialog=settingsDialog(element);
    if(!dialog)return null;
    if(element.closest('nav'))return settingsNavigationList(element)&&element.closest('button')?`settings:navigation:${name}`:null;
    if(settingsFormChrome(element,name))return `settings:form-chrome-v2:${name}`;
    const section=element.closest('section[data-section-id]');
    const id=section?.getAttribute('data-section-id');
    if(!id||!/^(general|sessions|themes|accessibility|experimental)-[a-z0-9-]+$/.test(id))return null;
    if(name==='#text') {
      const heading=element.closest('[data-section-heading]');
      const description=element.closest('p');
      const isDescription=description&&[...description.parentElement.children].some(x=>x.matches('[data-section-heading]'));
      const button=element.closest('button');
      const isTheme=/theme/.test(id);
      const isAction=!isTheme&&button&&!button.hasAttribute('aria-haspopup')&&!button.matches('[role="combobox"],[role="option"],[role="radio"],[aria-pressed],[data-selected]')&&(element.closest('[data-component="label"]')||button.matches('[role="switch"]'));
      if(!heading&&!isDescription&&!isAction&&!element.closest('label'))return null;
    } else if(/theme/.test(id)||!element.matches('button,input,textarea')||element.matches('[aria-haspopup],[aria-pressed],[data-selected],[role="radio"]'))return null;
    return `settings:${id}:${name}`;
  }
  function machineContext(element,name,prevalidated = false) {
    if(!model.machine.enabled || (!prevalidated && excluded(element,name!=='#text')))return null;
    if(sessionOptionsTrigger(element))return null;
    const settingPopup=settingsPopupField(element,name);
    if(settingPopup)return settingPopup.field==='ui'?`popup:${settingPopup.kind}:${name}`:null;
    const accountField=settingsAccountField(element,name);
    if(accountField)return accountField==='ui'?`settings:account-chrome-v1:${name}`:null;
    if(userMenuField(element,name))return null;
    const workField=myWorkField(element,name);
    if(workField)return workField==='ui'?`page:mywork-chrome-v1:${name}`:null;
    const browserField=browserPanelField(element,name);
    if(browserField)return browserField==='ui'?`page:browser-chrome-v1:${name}`:null;
    if(workspaceShellField(element,name))return `control:workspace-shell-v1:${name}`;
    const workspaceField=workspaceAddTabField(element,name);
    if(workspaceField)return workspaceField==='ui'?`popup:workspace-add-tab:${name}`:null;
    if(workspacePanelTab(element))return `control:workspace-tab-v1:${name}`;
    const sessionField=sessionInfoField(element,name);
    if(sessionField)return sessionField==='ui'?`dialog:session-info-v1:${name}`:null;
    const runField=runOptionsField(element,name);
    if(runField)return runField==='ui'?`popup:run-options:${name}`:null;
    if(messageChromeControl(element))return `control:message-chrome-v1:${name}`;
    if(accountMenuItem(element))return null;
    const palette=commandPaletteField(element,name);
    if(palette)return palette==='ui'?`dialog:command-palette-v1:${name}`:null;
    const catalogField=catalog.field(element,name);
    if(element.closest('[hidden],[inert],[data-closed],[role="treeitem"],[data-machine-translate="no"]'))return null;
    if(element.closest('[aria-hidden="true"]')&&!catalog.sizingCopy(element,catalogField))return null;
    if(shortcutDialog(element)) {
      const source=name==='#text'?model.originalContent(element):model.originalAttr(element,name);
      return shortcutKeyText(source)?null:`dialog:shortcut-v1:${name}`;
    }
    if(element.closest('[role="tab"]')&&!catalogField?.tab)return null;
    if(catalogField)return ['ui','description','category'].includes(catalogField.kind)?`page:catalog-${catalogField.kind}${catalogField.kind==='description'?'-v1':''}:${name}`:null;
    if(fixedTooltip(element))return `tooltip:fixed-control:${name}`;
    const popup=fixedPopup(element);
    if(popup&&!element.closest('input,[role="combobox"]'))return `popup:${popup}:${name}`;
    const settingsContext=fixedSettingsContext(element,name);
    if(settingsContext)return settingsContext;
    if(element.closest('[role="option"],[role="combobox"],[role="listbox"]'))return null;
    const content=fixedContent(element);
    if(content)return `page:${content}:${name}`;
    const dialog=element.closest('[role="dialog"]');
    const feedback=dialog&&['Share feedback',common['Share feedback']].includes(model.dialogName(dialog));
    if(feedback&&(name!=='#text'||element.closest('label,p,button')))return `dialog:feedback:${name}`;
    if(globalChromeControl(element,name))return `control:chrome-v1:${name}`;
    return null;
  }

  // Single public resolution point used by scanning, explain(), late machine
  // replies and restore-on-move. This is the central invariant of the refactor.
  function resolve(element,name) {
    const attribute=name!=='#text';
    if(composerField(element,name))return {route:'ui',dict:common,context:null};
    if(!element||excluded(element,attribute))return {route:'protected',dict:null,context:null};
    const sessionTrigger=sessionOptionsTrigger(element);
    if(sessionTrigger&&(name!=='aria-label'||element!==sessionTrigger))return {route:'data',dict:null,context:null};
    const soundControl=element.closest('button');
    if(soundControl&&settingsPopupKind(soundControl)==='settings-sound'&&(name==='#text'||element!==soundControl))return {route:'data',dict:null,context:null};
    if(settingsPopupField(element,name)?.field==='data')return {route:'data',dict:null,context:null};
    if(settingsAccountField(element,name)==='data')return {route:'data',dict:null,context:null};
    if(userMenuField(element,name)==='data')return {route:'data',dict:null,context:null};
    if(myWorkField(element,name)==='data')return {route:'data',dict:null,context:null};
    const browserField=browserPanelField(element,name);
    if(browserField==='data')return {route:'data',dict:null,context:null};
    const workspaceField=workspaceAddTabField(element,name);
    if(workspaceField==='data')return {route:'data',dict:null,context:null};
    const sessionField=sessionInfoField(element,name);
    if(sessionField==='data')return {route:'data',dict:null,context:null};
    const runField=runOptionsField(element,name);
    if(runField==='data')return {route:'data',dict:null,context:null};
    const catalogField=catalog.field(element,name);
    if(catalogField?.kind==='data')return {route:'data',dict:null,context:null,catalog:catalogField};
    if(accountMenuItem(element))return {route:'account-template',dict:null,context:null};
    const dict=dictionaryFor(element,attribute,name,true);
    const context=machineContext(element,name,true);
    return {route:'ui',dict,context,catalog:catalogField};
  }

  function inlineTemplate(text,element,name='#text') {
    return composerPlaceholderTemplate(text,element,name) ?? myWorkTemplate(text,element,name) ?? sidebarInlineTemplate(text,element) ?? chromeInlineTemplate(text,element,name) ?? settingsInlineTemplate(text,element) ?? sessionInfoTemplate(text,element) ?? messageInlineTemplate(text,element);
  }
  return {
    resolve, excluded, protectedContent, dictionaryFor, machineContext, inlineTemplate,
    accountUsage, accountMenuItem, fixedPopup, fixedTooltip, settingsDialog,
    sidebarInlineTemplate, settingsInlineTemplate, sessionInfoDialog, sessionInfoField,
    chromeInlineTemplate, composerPlaceholderTemplate, composerField, composerControl,
    messageChromeControl, messageInlineTemplate, runOptionsField, workspacePanelTab, workspaceShellField,
    workspaceAddTabField, browserPanelField, commandPaletteField
  };
}
