import './node-web-globals.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  EU_LOTL_URL,
  refreshTrustData,
  verifyLotlAndResolveHu,
} from '../src/verifier/trust/refreshTrustData.ts';
async function main(): Promise<void> {
  const lotlResponse = await fetch(EU_LOTL_URL, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!lotlResponse.ok)
    throw new Error(`LOTL download failed with HTTP ${lotlResponse.status}.`);
  const lotl = new Uint8Array(await lotlResponse.arrayBuffer());
  const pointer = await verifyLotlAndResolveHu(lotl);
  const huResponse = await fetch(pointer.url, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!huResponse.ok)
    throw new Error(`HU TSL download failed with HTTP ${huResponse.status}.`);
  const huTsl = new Uint8Array(await huResponse.arrayBuffer());
  const verifiedAt = new Date();
  const trust = await refreshTrustData(lotl, huTsl, verifiedAt);

  async function hash(data: Uint8Array): Promise<string> {
    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-256', Uint8Array.from(data).buffer),
    );
    return Array.from(digest, value =>
      value.toString(16).padStart(2, '0'),
    ).join('');
  }

  const root = resolve(import.meta.dirname, '../src/verifier/trust');
  const snapshot = resolve(root, 'snapshot');
  await mkdir(snapshot, { recursive: true });
  await writeFile(resolve(snapshot, 'eu-lotl.xml'), lotl);
  await writeFile(resolve(snapshot, 'HU_TL.xml'), huTsl);
  await writeFile(
    resolve(snapshot, 'manifest.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        verifiedAt: verifiedAt.toISOString(),
        lotlUrl: EU_LOTL_URL,
        huTslUrl: trust.huTslUrl,
        lotlNextUpdate: trust.lotlNextUpdate,
        huTslNextUpdate: trust.huTslNextUpdate,
        lotlSha256: await hash(lotl),
        huTslSha256: await hash(huTsl),
        lotlSize: lotl.length,
        huTslSize: huTsl.length,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

void main();
