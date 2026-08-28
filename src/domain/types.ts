export type VerificationStatus = 'valid' | 'invalid' | 'indeterminate';
export type DocumentKind = 'primary' | 'signature-attachment';
export type LoadingPhase =
  | 'reading'
  | 'parsing'
  | 'extracting'
  | 'refreshing-trust'
  | 'validating';

export interface ValidationCheck {
  id: string;
  labelKey: string;
  status: VerificationStatus;
  detailKey?: string;
  detail?: string;
}

export interface CertificateSummary {
  subject: string;
  issuer: string;
  serialNumber: string;
  validFrom: string;
  validTo: string;
  fingerprintSha256: string;
  serviceType?: string;
}

export interface TimestampResult {
  id: string;
  status: VerificationStatus;
  generationTime?: string;
  tsa?: CertificateSummary;
  imprintAlgorithm?: string;
  policyOid?: string;
  checks: ValidationCheck[];
  warnings: string[];
}

export interface SignatureResult {
  id: string;
  scope: 'document' | 'frame';
  status: VerificationStatus;
  signer?: CertificateSummary;
  signerName: string;
  signedAt?: string;
  trustedTime?: string;
  parentDocumentId?: string;
  checks: ValidationCheck[];
  timestamps: TimestampResult[];
  warnings: string[];
}

export interface DocumentPreviewPayload {
  type: 'html' | 'text' | 'quick-look' | 'hex' | 'locked' | 'error';
  text?: string;
  previewPath?: string;
  truncated?: boolean;
  errorCode?: string;
}

export interface DossierDocument {
  id: string;
  kind: DocumentKind;
  parentSignatureId?: string;
  title: string;
  mimeType: string;
  extension: string;
  sourceSize?: number;
  extractedSize?: number;
  previewPath?: string;
  locked: boolean;
  exportable: boolean;
  extractionStatus: VerificationStatus;
  extractionError?: string;
  preview: DocumentPreviewPayload;
}

export interface DossierMetadata {
  title: string;
  dossierId?: string;
  createdAt?: string;
  profile: string;
  displayName: string;
}

export interface DossierResult {
  status: VerificationStatus;
  metadata: DossierMetadata;
  documents: DossierDocument[];
  signatures: SignatureResult[];
  checks: ValidationCheck[];
  warnings: string[];
  trustDataAge?: string;
}

export interface AppState {
  phase: 'idle' | 'loading' | 'ready' | 'error';
  loadingPhase?: LoadingPhase;
  activeRequestId?: string;
  dossier?: DossierResult;
  selectedDocumentId?: string;
  selectedSignatureId?: string;
  inspectorVisible: boolean;
  errorCode?: string;
}
