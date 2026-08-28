import type { ValidationCheck, VerificationStatus } from '../domain/types';
import { ES3_NAMESPACE, XADES_NAMESPACES, XMLDSIG_NAMESPACE } from './limits';
import { DossierAbortError } from './types';
import { directChild, directChildren } from './xml';

const SIGNATURE_ALGORITHM: Record<string, true> = {
  'http://www.w3.org/2000/09/xmldsig#rsa-sha1': true,
  'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256': true,
  'http://www.w3.org/2001/04/xmldsig-more#rsa-sha384': true,
  'http://www.w3.org/2001/04/xmldsig-more#rsa-sha512': true,
  'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha1': true,
  'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256': true,
  'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha384': true,
  'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha512': true,
  'http://www.w3.org/2007/05/xmldsig-more#sha256-rsa-MGF1': true,
  'http://www.w3.org/2007/05/xmldsig-more#sha384-rsa-MGF1': true,
  'http://www.w3.org/2007/05/xmldsig-more#sha512-rsa-MGF1': true,
};

const DIGEST_ALGORITHM: Record<string, true> = {
  'http://www.w3.org/2000/09/xmldsig#sha1': true,
  'http://www.w3.org/2001/04/xmlenc#sha256': true,
  'http://www.w3.org/2001/04/xmldsig-more#sha384': true,
  'http://www.w3.org/2001/04/xmlenc#sha512': true,
};

const CANONICALIZATION_ALGORITHM: Record<string, true> = {
  'http://www.w3.org/TR/2001/REC-xml-c14n-20010315': true,
  'http://www.w3.org/TR/2001/REC-xml-c14n-20010315#WithComments': true,
  'http://www.w3.org/2001/10/xml-exc-c14n#': true,
  'http://www.w3.org/2001/10/xml-exc-c14n#WithComments': true,
};

const REFERENCE_TRANSFORM: Record<string, true> = {
  ...CANONICALIZATION_ALGORITHM,
  'http://www.w3.org/2000/09/xmldsig#enveloped-signature': true,
  'http://www.w3.org/2000/09/xmldsig#base64': true,
};

export interface SignaturePolicyResult {
  status: VerificationStatus;
  scope: 'document' | 'frame';
  parentDocumentId?: string;
  weakAlgorithm: boolean;
  checks: ValidationCheck[];
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

function requiredScopeIds(
  signature: Element,
  root: Element,
  scope: 'document' | 'frame',
): string[] | undefined {
  const signedPropertiesCandidates = xadesDescendants(
    signature,
    'SignedProperties',
  );
  const signedProperties =
    signedPropertiesCandidates.length === 1
      ? signedPropertiesCandidates[0]
      : undefined;
  const signatureProfiles = directChildren(
    signature,
    XMLDSIG_NAMESPACE,
    'Object',
  ).flatMap(object =>
    directChildren(object, ES3_NAMESPACE, 'SignatureProfile'),
  );
  const signatureProfile =
    signatureProfiles.length === 1 ? signatureProfiles[0] : undefined;
  const required = [signedProperties, signatureProfile];
  if (scope === 'frame') {
    required.push(
      directChild(root, ES3_NAMESPACE, 'Documents'),
      directChild(root, ES3_NAMESPACE, 'DossierProfile'),
    );
  } else {
    const document = signature.parentElement;
    const profile = document
      ? directChild(document, ES3_NAMESPACE, 'DocumentProfile')
      : undefined;
    const objref = profile?.getAttribute('OBJREF')?.trim();
    const objectId = objref?.startsWith('#') ? objref.slice(1) : objref;
    const matchingObjects =
      document && objectId
        ? directChildren(document, XMLDSIG_NAMESPACE, 'Object').filter(
            object => object.getAttribute('Id') === objectId,
          )
        : [];
    required.push(
      matchingObjects.length === 1 ? matchingObjects[0] : undefined,
      profile,
    );
  }
  const ids: string[] = [];
  for (const element of required) {
    const id = element?.getAttribute('Id');
    if (!id) return undefined;
    ids.push(id);
  }
  return ids;
}

export function enforceSignaturePolicy(
  signature: Element,
  root: Element,
): SignaturePolicyResult {
  const signedInfo = directChild(signature, XMLDSIG_NAMESPACE, 'SignedInfo');
  if (!signedInfo) {
    return {
      status: 'invalid',
      scope: 'frame',
      weakAlgorithm: false,
      checks: [],
    };
  }
  const parentDocument =
    signature.parentElement?.namespaceURI === ES3_NAMESPACE &&
    signature.parentElement.localName === 'Document'
      ? signature.parentElement
      : undefined;
  const scope = parentDocument ? 'document' : 'frame';
  const checks: ValidationCheck[] = [];
  let status: VerificationStatus = 'valid';
  let weakAlgorithm = false;

  const canonicalization = directChild(
    signedInfo,
    XMLDSIG_NAMESPACE,
    'CanonicalizationMethod',
  )?.getAttribute('Algorithm');
  const signatureMethod = directChild(
    signedInfo,
    XMLDSIG_NAMESPACE,
    'SignatureMethod',
  )?.getAttribute('Algorithm');
  if (!canonicalization || !CANONICALIZATION_ALGORITHM[canonicalization])
    status = 'indeterminate';
  if (!signatureMethod || !SIGNATURE_ALGORITHM[signatureMethod])
    status = 'indeterminate';
  weakAlgorithm = signatureMethod?.toLowerCase().includes('sha1') ?? false;
  checks.push({
    id: 'canonicalization',
    labelKey: 'checks.canonicalization',
    status,
  });

  const references = directChildren(signedInfo, XMLDSIG_NAMESPACE, 'Reference');
  const referencedIds: string[] = [];
  for (const reference of references) {
    const uri = reference.getAttribute('URI');
    if (!uri || !uri.startsWith('#') || uri.length === 1) {
      throw new DossierAbortError('external-signature-reference');
    }
    referencedIds.push(uri.slice(1));
    const digest = directChild(
      reference,
      XMLDSIG_NAMESPACE,
      'DigestMethod',
    )?.getAttribute('Algorithm');
    if (!digest || !DIGEST_ALGORITHM[digest]) status = 'indeterminate';
    if (digest?.toLowerCase().includes('sha1')) weakAlgorithm = true;
    const transforms = directChild(reference, XMLDSIG_NAMESPACE, 'Transforms');
    for (const transform of transforms
      ? directChildren(transforms, XMLDSIG_NAMESPACE, 'Transform')
      : []) {
      const algorithm = transform.getAttribute('Algorithm');
      if (!algorithm || !REFERENCE_TRANSFORM[algorithm]) {
        throw new DossierAbortError('signature-transform-unsupported');
      }
    }
  }

  const requiredIds = requiredScopeIds(signature, root, scope);
  const scopeValid =
    requiredIds?.every(id => referencedIds.includes(id)) ?? false;
  if (!scopeValid) status = 'invalid';
  checks.push({
    id: 'scope',
    labelKey: 'checks.scope',
    status: scopeValid ? 'valid' : 'invalid',
  });
  checks.push({ id: 'references', labelKey: 'checks.references', status });
  return {
    status,
    scope,
    parentDocumentId: parentDocument?.getAttribute('Id') || undefined,
    weakAlgorithm,
    checks,
  };
}

export function signatureTimeStampElements(signature: Element): Element[] {
  return xadesDescendants(signature, 'SignatureTimeStamp');
}

export function signatureValueElement(signature: Element): Element | undefined {
  return directChild(signature, XMLDSIG_NAMESPACE, 'SignatureValue');
}
