import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateHistoricalChain } from '../chains';
import { parseCertificateDer } from '../certificates';
import {
  refreshTrustData,
  trustCertificatesFor,
  type TrustContext,
} from '../trust/refreshTrustData';

Object.defineProperty(globalThis, 'DOMParser', {
  value: XmlDomParser,
  configurable: true,
});

function snapshot(name: string): Uint8Array {
  return Uint8Array.from(
    readFileSync(resolve(__dirname, `../trust/snapshot/${name}`)),
  );
}

function bootstrapCertificate() {
  const pem = readFileSync(
    resolve(__dirname, '../trust/eu-lotl-signers.pem'),
    'utf8',
  );
  const encoded = pem.match(
    /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/,
  )?.[1];
  const certificate = encoded
    ? parseCertificateDer(
        Uint8Array.from(Buffer.from(encoded.replace(/\s/g, ''), 'base64')),
      )
    : undefined;
  if (!certificate) throw new Error('Bootstrap certificate unavailable.');
  return certificate;
}

test('verified tracked trust data loads and tampering is rejected', async () => {
  const lotl = snapshot('eu-lotl.xml');
  const huTsl = snapshot('HU_TL.xml');
  const context = await refreshTrustData(lotl, huTsl, new Date());
  expect(context.services.length).toBeGreaterThan(0);

  const tampered = lotl.slice();
  const position = Math.floor(tampered.length / 2);
  tampered[position] ^= 1;
  await expect(
    refreshTrustData(tampered, huTsl, new Date()),
  ).rejects.toBeDefined();
});

test('historical service intervals are queried at the relevant proof time', () => {
  const certificate = bootstrapCertificate();
  const context: TrustContext = {
    services: [
      {
        role: 'ca',
        serviceType: 'http://uri.etsi.org/TrstSvc/Svctype/CA/QC',
        certificate,
        qualifications: [],
        intervals: [
          {
            start: '2020-01-01T00:00:00.000Z',
            end: '2022-01-01T00:00:00.000Z',
            status: 'http://uri.etsi.org/TrstSvc/TrustedList/Svcstatus/granted',
            granted: true,
          },
        ],
      },
    ],
    lotlNextUpdate: '2030-01-01T00:00:00.000Z',
    huTslNextUpdate: '2030-01-01T00:00:00.000Z',
    huTslUrl: 'https://example.invalid/HU_TL.xml',
    verifiedAt: '2026-01-01T00:00:00.000Z',
  };
  expect(
    trustCertificatesFor(context, 'ca', new Date('2021-01-01')).length,
  ).toBe(1);
  expect(
    trustCertificatesFor(context, 'ca', new Date('2023-01-01')).length,
  ).toBe(0);
});

test('missing or expired trust can never yield a valid chain', async () => {
  const certificate = bootstrapCertificate();
  const missing = await validateHistoricalChain(
    certificate,
    [certificate],
    undefined,
    'ca',
    new Date('2026-01-01'),
    new Date('2026-01-01'),
  );
  expect(missing.status).toBe('indeterminate');

  const stale: TrustContext = {
    services: [],
    lotlNextUpdate: '2025-01-01T00:00:00.000Z',
    huTslNextUpdate: '2025-01-01T00:00:00.000Z',
    huTslUrl: 'https://example.invalid/HU_TL.xml',
    verifiedAt: '2024-01-01T00:00:00.000Z',
  };
  const expired = await validateHistoricalChain(
    certificate,
    [certificate],
    stale,
    'ca',
    new Date('2024-01-01'),
    new Date('2026-01-01'),
  );
  expect(expired.status).toBe('indeterminate');
  expect(expired.checks[0]?.id).toBe('trust-stale');
});
