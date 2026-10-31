import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile, realpath, unlink, writeFile, mkdir, copyFile, stat } from 'node:fs/promises';
import ts from 'typescript';
import { sha, json } from './fixtures.mjs';

const testFile = /\.test\.tsx?$/i;
const within = (root, file) => { const relative = path.relative(root, file); return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative); };

// Follow only relative production imports from the actual public entry/palette.
// No recursive copy of utils/tests, and every untracked dependency is hashed too.
export async function productionClosure(root) {
  const pending = ['src/utils/colorUtils.ts', 'src/data/palettes.ts'], files = new Map();
  while (pending.length) {
    const relative = pending.pop();
    if (files.has(relative)) continue;
    const file = path.resolve(root, relative);
    assert.ok(within(path.join(root, 'src'), file) && !testFile.test(file), 'Not a production source dependency: ' + relative);
    const bytes = await readFile(file); files.set(relative, bytes);
    for (const imported of ts.preProcessFile(bytes.toString('utf8'), true, true).importedFiles) {
      if (!imported.fileName.startsWith('.')) continue;
      const base = path.resolve(path.dirname(file), imported.fileName);
      let resolved;
      for (const candidate of [base, base + '.ts', base + '.tsx', path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
        if (await stat(candidate).then(s => s.isFile(), () => false)) { resolved = candidate; break; }
      }
      assert.ok(resolved && /\.tsx?$/i.test(resolved) && !testFile.test(resolved), 'Unsupported source dependency: ' + imported.fileName);
      pending.push(path.relative(root, resolved).replaceAll('\\', '/'));
    }
  }
  return files;
}

export async function captureProductionClosure(root, destination) {
  const files = await productionClosure(root);
  for (const [relative] of files) {
    const target = path.resolve(destination, relative);
    assert.ok(within(destination, target));
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(root, relative), target);
  }
  const hashes = Object.fromEntries([...files].map(([file, bytes]) => [file, sha(bytes)]));
  for (const [relative, expected] of Object.entries(hashes)) {
    assert.equal(sha(await readFile(path.join(root, relative))), expected, 'Source changed during capture: ' + relative);
    assert.equal(sha(await readFile(path.join(destination, relative))), expected, 'Copied source changed: ' + relative);
  }
  return hashes;
}

export async function cleanupSnapshotTests(workspace) {
  const artifactRoot = path.resolve(workspace, 'artifacts/quality-benchmark');
  const expectedRoots = ['before', 'after'].map(phase => path.resolve(artifactRoot, phase, 'modules'));
  const records = [];
  for (const expected of expectedRoots) {
    const resolved = await realpath(expected);
    assert.equal(path.normalize(resolved).toLowerCase(), path.normalize(expected).toLowerCase(), 'Unexpected snapshot root');
    assert.ok(within(artifactRoot, resolved), 'Snapshot outside intended artifacts');
    const files = [];
    async function walk(directory) {
      for (const item of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, item.name);
        assert.ok(!item.isSymbolicLink(), 'Refuse symlink in snapshot');
        if (item.isDirectory()) await walk(file); else if (item.isFile()) files.push(file);
      }
    }
    await walk(resolved);
    const targets = files.filter(file => testFile.test(file));
    const production = files.filter(file => /\.tsx?$/i.test(file) && !testFile.test(file));
    const hashes = Object.fromEntries(await Promise.all(production.map(async file => [path.relative(resolved, file), sha(await readFile(file))])));
    // Validate the complete deletion set before changing anything. Never delete directories.
    for (const file of targets) {
      assert.ok(within(resolved, file) && testFile.test(file));
      assert.equal((await realpath(file)).toLowerCase(), path.resolve(file).toLowerCase());
    }
    for (const file of targets) await unlink(file);
    for (const [relative, expectedHash] of Object.entries(hashes)) assert.equal(sha(await readFile(path.join(resolved, relative))), expectedHash, 'Production hash changed');
    records.push({ snapshotRoot: path.relative(workspace, resolved), removedTests: targets.length, removed: targets.map(file => path.relative(resolved, file)), productionFilesUnchanged: production.length, hashes });
  }
  await writeFile(path.join(artifactRoot, 'snapshot-test-cleanup.json'), json({ policy: 'Only .test.ts/.test.tsx files inside two verified snapshot modules roots; no production files modified', records }));
  return records.map(({ hashes, removed, ...record }) => record);
}

if (process.argv[2] === '--cleanup-tests') {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  console.log(json(await cleanupSnapshotTests(root)));
}
