import type {
  EvidenceCapabilityMetadata,
  EvidenceFetchRequest,
  TrustCacheMetadata,
  VerifyDossierRequest,
  VerifyDossierResponse,
} from './types';

export const VERIFIER_PROTOCOL_VERSION = 1 as const;

export interface RpcEnvelope {
  protocolVersion: 1;
  type: string;
  requestId: string;
  operationId: string;
}

export interface ReadyMessage extends RpcEnvelope {
  type: 'ready';
  requestId: 'bootstrap';
  operationId: 'ready';
}

export interface StartMessage extends RpcEnvelope {
  type: 'start';
  request: VerifyDossierRequest;
}

export interface CancelMessage extends RpcEnvelope {
  type: 'cancel';
}

export interface ResourceChunkMessage extends RpcEnvelope {
  type: 'resource-chunk';
  dataBase64: string;
  eof: boolean;
  sequence: number;
}

export interface WriteAcknowledgementMessage extends RpcEnvelope {
  type: 'write-ack';
  outputToken?: string;
  previewPath?: string;
}

export interface EvidenceCapabilityMessage
  extends RpcEnvelope,
    EvidenceCapabilityMetadata {
  type: 'evidence-capability';
}

export interface TrustWriteAcknowledgementMessage extends RpcEnvelope {
  type: 'trust-write-ack';
  writeToken?: string;
}

export type HostToVerifierMessage =
  | StartMessage
  | CancelMessage
  | ResourceChunkMessage
  | WriteAcknowledgementMessage
  | EvidenceCapabilityMessage
  | TrustWriteAcknowledgementMessage
  | ProtocolErrorMessage;

export interface ReadResourceMessage extends RpcEnvelope {
  type: 'read-resource';
  resource: 'input' | 'trust-lotl' | 'trust-hu' | 'evidence';
  token: string;
  totalLength: number;
  offset: number;
  length: number;
}

export interface BeginWriteMessage extends RpcEnvelope {
  type: 'begin-write';
  sessionId: string;
  suggestedName: string;
}

export interface AppendWriteMessage extends RpcEnvelope {
  type: 'append-write';
  outputToken: string;
  sequence: number;
  dataBase64: string;
}

export interface FinishWriteMessage extends RpcEnvelope {
  type: 'finish-write';
  outputToken: string;
}

export interface FetchEvidenceMessage extends RpcEnvelope {
  type: 'fetch-evidence';
  request: EvidenceFetchRequest;
}

export interface ReleaseEvidenceMessage extends RpcEnvelope {
  type: 'release-evidence';
  evidenceToken: string;
}

export interface BeginTrustWriteMessage extends RpcEnvelope {
  type: 'begin-trust-write';
  metadata: TrustCacheMetadata;
}

export interface AppendTrustWriteMessage extends RpcEnvelope {
  type: 'append-trust-write';
  writeToken: string;
  part: 'lotl' | 'huTsl';
  sequence: number;
  dataBase64: string;
}

export interface FinishTrustWriteMessage extends RpcEnvelope {
  type: 'finish-trust-write';
  writeToken: string;
}

export interface ResultMessage extends RpcEnvelope {
  type: 'result';
  response: VerifyDossierResponse;
}

export interface CancelledMessage extends RpcEnvelope {
  type: 'cancelled';
}

export interface ProtocolErrorMessage extends RpcEnvelope {
  type: 'protocol-error';
  code: string;
}

export type VerifierToHostMessage =
  | ReadyMessage
  | ReadResourceMessage
  | BeginWriteMessage
  | AppendWriteMessage
  | FinishWriteMessage
  | ResultMessage
  | FetchEvidenceMessage
  | ReleaseEvidenceMessage
  | BeginTrustWriteMessage
  | AppendTrustWriteMessage
  | FinishTrustWriteMessage
  | CancelledMessage
  | ProtocolErrorMessage;

export function isRpcEnvelope(value: unknown): value is RpcEnvelope {
  if (!value || typeof value !== 'object') return false;
  if (
    !('protocolVersion' in value) ||
    !('type' in value) ||
    !('requestId' in value) ||
    !('operationId' in value)
  ) {
    return false;
  }
  return (
    value.protocolVersion === VERIFIER_PROTOCOL_VERSION &&
    typeof value.type === 'string' &&
    typeof value.requestId === 'string' &&
    typeof value.operationId === 'string'
  );
}

export function isVerifierToHostMessage(
  value: unknown,
): value is VerifierToHostMessage {
  if (!isRpcEnvelope(value)) return false;
  switch (value.type) {
    case 'ready':
    case 'cancelled':
      return true;
    case 'read-resource':
      return (
        'resource' in value &&
        'token' in value &&
        'totalLength' in value &&
        'offset' in value &&
        'length' in value &&
        typeof value.resource === 'string' &&
        typeof value.token === 'string' &&
        typeof value.totalLength === 'number' &&
        typeof value.offset === 'number' &&
        typeof value.length === 'number'
      );
    case 'begin-write':
      return (
        'sessionId' in value &&
        'suggestedName' in value &&
        typeof value.sessionId === 'string' &&
        typeof value.suggestedName === 'string'
      );
    case 'append-write':
      return (
        'outputToken' in value &&
        'sequence' in value &&
        'dataBase64' in value &&
        typeof value.outputToken === 'string' &&
        typeof value.sequence === 'number' &&
        typeof value.dataBase64 === 'string'
      );
    case 'finish-write':
      return 'outputToken' in value && typeof value.outputToken === 'string';
    case 'fetch-evidence':
      return (
        'request' in value &&
        Boolean(value.request) &&
        typeof value.request === 'object'
      );
    case 'release-evidence':
      return (
        'evidenceToken' in value && typeof value.evidenceToken === 'string'
      );
    case 'begin-trust-write':
      return (
        'metadata' in value &&
        Boolean(value.metadata) &&
        typeof value.metadata === 'object'
      );
    case 'append-trust-write':
      return (
        'writeToken' in value &&
        'part' in value &&
        'sequence' in value &&
        'dataBase64' in value &&
        typeof value.writeToken === 'string' &&
        (value.part === 'lotl' || value.part === 'huTsl') &&
        typeof value.sequence === 'number' &&
        typeof value.dataBase64 === 'string'
      );
    case 'finish-trust-write':
      return 'writeToken' in value && typeof value.writeToken === 'string';
    case 'result':
      return (
        'response' in value &&
        Boolean(value.response) &&
        typeof value.response === 'object'
      );
    case 'protocol-error':
      return 'code' in value && typeof value.code === 'string';
    default:
      return false;
  }
}
