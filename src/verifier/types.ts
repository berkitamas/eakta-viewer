import type { DossierResult } from '../domain/types';

export interface InputCapabilityMetadata {
  sessionId: string;
  inputToken: string;
  displayName: string;
  size: number;
}

export interface TrustCacheMetadata {
  schemaVersion: 1;
  verifiedAt: string;
  lotlNextUpdate: string;
  huTslNextUpdate: string;
  lotlSha256: string;
  huTslSha256: string;
  lotlSize: number;
  huTslSize: number;
}

export interface TrustCacheCapabilityMetadata {
  cacheToken: string;
  metadata: TrustCacheMetadata;
}

export interface VerifyDossierRequest {
  requestId: string;
  input: InputCapabilityMetadata;
  validationTime: string;
  trustSnapshotId: string;
  trustSnapshotManifestSha256: string;
  trustCache?: TrustCacheCapabilityMetadata;
}

export interface ResourceChunk {
  dataBase64: string;
  eof: boolean;
  sequence: number;
}

export type ResourceKind = 'input' | 'trust-lotl' | 'trust-hu' | 'evidence';

export interface ResourceReadRequest {
  kind: ResourceKind;
  token: string;
  totalLength: number;
  offset: number;
  length: number;
}

export interface TemporaryOutput {
  outputToken: string;
  previewPath: string;
}

export interface EvidenceFetchRequest {
  sessionId: string;
  kind: 'aia' | 'ocsp' | 'crl' | 'lotl' | 'tsl';
  url: string;
  method: 'GET' | 'POST';
  bodyBase64?: string;
  parentCapabilityToken: string;
  stage:
    | 'bootstrap'
    | 'verified-lotl'
    | 'linked-certificate'
    | 'verified-chain';
}

export interface EvidenceCapabilityMetadata {
  evidenceToken: string;
  size: number;
  mimeType: string;
}

export interface VerifierIO {
  readResource(request: ResourceReadRequest): Promise<ResourceChunk>;
  beginOutput(
    sessionId: string,
    suggestedName: string,
  ): Promise<TemporaryOutput>;
  appendOutput(
    outputToken: string,
    sequence: number,
    dataBase64: string,
  ): Promise<void>;
  finishOutput(outputToken: string): Promise<{ previewPath: string }>;
  fetchEvidence?(
    request: EvidenceFetchRequest,
  ): Promise<EvidenceCapabilityMetadata>;
  releaseEvidence?(evidenceToken: string): Promise<void>;
  writeTrustCache?(
    metadata: TrustCacheMetadata,
    lotl: Uint8Array,
    huTsl: Uint8Array,
  ): Promise<void>;
  isCancelled(): boolean;
}

export type VerifierErrorScope = 'dossier' | 'component' | 'indeterminate';

export interface VerifierError {
  code: string;
  scope: VerifierErrorScope;
  componentId?: string;
  detail?: string;
}

export interface VerifyDossierResponse {
  requestId: string;
  result?: DossierResult;
  errors: VerifierError[];
  aborted: boolean;
}

export class DossierAbortError extends Error {
  constructor(readonly code: string, readonly detail?: string) {
    super(code);
    this.name = 'DossierAbortError';
  }
}

export class ComponentExtractionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ComponentExtractionError';
  }
}
