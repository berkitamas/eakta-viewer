import type { DocumentKind } from '../domain/types';
import { ES3_NAMESPACE, XMLDSIG_NAMESPACE } from './limits';
import { ComponentExtractionError, DossierAbortError } from './types';
import { directChild, directChildren, textOfDirectChild } from './xml';

export type ContentTransform = 'zip' | 'encrypt' | 'base64';

export interface ComponentSource {
  id: string;
  kind: DocumentKind;
  parentSignatureId?: string;
  title: string;
  mimeType: string;
  extension: string;
  hintedExtension?: string;
  sourceSize?: number;
  object: Element;
  profile: Element;
  transforms: ContentTransform[];
  modelError?: string;
}

export interface DossierStructure {
  title: string;
  dossierId?: string;
  createdAt?: string;
  profile: string;
  components: ComponentSource[];
  signatures: Element[];
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'application/json': 'json',
  'application/pdf': 'pdf',
  'application/pkcs7-mime': 'p7m',
  'application/xml': 'xml',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/tiff': 'tiff',
  'text/html': 'html',
  'text/plain': 'txt',
  'text/xml': 'xml',
};

function safeTitle(value: string | undefined, fallback: string): string {
  const sanitized = (value ?? '')
    .replace(/[\u0000-\u001f\u007f/\\:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return sanitized || fallback;
}

function firstText(profile: Element, names: string[]): string | undefined {
  for (const name of names) {
    const value = textOfDirectChild(profile, ES3_NAMESPACE, name);
    if (value) return value;
  }
  return undefined;
}

function parseTransforms(profile: Element): ContentTransform[] {
  const baseTransforms = directChildren(
    profile,
    ES3_NAMESPACE,
    'BaseTransform',
  );
  if (baseTransforms.length !== 1)
    throw new ComponentExtractionError('content-transform-structure');
  const elements = directChildren(
    baseTransforms[0],
    ES3_NAMESPACE,
    'Transform',
  );
  const rawValues = elements.map(element => {
    const value = element.getAttribute('Algorithm');
    if (!value) throw new ComponentExtractionError('content-transform-empty');
    return value;
  });
  const transformByToken: Record<string, ContentTransform> = {
    zip: 'zip',
    'application/zip': 'zip',
    encrypt: 'encrypt',
    smime: 'encrypt',
    's/mime': 'encrypt',
    'application/pkcs7-mime': 'encrypt',
    base64: 'base64',
    'http://www.w3.org/2000/09/xmldsig#base64': 'base64',
  };
  const transforms = rawValues.map(value => {
    const transform = transformByToken[value.trim().toLowerCase()];
    if (!transform)
      throw new ComponentExtractionError('content-transform-unsupported');
    return transform;
  });
  const accepted = [
    'base64',
    'zip,base64',
    'encrypt,base64',
    'zip,encrypt,base64',
  ];
  if (!accepted.includes(transforms.join(','))) {
    throw new ComponentExtractionError('content-transform-order');
  }
  return transforms;
}

function exactObjectReference(profile: Element): string {
  const value = profile.getAttribute('OBJREF');
  if (value === null) throw new ComponentExtractionError('objref-missing');
  const trimmed = value.trim();
  const reference = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (!reference) throw new ComponentExtractionError('objref-empty');
  return reference;
}

function componentFromElement(
  element: Element,
  kind: DocumentKind,
  ordinal: number,
  parentSignatureId: string | undefined,
): ComponentSource {
  const profile = directChild(element, ES3_NAMESPACE, 'DocumentProfile');
  if (!profile) throw new ComponentExtractionError('document-profile-missing');
  const reference = exactObjectReference(profile);
  const directObjects = directChildren(element, XMLDSIG_NAMESPACE, 'Object');
  const object = directObjects.find(
    candidate => candidate.getAttribute('Id') === reference,
  );
  if (!object) throw new ComponentExtractionError('objref-target-missing');
  const format = directChild(profile, ES3_NAMESPACE, 'Format');
  const mimeElement = format
    ? directChild(format, ES3_NAMESPACE, 'MIME-Type')
    : undefined;
  const mimeText = mimeElement?.textContent?.trim();
  const mimeTypeAttribute = mimeElement?.getAttribute('type');
  const mimeSubtypeAttribute = mimeElement?.getAttribute('subtype');
  const mimeFromAttributes =
    mimeTypeAttribute &&
    mimeSubtypeAttribute &&
    /^[A-Za-z0-9!#$&^_.+-]+$/.test(mimeTypeAttribute) &&
    /^[A-Za-z0-9!#$&^_.+-]+$/.test(mimeSubtypeAttribute)
      ? `${mimeTypeAttribute}/${mimeSubtypeAttribute}`
      : undefined;
  const mimeType = (
    mimeText ||
    mimeFromAttributes ||
    'application/octet-stream'
  )
    .toLowerCase()
    .split(';', 1)[0]
    .trim();
  const declaredExtension = mimeElement
    ?.getAttribute('extension')
    ?.toLowerCase()
    .replace(/^\./, '');
  const hintedExtension =
    declaredExtension && /^[a-z0-9]{1,10}$/.test(declaredExtension)
      ? declaredExtension
      : undefined;
  const sourceSizeElement = directChild(profile, ES3_NAMESPACE, 'SourceSize');
  const sourceSizeText =
    sourceSizeElement?.getAttribute('sizeValue') ??
    sourceSizeElement?.textContent?.trim() ??
    undefined;
  const sourceSizeUnit = sourceSizeElement?.getAttribute('sizeUnit');
  let sourceSize: number | undefined;
  if (sourceSizeText !== undefined) {
    if (
      sourceSizeUnit &&
      !['b', 'byte', 'bytes', 'octet', 'octets'].includes(
        sourceSizeUnit.toLowerCase(),
      )
    ) {
      throw new ComponentExtractionError('source-size-unit');
    }
    sourceSize = Number(sourceSizeText);
    if (!Number.isSafeInteger(sourceSize) || sourceSize < 0) {
      throw new ComponentExtractionError('source-size-invalid');
    }
  }
  return {
    id: element.getAttribute('Id') || `document-${ordinal}`,
    kind,
    parentSignatureId,
    title: safeTitle(
      firstText(profile, ['Title', 'DocumentTitle', 'Name']),
      `Document ${ordinal}`,
    ),
    mimeType,
    extension: EXTENSION_BY_MIME[mimeType] ?? 'bin',
    hintedExtension,
    sourceSize,
    object,
    profile,
    transforms: parseTransforms(profile),
  };
}

function attachmentDocuments(signature: Element): Element[] {
  const profiles = directChildren(
    signature,
    XMLDSIG_NAMESPACE,
    'Object',
  ).flatMap(object =>
    directChildren(object, ES3_NAMESPACE, 'SignatureProfile'),
  );
  if (profiles.length !== 1) return [];
  const result: Element[] = [];
  for (const comment of directChildren(profiles[0], ES3_NAMESPACE, 'Comment')) {
    result.push(...directChildren(comment, ES3_NAMESPACE, 'Document'));
  }
  return result;
}

export function modelDossier(root: Element): DossierStructure {
  const dossierProfile = directChild(root, ES3_NAMESPACE, 'DossierProfile');
  const documentsElement = directChild(root, ES3_NAMESPACE, 'Documents');
  if (!dossierProfile || !documentsElement)
    throw new DossierAbortError('dossier-structure-missing');
  const declaredProfile =
    dossierProfile.getAttribute('Version') ??
    firstText(dossierProfile, ['Profile', 'Version']);
  if (declaredProfile !== undefined && declaredProfile !== '1.2')
    throw new DossierAbortError('dossier-profile-unsupported');
  const profile = '1.2';

  const components: ComponentSource[] = [];
  const signatures: Element[] = [];
  let ordinal = 1;
  for (const documentElement of directChildren(
    documentsElement,
    ES3_NAMESPACE,
    'Document',
  )) {
    try {
      components.push(
        componentFromElement(documentElement, 'primary', ordinal, undefined),
      );
    } catch (error) {
      if (!(error instanceof ComponentExtractionError)) throw error;
      components.push({
        id: documentElement.getAttribute('Id') || `document-${ordinal}`,
        kind: 'primary',
        title: `Document ${ordinal}`,
        mimeType: 'application/octet-stream',
        extension: 'bin',
        object: documentElement,
        profile: documentElement,
        transforms: [],
        modelError: error.code,
      });
    }
    ordinal += 1;
    signatures.push(
      ...directChildren(documentElement, XMLDSIG_NAMESPACE, 'Signature'),
    );
  }
  signatures.push(...directChildren(root, XMLDSIG_NAMESPACE, 'Signature'));

  for (const signature of signatures) {
    const parentSignatureId =
      signature.getAttribute('Id') ||
      `signature-${signatures.indexOf(signature) + 1}`;
    for (const attachment of attachmentDocuments(signature)) {
      try {
        components.push(
          componentFromElement(
            attachment,
            'signature-attachment',
            ordinal,
            parentSignatureId,
          ),
        );
      } catch (error) {
        if (!(error instanceof ComponentExtractionError)) throw error;
        components.push({
          id: attachment.getAttribute('Id') || `document-${ordinal}`,
          kind: 'signature-attachment',
          parentSignatureId,
          title: `Document ${ordinal}`,
          mimeType: 'application/octet-stream',
          extension: 'bin',
          object: attachment,
          profile: attachment,
          transforms: [],
          modelError: error.code,
        });
      }
      ordinal += 1;
    }
  }

  return {
    title: safeTitle(
      firstText(dossierProfile, ['Title', 'DossierTitle', 'Name']),
      'e-Akta dossier',
    ),
    dossierId: root.getAttribute('Id') || undefined,
    createdAt: firstText(dossierProfile, ['CreationTime', 'CreatedAt']),
    profile,
    components,
    signatures,
  };
}
