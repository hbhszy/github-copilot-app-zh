// Shared mutable state for the browser-side overlay. Kept deliberately small
// enough that classifiers can be tested independently from the DOM observer.
export function createOverlayModel(dictionary, doc, options = {}) {
  const view = doc.defaultView || window;
  const common = dictionary.common;
  const settings = dictionary.settings;
  const hardProtectedSelector = [
    'script', 'style', 'code', 'pre', 'kbd', 'samp', '[data-selectable="true"]',
    '.monaco-editor', '.cm-editor', '.xterm', '.markdown-body', '.prose',
    '[data-message-id]', '[data-message-role]', '[data-testid*="message-content"]',
    '[data-diff]', '[data-file-path]', '[translate="no"]',
    '[data-testid="project-menu-item"]', '[data-testid="user-workflow"]', '[data-testid="skill-card"]',
    '[aria-label="Conversation transcript"]', '[aria-label="对话记录"]'
  ].join(',');
  const records = new Map();
  const model = {
    dictionary, doc, view, options,
    labels: {
      common,
      settings,
      shortcuts: { ...common, ...settings },
      workflows: { ...common, ...dictionary.pages?.['/workflows'] },
      mywork: { ...common, ...dictionary.mywork },
      accountSettings: { ...common, ...settings, ...dictionary.accountSettings },
      catalog: { ...common, ...dictionary.pages?.['/extensions'], ...dictionary.catalog?.ui },
      catalogCategories: { ...dictionary.catalog?.categories },
      catalogDescriptions: dictionary.catalog?.descriptions || {},
      catalogBadges: { 'Built-in':'内置', Skill:'技能', Plugin:'插件', MCP:'MCP', Canvas:'画布', Installed:'已安装' },
      catalogTemplates: {}
    },
    config: {
      attrs: ['aria-label', 'title', 'placeholder', 'aria-placeholder'],
      emptyLabels: ['No sessions yet','暂无会话','No chats yet','暂无聊天'],
      hardProtectedSelector,
      protectedSelector: hardProtectedSelector + ',textarea,input,[contenteditable],[data-lexical-editor]',
      formControlSelector: 'input:not([type="hidden"]),textarea,select,[role="combobox"],[role="switch"],[role="checkbox"],[role="radio"]',
      dialogDataSelector: '[role="listbox"],[role="option"],[role="tree"],[role="treeitem"],[data-testid="project-menu-item"]',
      shortcutModifier: /^(?:Ctrl|Control|Alt|Shift|Meta|Command)$/i,
      shortcutKey: /^(?:Ctrl|Control|Alt|Shift|Meta|Command|Enter|Return|Esc|Escape|Tab|Space|Backspace|Delete|Home|End|PageUp|PageDown|Arrow(?:Up|Down|Left|Right)|F\d{1,2}|[A-Z0-9]|[\[\]`~!@#$%^&*()_+={}:;"'<>,.?/\\|-])$/i,
      catalogPanels: new Set(['Featured','MCP','Plugins','Skills','Extensions','Canvas','Installed']),
      fixedMenuRoots: new Map([
        ['Add context','add-context'], ['New project or session','new-session'],
        ['Group by','group-by'], ['Sort by','sort-by'], ['Configure sessions','session-view'],
        ['Run options','run-options'], ['Add tab','workspace-add-tab']
      ]),
      fixedSubmenus: new Map([
        ['Theme','color-scheme'],['Group by','group-by'],['Sort by','sort-by'],
        ['Grouping','group-by'],['Ordering','sort-by'],['Show','session-show'],
        ['Status','session-status'],['PR','session-pr'],['Environment','session-environment'],['Source','session-source']
      ])
    },
    records,
    pending: new Set(),
    catalogCache: { fields: new WeakMap(), items: new WeakMap() },
    machine: {
      policy: options.machinePolicy,
      enabled: Boolean(options.machine && options.machinePolicy),
      instance: view.crypto?.randomUUID?.() || String(Date.now()) + Math.random(),
      queue: new Map(),
      seen: new WeakMap(),
      nextId: 0,
      applied: 0,
      skipped: 0,
      overflow: false,
      refills: 0,
      expired: 0,
      notifyPending: false
    },
    lifecycle: {
      enabled: true,
      ready: false,
      reason: null,
      timer: null,
      scheduled: false,
      waiting: null
    },
    stats: { translated: 0, passes: 0, duration: 0 }
  };
  model.has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  model.originalAttr = (element, name) => {
    const record = records.get(element)?.get(name);
    return record && element.getAttribute(name) === record.translated ? record.original : element.getAttribute(name);
  };
  model.originalContent = function originalContent(element) {
    return [...element.childNodes].map(node => node.nodeType === 3
      ? (records.get(node)?.get('#text')?.translated === node.nodeValue ? records.get(node).get('#text').original : node.nodeValue)
      : node.nodeType === 1 ? model.originalContent(node) : '').join('');
  };
  model.dialogName = dialog => {
    const label = model.originalAttr(dialog, 'aria-label');
    if (label) return label;
    return (dialog.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).slice(0, 8)
      .map(id => doc.getElementById(id)).filter(Boolean).map(element => model.originalContent(element).trim()).join(' ');
  };
  model.resetCatalogCache = () => {
    model.catalogCache.fields = new WeakMap();
    model.catalogCache.items = new WeakMap();
  };
  return model;
}
