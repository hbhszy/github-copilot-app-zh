// Deterministic dictionary/templates and record bookkeeping. Machine translation
// is deliberately not invoked here; the runtime owns queueing/backpressure.
export function createOverlayTranslator(model, classifier, catalog) {
  const { common, settings, catalog: catalogLabels, catalogTemplates } = model.labels;

  function translate(text, dict, attribute = false) {
    if (dict === catalogTemplates) return catalog.template(text);
    const key = text.trim();
    let result = model.has(dict, key) ? dict[key] : dict === settings && model.has(common, key) ? common[key] : null;
    if (result == null && dict === catalogLabels) {
      const search = key.match(/^Search (featured extensions|MCP servers|plugins|skills|extensions|canvas|installed)(…|\.\.\.)?$/);
      if (search) {
        const nouns = {'featured extensions':'精选扩展','MCP servers':' MCP 服务器',plugins:'插件',skills:'技能',extensions:'扩展',canvas:'画布',installed:'已安装项目'};
        result = '搜索' + nouns[search[1]] + (search[2] ? '…' : '');
      }
    }
    const autoTier = key.match(/^Auto · (Efficiency|Balance|Intelligence)(, model and reasoning)?$/);
    if (result == null && autoTier) result = '自动 · ' + common[autoTier[1]] + (autoTier[2] ? '，模型与推理' : '');
    if (result == null && attribute) {
      const skillSearch = key.match(/^Search (\d+) skills(…|\.\.\.)?$/);
      if (skillSearch) result = '搜索 ' + skillSearch[1] + ' 项技能' + (skillSearch[2] ? '…' : '');
      const shortcut = key.match(/^(.+?)(, (?:Ctrl|Control|Alt|Shift|Meta|Command)\b.*)$/);
      if (shortcut && model.has(common, shortcut[1])) result = common[shortcut[1]] + shortcut[2];
      const mode = key.match(/^Mode: (Interactive|Plan|Autopilot)(, .+)?$/);
      if (mode) result = '模式：' + common[mode[1]] + (mode[2] || '');
      const pair = key.match(/^(.+?),\s*(.+)$/);
      if (pair && model.has(common,pair[1]) && model.has(common,pair[2])) result = common[pair[1]] + '，' + common[pair[2]];
    }
    if (result == null && dict === settings) {
      const updated = key.match(/^Up to date\. Last checked on (.+)\.$/);
      if (updated) result = '已是最新版本。上次检查：' + updated[1] + '。';
      const seconds = key.match(/^(\d+) seconds?$/);
      if (seconds) result = seconds[1] + ' 秒';
      const announcement = key.match(/^(.+) announcements$/);
      if (announcement && model.has(settings, announcement[1])) result = settings[announcement[1]] + '播报';
    }
    if (result == null) return null;
    return text.slice(0, text.indexOf(key)) + result + text.slice(text.indexOf(key) + key.length);
  }

  function set(node, name, current, value, context = null, dict = null) {
    if (current === value) return false;
    let fields = model.records.get(node);
    if (!fields) { fields = new Map(); model.records.set(node, fields); }
    const prior = fields.get(name);
    fields.set(name, { original: prior && current === prior.translated ? prior.original : current, translated: value, context, dict });
    if (name === '#text') node.nodeValue = value;
    else node.setAttribute(name, value);
    model.stats.translated++;
    return true;
  }

  function immediate(node,name,current,resolution) {
    const element=name==='#text'?node.parentElement:node;
    const account=name==='#text'?classifier.accountUsage(current,element):null;
    const template=classifier.inlineTemplate(current,element);
    const translated=account ?? template ?? (resolution.dict ? translate(current,resolution.dict,name!=='#text') : null);
    return translated == null ? null : { value:translated, dict:resolution.dict };
  }

  function restoreField(node,name,record) {
    if(name==='#text') {
      if(node.nodeValue===record.translated)node.nodeValue=record.original;
    } else if(node.getAttribute(name)===record.translated)node.setAttribute(name,record.original);
  }

  return { translate, set, immediate, restoreField };
}
