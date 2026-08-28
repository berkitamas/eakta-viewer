import { ES3_NAMESPACE } from './limits';
import { DossierAbortError } from './types';

export interface ParsedXml {
  document: Document;
  root: Element;
  encoding: 'UTF-8' | 'ISO-8859-2';
}

function declarationEncoding(
  bytes: Uint8Array,
  bomLength: number,
): 'UTF-8' | 'ISO-8859-2' {
  const prefix = String.fromCharCode(
    ...bytes.subarray(bomLength, Math.min(bytes.length, bomLength + 512)),
  );
  const declaration = prefix.match(/^<\?xml\s+([^?]+)\?>/i);
  if (!declaration) throw new DossierAbortError('xml-declaration-required');
  const encodingMatch = declaration[1].match(
    /(?:^|\s)encoding\s*=\s*(['"])([^'"]+)\1/i,
  );
  if (!encodingMatch) throw new DossierAbortError('xml-encoding-required');
  const normalized = encodingMatch[2].toUpperCase().replace('_', '-');
  if (normalized === 'UTF-8' || normalized === 'UTF8') return 'UTF-8';
  if (normalized === 'ISO-8859-2' || normalized === 'ISO8859-2')
    return 'ISO-8859-2';
  throw new DossierAbortError('xml-encoding-unsupported');
}

function decodeXml(bytes: Uint8Array): {
  source: string;
  encoding: 'UTF-8' | 'ISO-8859-2';
} {
  const hasUtf8Bom =
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf;
  const bomLength = hasUtf8Bom ? 3 : 0;
  const encoding = declarationEncoding(bytes, bomLength);
  if (hasUtf8Bom && encoding !== 'UTF-8')
    throw new DossierAbortError('xml-bom-conflict');
  try {
    const decoder = new TextDecoder(encoding.toLowerCase(), {
      fatal: encoding === 'UTF-8',
      ignoreBOM: true,
    });
    return { source: decoder.decode(bytes.subarray(bomLength)), encoding };
  } catch {
    throw new DossierAbortError('xml-decoding-failed');
  }
}

function rejectDuplicateIds(root: Element): void {
  const seen = new Set<string>();
  const visit = (element: Element): void => {
    if (element.hasAttribute('Id')) {
      const id = element.getAttribute('Id') ?? '';
      if (!id || seen.has(id))
        throw new DossierAbortError('duplicate-or-empty-id');
      seen.add(id);
    }
    for (const child of Array.from(element.children)) visit(child);
  };
  visit(root);
}

export function parseDossierXml(bytes: Uint8Array): ParsedXml {
  const { source, encoding } = decodeXml(bytes);
  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(source))
    throw new DossierAbortError('xml-entity-forbidden');
  const document = new DOMParser().parseFromString(source, 'application/xml');
  const parserErrors = document.getElementsByTagName('parsererror');
  if (parserErrors.length > 0 || !document.documentElement) {
    throw new DossierAbortError('xml-malformed');
  }
  const root = document.documentElement;
  if (root.localName !== 'Dossier' || root.namespaceURI !== ES3_NAMESPACE) {
    throw new DossierAbortError('unsupported-dossier-root');
  }
  rejectDuplicateIds(root);
  const profile = directChild(root, ES3_NAMESPACE, 'DossierProfile');
  if (!profile) throw new DossierAbortError('dossier-profile-missing');
  return { document, root, encoding };
}

export function directChildren(
  parent: Element,
  namespace: string,
  localName: string,
): Element[] {
  return Array.from(parent.children).filter(
    child => child.namespaceURI === namespace && child.localName === localName,
  );
}

export function directChild(
  parent: Element,
  namespace: string,
  localName: string,
): Element | undefined {
  return directChildren(parent, namespace, localName)[0];
}

export function descendants(
  parent: Element,
  namespace: string,
  localName: string,
): Element[] {
  const result: Element[] = [];
  const visit = (element: Element): void => {
    for (const child of Array.from(element.children)) {
      if (child.namespaceURI === namespace && child.localName === localName)
        result.push(child);
      visit(child);
    }
  };
  visit(parent);
  return result;
}

export function textOfDirectChild(
  parent: Element,
  namespace: string,
  localName: string,
): string | undefined {
  return (
    directChild(parent, namespace, localName)?.textContent?.trim() || undefined
  );
}
