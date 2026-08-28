import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { DossierResult, LoadingPhase } from '../domain/types';
import NativeES3MacBridge from '../native/specs/NativeES3MacBridge';
import type {
  InputCapability,
  TrustCacheResult,
} from '../native/specs/NativeES3MacBridge';
import { recordDiagnostic } from '../services/diagnostics';
import {
  VERIFIER_PROTOCOL_VERSION,
  isVerifierToHostMessage,
  type HostToVerifierMessage,
  type VerifierToHostMessage,
} from '../verifier/protocol';
import { createDeferred } from '../utils/deferred';
import { verifierHtml } from '../verifier/verifierBundle.generated';

interface VerifierHostProps {
  input?: InputCapability;
  onPhase(phase: LoadingPhase): void;
  onResult(result: DossierResult): void;
  onError(code: string): void;
}

interface ActiveSession {
  requestId: string;
  sessionId: string;
}

let requestSequence = 0;

export function VerifierHost({
  input,
  onPhase,
  onResult,
  onError,
}: VerifierHostProps): React.JSX.Element {
  const webView = useRef<React.ComponentRef<typeof WebView>>(null);
  const active = useRef<ActiveSession | undefined>(undefined);
  const cancellationAck = useRef<(() => void) | undefined>(undefined);
  const cleanupInFlight = useRef<
    { requestId: string; promise: Promise<void> } | undefined
  >(undefined);
  const [ready, setReady] = useState(false);

  const post = useCallback((message: HostToVerifierMessage) => {
    webView.current?.postMessage(JSON.stringify(message));
  }, []);

  const protocolError = useCallback(
    (message: VerifierToHostMessage, code: string) => {
      post({
        protocolVersion: VERIFIER_PROTOCOL_VERSION,
        type: 'write-ack',
        requestId: message.requestId,
        operationId: message.operationId,
      });
      onError(code);
    },
    [onError, post],
  );

  const handleMessage = useCallback(
    async (event: WebViewMessageEvent) => {
      let value: unknown;
      try {
        value = JSON.parse(event.nativeEvent.data);
      } catch {
        onError('protocol-json');
        return;
      }
      if (!isVerifierToHostMessage(value)) {
        onError('protocol-shape');
        return;
      }
      if (value.type === 'ready') {
        setReady(true);
        recordDiagnostic('verifier-ready');
        await NativeES3MacBridge.acknowledgeNativeReady();
        return;
      }
      const current = active.current;
      if (!current || value.requestId !== current.requestId) return;
      try {
        switch (value.type) {
          case 'cancelled':
            cancellationAck.current?.();
            cancellationAck.current = undefined;
            recordDiagnostic('session-cancelled');
            return;
          case 'read-resource': {
            let chunk;
            if (value.resource === 'input') {
              chunk = await NativeES3MacBridge.readInputChunk(
                value.token,
                value.offset,
                value.length,
              );
            } else if (
              value.resource === 'trust-lotl' ||
              value.resource === 'trust-hu'
            ) {
              chunk = await NativeES3MacBridge.readTrustCacheChunk(
                value.token,
                value.resource === 'trust-lotl' ? 'lotl' : 'huTsl',
                value.offset,
                value.length,
              );
            } else {
              chunk = await NativeES3MacBridge.readEvidenceChunk(
                value.token,
                value.offset,
                value.length,
              );
            }
            post({ ...value, type: 'resource-chunk', ...chunk });
            return;
          }
          case 'begin-write': {
            onPhase('extracting');
            const output = await NativeES3MacBridge.beginTemporaryFile(
              value.sessionId,
              value.suggestedName,
            );
            post({ ...value, type: 'write-ack', ...output });
            return;
          }
          case 'append-write':
            await NativeES3MacBridge.appendTemporaryFile(
              value.outputToken,
              value.sequence,
              value.dataBase64,
            );
            post({ ...value, type: 'write-ack' });
            return;
          case 'finish-write': {
            const output = await NativeES3MacBridge.finishTemporaryFile(
              value.outputToken,
            );
            post({ ...value, type: 'write-ack', ...output });
            return;
          }
          case 'fetch-evidence': {
            onPhase('refreshing-trust');
            const evidence = await NativeES3MacBridge.fetchEvidence(
              value.request,
            );
            post({ ...value, type: 'evidence-capability', ...evidence });
            return;
          }
          case 'release-evidence':
            await NativeES3MacBridge.releaseEvidence(value.evidenceToken);
            post({ ...value, type: 'write-ack' });
            return;
          case 'begin-trust-write': {
            const write = await NativeES3MacBridge.beginTrustCacheWrite(
              value.metadata,
            );
            post({ ...value, type: 'trust-write-ack', ...write });
            return;
          }
          case 'append-trust-write':
            await NativeES3MacBridge.appendTrustCachePart(
              value.writeToken,
              value.part,
              value.sequence,
              value.dataBase64,
            );
            post({ ...value, type: 'trust-write-ack' });
            return;
          case 'finish-trust-write':
            await NativeES3MacBridge.finishTrustCacheWrite(value.writeToken);
            post({ ...value, type: 'trust-write-ack' });
            return;
          case 'result':
            onPhase('validating');
            if (value.response.result) {
              recordDiagnostic('verification-completed');
              onResult(value.response.result);
            } else {
              recordDiagnostic('verification-failed');
              onError(value.response.errors[0]?.code ?? 'verification-failed');
            }
            return;
          case 'protocol-error':
            onError(value.code);
            return;
          default:
            return;
        }
      } catch {
        recordDiagnostic('native-operation-failed');
        protocolError(value, 'native-operation-failed');
      }
    },
    [onError, onPhase, onResult, post, protocolError],
  );

  useEffect(() => {
    if (!ready) return;
    let disposed = false;
    let startStage = 'cancel';
    const cancelPrevious = async () => {
      const previous = active.current;
      if (!previous) return;
      const existing = cleanupInFlight.current;
      if (existing?.requestId === previous.requestId) {
        await existing.promise;
        return;
      }
      const cleanup = (async () => {
        const { promise, resolve } = createDeferred();
        cancellationAck.current = resolve;
        let cancellationPosted = false;
        try {
          post({
            protocolVersion: VERIFIER_PROTOCOL_VERSION,
            type: 'cancel',
            requestId: previous.requestId,
            operationId: `${previous.requestId}:cancel`,
          });
          cancellationPosted = true;
        } catch {
          recordDiagnostic('native-operation-failed');
        }
        if (cancellationPosted) {
          const timeout = createDeferred();
          setTimeout(timeout.resolve, 5_000);
          await Promise.race([promise, timeout.promise]);
        }
        if (cancellationAck.current === resolve)
          cancellationAck.current = undefined;
        try {
          await NativeES3MacBridge.cancelSession(previous.sessionId);
        } catch {
          recordDiagnostic('native-operation-failed');
        }
        try {
          await NativeES3MacBridge.cleanupSession(previous.sessionId);
        } catch {
          recordDiagnostic('native-operation-failed');
        } finally {
          if (active.current?.requestId === previous.requestId)
            active.current = undefined;
        }
      })();
      cleanupInFlight.current = {
        requestId: previous.requestId,
        promise: cleanup,
      };
      await cleanup;
      if (cleanupInFlight.current?.promise === cleanup)
        cleanupInFlight.current = undefined;
    };
    const start = async () => {
      await cancelPrevious();
      startStage = 'activate';
      if (disposed || !input) return;
      requestSequence += 1;
      const requestId = `request-${requestSequence}`;
      active.current = { requestId, sessionId: input.sessionId };
      onPhase('reading');
      let cache: TrustCacheResult;
      startStage = 'cache';
      try {
        cache = await NativeES3MacBridge.loadTrustCache();
      } catch {
        recordDiagnostic('session-cache-load-failed');
        cache = { status: 'missing' };
      }
      if (disposed || active.current?.requestId !== requestId) {
        if (active.current?.requestId === requestId) active.current = undefined;
        return;
      }
      const trustCache =
        cache.status === 'available' &&
        cache.cacheToken &&
        cache.metadata &&
        cache.metadata.schemaVersion === 1
          ? {
              cacheToken: cache.cacheToken,
              metadata: { ...cache.metadata, schemaVersion: 1 as const },
            }
          : undefined;
      startStage = 'post';
      post({
        protocolVersion: VERIFIER_PROTOCOL_VERSION,
        type: 'start',
        requestId,
        operationId: `${requestId}:start`,
        request: {
          requestId,
          input,
          validationTime: new Date().toISOString(),
          trustSnapshotId: 'eu-hu-2026',
          trustSnapshotManifestSha256: 'runtime-verified',
          trustCache,
        },
      });
      recordDiagnostic('session-started');
    };
    void start().catch(() => {
      if (disposed || !input) return;
      recordDiagnostic('session-start-failed');
      onError(`session-start-failed-${startStage}`);
    });
    return () => {
      disposed = true;
    };
  }, [input, onError, onPhase, post, ready]);

  return (
    <View pointerEvents="none" style={styles.hidden}>
      <WebView
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        domStorageEnabled={false}
        javaScriptCanOpenWindowsAutomatically={false}
        javaScriptEnabled
        onMessage={event => void handleMessage(event)}
        originWhitelist={['https://eakta.invalid']}
        setSupportMultipleWindows={false}
        source={{ html: verifierHtml, baseUrl: 'https://eakta.invalid/' }}
        ref={webView}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: {
    height: 1,
    opacity: 0,
    position: 'absolute',
    width: 1,
  },
});
