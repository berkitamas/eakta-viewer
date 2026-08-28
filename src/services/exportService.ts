import type { DossierDocument } from '../domain/types';
import NativeES3MacBridge from '../native/specs/NativeES3MacBridge';
import type { ExportResult } from '../native/specs/NativeES3MacBridge';

function exportName(document: DossierDocument): string {
  return `${document.title}.${document.extension}`;
}

export async function exportSelectedDocument(
  document: DossierDocument,
): Promise<ExportResult> {
  if (!document.exportable || !document.previewPath) {
    return {
      status: 'partial',
      finalNames: [],
      errors: [{ name: exportName(document), code: 'not-exportable' }],
    };
  }
  return NativeES3MacBridge.exportFile(
    document.previewPath,
    exportName(document),
  );
}

export async function exportAllDocuments(
  documents: DossierDocument[],
): Promise<ExportResult> {
  const files = documents.flatMap(document =>
    document.exportable && document.previewPath
      ? [
          {
            previewPath: document.previewPath,
            suggestedName: exportName(document),
          },
        ]
      : [],
  );
  if (files.length === 0) {
    return {
      status: 'partial',
      finalNames: [],
      errors: [{ name: 'documents', code: 'none-exportable' }],
    };
  }
  return NativeES3MacBridge.exportFiles(files);
}
