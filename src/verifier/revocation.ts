import { fromBER } from 'asn1js';
import {
  BasicOCSPResponse,
  CertID,
  Certificate,
  CertificateRevocationList,
  OCSPRequest,
  OCSPResponse,
} from 'pkijs';
import type { ValidationCheck, VerificationStatus } from '../domain/types';
import { decodeStrictBase64 } from './certificates';
import { encodeTransportBase64, readAllResource } from './base64';
import { MAX_ES3_BYTES, XADES_NAMESPACES } from './limits';
import type { VerifierIO } from './types';

const CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;

function xadesValues(signature: Element, localName: string): Uint8Array[] {
  const result: Uint8Array[] = [];
  const visit = (element: Element): void => {
    for (const child of Array.from(element.children)) {
      if (
        child.localName === localName &&
        child.namespaceURI &&
        XADES_NAMESPACES[child.namespaceURI]
      ) {
        const raw = decodeStrictBase64(child.textContent ?? '');
        if (raw) result.push(raw);
      }
      visit(child);
    }
  };
  visit(signature);
  return result;
}

function hashName(oid: string): string | undefined {
  const names: Record<string, string> = {
    '1.3.14.3.2.26': 'SHA-1',
    '2.16.840.1.101.3.4.2.1': 'SHA-256',
    '2.16.840.1.101.3.4.2.2': 'SHA-384',
    '2.16.840.1.101.3.4.2.3': 'SHA-512',
  };
  return names[oid];
}

function timeIsFresh(
  thisUpdate: Date,
  nextUpdate: Date | undefined,
  time: Date,
): boolean {
  const timestamp = time.getTime();
  const thisTimestamp = thisUpdate.getTime();
  if (
    thisTimestamp < timestamp - MAX_EVIDENCE_AGE_MS ||
    thisTimestamp > timestamp + CLOCK_SKEW_MS
  ) {
    return false;
  }
  return nextUpdate ? nextUpdate.getTime() >= timestamp - CLOCK_SKEW_MS : true;
}

function serialMatches(left: Uint8Array, right: Uint8Array): boolean {
  const trim = (value: Uint8Array): Uint8Array => {
    let offset = 0;
    while (offset < value.length - 1 && value[offset] === 0) offset += 1;
    return value.subarray(offset);
  };
  const normalizedLeft = trim(left);
  const normalizedRight = trim(right);
  if (normalizedLeft.length !== normalizedRight.length) return false;
  return normalizedLeft.every(
    (value, index) => value === normalizedRight[index],
  );
}

export interface RevocationResult {
  status: VerificationStatus;
  checks: ValidationCheck[];
  source?: 'ocsp' | 'crl';
}

export function bestEffortRevocationStatus(
  chainStatus: VerificationStatus,
  revocationStatus: VerificationStatus,
): VerificationStatus {
  if (revocationStatus === 'invalid') return 'invalid';
  return chainStatus === 'valid' ? 'valid' : 'indeterminate';
}

async function evaluateOcsp(
  response: BasicOCSPResponse,
  certificate: Certificate,
  issuer: Certificate,
  time: Date,
): Promise<RevocationResult | undefined> {
  for (const single of response.tbsResponseData.responses) {
    const name = hashName(single.certID.hashAlgorithm.algorithmId);
    if (!name) continue;
    const expected = new CertID();
    await expected.createForCertificate(certificate, {
      hashAlgorithm: name,
      issuerCertificate: issuer,
    });
    if (!single.certID.isEqual(expected)) continue;
    const signatureValid = await response.verify({ trustedCerts: [issuer] });
    if (!signatureValid) {
      return {
        status: 'invalid',
        checks: [
          {
            id: 'ocsp-signature',
            labelKey: 'checks.ocspSignature',
            status: 'invalid',
          },
        ],
      };
    }
    const producedAt = response.tbsResponseData.producedAt.getTime();
    const producedFresh =
      producedAt >= single.thisUpdate.getTime() - CLOCK_SKEW_MS &&
      producedAt <= time.getTime() + CLOCK_SKEW_MS;
    const fresh =
      producedFresh && timeIsFresh(single.thisUpdate, single.nextUpdate, time);
    const statusTag = single.certStatus.idBlock?.tagNumber;
    if (statusTag === 1 && fresh) {
      return {
        status: 'invalid',
        source: 'ocsp',
        checks: [
          {
            id: 'ocsp-revoked',
            labelKey: 'checks.ocspRevoked',
            status: 'invalid',
          },
        ],
      };
    }
    if (statusTag === 0 && fresh) {
      return {
        status: 'valid',
        source: 'ocsp',
        checks: [
          { id: 'ocsp-good', labelKey: 'checks.ocspGood', status: 'valid' },
        ],
      };
    }
    return {
      status: 'indeterminate',
      source: 'ocsp',
      checks: [
        {
          id: 'ocsp-freshness',
          labelKey: 'checks.ocspFreshness',
          status: 'indeterminate',
        },
      ],
    };
  }
  return undefined;
}

async function evaluateCrl(
  crl: CertificateRevocationList,
  certificate: Certificate,
  issuer: Certificate,
  time: Date,
): Promise<RevocationResult | undefined> {
  const crlIssuer = new Uint8Array(crl.issuer.toSchema().toBER(false));
  const certificateIssuer = new Uint8Array(
    issuer.subject.toSchema().toBER(false),
  );
  const issuerMatches =
    crlIssuer.length === certificateIssuer.length &&
    crlIssuer.every((value, index) => value === certificateIssuer[index]);
  if (!issuerMatches) return undefined;
  if (!(await crl.verify({ issuerCertificate: issuer }))) {
    return {
      status: 'invalid',
      checks: [
        {
          id: 'crl-signature',
          labelKey: 'checks.crlSignature',
          status: 'invalid',
        },
      ],
    };
  }
  const fresh = timeIsFresh(crl.thisUpdate.value, crl.nextUpdate?.value, time);
  const serial = new Uint8Array(
    certificate.serialNumber.valueBlock.valueHexView,
  );
  const revoked = crl.revokedCertificates?.some(entry =>
    serialMatches(
      serial,
      new Uint8Array(entry.userCertificate.valueBlock.valueHexView),
    ),
  );
  if (revoked && fresh) {
    return {
      status: 'invalid',
      source: 'crl',
      checks: [
        { id: 'crl-revoked', labelKey: 'checks.crlRevoked', status: 'invalid' },
      ],
    };
  }
  return fresh
    ? {
        status: 'valid',
        source: 'crl',
        checks: [
          { id: 'crl-good', labelKey: 'checks.crlGood', status: 'valid' },
        ],
      }
    : {
        status: 'indeterminate',
        source: 'crl',
        checks: [
          {
            id: 'crl-freshness',
            labelKey: 'checks.crlFreshness',
            status: 'indeterminate',
          },
        ],
      };
}

export interface OnlineRevocationContext {
  io: VerifierIO;
  sessionId: string;
  trustToken: string;
}

function extensionURLs(certificate: Certificate, oid: string): string[] {
  const extension = certificate.extensions?.find(value => value.extnID === oid);
  if (!extension) return [];
  const bytes = new Uint8Array(extension.extnValue.valueBlock.valueHexView);
  let text = '';
  for (const byte of bytes)
    text += byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ' ';
  return Array.from(
    text.matchAll(/https?:\/\/[A-Za-z0-9._~:/?#\x5B\x5D@!$&'()*+,;=%-]+/g),
    match => match[0],
  );
}

async function onlineBytes(
  context: OnlineRevocationContext,
  kind: 'ocsp' | 'crl',
  url: string,
  bodyBase64?: string,
): Promise<Uint8Array> {
  if (!context.io.fetchEvidence || !context.io.releaseEvidence)
    throw new Error('online-evidence-unavailable');
  const capability = await context.io.fetchEvidence({
    sessionId: context.sessionId,
    kind,
    url,
    method: bodyBase64 ? 'POST' : 'GET',
    bodyBase64,
    parentCapabilityToken: context.trustToken,
    stage: 'verified-chain',
  });
  try {
    return await readAllResource(
      context.io,
      'evidence',
      capability.evidenceToken,
      capability.size,
      MAX_ES3_BYTES,
      'revocation-size-limit',
    );
  } finally {
    await context.io.releaseEvidence(capability.evidenceToken);
  }
}

export async function validateOnlineRevocation(
  certificate: Certificate,
  issuer: Certificate,
  time: Date,
  context: OnlineRevocationContext | undefined,
): Promise<RevocationResult | undefined> {
  if (!context) return undefined;
  for (const url of extensionURLs(certificate, '2.5.29.31')) {
    try {
      const raw = await onlineBytes(context, 'crl', url);
      const schema = fromBER(raw);
      if (schema.offset === -1) continue;
      const result = await evaluateCrl(
        new CertificateRevocationList({ schema: schema.result }),
        certificate,
        issuer,
        time,
      );
      if (result?.status === 'valid' || result?.status === 'invalid')
        return result;
    } catch {
      // Try the next exact certificate-declared endpoint.
    }
  }
  const request = new OCSPRequest();
  await request.createForCertificate(certificate, {
    hashAlgorithm: 'SHA-256',
    issuerCertificate: issuer,
  });
  const bodyBase64 = encodeTransportBase64(
    new Uint8Array(request.toSchema(true).toBER(false)),
  );
  for (const url of extensionURLs(certificate, '1.3.6.1.5.5.7.1.1')) {
    try {
      const raw = await onlineBytes(context, 'ocsp', url, bodyBase64);
      const schema = fromBER(raw);
      if (schema.offset === -1) continue;
      const response = new OCSPResponse({ schema: schema.result });
      if (!response.responseBytes) continue;
      const basicSchema = fromBER(
        response.responseBytes.response.valueBlock.valueHexView,
      );
      if (basicSchema.offset === -1) continue;
      const result = await evaluateOcsp(
        new BasicOCSPResponse({ schema: basicSchema.result }),
        certificate,
        issuer,
        time,
      );
      if (result?.status === 'valid' || result?.status === 'invalid')
        return result;
    } catch {
      // Try the next exact certificate-declared endpoint.
    }
  }
  return undefined;
}

export async function validateEmbeddedRevocation(
  signature: Element,
  certificate: Certificate,
  issuer: Certificate,
  time: Date,
): Promise<RevocationResult> {
  let known: RevocationResult | undefined;
  for (const raw of xadesValues(signature, 'EncapsulatedOCSPValue')) {
    const schema = fromBER(raw);
    if (schema.offset === -1) continue;
    try {
      const result = await evaluateOcsp(
        new BasicOCSPResponse({ schema: schema.result }),
        certificate,
        issuer,
        time,
      );
      if (result?.status === 'invalid' || result?.status === 'valid')
        return result;
      known = result ?? known;
    } catch {
      known = {
        status: 'indeterminate',
        checks: [
          {
            id: 'ocsp-malformed',
            labelKey: 'checks.ocspMalformed',
            status: 'indeterminate',
          },
        ],
      };
    }
  }
  for (const raw of xadesValues(signature, 'EncapsulatedCRLValue')) {
    const schema = fromBER(raw);
    if (schema.offset === -1) continue;
    try {
      const result = await evaluateCrl(
        new CertificateRevocationList({ schema: schema.result }),
        certificate,
        issuer,
        time,
      );
      if (result?.status === 'invalid' || result?.status === 'valid')
        return result;
      known = result ?? known;
    } catch {
      known = {
        status: 'indeterminate',
        checks: [
          {
            id: 'crl-malformed',
            labelKey: 'checks.crlMalformed',
            status: 'indeterminate',
          },
        ],
      };
    }
  }
  return (
    known ?? {
      status: 'indeterminate',
      checks: [
        {
          id: 'revocation-missing',
          labelKey: 'checks.revocationMissing',
          status: 'indeterminate',
        },
      ],
    }
  );
}
