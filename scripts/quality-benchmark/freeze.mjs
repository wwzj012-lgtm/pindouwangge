// Freeze an explicitly ready candidate without executing any conversion.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { captureProductionClosure } from './snapshot.mjs';
import { json, sha } from './fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tag = process.argv[2];
assert.ok(tag === 'final-retained' || /^after(?:-[a-z0-9]+)+$/.test(tag ?? ''), 'Provide final-retained or a new after-* tag');
const sourceFlag = process.argv.indexOf('--source-root');
const sourceRoot = sourceFlag >= 0 ? path.resolve(root, process.argv[sourceFlag + 1]) : root;
const base = path.join(root, 'artifacts/quality-benchmark'), out = path.join(base, tag);
const contractBytes = await readFile(path.join(base, 'contract.json'));
const contract = JSON.parse(contractBytes);
assert.equal(sha(await readFile(path.join(base, 'before/head-src.zip'))), contract.archiveSha256, 'Before archive changed');
await mkdir(out); // Fail if an existing candidate would be overwritten.
const files = await captureProductionClosure(sourceRoot, path.join(out, 'modules'));
const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
const versionSha256 = sha(json(sorted)), capturedAt = new Date().toISOString();
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
await writeFile(path.join(out, 'source-capture.json'), json({ capturedAt, head: git('rev-parse', 'HEAD'), files,
  sourceRoot: path.relative(root, sourceRoot) || '.', status: git('status', '--short'), notes: 'Production dependency closure only; snapshot-only capture, no converter call. Tests/App/UI not copied.' }), { flag: 'wx' });
await writeFile(path.join(out, 'probe-version.json'), json({ status: tag === 'final-retained' ? 'retained candidate snapshot; not an all-mode quality pass or release' : 'non-final ready candidate snapshot', tag, capturedAt, versionSha256, files: sorted }), { flag: 'wx' });
const statement = { tag, capturedAt, versionSha256, productionFiles: Object.keys(files).length, contractSha256: sha(contractBytes),
  measurementsExecuted: 0, baselineHead: contract.head, baselineArchiveSha256: contract.archiveSha256,
  retentionStatus: tag === 'final-retained' ? 'Coordinator reports cartoon/logo restored to baseline production output, photoA retained. This snapshot-only operation does not independently remeasure that behavior.' : 'Coordinator-ready candidate, frozen without measurement.',
  evidenceBoundary: 'A-version 60-case results stay associated with their A version hash; they are not relabeled as measurements of this snapshot.',
  followup: 'Await coordinator notice; prefer only three existing priority user cases. No full matrix or new fixtures requested. No all-mode improvement/release claim.' };
await writeFile(path.join(out, 'FREEZE.json'), json(statement), { flag: 'wx' });
await writeFile(path.join(out, 'STATUS.md'), `# ${tag}: snapshot only\n\nVersion SHA256: ${versionSha256}\n\n${statement.retentionStatus}\n\nNo conversion executed. Production dependency closure: ${statement.productionFiles} files. Original before archive and all prior grids/reports unchanged. Inputs/palette/settings remain in the existing frozen contract.\n\n${statement.evidenceBoundary}\n\n${statement.followup}\n`, { flag: 'wx' });
console.log(json(statement));
