import { fromBER } from 'asn1js';
import {
  Certificate,
  ContentInfo,
  IssuerAndSerialNumber,
  SignedData,
  TSTInfo,
} from 'pkijs';
import { XmlCanonicalizer } from 'xmldsigjs';
import type { TimestampResult, ValidationCheck } from '../domain/types';
import { validateHistoricalChain } from './chains';
import { summarizeCertificate } from './certificates';
import { XMLDSIG_NAMESPACE } from './limits';
import { validateEmbeddedRevocation } from './revocation';
import { signatureValueElement } from './signaturePolicy';
import type { TrustContext } from './trust/refreshTrustData';
import { directChild, descendants } from './xml';

const CANONICALIZATION: Record<
  string,
  { comments: boolean; exclusive: boolean }
> = {
  'http://www.w3.org/TR/2001/REC-xml-c14n-20010315': {
    comments: false,
    exclusive: false,
  },
  'http://www.w3.org/TR/2001/REC-xml-c14n-20010315#WithComments': {
    comments: true,
    exclusive: false,
  },
  'http://www.w3.org/2001/10/xml-exc-c14n#': {
    comments: false,
    exclusive: true,
  },
  'http://www.w3.org/2001/10/xml-exc-c14n#WithComments': {
    comments: true,
    exclusive: true,
  },
};

function decodeBase64(value: string): Uint8Array | undefined {
  const normalized = value.replace(/[\t\n\r ]/g, '');
  if (!normalized || /[^A-Za-z0-9+/=]/.test(normalized)) return undefined;
  try {
    return Uint8Array.from(globalThis.atob(normalized), character =>
      character.charCodeAt(0),
    );
  } catch {
    return undefined;
  }
}

function timestampingEku(certificate: Certificate): boolean {
  const extension = certificate.extensions?.find(
    value => value.extnID === '2.5.29.37',
  );
  const parsed = extension?.parsedValue;
  return Boolean(
    parsed &&
      typeof parsed === 'object' &&
      'keyPurposes' in parsed &&
      Array.isArray(parsed.keyPurposes) &&
      parsed.keyPurposes.includes('1.3.6.1.5.5.7.3.8'),
  );
}

function timestampCertificates(signedData: SignedData): Certificate[] {
  return (signedData.certificates ?? []).filter(
    (certificate): certificate is Certificate =>
      certificate instanceof Certificate,
  );
}

function equalBytes(
  left: ArrayBufferView | ArrayBuffer,
  right: ArrayBufferView | ArrayBuffer,
): boolean {
  const leftBytes =
    left instanceof ArrayBuffer
      ? new Uint8Array(left)
      : new Uint8Array(left.buffer, left.byteOffset, left.byteLength);
  const rightBytes =
    right instanceof ArrayBuffer
      ? new Uint8Array(right)
      : new Uint8Array(right.buffer, right.byteOffset, right.byteLength);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1)
    difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

function resolveTimestampSigner(
  signedData: SignedData,
): Certificate | undefined {
  const signer = signedData.signerInfos[0];
  if (!signer) return undefined;
  const matches = timestampCertificates(signedData).filter(certificate => {
    if (signer.sid instanceof IssuerAndSerialNumber) {
      return (
        equalBytes(
          certificate.issuer.toSchema().toBER(false),
          signer.sid.issuer.toSchema().toBER(false),
        ) &&
        equalBytes(
          certificate.serialNumber.valueBlock.valueHexView,
          signer.sid.serialNumber.valueBlock.valueHexView,
        )
      );
    }
    const sid = signer.sid;
    if (sid.idBlock.tagClass !== 3 || sid.idBlock.tagNumber !== 0) return false;
    const extension = certificate.extensions?.find(
      value => value.extnID === '2.5.29.14',
    );
    const parsed = extension?.parsedValue;
    if (!parsed || typeof parsed !== 'object' || !('valueBlock' in parsed))
      return false;
    const valueBlock = parsed.valueBlock;
    if (
      !valueBlock ||
      typeof valueBlock !== 'object' ||
      !('valueHexView' in valueBlock)
    )
      return false;
    return equalBytes(
      sid.valueBlock.valueHexView,
      valueBlock.valueHexView as Uint8Array,
    );
  });
  return matches.length === 1 ? matches[0] : undefined;
}

function invalidTimestamp(
  id: string,
  code: string,
  checks: ValidationCheck[] = [],
): TimestampResult {
  return {
    id,
    status: 'invalid',
    checks: [
      ...checks,
      { id: code, labelKey: `checks.${code}`, status: 'invalid' },
    ],
    warnings: [],
  };
}

export async function validateSignatureTimestamp(
  timestamp: Element,
  signature: Element,
  index: number,
  trust: TrustContext | undefined,
  validationTime: Date,
): Promise<TimestampResult> {
  const id = timestamp.getAttribute('Id') || `timestamp-${index + 1}`;
  const encapsulated = descendants(
    timestamp,
    timestamp.namespaceURI ?? '',
    'EncapsulatedTimeStamp',
  )[0];
  const raw = decodeBase64(encapsulated?.textContent ?? '');
  if (!raw) return invalidTimestamp(id, 'timestamp-encoding');
  const signatureValue = signatureValueElement(signature);
  if (!signatureValue) return invalidTimestamp(id, 'signature-value-missing');
  const method = directChild(
    timestamp,
    XMLDSIG_NAMESPACE,
    'CanonicalizationMethod',
  )?.getAttribute('Algorithm');
  const canonicalization = method ? CANONICALIZATION[method] : undefined;
  if (!canonicalization)
    return invalidTimestamp(id, 'timestamp-canonicalization');
  const canonicalizer = new XmlCanonicalizer(
    canonicalization.comments,
    canonicalization.exclusive,
  );
  const canonicalBytes = new TextEncoder().encode(
    canonicalizer.Canonicalize(signatureValue),
  );

  let failureCode = 'timestamp-cms-malformed';
  try {
    const contentSchema = fromBER(raw);
    if (contentSchema.offset === -1)
      return invalidTimestamp(id, 'timestamp-cms-malformed');
    const contentInfo = new ContentInfo({ schema: contentSchema.result });
    if (contentInfo.contentType !== ContentInfo.SIGNED_DATA) {
      return invalidTimestamp(id, 'timestamp-cms-content-type');
    }
    const signedData = new SignedData({ schema: contentInfo.content });
    if (signedData.signerInfos.length !== 1)
      return invalidTimestamp(id, 'timestamp-cms-signers');
    failureCode = 'timestamp-cms-signature-error';
    const cmsValid = await signedData.verify({
      signer: 0,
      checkChain: false,
      data: Uint8Array.from(canonicalBytes).buffer,
    });
    const checks: ValidationCheck[] = [
      {
        id: 'timestamp-cms',
        labelKey: 'checks.timestampCms',
        status: cmsValid ? 'valid' : 'invalid',
      },
    ];
    if (!cmsValid) return invalidTimestamp(id, 'timestamp-cms', checks);

    failureCode = 'timestamp-info-error';
    const eContent = signedData.encapContentInfo.eContent;
    if (!eContent)
      return invalidTimestamp(id, 'timestamp-info-missing', checks);
    const infoSchema = fromBER(eContent.valueBlock.valueHexView);
    if (infoSchema.offset === -1)
      return invalidTimestamp(id, 'timestamp-info-malformed', checks);
    const info = new TSTInfo({ schema: infoSchema.result });
    failureCode = 'timestamp-imprint-error';
    const imprintValid = await info.verify({ data: canonicalBytes.buffer });
    checks.push({
      id: 'timestamp-imprint',
      labelKey: 'checks.timestampImprint',
      status: imprintValid ? 'valid' : 'invalid',
    });
    if (!imprintValid) return invalidTimestamp(id, 'timestamp-imprint', checks);

    failureCode = 'timestamp-tsa-error';
    const tsa = resolveTimestampSigner(signedData);
    if (!tsa || !timestampingEku(tsa)) {
      return invalidTimestamp(id, 'timestamp-tsa-certificate', checks);
    }
    const validityPass =
      tsa.notBefore.value.getTime() <= info.genTime.getTime() &&
      tsa.notAfter.value.getTime() >= info.genTime.getTime();
    checks.push({
      id: 'timestamp-tsa-validity',
      labelKey: 'checks.timestampTsaValidity',
      status: validityPass ? 'valid' : 'invalid',
    });
    if (!validityPass)
      return invalidTimestamp(id, 'timestamp-tsa-validity', checks);
    failureCode = 'timestamp-trust-error';
    const chain = await validateHistoricalChain(
      tsa,
      timestampCertificates(signedData),
      trust,
      'tsa',
      info.genTime,
      validationTime,
    );
    checks.push(...chain.checks);
    const issuer = chain.path[1];
    const revocation = issuer
      ? await validateEmbeddedRevocation(signature, tsa, issuer, info.genTime)
      : { status: 'indeterminate' as const, checks: [] };
    checks.push(...revocation.checks);
    const status =
      chain.status === 'valid' && revocation.status === 'valid'
        ? 'valid'
        : revocation.status === 'invalid'
        ? 'invalid'
        : 'indeterminate';
    return {
      id,
      status,
      generationTime: info.genTime.toISOString(),
      tsa: await summarizeCertificate(tsa),
      imprintAlgorithm: info.messageImprint.hashAlgorithm.algorithmId,
      policyOid: info.policy,
      checks,
      warnings:
        status === 'indeterminate'
          ? ['timestamp-trust-or-revocation-unavailable']
          : [],
    };
  } catch {
    return invalidTimestamp(id, failureCode);
  }
}
