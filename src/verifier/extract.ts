import type { DossierDocument } from '../domain/types';
import { decodeEmbeddedBase64 } from './base64';
import type { ExtractionBudget } from './limits';
import type { ComponentSource } from './model';
import { OutputSink } from './output';
import { sanitizeHtmlPreview } from './sanitizeHtml';
import { ComponentExtractionError } from './types';
import type { VerifierIO } from './types';
import { extractSingleZipEntry } from './zip';

function failedDocument(
  source: ComponentSource,
  code: string,
): DossierDocument {
  return {
    id: source.id,
    kind: source.kind,
    parentSignatureId: source.parentSignatureId,
    title: source.title,
    mimeType: source.mimeType,
    extension: source.extension,
    sourceSize: source.sourceSize,
    locked: false,
    exportable: false,
    extractionStatus: 'invalid',
    extractionError: code,
    preview: { type: 'error', errorCode: code },
  };
}

export async function extractComponent(
  source: ComponentSource,
  io: VerifierIO,
  budget: ExtractionBudget,
  sessionId: string,
): Promise<DossierDocument> {
  if (source.modelError) return failedDocument(source, source.modelError);
  const payload = source.object.textContent ?? '';
  const encrypted = source.transforms.includes('encrypt');
  const zipped = source.transforms.includes('zip') && !encrypted;
  const hintedPdf =
    !encrypted &&
    source.mimeType === 'application/octet-stream' &&
    source.hintedExtension === 'pdf';
  const effectiveExtension = encrypted
    ? 'p7m'
    : hintedPdf
    ? 'pdf'
    : source.extension;
  const suggestedName = `${source.title}.${effectiveExtension}`;
  const outputMime = encrypted
    ? 'application/pkcs7-mime'
    : hintedPdf
    ? 'application/pdf'
    : source.mimeType;
  try {
    const sink = await OutputSink.create(
      io,
      budget,
      sessionId,
      suggestedName,
      outputMime,
    );
    const decoded = decodeEmbeddedBase64(payload);
    if (zipped) {
      await extractSingleZipEntry(decoded, sink);
    } else {
      for (const chunk of decoded) await sink.write(chunk);
    }
    const finished = await sink.finish();
    if (
      hintedPdf &&
      !(
        finished.headerBytes.length >= 5 &&
        finished.headerBytes[0] === 0x25 &&
        finished.headerBytes[1] === 0x50 &&
        finished.headerBytes[2] === 0x44 &&
        finished.headerBytes[3] === 0x46 &&
        finished.headerBytes[4] === 0x2d
      )
    ) {
      throw new ComponentExtractionError('content-magic-mismatch');
    }
    if (
      !encrypted &&
      source.sourceSize !== undefined &&
      source.sourceSize !== finished.size
    ) {
      throw new ComponentExtractionError('source-size-mismatch');
    }
    const preview = encrypted
      ? { type: 'locked' as const, previewPath: finished.previewPath }
      : finished.preview;
    if (preview.type === 'html' && preview.text) {
      preview.text = sanitizeHtmlPreview(preview.text);
    }
    return {
      id: source.id,
      kind: source.kind,
      parentSignatureId: source.parentSignatureId,
      title: source.title,
      mimeType: outputMime,
      extension: effectiveExtension,
      sourceSize: source.sourceSize,
      extractedSize: finished.size,
      previewPath: finished.previewPath,
      locked: encrypted,
      exportable: true,
      extractionStatus: encrypted ? 'indeterminate' : 'valid',
      preview,
    };
  } catch (error) {
    const code =
      error instanceof ComponentExtractionError
        ? error.code
        : 'extraction-failed';
    return failedDocument(source, code);
  }
}
