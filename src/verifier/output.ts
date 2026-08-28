import type { DocumentPreviewPayload } from '../domain/types';
import { encodeTransportBase64 } from './base64';
import {
  MAX_COMPONENT_BYTES,
  MAX_HEX_PREVIEW_BYTES,
  MAX_TEXT_PREVIEW_BYTES,
  MAX_TOTAL_EXTRACTED_BYTES,
} from './limits';
import type { ExtractionBudget } from './limits';
import { ComponentExtractionError } from './types';
import type { VerifierIO } from './types';

function isTextMime(mimeType: string): boolean {
  return (
    mimeType.startsWith('text/') ||
    mimeType === 'application/xml' ||
    mimeType === 'application/json' ||
    mimeType.endsWith('+xml') ||
    mimeType.endsWith('+json')
  );
}

function decodeTextPreview(data: Uint8Array, mimeType: string): string {
  if (
    data.length >= 3 &&
    data[0] === 0xef &&
    data[1] === 0xbb &&
    data[2] === 0xbf
  )
    return new TextDecoder('utf-8').decode(data.subarray(3));
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(data.subarray(2));
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff)
    return new TextDecoder('utf-16be').decode(data.subarray(2));

  const prefix = String.fromCharCode(
    ...data.subarray(0, Math.min(data.length, 4096)),
  );
  const declaration = prefix.match(
    /<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i,
  );
  const meta = prefix.match(
    /<meta[^>]+charset\s*=\s*["']?\s*([A-Za-z0-9_-]+)/i,
  );
  const httpEquiv = prefix.match(
    /<meta[^>]+http-equiv\s*=\s*["']content-type["'][^>]+content\s*=\s*["'][^"']*charset\s*=\s*([A-Za-z0-9_-]+)/i,
  );
  const declared = (declaration?.[1] ?? meta?.[1] ?? httpEquiv?.[1] ?? '')
    .toLowerCase()
    .replace('_', '-');
  const encodingByLabel: Record<string, string> = {
    'iso-8859-2': 'iso-8859-2',
    'iso8859-2': 'iso-8859-2',
    'windows-1250': 'windows-1250',
    cp1250: 'windows-1250',
    'utf-8': 'utf-8',
    utf8: 'utf-8',
  };
  const declaredEncoding = encodingByLabel[declared];
  if (declaredEncoding) return new TextDecoder(declaredEncoding).decode(data);
  if (mimeType === 'text/html')
    return new TextDecoder('windows-1252').decode(data);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return new TextDecoder('iso-8859-2').decode(data);
  }
}

function hexPreview(data: Uint8Array): string {
  const lines: string[] = [];
  for (let offset = 0; offset < data.length; offset += 16) {
    const row = data.subarray(offset, Math.min(offset + 16, data.length));
    const hex = Array.from(row, value =>
      value.toString(16).padStart(2, '0'),
    ).join(' ');
    const ascii = Array.from(row, value =>
      value >= 32 && value <= 126 ? String.fromCharCode(value) : '.',
    ).join('');
    lines.push(
      `${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  ${ascii}`,
    );
  }
  return lines.join('\n');
}

export class OutputSink {
  private outputToken = '';
  private previewPath = '';
  private sequence = 0;
  private size = 0;
  private previewSize = 0;
  private readonly previewChunks: Uint8Array[] = [];
  private readonly previewLimit: number;

  private constructor(
    private readonly io: VerifierIO,
    private readonly budget: ExtractionBudget,
    private readonly mimeType: string,
  ) {
    this.previewLimit = isTextMime(mimeType)
      ? MAX_TEXT_PREVIEW_BYTES
      : MAX_HEX_PREVIEW_BYTES;
  }

  static async create(
    io: VerifierIO,
    budget: ExtractionBudget,
    sessionId: string,
    suggestedName: string,
    mimeType: string,
  ): Promise<OutputSink> {
    const sink = new OutputSink(io, budget, mimeType);
    const output = await io.beginOutput(sessionId, suggestedName);
    sink.outputToken = output.outputToken;
    sink.previewPath = output.previewPath;
    return sink;
  }

  async write(data: Uint8Array): Promise<void> {
    if (this.io.isCancelled()) throw new ComponentExtractionError('cancelled');
    if (this.size + data.length > MAX_COMPONENT_BYTES) {
      throw new ComponentExtractionError('component-size-limit');
    }
    if (this.budget.totalExtracted + data.length > MAX_TOTAL_EXTRACTED_BYTES) {
      throw new ComponentExtractionError('dossier-size-limit');
    }
    const previewRemaining = this.previewLimit - this.previewSize;
    if (previewRemaining > 0) {
      const previewPart = data.slice(
        0,
        Math.min(previewRemaining, data.length),
      );
      this.previewChunks.push(previewPart);
      this.previewSize += previewPart.length;
    }
    await this.io.appendOutput(
      this.outputToken,
      this.sequence,
      encodeTransportBase64(data),
    );
    this.sequence += 1;
    this.size += data.length;
    this.budget.totalExtracted += data.length;
  }

  async finish(): Promise<{
    previewPath: string;
    size: number;
    preview: DocumentPreviewPayload;
  }> {
    const finished = await this.io.finishOutput(this.outputToken);
    this.previewPath = finished.previewPath;
    const previewBytes = new Uint8Array(this.previewSize);
    let offset = 0;
    for (const chunk of this.previewChunks) {
      previewBytes.set(chunk, offset);
      offset += chunk.length;
    }
    const truncated = this.size > this.previewSize;
    if (isTextMime(this.mimeType)) {
      const text = decodeTextPreview(previewBytes, this.mimeType);
      return {
        previewPath: this.previewPath,
        size: this.size,
        preview: {
          type: this.mimeType === 'text/html' ? 'html' : 'text',
          text,
          truncated,
          previewPath: this.previewPath,
        },
      };
    }
    return {
      previewPath: this.previewPath,
      size: this.size,
      preview: {
        type: 'quick-look',
        previewPath: this.previewPath,
        text: hexPreview(previewBytes),
        truncated,
      },
    };
  }
}
