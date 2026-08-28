import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';
import type {
  Double,
  EventEmitter,
  Int32,
} from 'react-native/Libraries/Types/CodegenTypes';

export type InputCapability = Readonly<{
  sessionId: string;
  inputToken: string;
  displayName: string;
  size: Double;
}>;

export type OpenDossierResult = Readonly<{
  status: 'selected' | 'cancelled';
  input?: InputCapability;
}>;

export type ResourceChunk = Readonly<{
  dataBase64: string;
  eof: boolean;
  sequence: Int32;
}>;

export type TemporaryFile = Readonly<{
  outputToken: string;
  previewPath: string;
}>;

export type FinishedTemporaryFile = Readonly<{
  previewPath: string;
}>;

export type ExportError = Readonly<{
  name: string;
  code: string;
}>;

export type ExportResult = Readonly<{
  status: 'exported' | 'cancelled' | 'partial';
  finalNames: ReadonlyArray<string>;
  errors: ReadonlyArray<ExportError>;
}>;

export type ExportFile = Readonly<{
  previewPath: string;
  suggestedName: string;
}>;

export type TrustCacheMetadata = Readonly<{
  schemaVersion: Int32;
  verifiedAt: string;
  lotlNextUpdate: string;
  huTslNextUpdate: string;
  lotlSha256: string;
  huTslSha256: string;
  lotlSize: Double;
  huTslSize: Double;
}>;

export type TrustCacheResult = Readonly<{
  status: 'available' | 'missing';
  cacheToken?: string;
  metadata?: TrustCacheMetadata;
}>;

export type TrustCacheWrite = Readonly<{
  writeToken: string;
}>;

export type EvidenceRequest = Readonly<{
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
}>;

export type EvidenceCapability = Readonly<{
  evidenceToken: string;
  size: Double;
  mimeType: string;
}>;

export type LanguagePreference = 'system' | 'en' | 'hu';

export type MenuLabels = Readonly<{
  about: string;
  openDossier: string;
  closeDossier: string;
  exportSelected: string;
  exportAll: string;
  documents: string;
  signatures: string;
  showInspector: string;
  hideInspector: string;
  language: string;
  system: string;
  english: string;
  hungarian: string;
  verificationPrivacy: string;
}>;

export type MenuState = Readonly<{
  hasDossier: boolean;
  hasSelectedExportable: boolean;
  canExportAll: boolean;
  inspectorVisible: boolean;
  language: LanguagePreference;
  labels: MenuLabels;
}>;

export type MenuCommand = Readonly<{
  command:
    | 'about'
    | 'open-dossier'
    | 'close-dossier'
    | 'export-selected'
    | 'export-all'
    | 'documents'
    | 'signatures'
    | 'toggle-inspector'
    | 'verification-privacy'
    | 'language-system'
    | 'language-en'
    | 'language-hu';
}>;

export interface Spec extends TurboModule {
  acknowledgeNativeReady(): Promise<void>;
  openDossier(): Promise<OpenDossierResult>;
  adoptDroppedFile(uri: string): Promise<InputCapability>;
  readInputChunk(
    inputToken: string,
    offset: Double,
    length: Double,
  ): Promise<ResourceChunk>;
  beginTemporaryFile(
    sessionId: string,
    suggestedName: string,
  ): Promise<TemporaryFile>;
  appendTemporaryFile(
    outputToken: string,
    sequence: Int32,
    dataBase64: string,
  ): Promise<void>;
  finishTemporaryFile(outputToken: string): Promise<FinishedTemporaryFile>;
  exportFile(previewPath: string, suggestedName: string): Promise<ExportResult>;
  exportFiles(files: ReadonlyArray<ExportFile>): Promise<ExportResult>;
  cancelSession(sessionId: string): Promise<void>;
  cleanupSession(sessionId: string): Promise<void>;
  loadTrustCache(): Promise<TrustCacheResult>;
  readTrustCacheChunk(
    cacheToken: string,
    part: 'lotl' | 'huTsl',
    offset: Double,
    length: Double,
  ): Promise<ResourceChunk>;
  beginTrustCacheWrite(metadata: TrustCacheMetadata): Promise<TrustCacheWrite>;
  appendTrustCachePart(
    writeToken: string,
    part: 'lotl' | 'huTsl',
    sequence: Int32,
    dataBase64: string,
  ): Promise<void>;
  finishTrustCacheWrite(writeToken: string): Promise<void>;
  fetchEvidence(request: EvidenceRequest): Promise<EvidenceCapability>;
  readEvidenceChunk(
    evidenceToken: string,
    offset: Double,
    length: Double,
  ): Promise<ResourceChunk>;
  releaseEvidence(evidenceToken: string): Promise<void>;
  getLanguagePreference(): Promise<LanguagePreference>;
  setLanguagePreference(value: LanguagePreference): Promise<void>;
  setMenuState(state: MenuState): Promise<void>;

  readonly onOpenFile: EventEmitter<InputCapability>;
  readonly onMenuCommand: EventEmitter<MenuCommand>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('ES3MacBridge');
