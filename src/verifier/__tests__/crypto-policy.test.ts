import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { selectSignerCertificate, parseCertificateDer } from '../certificates';
import { enforceSignaturePolicy } from '../signaturePolicy';
import { DossierAbortError } from '../types';

Object.defineProperty(globalThis, 'DOMParser', {
  value: XmlDomParser,
  configurable: true,
});

const EXPECTED_BOOTSTRAP = [
  'c0641c4f7d56c431b1c924742db7fce9c1eef7d7fd212113a2768486b3abcdc5',
  'e0a620fbb6747362bb933ac44169d676a553444716cf5f31605f12a22b8396b1',
  'df7e29360c34b2b8d6d5f40325c1d4d12c9922cecd33b7407674a74b2b3ca1e5',
  'b63d416744e7098bf9ec2caa596a93bc2468e37f8284ba65ecc061711bcbaa18',
  '236103f03a8031ae8f47f9059bf8de38564cdbfebedde4a597d50f8980aa653b',
  'd2064fdd70f6982dcc516b86d9d5c56aea939417c624b2e478c0b29de54f8474',
];

function pemCertificates(): Uint8Array[] {
  const pem = readFileSync(
    resolve(__dirname, '../trust/eu-lotl-signers.pem'),
    'utf8',
  );
  return Array.from(
    pem.matchAll(
      /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g,
    ),
    match =>
      Uint8Array.from(Buffer.from(match[1].replace(/\s/g, ''), 'base64')),
  );
}

function serialDecimal(raw: Uint8Array): string {
  const certificate = parseCertificateDer(raw);
  if (!certificate) throw new Error('certificate');
  const hex = Buffer.from(certificate.serialNumber.valueBlock.valueHexView)
    .toString('hex')
    .replace(/^00/, '');
  return BigInt(`0x${hex}`).toString(10);
}

async function signerXml(
  duplicate: boolean,
  digestOverride?: string,
): Promise<Element> {
  const raw = pemCertificates()[0];
  const certificate = parseCertificateDer(raw);
  if (!certificate) throw new Error('certificate');
  const digest =
    digestOverride ??
    Buffer.from(
      await crypto.subtle.digest('SHA-256', Uint8Array.from(raw).buffer),
    ).toString('base64');
  const encoded = Buffer.from(raw).toString('base64');
  const certElements = duplicate
    ? `<ds:X509Certificate>${encoded}</ds:X509Certificate><ds:X509Certificate>${encoded}</ds:X509Certificate>`
    : `<ds:X509Certificate>${encoded}</ds:X509Certificate>`;
  const document = new globalThis.DOMParser().parseFromString(
    `<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:xades="http://uri.etsi.org/01903/v1.3.2#">
      <ds:KeyInfo><ds:X509Data>${certElements}</ds:X509Data></ds:KeyInfo>
      <xades:SigningCertificateV2><xades:Cert><xades:CertDigest>
        <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${digest}</ds:DigestValue>
      </xades:CertDigest><xades:IssuerSerial><ds:X509IssuerName>${certificate.issuer.toString()}</ds:X509IssuerName>
      <ds:X509SerialNumber>${serialDecimal(
        raw,
      )}</ds:X509SerialNumber></xades:IssuerSerial></xades:Cert>
      </xades:SigningCertificateV2></ds:Signature>`,
    'application/xml',
  );
  return document.documentElement;
}

test('OJEU bootstrap contains exactly the six pinned certificates', async () => {
  const hashes = [];
  for (const raw of pemCertificates()) {
    hashes.push(
      Buffer.from(
        await crypto.subtle.digest('SHA-256', Uint8Array.from(raw).buffer),
      ).toString('hex'),
    );
  }
  expect(hashes).toEqual(EXPECTED_BOOTSTRAP);
});

test('signer selection requires issuer serial digest and one exact certificate', async () => {
  await expect(
    selectSignerCertificate(await signerXml(false)),
  ).resolves.toBeDefined();
  await expect(
    selectSignerCertificate(
      await signerXml(false, Buffer.alloc(32).toString('base64')),
    ),
  ).resolves.toBeUndefined();
  await expect(
    selectSignerCertificate(await signerXml(true)),
  ).resolves.toBeUndefined();
});

function scopeXml(referenceObject: string): {
  root: Element;
  signature: Element;
} {
  const document = new globalThis.DOMParser().parseFromString(
    `<Dossier xmlns="https://www.microsec.hu/ds/e-szigno30#" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:xades="http://uri.etsi.org/01903/v1.3.2#">
      <DossierProfile Id="dossier-profile"/><Documents Id="documents"><Document Id="document">
      <DocumentProfile Id="profile" OBJREF="second"/><ds:Object Id="first"/><ds:Object Id="second"/>
      <ds:Signature Id="signature"><ds:SignedInfo>
      <ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>
      <ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>
      ${['profile', referenceObject, 'signature-profile', 'signed-properties']
        .map(
          id =>
            `<ds:Reference URI="#${id}"><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/></ds:Reference>`,
        )
        .join('')}
      </ds:SignedInfo><ds:Object Id="signature-profile-object"><SignatureProfile Id="signature-profile"/><xades:SignedProperties Id="signed-properties"/></ds:Object></ds:Signature>
      </Document></Documents></Dossier>`,
    'application/xml',
  );
  const signature = document.getElementsByTagNameNS(
    'http://www.w3.org/2000/09/xmldsig#',
    'Signature',
  )[0];
  return { root: document.documentElement, signature };
}

test('document signature scope binds the OBJREF-selected object', () => {
  const wrapped = scopeXml('first');
  expect(enforceSignaturePolicy(wrapped.signature, wrapped.root).status).toBe(
    'invalid',
  );
  const exact = scopeXml('second');
  expect(enforceSignaturePolicy(exact.signature, exact.root).status).toBe(
    'valid',
  );
});

test('rejects duplicate SignedProperties and wrongly nested SignatureProfile nodes', () => {
  const duplicate = scopeXml('second');
  const wrapper = duplicate.signature.getElementsByTagNameNS(
    'http://www.w3.org/2000/09/xmldsig#',
    'Object',
  )[0];
  const extra = duplicate.root.ownerDocument.createElementNS(
    'http://uri.etsi.org/01903/v1.3.2#',
    'xades:SignedProperties',
  );
  extra.setAttribute('Id', 'signed-properties-extra');
  wrapper.appendChild(extra);
  expect(
    enforceSignaturePolicy(duplicate.signature, duplicate.root).status,
  ).toBe('invalid');

  const wrongNesting = scopeXml('second');
  const profile = wrongNesting.signature.getElementsByTagNameNS(
    'https://www.microsec.hu/ds/e-szigno30#',
    'SignatureProfile',
  )[0];
  wrongNesting.signature.appendChild(profile);
  expect(
    enforceSignaturePolicy(wrongNesting.signature, wrongNesting.root).status,
  ).toBe('invalid');
});

test('external signature references abort the dossier', () => {
  const { root, signature } = scopeXml('second');
  signature
    .getElementsByTagNameNS(
      'http://www.w3.org/2000/09/xmldsig#',
      'Reference',
    )[0]
    .setAttribute('URI', 'https://example.test/value');
  expect(() => enforceSignaturePolicy(signature, root)).toThrow(
    DossierAbortError,
  );
});
