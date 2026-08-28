import { Certificate, CertificateChainValidationEngine } from 'pkijs';
import type { ValidationCheck, VerificationStatus } from '../domain/types';
import type { TrustContext } from './trust/refreshTrustData';
import { trustCertificatesFor } from './trust/refreshTrustData';

export interface ChainResult {
  status: VerificationStatus;
  path: Certificate[];
  checks: ValidationCheck[];
}

export async function validateHistoricalChain(
  certificate: Certificate,
  candidates: Certificate[],
  trust: TrustContext | undefined,
  role: 'ca' | 'tsa',
  historicalTime: Date,
  validationTime: Date,
): Promise<ChainResult> {
  if (!trust) {
    return {
      status: 'indeterminate',
      path: [],
      checks: [
        {
          id: 'trust-missing',
          labelKey: 'checks.trustMissing',
          status: 'indeterminate',
        },
      ],
    };
  }
  const cacheFresh =
    new Date(trust.lotlNextUpdate).getTime() >= validationTime.getTime() &&
    new Date(trust.huTslNextUpdate).getTime() >= validationTime.getTime();
  if (!cacheFresh) {
    return {
      status: 'indeterminate',
      path: [],
      checks: [
        {
          id: 'trust-stale',
          labelKey: 'checks.trustStale',
          status: 'indeterminate',
        },
      ],
    };
  }
  const trustedCerts = trustCertificatesFor(trust, role, historicalTime);
  if (trustedCerts.length === 0) {
    return {
      status: 'indeterminate',
      path: [],
      checks: [
        {
          id: 'trust-service-missing',
          labelKey: 'checks.trustServiceMissing',
          status: 'indeterminate',
        },
      ],
    };
  }
  const engine = new CertificateChainValidationEngine({
    trustedCerts,
    certs: [
      certificate,
      ...candidates.filter(candidate => candidate !== certificate),
    ],
    checkDate: historicalTime,
  });
  const result = await engine.verify({ passedWhenNotRevValues: true });
  return {
    status: result.result ? 'valid' : 'indeterminate',
    path: result.certificatePath ?? [],
    checks: [
      {
        id: role === 'tsa' ? 'tsa-chain' : 'signer-chain',
        labelKey: role === 'tsa' ? 'checks.tsaChain' : 'checks.signerChain',
        status: result.result ? 'valid' : 'indeterminate',
        detail: result.result ? undefined : result.resultMessage,
      },
    ],
  };
}
