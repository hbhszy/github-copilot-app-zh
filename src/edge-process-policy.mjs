import { win32 } from 'node:path';

// Parse quoted switch values, including --user-data-dir="C:\path with spaces".
// Do not infer ownership from a substring of a command line or a launcher PID.
export function windowsArguments(commandLine = '') {
  const args=[];let value='',quoted=false,active=false;
  for(let i=0;i<commandLine.length;i++) {
    const c=commandLine[i];
    if(c==='\\') {
      let count=1;while(commandLine[i+1]==='\\'){count++;i++;}
      if(commandLine[i+1]==='"') {
        value+='\\'.repeat(Math.floor(count/2));i++;
        if(count%2)value+='"';else quoted=!quoted;
      } else value+='\\'.repeat(count);
      active=true;
    } else if(c==='"'){quoted=!quoted;active=true;}
    else if(/\s/.test(c)&&!quoted){if(active){args.push(value);value='';active=false;}}
    else {value+=c;active=true;}
  }
  if(quoted)return []; // Malformed/ambiguous commands fail closed.
  if(active)args.push(value);
  return args;
}
const normalized = value => typeof value==='string' ? win32.normalize(value).replace(/[\\/]+$/,'').toLowerCase() : '';
export function isDedicatedEdge(process, installation, url) {
  if(!process || normalized(process.ExecutablePath)!==normalized(installation.exe))return false;
  const args=windowsArguments(process.CommandLine);
  const values=[];
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--user-data-dir')values.push(args[i+1]);
    else if(args[i].startsWith('--user-data-dir='))values.push(args[i].slice('--user-data-dir='.length));
  }
  return values.length===1 && normalized(values[0])===normalized(installation.profile) &&
    args.includes('--headless=new') && args.includes('--remote-debugging-address=127.0.0.1') &&
    !args.some(a=>a==='--type'||a.startsWith('--type=')) && (!url || args.includes(url));
}
export function resolveEdgeListener(port, listeners, processes, installation, url) {
  if(!Number.isInteger(port)||port<1||port>65535||!listeners.length||listeners.some(l=>![`127.0.0.1:${port}`,`[::1]:${port}`].includes(l.address)))throw Error('翻译端口不是仅回环监听');
  const pids=new Set(listeners.map(l=>l.pid));
  if(pids.size!==1)throw Error('翻译端口归属不唯一');
  const owner=processes.find(p=>p.ProcessId===[...pids][0]);
  if(!isDedicatedEdge(owner,installation,url))throw Error('翻译端口归属校验失败');
  return owner;
}
