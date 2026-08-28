import { fromBER } from 'asn1js';
import { Certificate, IssuerSerial as PkijsIssuerSerial } from 'pkijs';
import type { CertificateSummary } from '../domain/types';
import { XADES_NAMESPACES, XMLDSIG_NAMESPACE } from './limits';
import { directChild, descendants } from './xml';

export interface SelectedCertificate {
  certificate: Certificate;
  raw: Uint8Array;
  summary: CertificateSummary;
  allCertificates: Certificate[];
}

export function decodeStrictBase64(value: string): Uint8Array | undefined {
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

export function parseCertificateDer(raw: Uint8Array): Certificate | undefined {
  const schema = fromBER(raw);
  if (schema.offset === -1) return undefined;
  try {
    return new Certificate({ schema: schema.result });
  } catch {
    return undefined;
  }
}

function attributeValue(
  certificate: Certificate,
  oid: string,
): string | undefined {
  const attribute = certificate.subject.typesAndValues.find(
    value => value.type === oid,
  );
  const valueBlock = attribute?.value.valueBlock;
  if (
    !valueBlock ||
    !('value' in valueBlock) ||
    typeof valueBlock.value !== 'string'
  )
    return undefined;
  return valueBlock.value;
}

function serialHex(certificate: Certificate): string {
  const bytes = new Uint8Array(
    certificate.serialNumber.valueBlock.valueHexView,
  );
  return Array.from(bytes, value => value.toString(16).padStart(2, '0'))
    .join('')
    .replace(/^00/, '');
}

function serialDecimal(certificate: Certificate): string {
  const hex = serialHex(certificate);
  return hex ? BigInt(`0x${hex}`).toString(10) : '0';
}

function normalizedIssuer(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s*([,=+])\s*/g, '$1')
    .trim()
    .toLowerCase();
}

function issuerTextMatches(
  certificate: Certificate,
  issuerName: string,
): boolean {
  const expected = normalizedIssuer(issuerName);
  if (expected === normalizedIssuer(certificate.issuer.toString())) return true;
  const values = certificate.issuer.typesAndValues.flatMap(attribute => {
    const valueBlock = attribute.value.valueBlock;
    return 'value' in valueBlock && typeof valueBlock.value === 'string'
      ? [normalizedIssuer(valueBlock.value)]
      : [];
  });
  return values.length > 0 && values.every(value => expected.includes(value));
}

function parseIssuerSerialV2(element: Element): PkijsIssuerSerial | undefined {
  const raw = decodeStrictBase64(element.textContent ?? '');
  if (!raw) return undefined;
  const schema = fromBER(raw);
  if (schema.offset === -1) return undefined;
  try {
    return new PkijsIssuerSerial({ schema: schema.result });
  } catch {
    return undefined;
  }
}

function issuerSerialV2Matches(
  certificate: Certificate,
  issuerSerial: PkijsIssuerSerial,
): boolean {
  if (
    !equalBytes(
      new Uint8Array(certificate.serialNumber.valueBlock.valueHexView),
      new Uint8Array(issuerSerial.serialNumber.valueBlock.valueHexView),
    )
  )
    return false;
  const certificateIssuer = new Uint8Array(
    certificate.issuer.toSchema().toBER(false),
  );
  return issuerSerial.issuer.names.some(name => {
    if (name.type !== 4) return false;
    const directoryName: unknown = name.value;
    if (
      !directoryName ||
      typeof directoryName !== 'object' ||
      !('toSchema' in directoryName) ||
      typeof directoryName.toSchema !== 'function'
    )
      return false;
    return equalBytes(
      certificateIssuer,
      new Uint8Array(directoryName.toSchema().toBER(false)),
    );
  });
}

async function digest(
  algorithm: string,
  data: Uint8Array,
): Promise<Uint8Array | undefined> {
  const nameByUri: Record<string, AlgorithmIdentifier> = {
    'http://www.w3.org/2000/09/xmldsig#sha1': { name: 'SHA-1' },
    'http://www.w3.org/2001/04/xmlenc#sha256': { name: 'SHA-256' },
    'http://www.w3.org/2001/04/xmldsig-more#sha384': { name: 'SHA-384' },
    'http://www.w3.org/2001/04/xmlenc#sha512': { name: 'SHA-512' },
  };
  const selected = nameByUri[algorithm];
  if (!selected) return undefined;
  return new Uint8Array(
    await crypto.subtle.digest(selected, Uint8Array.from(data).buffer),
  );
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left[index] ^ right[index];
  return difference === 0;
}

function xadesDescendants(parent: Element, localName: string): Element[] {
  const result: Element[] = [];
  const visit = (element: Element): void => {
    for (const child of Array.from(element.children)) {
      if (
        child.localName === localName &&
        child.namespaceURI &&
        XADES_NAMESPACES[child.namespaceURI]
      ) {
        result.push(child);
      }
      visit(child);
    }
  };
  visit(parent);
  return result;
}

export async function summarizeCertificate(
  certificate: Certificate,
  raw?: Uint8Array,
): Promise<CertificateSummary> {
  const encoded = raw ?? new Uint8Array(certificate.toSchema().toBER(false));
  const fingerprint = new Uint8Array(
    await crypto.subtle.digest('SHA-256', Uint8Array.from(encoded).buffer),
  );
  return {
    subject:
      attributeValue(certificate, '2.5.4.3') ?? certificate.subject.toString(),
    issuer: certificate.issuer.toString(),
    serialNumber: serialHex(certificate),
    validFrom: certificate.notBefore.value.toISOString(),
    validTo: certificate.notAfter.value.toISOString(),
    fingerprintSha256: Array.from(fingerprint, value =>
      value.toString(16).padStart(2, '0'),
    ).join(''),
  };
}

export async function selectSignerCertificate(
  signature: Element,
): Promise<SelectedCertificate | undefined> {
  const certificateElements = descendants(
    signature,
    XMLDSIG_NAMESPACE,
    'X509Certificate',
  );
  const candidates = certificateElements.flatMap(element => {
    const raw = decodeStrictBase64(element.textContent ?? '');
    const certificate = raw ? parseCertificateDer(raw) : undefined;
    return raw && certificate ? [{ raw, certificate }] : [];
  });
  if (candidates.length === 0) return undefined;

  const signingCertificate =
    xadesDescendants(signature, 'SigningCertificateV2')[0] ??
    xadesDescendants(signature, 'SigningCertificate')[0];
  const cert = signingCertificate
    ? xadesDescendants(signingCertificate, 'Cert')[0]
    : undefined;
  const certDigest = cert ? xadesDescendants(cert, 'CertDigest')[0] : undefined;
  const digestMethod = certDigest
    ? directChild(certDigest, XMLDSIG_NAMESPACE, 'DigestMethod')?.getAttribute(
        'Algorithm',
      )
    : undefined;
  const digestValue = certDigest
    ? decodeStrictBase64(
        directChild(certDigest, XMLDSIG_NAMESPACE, 'DigestValue')
          ?.textContent ?? '',
      )
    : undefined;
  const issuerSerial = cert
    ? xadesDescendants(cert, 'IssuerSerial')[0]
    : undefined;
  const issuerName = issuerSerial
    ? directChild(
        issuerSerial,
        XMLDSIG_NAMESPACE,
        'X509IssuerName',
      )?.textContent?.trim()
    : undefined;
  const serialText = issuerSerial
    ? directChild(
        issuerSerial,
        XMLDSIG_NAMESPACE,
        'X509SerialNumber',
      )?.textContent?.trim()
    : undefined;
  const issuerSerialV2Element = cert
    ? xadesDescendants(cert, 'IssuerSerialV2')[0]
    : undefined;
  const issuerSerialV2 = issuerSerialV2Element
    ? parseIssuerSerialV2(issuerSerialV2Element)
    : undefined;
  if (
    !digestMethod ||
    !digestValue ||
    (!issuerSerialV2 && (!issuerName || !serialText))
  )
    return undefined;

  const matches: typeof candidates = [];
  for (const candidate of candidates) {
    const calculated = await digest(digestMethod, candidate.raw);
    if (!calculated || !equalBytes(calculated, digestValue)) continue;
    const identityMatches = issuerSerialV2
      ? issuerSerialV2Matches(candidate.certificate, issuerSerialV2)
      : serialText === serialDecimal(candidate.certificate) &&
        issuerTextMatches(candidate.certificate, issuerName ?? '');
    if (!identityMatches) continue;
    matches.push(candidate);
  }
  if (matches.length !== 1) return undefined;
  const match = matches[0];
  return {
    ...match,
    allCertificates: candidates.map(candidate => candidate.certificate),
    summary: await summarizeCertificate(match.certificate, match.raw),
  };
}
