import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { keccak256, stringToHex } from 'viem';
import { interfaces } from '../config/protocol.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = path.join(root, 'dist');
const handoff = JSON.parse(await readFile(new URL('../config/handoff.json', import.meta.url), 'utf8'));
const networkInput = JSON.parse(await readFile(new URL('../config/network.json', import.meta.url), 'utf8'));
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
if (handoff.chainId !== networkInput.network.chainId || Number(BigInt(networkInput.walletAddChain.chainId)) !== handoff.chainId) throw Error('Chain mismatch');
await mkdir(path.join(out, 'abi'), { recursive: true });
const contracts = [];
for (const c of handoff.contracts) {
  if (!/^[A-Za-z0-9_]+$/.test(c.name)) throw Error('Invalid contract name');
  const sourcePath = `docs/abi/${c.name}.json`;
  const raw = execFileSync('git', ['show', `${handoff.sourceCommit}:${sourcePath}`], { cwd: root, encoding: 'utf8' });
  const abi = JSON.parse(raw);
  const hash = keccak256(stringToHex(canonical(abi))).slice(2);
  if (!Array.isArray(abi) || hash !== c.abiHash) throw Error(`ABI hash mismatch: ${c.name}: ${hash}`);
  const abiPath = `abi/${c.name}.json`;
  await writeFile(path.join(out, abiPath), raw);
  contracts.push({ name: c.name, address: c.address, abiHash: c.abiHash, abiPath });
  console.log(`Pinned ABI verified: ${c.name} ${hash}`);
}
const protocolInterfaces = {};
for (const [name, abi] of Object.entries(interfaces)) {
  const abiPath = `abi/${name}.json`;
  await writeFile(path.join(out, abiPath), JSON.stringify(abi, null, 2) + '\n');
  protocolInterfaces[name] = { abiPath, abiHash: keccak256(stringToHex(canonical(abi))).slice(2) };
}
async function files(dir, prefix = '') {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isSymbolicLink()) throw Error('Symlinks are not export assets');
    if (entry.isDirectory()) result.push(...await files(path.join(dir, entry.name), relative + '/'));
    else if (relative !== 'imd-deployment.json') result.push(relative);
  }
  return result.sort();
}
const exported = await files(out);
if (!exported.includes('index.html') || exported.length > 128) throw Error('Invalid export inventory');
let bytes = 0;
const assets = [];
for (const file of exported) {
  const data = await readFile(path.join(out, file));
  if (data.length > 8388608) throw Error(`Asset too large: ${file}`);
  bytes += data.length;
  assets.push({ path: file, sha256: createHash('sha256').update(data).digest('hex') });
}
if (bytes > 7 * 1024 * 1024) throw Error('Export leaves too little submission space');
const manifest = {
  version: 1, launchId: handoff.launchId, chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit, attestationHash: handoff.attestationHash,
  contracts, assets, network: networkInput.network,
  walletAddChain: networkInput.walletAddChain,
  pool: handoff.manifest.pool, token: handoff.manifest.token,
  hookContract: handoff.manifest.hook.contract,
  deploymentBlock: Math.min(...handoff.contracts.map(c => c.blockNumber)),
  protocolInterfaces,
};
await writeFile(path.join(out, 'imd-deployment.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Manifest complete: ${assets.length} assets, ${bytes} bytes; configuration ${ (await stat(path.join(out, 'imd-deployment.json'))).size } bytes`);
