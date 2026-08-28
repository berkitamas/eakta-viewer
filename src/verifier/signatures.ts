import { SignedXml } from 'xadesjs';
import type {
  SignatureResult,
  ValidationCheck,
  VerificationStatus,
} from '../domain/types';
import { validateHistoricalChain } from './chains';
import { selectSignerCertificate } from './certificates';
import {
  bindVerificationKeyAlgorithm,
  ensureCryptoEngine,
} from './cryptoEngine';
import { validateEmbeddedRevocation } from './revocation';
import {
  enforceSignaturePolicy,
  signatureTimeStampElements,
} from './signaturePolicy';
import { validateSignatureTimestamp } from './timestamps';
import type { TrustContext } from './trust/refreshTrustData';

function reduceStatus(statuses: VerificationStatus[]): VerificationStatus {
  if (statuses.includes('invalid')) return 'invalid';
  if (statuses.includes('indeterminate')) return 'indeterminate';
  return 'valid';
}

export async function validateDossierSignatures(
  signatures: Element[],
  root: Element,
  trust: TrustContext | undefined,
  validationTime: Date,
): Promise<SignatureResult[]> {
  if (signatures.length === 0) return [];
  ensureCryptoEngine();
  const results: SignatureResult[] = [];
  for (let index = 0; index < signatures.length; index += 1) {
    const signature = signatures[index];
    const id = signature.getAttribute('Id') || `signature-${index + 1}`;
    const policy = enforceSignaturePolicy(signature, root);
    const checks: ValidationCheck[] = [...policy.checks];
    const warnings = policy.weakAlgorithm ? ['weak-sha1-algorithm'] : [];
    const selected = await selectSignerCertificate(signature);
    checks.push({
      id: 'signer-certificate',
      labelKey: 'checks.signerCertificate',
      status: selected ? 'valid' : 'invalid',
    });

    let mathStatus: VerificationStatus =
      policy.status === 'indeterminate' ? 'indeterminate' : 'invalid';
    if (policy.status !== 'indeterminate' && selected) {
      try {
        const signedXml = new SignedXml(signature.ownerDocument ?? signature);
        signedXml.LoadXml(signature);
        const key = await selected.certificate.getPublicKey();
        bindVerificationKeyAlgorithm(signedXml, key);
        mathStatus = (await signedXml.Verify({ key })) ? 'valid' : 'invalid';
      } catch {
        mathStatus = 'invalid';
      }
    }
    checks.push({
      id: 'signature-value',
      labelKey: 'checks.signatureValue',
      status: mathStatus,
    });

    const timestampElements = signatureTimeStampElements(signature);
    const timestamps = [];
    for (
      let timestampIndex = 0;
      timestampIndex < timestampElements.length;
      timestampIndex += 1
    ) {
      timestamps.push(
        await validateSignatureTimestamp(
          timestampElements[timestampIndex],
          signature,
          timestampIndex,
          trust,
          validationTime,
        ),
      );
    }
    const timestampStatus: VerificationStatus =
      timestamps.length === 0
        ? 'indeterminate'
        : reduceStatus(timestamps.map(timestamp => timestamp.status));
    checks.push({
      id: 'timestamp',
      labelKey: 'checks.timestamp',
      status: timestampStatus,
    });

    const validTimes = timestamps
      .flatMap(timestamp =>
        timestamp.status === 'valid' && timestamp.generationTime
          ? [timestamp.generationTime]
          : [],
      )
      .sort();
    const trustedTime = validTimes[0] ? new Date(validTimes[0]) : undefined;
    let chainStatus: VerificationStatus = 'indeterminate';
    let revocationStatus: VerificationStatus = 'indeterminate';
    if (selected && trustedTime) {
      const chain = await validateHistoricalChain(
        selected.certificate,
        selected.allCertificates,
        trust,
        'ca',
        trustedTime,
        validationTime,
      );
      checks.push(...chain.checks);
      chainStatus = chain.status;
      const issuer = chain.path[1];
      if (issuer) {
        const revocation = await validateEmbeddedRevocation(
          signature,
          selected.certificate,
          issuer,
          trustedTime,
        );
        checks.push(...revocation.checks);
        revocationStatus = revocation.status;
      }
    }
    let status = reduceStatus([
      policy.status,
      mathStatus,
      selected ? 'valid' : 'invalid',
      timestampStatus,
      chainStatus,
      revocationStatus,
    ]);
    if (timestamps.some(timestamp => timestamp.status === 'invalid'))
      status = 'invalid';
    if (timestampElements.length === 0)
      warnings.push('signature-timestamp-missing');

    results.push({
      id,
      scope: policy.scope,
      parentDocumentId: policy.parentDocumentId,
      status,
      signer: selected?.summary,
      signerName: selected?.summary.subject ?? 'Unknown signer',
      trustedTime: validTimes[0],
      checks,
      timestamps,
      warnings,
    });
  }
  return results;
}
