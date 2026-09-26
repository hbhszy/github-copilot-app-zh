// Read-only capability probe; only public diagnostic strings, no app content.
import { readFile, writeFile } from 'node:fs/promises';
import { CDP, getTargets, isAppTarget } from '../src/cdp.mjs';
const state = JSON.parse(await readFile('.local/state.json', 'utf8'));
const target = (await getTargets(state.port)).find(isAppTarget);
if (!target) throw new Error('Copilot page not found');
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
try {
  const result = await cdp.send('Runtime.evaluate', {
    userGesture: true, returnByValue: true, awaitPromise: true,
    expression: `(async()=>{
      const result={ua:navigator.userAgent,secure:isSecureContext,translator:typeof Translator,
        policy:document.featurePolicy?.allowsFeature('translator'),activation:navigator.userActivation.isActive};
      if(typeof Translator==='undefined')return result;
      result.pairs=await Promise.all(['zh','zh-Hans','zh-Hant','es','fr','ja','en'].map(async to=>({to,result:await Translator.availability({sourceLanguage:'en',targetLanguage:to})})));
      try{const t=await Translator.create({sourceLanguage:'en',targetLanguage:'zh'});result.sample=await t.translate('Choose where new sessions start.');t.destroy()}
      catch(e){result.error={name:e.name,message:e.message}}
      return result;
    })()`
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  const report = { date:new Date().toISOString(), ...result.result.value };
  await writeFile('.local/copilot-translator-report.json', JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally { cdp.close(); }
