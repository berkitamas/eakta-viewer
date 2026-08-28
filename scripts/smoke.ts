import './node-web-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyAndExtractDossier } from '../src/verifier/verifyAndExtractDossier';
import type { TrustCacheMetadata, VerifierIO } from '../src/verifier/types';

function trustMetadata(value: unknown): TrustCacheMetadata {
  if (
    !value ||
    typeof value !== 'object' ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== 1 ||
    !('verifiedAt' in value) ||
    typeof value.verifiedAt !== 'string' ||
    !('lotlNextUpdate' in value) ||
    typeof value.lotlNextUpdate !== 'string' ||
    !('huTslNextUpdate' in value) ||
    typeof value.huTslNextUpdate !== 'string' ||
    !('lotlSha256' in value) ||
    typeof value.lotlSha256 !== 'string' ||
    !('huTslSha256' in value) ||
    typeof value.huTslSha256 !== 'string' ||
    !('lotlSize' in value) ||
    typeof value.lotlSize !== 'number' ||
    !('huTslSize' in value) ||
    typeof value.huTslSize !== 'number'
  )
    throw new Error('Tracked trust manifest is invalid.');
  return {
    schemaVersion: 1,
    verifiedAt: value.verifiedAt,
    lotlNextUpdate: value.lotlNextUpdate,
    huTslNextUpdate: value.huTslNextUpdate,
    lotlSha256: value.lotlSha256,
    huTslSha256: value.huTslSha256,
    lotlSize: value.lotlSize,
    huTslSize: value.huTslSize,
  };
}

async function main(): Promise<void> {
  const fixture = process.env.ES3_TEST_FIXTURE;
  if (!fixture) throw new Error('ES3_TEST_FIXTURE is required.');
  const input = Uint8Array.from(readFileSync(fixture));
  const trustRoot = resolve('src/verifier/trust/snapshot');
  const lotl = Uint8Array.from(readFileSync(resolve(trustRoot, 'eu-lotl.xml')));
  const huTsl = Uint8Array.from(readFileSync(resolve(trustRoot, 'HU_TL.xml')));
  const metadata = trustMetadata(
    JSON.parse(readFileSync(resolve(trustRoot, 'manifest.json'), 'utf8')),
  );
  let outputSequence = 0;
  const io: VerifierIO = {
    isCancelled: () => false,
    async readResource(request) {
      const source =
        request.kind === 'input'
          ? input
          : request.kind === 'trust-lotl'
          ? lotl
          : huTsl;
      const data = source.slice(
        request.offset,
        request.offset + request.length,
      );
      return {
        dataBase64: Buffer.from(data).toString('base64'),
        eof: request.offset + data.length >= source.length,
        sequence: Math.floor(request.offset / (768 * 1024)),
      };
    },
    async beginOutput() {
      outputSequence += 1;
      return {
        outputToken: `output-${outputSequence}`,
        previewPath: `/temporary/output-${outputSequence}`,
      };
    },
    async appendOutput() {},
    async finishOutput(outputToken) {
      return { previewPath: `/temporary/${outputToken}` };
    },
  };
  const response = await verifyAndExtractDossier(
    {
      requestId: 'smoke',
      input: {
        sessionId: 'smoke',
        inputToken: 'input',
        displayName: 'local',
        size: input.length,
      },
      validationTime: new Date().toISOString(),
      trustSnapshotId: 'tracked',
      trustSnapshotManifestSha256: 'tracked',
      trustCache: { cacheToken: 'trust', metadata },
    },
    io,
  );
  if (!response.result) throw new Error('Smoke verification aborted.');
  const primary = response.result.documents.filter(
    document => document.kind === 'primary',
  ).length;
  const attachments = response.result.documents.filter(
    document => document.kind === 'signature-attachment',
  ).length;
  const signatures = response.result.signatures.length;
  const timestamps = response.result.signatures.reduce(
    (count, signature) => count + signature.timestamps.length,
    0,
  );
  if (
    primary !== 2 ||
    attachments !== 2 ||
    signatures !== 3 ||
    timestamps !== 3
  )
    throw new Error('Smoke aggregate contract failed.');
  process.stdout.write(
    `Smoke aggregate passed: ${primary} primary, ${attachments} attachments, ${signatures} signatures, ${timestamps} timestamps.\n`,
  );
}
void main();
