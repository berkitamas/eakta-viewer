export type DiagnosticEvent =
  | 'verifier-ready'
  | 'session-started'
  | 'session-start-failed'
  | 'session-cache-load-failed'
  | 'session-cancelled'
  | 'verification-completed'
  | 'verification-failed'
  | 'native-operation-failed';

export function recordDiagnostic(event: DiagnosticEvent): void {
  // Never add dossier-derived values, paths, names, tokens, hashes, or error objects here.
  console.info(`[e-Akta Viewer] ${event}`);
}
