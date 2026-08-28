import { ObjectIdentifier } from 'asn1js';
import { SignedXml, X509Certificate } from 'xmldsigjs';
import type { Certificate } from 'pkijs';
import { decodeStrictBase64, parseCertificateDer } from '../certificates';
import {
  bindVerificationKeyAlgorithm,
  ensureCryptoEngine,
} from '../cryptoEngine';
import { XMLDSIG_NAMESPACE } from '../limits';

export const EU_LOTL_URL = 'https://ec.europa.eu/tools/lotl/eu-lotl.xml';
export const LOTL_SIGNER_SHA256: Record<string, true> = {
  c0641c4f7d56c431b1c924742db7fce9c1eef7d7fd212113a2768486b3abcdc5: true,
  e0a620fbb6747362bb933ac44169d676a553444716cf5f31605f12a22b8396b1: true,
  df7e29360c34b2b8d6d5f40325c1d4d12c9922cecd33b7407674a74b2b3ca1e5: true,
  b63d416744e7098bf9ec2caa596a93bc2468e37f8284ba65ecc061711bcbaa18: true,
  '236103f03a8031ae8f47f9059bf8de38564cdbfebedde4a597d50f8980aa653b': true,
  d2064fdd70f6982dcc516b86d9d5c56aea939417c624b2e478c0b29de54f8474: true,
};

const SERVICE_TYPE: Record<string, 'ca' | 'tsa'> = {
  'http://uri.etsi.org/TrstSvc/Svctype/CA/QC': 'ca',
  'http://uri.etsi.org/TrstSvc/Svctype/TSA/QTST': 'tsa',
};

const GRANTED_STATUS: Record<string, true> = {
  'http://uri.etsi.org/TrstSvc/TrustedList/Svcstatus/granted': true,
  'http://uri.etsi.org/TrstSvc/TrustedList/Svcstatus/recognisedatnationallevel':
    true,
  'http://uri.etsi.org/TrstSvc/TrustedList/Svcstatus/undersupervision': true,
  'http://uri.etsi.org/TrstSvc/TrustedList/Svcstatus/supervisionincessation':
    true,
  'http://uri.etsi.org/TrstSvc/TrustedList/Svcstatus/accredited': true,
};

export interface TrustServiceInterval {
  start: string;
  end?: string;
  status: string;
  granted: boolean;
}

export interface TrustServiceIdentity {
  role: 'ca' | 'tsa';
  serviceType: string;
  certificate: Certificate;
  intervals: TrustServiceInterval[];
  qualifications: string[];
}

export interface TrustContext {
  services: TrustServiceIdentity[];
  lotlNextUpdate: string;
  huTslNextUpdate: string;
  huTslUrl: string;
  verifiedAt: string;
}

function allElements(
  parent: Element,
  localName: string,
  namespace?: string,
): Element[] {
  const result: Element[] = [];
  const visit = (element: Element): void => {
    for (const child of Array.from(element.children)) {
      if (
        child.localName === localName &&
        (!namespace || child.namespaceURI === namespace)
      )
        result.push(child);
      visit(child);
    }
  };
  visit(parent);
  return result;
}

function parseTrustXml(bytes: Uint8Array): Document {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(source))
    throw new Error('trust-xml-entity');
  const document = new DOMParser().parseFromString(source, 'application/xml');
  if (
    document.getElementsByTagName('parsererror').length ||
    !document.documentElement
  ) {
    throw new Error('trust-xml-malformed');
  }
  return document;
}

async function sha256(raw: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', Uint8Array.from(raw).buffer),
  );
  return Array.from(digest, value => value.toString(16).padStart(2, '0')).join(
    '',
  );
}

function embeddedSignatureCertificates(signature: Element): Uint8Array[] {
  return allElements(signature, 'X509Certificate', XMLDSIG_NAMESPACE).flatMap(
    element => {
      const raw = decodeStrictBase64(element.textContent ?? '');
      return raw ? [raw] : [];
    },
  );
}

function signatureKeyAlgorithm(
  signature: Element,
  raw: Uint8Array,
): EcKeyImportParams | RsaHashedImportParams | undefined {
  const method = allElements(
    signature,
    'SignatureMethod',
    XMLDSIG_NAMESPACE,
  )[0]?.getAttribute('Algorithm');
  if (method?.includes('ecdsa-')) {
    const parameters =
      parseCertificateDer(raw)?.subjectPublicKeyInfo.algorithm.algorithmParams;
    const curve =
      parameters instanceof ObjectIdentifier
        ? parameters.valueBlock.toString()
        : undefined;
    const namedCurve: Record<string, string> = {
      '1.2.840.10045.3.1.7': 'P-256',
      '1.3.132.0.34': 'P-384',
      '1.3.132.0.35': 'P-521',
    };
    return curve && namedCurve[curve]
      ? { name: 'ECDSA', namedCurve: namedCurve[curve] }
      : undefined;
  }
  const hashBySuffix: Record<string, string> = {
    'rsa-sha1': 'SHA-1',
    'rsa-sha256': 'SHA-256',
    'rsa-sha384': 'SHA-384',
    'rsa-sha512': 'SHA-512',
  };
  const suffix = method?.split('#').at(-1) ?? method?.split('/').at(-1);
  const hash = suffix ? hashBySuffix[suffix] : undefined;
  return hash ? { name: 'RSASSA-PKCS1-v1_5', hash } : undefined;
}
async function verifyWithCertificates(
  signature: Element,
  certificates: Uint8Array[],
): Promise<boolean> {
  const signedXml = new SignedXml(signature.ownerDocument ?? signature);
  signedXml.LoadXml(signature);
  let verificationError: unknown;
  for (const raw of certificates) {
    try {
      const certificate = new X509Certificate(Uint8Array.from(raw).buffer);
      const key = await certificate.exportKey(
        signatureKeyAlgorithm(signature, raw),
      );
      bindVerificationKeyAlgorithm(signedXml, key);
      if (await signedXml.Verify({ key })) return true;
    } catch (error) {
      verificationError = error;
    }
  }
  if (verificationError instanceof Error) throw verificationError;
  return false;
}

async function verifyLotl(document: Document): Promise<Uint8Array[]> {
  const signatures = allElements(
    document.documentElement,
    'Signature',
    XMLDSIG_NAMESPACE,
  );
  if (signatures.length !== 1) throw new Error('lotl-signature-count');
  const signature = signatures[0];
  const pinned: Uint8Array[] = [];
  for (const raw of embeddedSignatureCertificates(signature)) {
    if (LOTL_SIGNER_SHA256[await sha256(raw)]) pinned.push(raw);
  }
  if (
    pinned.length === 0 ||
    !(await verifyWithCertificates(signature, pinned))
  ) {
    throw new Error('lotl-signature-invalid');
  }
  return pinned;
}

function directText(parent: Element, localName: string): string | undefined {
  const child = Array.from(parent.children).find(
    element => element.localName === localName,
  );
  return child?.textContent?.trim() || undefined;
}

function huPointer(document: Document): {
  url: string;
  identities: Uint8Array[];
} {
  const pointers = allElements(document.documentElement, 'OtherTSLPointer');
  const matches = pointers.filter(pointer => {
    const territory = allElements(
      pointer,
      'SchemeTerritory',
    )[0]?.textContent?.trim();
    const location = allElements(
      pointer,
      'TSLLocation',
    )[0]?.textContent?.trim();
    if (territory !== 'HU' || !location) return false;
    try {
      const url = new URL(location);
      return (
        url.protocol === 'https:' && url.pathname.toLowerCase().endsWith('.xml')
      );
    } catch {
      return false;
    }
  });
  if (matches.length !== 1) throw new Error('hu-pointer-count');
  const pointer = matches[0];
  const url = allElements(pointer, 'TSLLocation')[0]?.textContent?.trim();
  if (!url) throw new Error('hu-pointer-url');
  const identities = allElements(pointer, 'X509Certificate').flatMap(
    element => {
      const raw = decodeStrictBase64(element.textContent ?? '');
      return raw ? [raw] : [];
    },
  );
  if (identities.length === 0) throw new Error('hu-pointer-identities');
  return { url, identities };
}

async function verifyHuTsl(
  document: Document,
  identities: Uint8Array[],
): Promise<void> {
  const signatures = allElements(
    document.documentElement,
    'Signature',
    XMLDSIG_NAMESPACE,
  );
  if (
    signatures.length !== 1 ||
    !(await verifyWithCertificates(signatures[0], identities))
  ) {
    throw new Error('hu-tsl-signature-invalid');
  }
}

function nextUpdate(document: Document): string {
  const value = allElements(document.documentElement, 'NextUpdate')[0];
  const dateText = value
    ? allElements(value, 'dateTime')[0]?.textContent?.trim() ??
      value.textContent?.trim()
    : undefined;
  const date = dateText ? new Date(dateText) : undefined;
  if (!date || !Number.isFinite(date.getTime()))
    throw new Error('trust-next-update');
  return date.toISOString();
}

function serviceIntervals(service: Element): TrustServiceInterval[] {
  const information = allElements(service, 'ServiceInformation')[0];
  if (!information) return [];
  const events: Array<{ start: number; status: string }> = [];
  const addEvent = (element: Element): void => {
    const start = directText(element, 'StatusStartingTime');
    const status = directText(element, 'ServiceStatus');
    const timestamp = start ? new Date(start).getTime() : Number.NaN;
    if (status && Number.isFinite(timestamp))
      events.push({ start: timestamp, status });
  };
  addEvent(information);
  for (const history of allElements(service, 'ServiceHistoryInstance'))
    addEvent(history);
  events.sort((left, right) => left.start - right.start);
  return events.map((event, index) => ({
    start: new Date(event.start).toISOString(),
    end: events[index + 1]
      ? new Date(events[index + 1].start).toISOString()
      : undefined,
    status: event.status,
    granted: Boolean(GRANTED_STATUS[event.status]),
  }));
}

function trustServices(document: Document): TrustServiceIdentity[] {
  const result: TrustServiceIdentity[] = [];
  for (const service of allElements(document.documentElement, 'TSPService')) {
    const information = allElements(service, 'ServiceInformation')[0];
    const serviceType = information
      ? directText(information, 'ServiceTypeIdentifier')
      : undefined;
    const role = serviceType ? SERVICE_TYPE[serviceType] : undefined;
    if (!information || !serviceType || !role) continue;
    const intervals = serviceIntervals(service);
    const qualifications = allElements(service, 'Qualifier').flatMap(
      element => {
        const value =
          element.getAttribute('uri') ??
          element.getAttribute('URI') ??
          element.textContent?.trim();
        return value ? [value] : [];
      },
    );
    for (const element of allElements(information, 'X509Certificate')) {
      const raw = decodeStrictBase64(element.textContent ?? '');
      const certificate = raw ? parseCertificateDer(raw) : undefined;
      if (certificate)
        result.push({
          role,
          serviceType,
          certificate,
          intervals,
          qualifications,
        });
    }
  }
  return result;
}

export function trustCertificatesFor(
  context: TrustContext,
  role: 'ca' | 'tsa',
  time: Date,
): Certificate[] {
  const timestamp = time.getTime();
  return context.services
    .filter(
      service =>
        service.role === role &&
        service.intervals.some(interval => {
          const start = new Date(interval.start).getTime();
          const end = interval.end
            ? new Date(interval.end).getTime()
            : Number.POSITIVE_INFINITY;
          return interval.granted && start <= timestamp && timestamp < end;
        }),
    )
    .map(service => service.certificate);
}

export async function verifyLotlAndResolveHu(lotlBytes: Uint8Array): Promise<{
  url: string;
  signerCertificates: Uint8Array[];
}> {
  ensureCryptoEngine();
  const lotl = parseTrustXml(lotlBytes);
  const signerCertificates = await verifyLotl(lotl);
  return { url: huPointer(lotl).url, signerCertificates };
}

export async function refreshTrustData(
  lotlBytes: Uint8Array,
  huTslBytes: Uint8Array,
  validationTime: Date,
): Promise<TrustContext> {
  ensureCryptoEngine();
  const lotl = parseTrustXml(lotlBytes);
  await verifyLotl(lotl);
  const pointer = huPointer(lotl);
  const huTsl = parseTrustXml(huTslBytes);
  await verifyHuTsl(huTsl, pointer.identities);
  const lotlNextUpdate = nextUpdate(lotl);
  const huTslNextUpdate = nextUpdate(huTsl);
  const services = trustServices(huTsl);
  return {
    services,
    lotlNextUpdate,
    huTslNextUpdate,
    huTslUrl: pointer.url,
    verifiedAt: validationTime.toISOString(),
  };
}
