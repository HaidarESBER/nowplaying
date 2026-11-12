'use strict';
// Static sanity checks. The scripts in js/ are browser-only classic scripts, so they are checked
// without being executed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const jsFiles = fs.readdirSync(path.join(root, 'js')).filter((f) => f.endsWith('.js')).map((f) => 'js/' + f);

test('every script in js/ has valid syntax (node --check)', () => {
  assert.ok(jsFiles.length >= 11);
  for (const f of jsFiles) {
    const r = spawnSync(process.execPath, ['--check', path.join(root, f)], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, f + ': ' + r.stderr);
  }
});

test('every script is strict-mode and has no stray debugger statements', () => {
  for (const f of jsFiles) {
    const src = read(f);
    assert.match(src, /'use strict'/, f);
    assert.doesNotMatch(src, /^\s*debugger\s*;?\s*$/m, f);
  }
});

test('manifest.webmanifest is valid and its icons exist', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.ok(m.name && m.start_url && m.display);
  assert.ok(Array.isArray(m.icons) && m.icons.length > 0);
  for (const i of m.icons) {
    assert.ok(fs.existsSync(path.join(root, i.src)), `missing icon ${i.src}`);
    assert.match(i.sizes, /^\d+x\d+$/);
  }
});

test('index.html references only files that exist', () => {
  const html = read('index.html');
  const refs = [...html.matchAll(/\b(?:src|href)="([^"#?]+)[^"]*"/g)].map((m) => m[1])
    .filter((u) => !/^(https?:)?\/\//.test(u) && !u.startsWith('data:'));
  assert.ok(refs.includes('style.css'));
  for (const f of jsFiles) assert.ok(refs.includes(f), `${f} is not loaded by index.html`);
  for (const r of refs) assert.ok(fs.existsSync(path.join(root, r)), `missing ${r}`);
});

test('every element id read via $("...") in js/ exists in index.html', () => {
  const html = read('index.html');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const used = [...jsFiles.map(read).join(' ').matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]);
  const missing = [...new Set(used)].filter((i) => !ids.has(i));
  assert.deepStrictEqual(missing, []);
});

test('no top-level name is declared twice across the scripts (a clash breaks the whole second file)', () => {
  const seen = new Map(), dup = [];
  for (const f of jsFiles) {
    for (const m of read(f).matchAll(/^(?:async\s+)?(?:const|let|var|function\*?)\s+([A-Za-z_$][\w$]*)/gm)) {
      const n = m[1];
      if (seen.has(n) && seen.get(n) !== f) dup.push(`${n} (${seen.get(n)} and ${f})`);
      else seen.set(n, f);
    }
  }
  assert.deepStrictEqual(dup, []);
});
