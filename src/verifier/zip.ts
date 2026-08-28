import { Unzip, UnzipInflate, type UnzipFile } from 'fflate';
import { MAX_COMPONENT_BYTES } from './limits';
import { ComponentExtractionError } from './types';
import type { OutputSink } from './output';

function archivePathIsSafe(name: string): boolean {
  if (!name || /[\u0000-\u001f\u007f]/.test(name)) return false;
  const normalized = name.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized))
    return false;
  return !normalized.split('/').some(part => part === '..');
}

export async function extractSingleZipEntry(
  transformedChunks: Iterable<Uint8Array>,
  sink: OutputSink,
): Promise<void> {
  let regularFiles = 0;
  let outputBytes = 0;
  let extractionError: ComponentExtractionError | undefined;
  let writeTail: Promise<void> = Promise.resolve();
  const {
    promise: firstFileFinished,
    resolve: finishResolve,
    reject: finishReject,
  } = Promise.withResolvers<void>();

  const unzip = new Unzip((file: UnzipFile) => {
    if (!archivePathIsSafe(file.name)) {
      extractionError = new ComponentExtractionError('archive-path-unsafe');
      file.terminate?.();
      finishResolve();
      return;
    }
    const directory = file.name.replace(/\\/g, '/').endsWith('/');
    if (directory) {
      file.ondata = error => {
        if (error && !extractionError)
          extractionError = new ComponentExtractionError('archive-corrupt');
      };
      file.start();
      return;
    }
    regularFiles += 1;
    if (regularFiles > 1) {
      extractionError = new ComponentExtractionError('archive-multiple-files');
      file.terminate?.();
      finishResolve();
      return;
    }
    if (
      file.originalSize !== undefined &&
      file.originalSize > MAX_COMPONENT_BYTES
    ) {
      extractionError = new ComponentExtractionError('component-size-limit');
      file.terminate?.();
      finishResolve();
      return;
    }
    file.ondata = (error, data, final) => {
      if (error) {
        extractionError = new ComponentExtractionError('archive-corrupt');
        finishResolve();
        return;
      }
      outputBytes += data.length;
      if (outputBytes > MAX_COMPONENT_BYTES) {
        extractionError = new ComponentExtractionError('component-size-limit');
        file.terminate?.();
        finishResolve();
        return;
      }
      if (data.length) writeTail = writeTail.then(() => sink.write(data));
      if (final) writeTail.then(finishResolve, finishReject);
    };
    file.start();
  });
  unzip.register(UnzipInflate);

  try {
    for (const chunk of transformedChunks) {
      if (extractionError) throw extractionError;
      unzip.push(chunk, false);
      await writeTail;
    }
    unzip.push(new Uint8Array(), true);
    if (extractionError) throw extractionError;
    if (regularFiles !== 1)
      throw new ComponentExtractionError('archive-file-count');
    await firstFileFinished;
  } catch (error) {
    if (error instanceof ComponentExtractionError) throw error;
    throw new ComponentExtractionError('archive-corrupt');
  }
}
