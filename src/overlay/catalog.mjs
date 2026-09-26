// Customize/catalog-specific ownership rules. Identity/name nodes are treated
// as data; only catalog chrome, public descriptions and fixed actions are UI.
export function createCatalogSurface(model) {
  const { doc } = model;
  const { catalog: catalogLabels, catalogCategories, catalogDescriptions, catalogBadges, catalogTemplates } = model.labels;
  const { catalogPanels } = model.config;
  const catalogData = { kind:'data', dict:null };

  function reset() { model.resetCatalogCache(); }
  function template(text, identity) {
    const key = text.trim();
    const details = key.match(/^(.+), view details$/);
    if (details && (identity == null || details[1] === identity)) return text.replace(key, details[1] + '，查看详情');
    const actions = key.match(/^Actions for (.+)$/);
    if (actions && (identity == null || actions[1] === identity)) return text.replace(key, actions[1] + '的操作');
    const action = key.match(/^(Add server|Install skill|Install|Uninstall|Enable|Disable|Open in new session)(: |, | )(.+)$/);
    if (action && (identity == null || action[3] === identity)) {
      const labels = {'Add server':'添加服务器','Install skill':'安装技能',Install:'安装',Uninstall:'卸载',Enable:'启用',Disable:'停用','Open in new session':'在新会话中打开'};
      return text.replace(key, labels[action[1]] + (action[2] === ' ' ? ' ' : '：') + action[3]);
    }
    return null;
  }
  function item(row) {
    const cache = model.catalogCache.items;
    if (cache.has(row)) return cache.get(row);
    const selector = 'li,[class~="group/row"]';
    const paragraphs = [...row.querySelectorAll('p')].filter(p => p.closest(selector) === row);
    const title = paragraphs[0];
    const identityNode = title?.firstElementChild?.tagName === 'SPAN' ? title.firstElementChild : title;
    const identity = identityNode && model.originalContent(identityNode).trim();
    const primary = identity && [...row.querySelectorAll('button[aria-label]')].find(button => {
      const label = model.originalAttr(button,'aria-label');
      return label === identity || label === identity + ', view details';
    });
    let description = null;
    if (primary?.hasAttribute('aria-describedby')) {
      description = primary.getAttribute('aria-describedby').split(/\s+/).map(id => doc.getElementById(id))
        .find(p => p?.matches('p') && p !== title && p.closest(selector) === row && primary.contains(p));
    } else if (primary && !primary.textContent.trim() && paragraphs[1] &&
        (title.parentElement === paragraphs[1].parentElement || title.parentElement.parentElement === paragraphs[1].parentElement)) {
      description = paragraphs[1];
    }
    const result = { row, title, identityNode, identity, primary, description, metadata:paragraphs[1] };
    cache.set(row,result);
    return result;
  }
  function field(element, name = '#text') {
    if (doc.location?.pathname !== '/extensions' || !element?.closest('main') || element.closest('[role="dialog"],[role="menu"],[role="listbox"]')) return null;
    const cache = model.catalogCache.fields;
    let fields = cache.get(element);
    if (!fields) { fields = new Map(); cache.set(element,fields); }
    if (fields.has(name)) return fields.get(name);
    const result = classify(element,name);
    fields.set(name,result);
    return result;
  }
  function classify(element, name) {
    const ui = {kind:'ui',dict:catalogLabels};
    if (element.closest('[data-customize-category-header-row]')) {
      if (element.closest('[role="tab"],[data-customize-category-tabs-root]')) return {...ui,tab:true};
      if (element.matches('input') && name !== '#text' || element.closest('button')) return ui;
      return catalogData;
    }
    const panel = element.closest('[role="tabpanel"]');
    const panelName = panel && model.originalAttr(panel,'aria-label');
    if (!catalogPanels.has(panelName)) return panel ? catalogData : null;
    const section = element.closest('section');
    const ids = (section?.getAttribute('aria-labelledby') || '').split(/\s+/);
    let heading = ids.map(id => doc.getElementById(id)).find(h => h?.matches('h2,h3') && h.closest('section') === section);
    const virtualList = panelName === 'Plugins' && section?.querySelector('[data-testid="virtualized-available-plugins"][role="list"][aria-label="Available plugins"]');
    if (!heading && virtualList) heading = section.querySelector('h2');
    const id = heading?.id || '';
    const publicSection = Boolean(heading && ((panelName !== 'Installed' && id.startsWith('featured-')) ||
      panelName === 'MCP' && id === 'mcp-available-heading' || virtualList));
    const localSection = Boolean(heading && (panelName === 'Installed' && id.startsWith('installed-') ||
      panelName === 'Skills' && id === 'skills-all-heading' || panelName === 'Canvas' && id === 'canvas-available-heading'));
    const row = element.closest('li,[class~="group/row"]');
    if (row && section?.contains(row)) {
      const list = row.closest('[role="list"]');
      const ownedList = list && list.closest('section') === section &&
        ((list.getAttribute('aria-labelledby') || '').split(/\s+/).includes(id) || list === virtualList);
      if (!(publicSection && ownedList || localSection)) return catalogData;
      const current = item(row);
      if (!current.identity) return catalogData;
      if (name !== '#text' && element === current.primary) {
        return name === 'aria-label' && template(model.originalAttr(element,name) || '',current.identity) !== null ? {kind:'template',dict:catalogTemplates} : catalogData;
      }
      if (name === '#text' && current.title?.contains(element)) {
        return !current.identityNode.contains(element) && model.has(catalogBadges,model.originalContent(element).trim()) ? {kind:'badge',dict:catalogBadges} : catalogData;
      }
      if (name === '#text' && publicSection && current.description?.contains(element)) return {kind:'description',dict:catalogDescriptions};
      if (name === '#text' && localSection && current.metadata?.contains(element)) return {kind:'badge',dict:catalogBadges};
      const action = element.closest('button');
      if (action && action !== current.primary) {
        const source = name === '#text' ? model.originalContent(element) : model.originalAttr(element,name);
        if (source && template(source,current.identity) !== null) return {kind:'template',dict:catalogTemplates};
        if (name === '#text' && element.closest('[data-component="label"]') || name !== '#text' && element === action && !source?.includes(current.identity)) return ui;
        return {kind:'badge',dict:catalogBadges};
      }
      if (name === '#text' && model.has(catalogBadges,model.originalContent(element).trim())) return {kind:'badge',dict:catalogBadges};
      return catalogData;
    }
    if (publicSection || localSection) {
      const tabs = element.closest('[role="tablist"]');
      if (tabs && model.originalAttr(tabs,'aria-label') === 'Filter available MCP servers by category' && panelName === 'MCP') return {kind:'category',dict:catalogCategories,tab:true};
      if (heading.contains(element)) return ui;
      const paragraph = element.closest('p');
      if (paragraph?.parentElement === heading.parentElement) return ui;
      const button = element.closest('button');
      if (button?.matches('[role="combobox"]')) {
        if (name === 'aria-label' && element === button || name === '#text' && model.originalContent(element).trim() === 'All marketplaces') return ui;
        return catalogData;
      }
      if (button) return ui;
      if (paragraph?.parentElement?.parentElement === section) return ui;
      if (paragraph && model.originalContent(paragraph).trim() === 'Built-in') return {kind:'badge',dict:catalogBadges};
      return catalogData;
    }
    const empty = element.closest('[data-size="medium"]');
    if (empty && panel.contains(empty) && empty.querySelector('h2') && !empty.querySelector('li,[class~="group/row"]')) return ui;
    return catalogData;
  }
  function sizingCopy(element, current) {
    const hidden = element.closest('[aria-hidden="true"]');
    if (!hidden || !current?.tab || !hidden.closest('[role="tab"]') || hidden.parentElement?.children.length !== 2) return false;
    return [...hidden.parentElement.children].some(sibling => sibling !== hidden && !sibling.hasAttribute('aria-hidden') && model.originalContent(sibling) === model.originalContent(hidden));
  }
  return { reset, template, field, sizingCopy };
}
