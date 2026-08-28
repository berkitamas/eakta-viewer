import { Application } from 'xmldsigjs';
import { setEngine } from 'pkijs';

let initialized = false;

export function ensureCryptoEngine(): void {
  if (initialized) return;
  if (!globalThis.crypto?.subtle) throw new Error('webcrypto-unavailable');
  Application.setEngine('WebCrypto', globalThis.crypto);
  setEngine('WebCrypto', globalThis.crypto, globalThis.crypto.subtle);
  initialized = true;
}

interface CurveBindableSignedXml {
  Algorithm?: Algorithm | RsaPssParams | EcdsaParams;
}

export function bindVerificationKeyAlgorithm(
  signedXml: CurveBindableSignedXml,
  key: CryptoKey,
): void {
  if (
    key.algorithm.name !== 'ECDSA' ||
    !('namedCurve' in key.algorithm) ||
    !signedXml.Algorithm
  )
    return;
  // xmldsigjs omits namedCurve when reimporting an ECDSA key; WebCrypto requires it.
  const compatibleAlgorithm = {
    ...signedXml.Algorithm,
    namedCurve: key.algorithm.namedCurve,
  } as EcdsaParams & EcKeyAlgorithm;
  signedXml.Algorithm = compatibleAlgorithm;
}
