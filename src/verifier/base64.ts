import {
  MAX_BASE64_MESSAGE_BYTES,
  MAX_ES3_BYTES,
  MAX_RAW_CHUNK_BYTES,
  MAX_TRANSFORMED_BYTES,
} from './limits';
import { ComponentExtractionError, DossierAbortError } from './types';
import type { ResourceKind, ResourceReadRequest, VerifierIO } from './types';

function decodeAsciiBase64(value: string): Uint8Array {
  if (value.length > MAX_BASE64_MESSAGE_BYTES) {
    throw new DossierAbortError('protocol-chunk-too-large');
  }
  let binary: string;
  try {
    binary = globalThis.atob(value);
  } catch {
    throw new DossierAbortError('protocol-base64-invalid');
  }
  const result = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    result[index] = binary.charCodeAt(index);
  }
  return result;
}

export async function readAllResource(
  io: VerifierIO,
  kind: ResourceKind,
  token: string,
  totalLength: number,
  maximumLength: number,
  sizeError: string,
): Promise<Uint8Array> {
  if (
    !Number.isSafeInteger(totalLength) ||
    totalLength < 0 ||
    totalLength > maximumLength
  ) {
    throw new DossierAbortError(sizeError);
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  let sequence = 0;
  while (offset < totalLength) {
    if (io.isCancelled()) throw new DossierAbortError('cancelled');
    const request: ResourceReadRequest = {
      kind,
      token,
      totalLength,
      offset,
      length: Math.min(MAX_RAW_CHUNK_BYTES, totalLength - offset),
    };
    const chunk = await io.readResource(request);
    if (chunk.sequence !== sequence)
      throw new DossierAbortError('protocol-sequence');
    const decoded = decodeAsciiBase64(chunk.dataBase64);
    if (decoded.length === 0 && !chunk.eof)
      throw new DossierAbortError('protocol-stalled');
    if (offset + decoded.length > totalLength)
      throw new DossierAbortError('protocol-overflow');
    result.set(decoded, offset);
    offset += decoded.length;
    sequence += 1;
    if (chunk.eof && offset !== totalLength)
      throw new DossierAbortError('protocol-truncated');
  }
  return result;
}

export function readAllInput(
  io: VerifierIO,
  token: string,
  totalLength: number,
): Promise<Uint8Array> {
  return readAllResource(
    io,
    'input',
    token,
    totalLength,
    MAX_ES3_BYTES,
    'input-size-limit',
  );
}

const BASE64_CHARACTER = /^[A-Za-z0-9+/=]$/;

export function* decodeEmbeddedBase64(value: string): Generator<Uint8Array> {
  let quartetBuffer = '';
  let decodedTotal = 0;
  let sawPadding = false;
  const flush = (final: boolean): Uint8Array | undefined => {
    const usable = final
      ? quartetBuffer.length
      : quartetBuffer.length - (quartetBuffer.length % 4);
    if (usable === 0) return undefined;
    if (usable % 4 !== 0) throw new ComponentExtractionError('base64-length');
    const encoded = quartetBuffer.slice(0, usable);
    quartetBuffer = quartetBuffer.slice(usable);
    let binary: string;
    try {
      binary = globalThis.atob(encoded);
    } catch {
      throw new ComponentExtractionError('base64-invalid');
    }
    decodedTotal += binary.length;
    if (decodedTotal > MAX_TRANSFORMED_BYTES) {
      throw new ComponentExtractionError('transformed-size-limit');
    }
    const result = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1)
      result[index] = binary.charCodeAt(index);
    return result;
  };

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (
      character === ' ' ||
      character === '\t' ||
      character === '\n' ||
      character === '\r'
    )
      continue;
    if (!BASE64_CHARACTER.test(character))
      throw new ComponentExtractionError('base64-character');
    if (sawPadding && character !== '=')
      throw new ComponentExtractionError('base64-padding');
    if (character === '=') sawPadding = true;
    quartetBuffer += character;
    if (quartetBuffer.length >= 256 * 1024) {
      const chunk = flush(false);
      if (chunk?.length) yield chunk;
    }
  }
  const finalChunk = flush(true);
  if (quartetBuffer.length !== 0)
    throw new ComponentExtractionError('base64-length');
  if (finalChunk?.length) yield finalChunk;
}

export function encodeTransportBase64(data: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < data.length; offset += 0x8000) {
    const part = data.subarray(offset, Math.min(offset + 0x8000, data.length));
    binary += String.fromCharCode(...part);
  }
  return globalThis.btoa(binary);
}
