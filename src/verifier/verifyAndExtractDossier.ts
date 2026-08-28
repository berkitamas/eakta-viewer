import type {
  DossierResult,
  ValidationCheck,
  VerificationStatus,
} from '../domain/types';
import { readAllInput, readAllResource } from './base64';
import { extractComponent } from './extract';
import { MAX_ES3_BYTES } from './limits';
import { modelDossier } from './model';
import { validateDossierSignatures } from './signatures';
import type { TrustContext } from './trust/refreshTrustData';
import {
  EU_LOTL_URL,
  refreshTrustData,
  verifyLotlAndResolveHu,
} from './trust/refreshTrustData';
import { DossierAbortError } from './types';
import type {
  EvidenceCapabilityMetadata,
  TrustCacheMetadata,
  VerifierError,
  VerifierIO,
  VerifyDossierRequest,
  VerifyDossierResponse,
} from './types';
import { parseDossierXml } from './xml';

async function sha256(data: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', Uint8Array.from(data).buffer),
  );
  return Array.from(digest, value => value.toString(16).padStart(2, '0')).join(
    '',
  );
}

async function loadCachedTrust(
  request: VerifyDossierRequest,
  io: VerifierIO,
  validationTime: Date,
): Promise<TrustContext | undefined> {
  const cache = request.trustCache;
  if (!cache || cache.metadata.schemaVersion !== 1) return undefined;
  const lotl = await readAllResource(
    io,
    'trust-lotl',
    cache.cacheToken,
    cache.metadata.lotlSize,
    MAX_ES3_BYTES,
    'trust-lotl-size',
  );
  const huTsl = await readAllResource(
    io,
    'trust-hu',
    cache.cacheToken,
    cache.metadata.huTslSize,
    MAX_ES3_BYTES,
    'trust-hu-size',
  );
  if (
    (await sha256(lotl)) !== cache.metadata.lotlSha256 ||
    (await sha256(huTsl)) !== cache.metadata.huTslSha256
  ) {
    throw new Error('trust-cache-hash');
  }
  return refreshTrustData(lotl, huTsl, validationTime);
}

async function refreshOnlineTrust(
  request: VerifyDossierRequest,
  io: VerifierIO,
  validationTime: Date,
): Promise<TrustContext | undefined> {
  if (!io.fetchEvidence || !io.releaseEvidence) return undefined;
  const lotlCapability = await io.fetchEvidence({
    sessionId: request.input.sessionId,
    kind: 'lotl',
    url: EU_LOTL_URL,
    method: 'GET',
    parentCapabilityToken: request.input.inputToken,
    stage: 'bootstrap',
  });
  let huCapability: EvidenceCapabilityMetadata | undefined;
  try {
    const lotl = await readAllResource(
      io,
      'evidence',
      lotlCapability.evidenceToken,
      lotlCapability.size,
      MAX_ES3_BYTES,
      'trust-lotl-size',
    );
    const pointer = await verifyLotlAndResolveHu(lotl);
    huCapability = await io.fetchEvidence({
      sessionId: request.input.sessionId,
      kind: 'tsl',
      url: pointer.url,
      method: 'GET',
      parentCapabilityToken: lotlCapability.evidenceToken,
      stage: 'verified-lotl',
    });
    const huTsl = await readAllResource(
      io,
      'evidence',
      huCapability.evidenceToken,
      huCapability.size,
      MAX_ES3_BYTES,
      'trust-hu-size',
    );
    const trust = await refreshTrustData(lotl, huTsl, validationTime);
    if (io.writeTrustCache) {
      const metadata: TrustCacheMetadata = {
        schemaVersion: 1,
        verifiedAt: validationTime.toISOString(),
        lotlNextUpdate: trust.lotlNextUpdate,
        huTslNextUpdate: trust.huTslNextUpdate,
        lotlSha256: await sha256(lotl),
        huTslSha256: await sha256(huTsl),
        lotlSize: lotl.length,
        huTslSize: huTsl.length,
      };
      await io.writeTrustCache(metadata, lotl, huTsl);
    }
    return trust;
  } finally {
    if (huCapability) await io.releaseEvidence(huCapability.evidenceToken);
    await io.releaseEvidence(lotlCapability.evidenceToken);
  }
}

async function loadTrust(
  request: VerifyDossierRequest,
  io: VerifierIO,
  validationTime: Date,
): Promise<TrustContext | undefined> {
  let cached: TrustContext | undefined;
  try {
    cached = await loadCachedTrust(request, io, validationTime);
  } catch {
    cached = undefined;
  }
  const metadata = request.trustCache?.metadata;
  const withinNextUpdate = Boolean(
    metadata &&
      new Date(metadata.lotlNextUpdate).getTime() >= validationTime.getTime() &&
      new Date(metadata.huTslNextUpdate).getTime() >= validationTime.getTime(),
  );
  const verifiedAt = metadata
    ? new Date(metadata.verifiedAt).getTime()
    : Number.NaN;
  const refreshDue =
    !cached ||
    !withinNextUpdate ||
    !Number.isFinite(verifiedAt) ||
    validationTime.getTime() - verifiedAt >= 24 * 60 * 60 * 1000;
  if (cached && !refreshDue) return cached;
  try {
    return (
      (await refreshOnlineTrust(request, io, validationTime)) ??
      (withinNextUpdate ? cached : undefined)
    );
  } catch {
    if (cached && withinNextUpdate) return cached;
    throw new Error('trust-refresh-unavailable');
  }
}

export async function verifyAndExtractDossier(
  request: VerifyDossierRequest,
  io: VerifierIO,
): Promise<VerifyDossierResponse> {
  const errors: VerifierError[] = [];
  try {
    const validationTime = new Date(request.validationTime);
    if (!Number.isFinite(validationTime.getTime()))
      throw new DossierAbortError('validation-time-invalid');
    const bytes = await readAllInput(
      io,
      request.input.inputToken,
      request.input.size,
    );
    const parsed = parseDossierXml(bytes);
    const structure = modelDossier(parsed.root);
    const budget = { totalExtracted: 0 };
    const documents = [];
    for (const source of structure.components) {
      const document = await extractComponent(
        source,
        io,
        budget,
        request.input.sessionId,
      );
      documents.push(document);
      if (document.extractionError) {
        errors.push({
          code: document.extractionError,
          scope: 'component',
          componentId: document.id,
        });
      }
    }
    let trust: TrustContext | undefined;
    if (structure.signatures.length > 0) {
      try {
        trust = await loadTrust(request, io, validationTime);
      } catch {
        errors.push({ code: 'trust-cache-invalid', scope: 'indeterminate' });
      }
    }
    const signatures = await validateDossierSignatures(
      structure.signatures,
      parsed.root,
      trust,
      validationTime,
    );
    const checks: ValidationCheck[] = [
      {
        id: 'encoding',
        labelKey: 'checks.encoding',
        status: 'valid',
        detail: parsed.encoding,
      },
      {
        id: 'structure',
        labelKey: 'checks.structure',
        status: 'valid',
        detail: structure.profile,
      },
    ];
    const componentInvalid = documents.some(
      document => document.extractionStatus === 'invalid',
    );
    const signatureStatus: VerificationStatus =
      signatures.length === 0
        ? 'indeterminate'
        : signatures.some(signature => signature.status === 'invalid')
        ? 'invalid'
        : signatures.some(signature => signature.status === 'indeterminate')
        ? 'indeterminate'
        : 'valid';
    const dossierStatus: VerificationStatus =
      componentInvalid || signatureStatus === 'invalid'
        ? 'invalid'
        : signatureStatus === 'indeterminate'
        ? 'indeterminate'
        : 'valid';
    const result: DossierResult = {
      status: dossierStatus,
      metadata: {
        title: structure.title,
        dossierId: structure.dossierId,
        createdAt: structure.createdAt,
        profile: structure.profile,
        displayName: request.input.displayName,
      },
      documents,
      signatures,
      checks,
      warnings: signatures.length === 0 ? ['unsigned-dossier'] : [],
    };
    return { requestId: request.requestId, result, errors, aborted: false };
  } catch (error) {
    if (error instanceof DossierAbortError) {
      errors.push({ code: error.code, scope: 'dossier', detail: error.detail });
    } else {
      errors.push({ code: 'verifier-failure', scope: 'dossier' });
    }
    return { requestId: request.requestId, errors, aborted: true };
  }
}
