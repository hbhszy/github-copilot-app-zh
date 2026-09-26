const protectedSubtree = [
  'script', 'style', 'svg', 'code', 'pre', 'kbd', 'samp', 'textarea', 'input', '[contenteditable]',
  '[data-lexical-editor]', '.monaco-editor', '.cm-editor', '.xterm', '.markdown-body', '.prose',
  '[data-message-id]', '[data-message-role]', '[data-testid*="message-content"]', '[data-diff]',
  '[data-file-path]', '[data-selectable="true"]', '[translate="no"]', '[role="treeitem"]',
  '[role="option"]', '[role="listbox"]', '[aria-hidden="true"]', '[hidden]', '[inert]'
].join(',');
const inspectableAttributes = ['aria-label', 'title', 'placeholder', 'aria-placeholder'];
const attributeOwners = 'button,[role="button"],[role^="menuitem"],[role="dialog"],[role="menu"],[role="tooltip"],[role="tab"],[role="combobox"],[role="switch"],[role="checkbox"],[role="radio"],label,input,textarea';

function safeRole(element) {
  const role = element.getAttribute('role') || '';
  return /^[a-z-]{1,32}$/i.test(role) ? role : null;
}

function structuralPath(element) {
  const parts = [];
  for (let current = element; current && current !== element.ownerDocument.body; current = current.parentElement) {
    const parent = current.parentElement;
    if (!parent) break;
    const siblings = [...parent.children].filter(sibling => sibling.tagName === current.tagName);
    parts.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(current) + 1})`);
  }
  return ['body', ...parts.slice(-16)].join(' > ');
}

export function discoverUntranslated(document, api, { includeText = false, limit = 300 } = {}) {
  const status = api?.status?.();
  if (!api?.enabled || !status?.ready) throw new Error('The translation overlay is not ready');
  const root = document.body;
  if (!root) throw new Error('The app page has no document body');
  const maxCandidates = Math.min(1000, Math.max(1, Number(limit) || 300));
  const rows = new Map();
  let inspected = 0;
  let truncated = false;
  const allowedRoutes = new Set(['unclassified', 'text-filter']);
  const visible = element => {
    for (let current = element; current && current !== root.parentElement; current = current.parentElement) {
      if (current.hidden || current.inert || current.getAttribute('aria-hidden') === 'true') return false;
      const style = document.defaultView.getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  };
  const add = (element, name, readSource, subject = element) => {
    if (inspected >= 12000) { truncated = true; return; }
    inspected++;
    if (!visible(element)) return;
    const decision = api.explain(subject, name);
    if (!allowedRoutes.has(decision.route)) return;
    const source = readSource();
    if (!source || source.length > 480 || !/[A-Za-z]{2}/.test(source)) return;
    const route = decision.route;
    const path = structuralPath(element);
    const key = `${path}\n${name}\n${route}\n${decision.context || ''}${includeText ? `\n${source}` : ''}`;
    let row = rows.get(key);
    if (!row) {
      if (rows.size >= maxCandidates) { truncated = true; return; }
      row = {
        path,
        tag: element.tagName.toLowerCase(),
        role: safeRole(element),
        field: name,
        route,
        context: decision.context || null,
        characters: source.length,
        occurrences: 0
      };
      if (includeText) row.source = source;
      rows.set(key, row);
    }
    row.occurrences++;
  };

  for (const element of document.querySelectorAll(attributeOwners)) {
    if (!visible(element)) continue;
    for (const name of inspectableAttributes) {
      if (element.hasAttribute(name)) add(element, name, () => api.originalAttribute ? api.originalAttribute(element, name) : element.getAttribute(name));
    }
    if (inspected >= 12000 || rows.size >= maxCandidates) { truncated = true; break; }
  }

  const walker = document.createTreeWalker(root, document.defaultView.NodeFilter.SHOW_ELEMENT | document.defaultView.NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === 1 && node !== root && node.matches(protectedSubtree)) return document.defaultView.NodeFilter.FILTER_REJECT;
      return document.defaultView.NodeFilter.FILTER_ACCEPT;
    }
  });
  let node = root;
  while (node) {
    if (node.nodeType === 3) add(node.parentElement, '#text', () => api.originalText ? api.originalText(node)?.trim() : node.nodeValue?.trim(), node);
    if (inspected >= 12000 || rows.size >= maxCandidates) { truncated = true; break; }
    node = walker.nextNode();
  }
  return {
    routeGroup: document.location?.pathname === '/' ? 'home' : document.location?.pathname === '/extensions' ? 'customize' : document.location?.pathname === '/workflows' ? 'workflows' : 'other',
    inspected,
    truncated,
    includeText,
    candidates: [...rows.values()]
  };
}
