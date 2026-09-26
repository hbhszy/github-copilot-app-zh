// Shared by the Node backend and the DOM overlay; no application content access.
export function createMachinePolicy() {
  const version = '5';
  // New catalog-only rules have their own cache context. Existing version-5
  // contexts are unchanged, so previously validated UI caches remain usable.
  const isCatalog = context => context === 'page:catalog-description-v1:#text';
  const preservesLiterals = context => isCatalog(context) || /^settings:form-chrome-v\d+:/.test(context);
  const literals = /`[^`\r\n]{1,300}`|\{[^{}\r\n]{1,300}\}|https?:\/\/[^\s<>`"'()\[\]]+|\b[A-Za-z]:\\[^\s<>`]+|\b(?:[\w.-]+\/)+[\w.-]+|\b[\w.-]+\.(?:exe|json|md|js|ts|py|txt|html|yml|yaml)\b/g;
  const literalValues = text => (text.match(literals) || []).sort();
  const tokens = /\{[A-Za-z_][\w.]*\}|%(?:\d+\$)?[sdif]|\b(?:Ctrl|Control|Alt|Shift|Meta|Command)(?:\s*\+\s*(?:[A-Za-z0-9]+))+|\b\d+(?:[.,]\d+)*\b/g;
  const terms = {
    'github copilot': 'GitHub Copilot', 'github': 'GitHub', 'vs code': 'VS Code',
    'pull requests': '拉取请求', 'pull request': '拉取请求',
    'worktrees': '工作树', 'worktree': '工作树', 'branches': '分支', 'branch': '分支',
    'repositories': '仓库', 'repository': '仓库', 'commits': '提交', 'commit': '提交'
  };
  const formTerms = {
    'display name':'显示名称', 'base url':'基础 URL', 'wire api':'API 协议', 'wire format':'协议格式',
    'api key':'API 密钥', 'custom headers':'自定义请求头', 'chat completions':'Chat Completions', 'responses':'Responses'
  };
  const protectedValues = text => (text.match(tokens) || []).sort();
  function eligible(text, context = '') {
    // The DOM classifier establishes ownership, not the word count or dictionary.
    // A new one-word UI label is as eligible as a sentence in an approved scope.
    const fixedLabel = typeof context === 'string' && /^(settings|popup|page|dialog|tooltip|control):[a-z0-9-]+:(#text|aria-label|title|placeholder|aria-placeholder)$/.test(context);
    const catalog = isCatalog(context), literalAware = preservesLiterals(context);
    if (typeof text !== 'string' || text.length < (fixedLabel ? 2 : 5) || text.length > (catalog ? 2400 : 480) || /CPZH\d/i.test(text)) return false;
    const prose = literalAware ? text.replace(literals, '') : text;
    if (/[^\x20-\x7e\t\r\n\u2013\u2014\u2018\u2019\u201c\u201d\u2026]/.test(prose)) return false;
    if (/https?:|www\.|[@\\/`<>=]|\b\w+\.(?:exe|json|md|js|ts|py|txt|com|org)\b/i.test(prose)) return false;
    if ((literalAware ? /[{}\[\]]/ : /[{}\[\];]/).test(prose.replace(tokens, ''))) return false;
    return (prose.match(/\b[A-Za-z]{2,}\b/g) || []).length >= (fixedLabel ? 1 : 2);
  }
  function valid(source, output, context = '') {
    if (typeof source !== 'string' || typeof output !== 'string' || output.length > Math.max(80, source.length * 2) || /[\n\r\x00-\x1f]|CPZH\d/i.test(output)) return false;
    const literalAware = preservesLiterals(context);
    if (literalAware && JSON.stringify(literalValues(source)) !== JSON.stringify(literalValues(output))) return false;
    const prose = literalAware ? output.replace(literals, '') : output;
    if (!/[\u3400-\u9fff]/.test(prose) || /[<>`]|https?:/i.test(prose)) return false;
    return JSON.stringify(protectedValues(source)) === JSON.stringify(protectedValues(output));
  }
  function prepare(source, context = '') {
    const values = [];
    const mask = value => { const key = `{CPZH${values.length}}`; values.push({ key, value }); return key; };
    // Keep native placeholders/counts visible: replacing different semantic values
    // with indistinguishable markers can make an MT model swap their roles.
    const protectedSource = preservesLiterals(context) ? source.replace(literals, mask) : source;
    const vocabulary = /^settings:form-chrome-v\d+:/.test(context) ? {...terms,...formTerms} : terms;
    const termRx = new RegExp('\\b(?:' + Object.keys(vocabulary).sort((a,b)=>b.length-a.length).join('|') + ')\\b', 'gi');
    const text = protectedSource.replace(/\s+/g, ' ').replace(termRx, term => mask(vocabulary[term.toLowerCase()]));
    return { text, restore(output) {
      if (typeof output !== 'string') return null;
      for (const {key} of values) if (output.split(key).length !== 2) return null;
      const result = output.replace(/\{CPZH(\d+)\}/g, (key, i) => values[Number(i)]?.value ?? key).trim().replace(/([\u3400-\u9fff]) +(?=[\u3400-\u9fff])/g,'$1');
      return valid(source, result, context) ? result : null;
    } };
  }
  return { version, eligible, valid, prepare };
}
