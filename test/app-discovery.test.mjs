import test from 'node:test';
import assert from 'node:assert/strict';
import { appCandidatePath, commonAppCandidates, findApp } from '../src/app-discovery.mjs';

const app = 'D:\\Apps\\GitHub Copilot\\github.exe';
const signed = path => ({ path, signature: 'Valid', signer: 'CN="GitHub, Inc."', version: '1.1.23' });
const discover = options => findApp({ env: {}, processes: [], registered: async () => [], exists: () => false, inspect: async path => signed(path), ...options });

test('app paths accept directories, quoted icons and case-insensitive environment variables', () => {
  assert.equal(appCandidatePath('D:\\Apps\\GitHub Copilot'), app);
  assert.equal(appCandidatePath('"' + app + '", -12'), app);
  assert.equal(appCandidatePath('"%localappdata%\\GitHub Copilot\\github.exe"', { LOCALAPPDATA: 'C:\\用户\\本地' }), 'C:\\用户\\本地\\GitHub Copilot\\github.exe');
  assert.equal(appCandidatePath('"D:\\Apps & Tools\\Copilot\\github.exe"'), 'D:\\Apps & Tools\\Copilot\\github.exe');
  for (const value of [undefined, '', 123, 'relative\\github.exe', 'D:\\Apps\\uninstall.exe', '"' + app + '" --run']) {
    assert.equal(appCandidatePath(value), null, String(value));
  }
  assert.deepEqual(commonAppCandidates({}), [], 'Unset environment variables must not search the current directory');
});

test('explicit app directory is validated and wins without probing the machine', async () => {
  const result = await discover({ appPath: 'D:\\Apps\\GitHub Copilot', exists: value => value === app,
    registered: async () => { throw new Error('must not discover'); } });
  assert.equal(result.path, app);
  assert.equal(result.source, 'argument');
});

test('explicit missing or unsigned paths fail instead of silently installing another app', async () => {
  await assert.rejects(discover({ appPath: app }), /指定/);
  await assert.rejects(discover({ appPath: app, exists: () => true, inspect: async path => ({ ...signed(path), signature: 'NotSigned' }) }), /签名/);
  await assert.rejects(discover({ appPath: app, exists: () => true, inspect: async path => ({ ...signed(path), signer: 'Microsoft Corporation' }) }), /签名/);
});

test('a valid saved app is reused without enumerating processes or modifying configuration', async () => {
  const config = { appPath: app, machineTranslation: { enabled: false, idleSeconds: 300 }, custom: { keep: true } };
  const snapshot = structuredClone(config);
  const result = await findApp({ config, env: {}, exists: () => true, inspect: async path => signed(path),
    running: async () => { throw new Error('must not enumerate'); }, registered: async () => { throw new Error('must not enumerate'); } });
  assert.equal(result.source, 'config');
  assert.deepEqual(config, snapshot);
});

test('stale config from another PC falls back to the running original application', async () => {
  const result = await discover({ config: { appPath: 'Z:\\Old PC\\github.exe' }, processes: Promise.resolve([{ ExecutablePath: null }, { ExecutablePath: app }]), exists: value => value === app });
  assert.equal(result.path, app);
  assert.equal(result.source, 'running-process');
});

test('an invalid saved executable does not hide a separately signed registered application', async () => {
  const bad = 'C:\\Old\\github.exe';
  const result = await discover({ config: { appPath: bad }, exists: () => true,
    inspect: async path => path === bad ? { ...signed(path), signature: 'HashMismatch' } : signed(path),
    registered: async () => [{ path: app, source: 'uninstall-registry' }] });
  assert.equal(result.path, app);
  assert.equal(result.source, 'uninstall-registry');
});

test('process enumeration failure still allows common directory discovery', async () => {
  const expected = 'C:\\Program Files\\GitHub Copilot\\github.exe';
  const result = await findApp({ env: { ProgramFiles: 'C:\\Program Files' }, running: async () => { throw new Error('access denied'); },
    exists: value => value === expected, inspect: async path => signed(path), registered: async () => [] });
  assert.equal(result.path, expected);
  assert.equal(result.source, 'common-directory');
});

test('custom drive and shortcut candidates are checked instead of assuming the C drive', async () => {
  const result = await discover({ exists: value => value === app,
    registered: async () => [{ path: 'C:\\Missing', source: 'uninstall-registry' }, { path: '"' + app + '",0', source: 'shortcut' }] });
  assert.equal(result.path, app);
  assert.equal(result.source, 'shortcut');
});

test('candidate signature checks are case-insensitively deduplicated and failures are explained', async () => {
  let inspected = 0;
  await assert.rejects(discover({ config: { appPath: app }, exists: () => true,
    processes: [{ ExecutablePath: app.toUpperCase() }], registered: async () => [{ path: app, source: 'shortcut' }],
    inspect: async () => { inspected++; throw new Error('signature unavailable'); } }), /signature unavailable/);
  assert.equal(inspected, 1);
});

test('absence of the app gives actionable installation guidance', async () => {
  await assert.rejects(discover(), /install\.ps1 -AppPath/);
});
