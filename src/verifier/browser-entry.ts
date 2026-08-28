import { encodeTransportBase64 } from './base64';
import { MAX_BASE64_MESSAGE_BYTES, MAX_RAW_CHUNK_BYTES } from './limits';
import {
  VERIFIER_PROTOCOL_VERSION,
  isRpcEnvelope,
  type HostToVerifierMessage,
  type VerifierToHostMessage,
} from './protocol';
import type { ResourceReadRequest, VerifierIO } from './types';
import { verifyAndExtractDossier } from './verifyAndExtractDossier';

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(value: string): void };
  }
}

interface PendingOperation {
  requestId: string;
  resolve(message: HostToVerifierMessage): void;
  reject(error: Error): void;
}

const pending = new Map<string, PendingOperation>();
let operationSequence = 0;
let active: { requestId: string; cancelled: boolean } | undefined;

function post(message: VerifierToHostMessage): void {
  window.ReactNativeWebView?.postMessage(JSON.stringify(message));
}

function nextOperationId(requestId: string): string {
  operationSequence += 1;
  return `${requestId}:${operationSequence}`;
}

function awaitHost(
  requestId: string,
  message: VerifierToHostMessage,
): Promise<HostToVerifierMessage> {
  const { promise, resolve, reject } =
    Promise.withResolvers<HostToVerifierMessage>();
  pending.set(message.operationId, { requestId, resolve, reject });
  post(message);
  return promise;
}

function cancelActive(requestId: string): void {
  if (!active || active.requestId !== requestId) return;
  active.cancelled = true;
  for (const [operationId, operation] of pending) {
    if (operation.requestId === requestId) {
      operation.reject(new Error('cancelled'));
      pending.delete(operationId);
    }
  }
  post({
    protocolVersion: VERIFIER_PROTOCOL_VERSION,
    type: 'cancelled',
    requestId,
    operationId: nextOperationId(requestId),
  });
}

function createIO(requestId: string): VerifierIO {
  return {
    isCancelled: () => active?.requestId !== requestId || active.cancelled,
    async readResource(request: ResourceReadRequest) {
      const operationId = nextOperationId(requestId);
      const response = await awaitHost(requestId, {
        protocolVersion: VERIFIER_PROTOCOL_VERSION,
        type: 'read-resource',
        requestId,
        operationId,
        resource: request.kind,
        token: request.token,
        totalLength: request.totalLength,
        offset: request.offset,
        length: request.length,
      });
      if (
        response.type !== 'resource-chunk' ||
        response.dataBase64.length > MAX_BASE64_MESSAGE_BYTES
      ) {
        throw new Error('protocol-resource-response');
      }
      return {
        dataBase64: response.dataBase64,
        eof: response.eof,
        sequence: response.sequence,
      };
    },
    async beginOutput(sessionId: string, suggestedName: string) {
      const operationId = nextOperationId(requestId);
      const response = await awaitHost(requestId, {
        protocolVersion: VERIFIER_PROTOCOL_VERSION,
        type: 'begin-write',
        requestId,
        operationId,
        sessionId,
        suggestedName,
      });
      if (
        response.type !== 'write-ack' ||
        !response.outputToken ||
        !response.previewPath
      ) {
        throw new Error('protocol-begin-write');
      }
      return {
        outputToken: response.outputToken,
        previewPath: response.previewPath,
      };
    },
    async appendOutput(
      outputToken: string,
      sequence: number,
      dataBase64: string,
    ) {
      if (dataBase64.length > MAX_BASE64_MESSAGE_BYTES)
        throw new Error('protocol-write-size');
      const operationId = nextOperationId(requestId);
      const response = await awaitHost(requestId, {
        protocolVersion: VERIFIER_PROTOCOL_VERSION,
        type: 'append-write',
        requestId,
        operationId,
        outputToken,
        sequence,
        dataBase64,
      });
      if (response.type !== 'write-ack')
        throw new Error('protocol-append-write');
    },
    async finishOutput(outputToken: string) {
      const operationId = nextOperationId(requestId);
      const response = await awaitHost(requestId, {
        protocolVersion: VERIFIER_PROTOCOL_VERSION,
        type: 'finish-write',
        requestId,
        operationId,
        outputToken,
      });
      if (response.type !== 'write-ack' || !response.previewPath) {
        throw new Error('protocol-finish-write');
      }
      return { previewPath: response.previewPath };
    },
    async fetchEvidence(request) {
      const operationId = nextOperationId(requestId);
      const response = await awaitHost(requestId, {
        protocolVersion: VERIFIER_PROTOCOL_VERSION,
        type: 'fetch-evidence',
        requestId,
        operationId,
        request,
      });
      if (response.type !== 'evidence-capability')
        throw new Error('protocol-evidence-capability');
      return {
        evidenceToken: response.evidenceToken,
        size: response.size,
        mimeType: response.mimeType,
      };
    },
    async releaseEvidence(evidenceToken: string) {
      const operationId = nextOperationId(requestId);
      const response = await awaitHost(requestId, {
        protocolVersion: VERIFIER_PROTOCOL_VERSION,
        type: 'release-evidence',
        requestId,
        operationId,
        evidenceToken,
      });
      if (response.type !== 'write-ack')
        throw new Error('protocol-release-evidence');
    },
    async writeTrustCache(metadata, lotl, huTsl) {
      const beginOperationId = nextOperationId(requestId);
      const begin = await awaitHost(requestId, {
        protocolVersion: VERIFIER_PROTOCOL_VERSION,
        type: 'begin-trust-write',
        requestId,
        operationId: beginOperationId,
        metadata,
      });
      if (begin.type !== 'trust-write-ack' || !begin.writeToken) {
        throw new Error('protocol-trust-begin');
      }
      for (const [part, data] of [
        ['lotl', lotl],
        ['huTsl', huTsl],
      ] as const) {
        let sequence = 0;
        for (
          let offset = 0;
          offset < data.length;
          offset += MAX_RAW_CHUNK_BYTES
        ) {
          const operationId = nextOperationId(requestId);
          const response = await awaitHost(requestId, {
            protocolVersion: VERIFIER_PROTOCOL_VERSION,
            type: 'append-trust-write',
            requestId,
            operationId,
            writeToken: begin.writeToken,
            part,
            sequence,
            dataBase64: encodeTransportBase64(
              data.subarray(
                offset,
                Math.min(offset + MAX_RAW_CHUNK_BYTES, data.length),
              ),
            ),
          });
          if (response.type !== 'trust-write-ack')
            throw new Error('protocol-trust-append');
          sequence += 1;
        }
      }
      const finishOperationId = nextOperationId(requestId);
      const finish = await awaitHost(requestId, {
        protocolVersion: VERIFIER_PROTOCOL_VERSION,
        type: 'finish-trust-write',
        requestId,
        operationId: finishOperationId,
        writeToken: begin.writeToken,
      });
      if (finish.type !== 'trust-write-ack')
        throw new Error('protocol-trust-finish');
    },
  };
}

async function start(
  message: Extract<HostToVerifierMessage, { type: 'start' }>,
): Promise<void> {
  if (active) cancelActive(active.requestId);
  active = { requestId: message.requestId, cancelled: false };
  const response = await verifyAndExtractDossier(
    message.request,
    createIO(message.requestId),
  );
  if (active.requestId !== message.requestId || active.cancelled) return;
  post({
    protocolVersion: VERIFIER_PROTOCOL_VERSION,
    type: 'result',
    requestId: message.requestId,
    operationId: nextOperationId(message.requestId),
    response,
  });
}

window.addEventListener('message', event => {
  let message: unknown;
  try {
    message =
      typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
  } catch {
    return;
  }
  if (!isRpcEnvelope(message)) return;
  const typed = message as HostToVerifierMessage;
  if (typed.type === 'start') {
    void start(typed).catch(() => {
      post({
        protocolVersion: VERIFIER_PROTOCOL_VERSION,
        type: 'protocol-error',
        requestId: typed.requestId,
        operationId: nextOperationId(typed.requestId),
        code: 'start-failed',
      });
    });
    return;
  }
  if (typed.type === 'cancel') {
    cancelActive(typed.requestId);
    return;
  }
  const operation = pending.get(typed.operationId);
  if (!operation || operation.requestId !== typed.requestId) return;
  pending.delete(typed.operationId);
  operation.resolve(typed);
});

post({
  protocolVersion: VERIFIER_PROTOCOL_VERSION,
  type: 'ready',
  requestId: 'bootstrap',
  operationId: 'ready',
});
