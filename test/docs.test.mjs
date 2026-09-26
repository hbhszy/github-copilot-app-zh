import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const json = async path => JSON.parse(await readFile(join(root, path), 'utf8'));

test('release package, lockfile, dictionary and changelog agree on the version', async () => {
  const [pkg, lock, dictionary] = await Promise.all([
    json('package.json'), json('package-lock.json'), json('locales/zh-CN.json'),
  ]);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(dictionary.version, pkg.version);
  const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8');
  const release = changelog.match(/^## (\d+\.\d+\.\d+) - \d{4}-\d{2}-\d{2}$/m);
  assert.equal(release?.[1], pkg.version, 'The first dated changelog release must match the package');
});

test('project Markdown links resolve within the repository', async () => {
  async function markdownFiles(directory, recursive) {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isFile() && entry.name.endsWith('.md')) files.push(path);
      else if (recursive && entry.isDirectory()) files.push(...await markdownFiles(path, true));
    }
    return files;
  }
  const files = [
    ...await markdownFiles(root, false),
    ...await markdownFiles(join(root, 'docs'), true),
  ];
  assert.ok(files.some(path => path === join(root, 'AGENTS.md')), 'Root AGENTS.md must exist');
  for (const file of files) {
    // Skip code samples; only verify local inline links, never contact external sites.
    const markdown = (await readFile(file, 'utf8')).replace(/```[^]*?```/g, '');
    for (const match of markdown.matchAll(/\[[^\]\n]+\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const href = match[1];
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) continue;
      const target = resolve(dirname(file), decodeURIComponent(href.split(/[?#]/)[0]));
      const local = relative(root, target);
      assert.ok(!isAbsolute(local) && local !== '..' && !/^\.\.[\\/]/.test(local), `${file}: link escapes repository: ${href}`);
      assert.ok(await stat(target).catch(() => null), `${file}: broken local link: ${href}`);
    }
  }
});
