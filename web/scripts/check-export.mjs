import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
const root = new URL('../../', import.meta.url);
const read = async file => JSON.parse(await readFile(new URL(file, root), 'utf8'));
const handoff = await read('web/config/handoff.json'), network = await read('web/config/network.json'), deployment = await read('dist/imd-deployment.json');
for (const field of ['launchId', 'chainId', 'sourceCommit', 'attestationHash']) assert.deepEqual(deployment[field], handoff[field]);
assert.deepEqual(deployment.network, network.network); assert.deepEqual(deployment.walletAddChain, network.walletAddChain);
assert.deepEqual(deployment.contracts.map(({ abiPath, ...rest }) => rest), handoff.contracts.map(({ name, address, abiHash }) => ({ name, address, abiHash })));
const actual = [];
async function visit(prefix = '') {
  for (const entry of await readdir(new URL('dist/' + prefix, root), { withFileTypes: true })) {
    assert(!entry.isSymbolicLink());
    const p = prefix + entry.name;
    if (entry.isDirectory()) await visit(p + '/'); else if (p !== 'imd-deployment.json') actual.push(p);
  }
}
await visit();
assert.deepEqual(deployment.assets.map(a => a.path).sort(), actual.sort());
let bytes = 0;
for (const asset of deployment.assets) {
  assert(!path.isAbsolute(asset.path) && !asset.path.includes('..') && !asset.path.includes(':'));
  const raw = await readFile(new URL('dist/' + asset.path, root)); bytes += raw.length;
  assert(raw.length <= 8388608); assert.match(asset.sha256, /^[0-9a-f]{64}$/);
  assert.equal(createHash('sha256').update(raw).digest('hex'), asset.sha256);
}
assert(deployment.assets.length <= 128); assert(bytes < 32 * 1024 * 1024);
console.log(JSON.stringify({ status: 'passed', assets: actual.length, bytes, manifestMatchesHandoff: true, networkUnchanged: true, everyExportedFileHasValidSha256: true }, null, 2));
