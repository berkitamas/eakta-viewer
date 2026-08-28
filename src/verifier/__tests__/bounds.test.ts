import { DOMParser } from '@xmldom/xmldom';
import { zipSync } from 'fflate';
import { decodeEmbeddedBase64, readAllInput } from '../base64';
import {
  MAX_COMPONENT_BYTES,
  MAX_ES3_BYTES,
  MAX_TEXT_PREVIEW_BYTES,
  MAX_TOTAL_EXTRACTED_BYTES,
} from '../limits';
import { OutputSink } from '../output';
import type {
  VerifierIO,
  VerifyDossierRequest,
  VerifyDossierResponse,
} from '../types';
import { ComponentExtractionError } from '../types';
import { verifyAndExtractDossier } from '../verifyAndExtractDossier';

Object.defineProperty(globalThis, 'DOMParser', {
  value: DOMParser,
  configurable: true,
});

interface MemoryIO extends VerifierIO {
  output: Uint8Array[];
  maxConcurrentWrites: number;
}

function createIO(
  input: Uint8Array,
  cancelled = false,
  discardOutput = false,
): MemoryIO {
  let writeConcurrency = 0;
  let appended = 0;
  const output: Uint8Array[] = [];
  return {
    output,
    maxConcurrentWrites: 0,
    isCancelled: () => cancelled,
    async readResource(request) {
      const data = input.slice(request.offset, request.offset + request.length);
      return {
        dataBase64: Buffer.from(data).toString('base64'),
        eof: request.offset + data.length >= input.length,
        sequence: Math.floor(request.offset / (768 * 1024)),
      };
    },
    async beginOutput() {
      return { outputToken: 'output', previewPath: '/temporary/output' };
    },
    async appendOutput(_token, sequence, dataBase64) {
      if (sequence !== appended) throw new Error('backpressure-sequence');
      writeConcurrency += 1;
      this.maxConcurrentWrites = Math.max(
        this.maxConcurrentWrites,
        writeConcurrency,
      );
      await Promise.resolve();
      if (!discardOutput)
        output.push(Uint8Array.from(Buffer.from(dataBase64, 'base64')));
      appended += 1;
      writeConcurrency -= 1;
    },
    async finishOutput() {
      return { previewPath: '/temporary/output' };
    },
  };
}

function request(input: Uint8Array): VerifyDossierRequest {
  return {
    requestId: 'bounds',
    input: {
      sessionId: 'session',
      inputToken: 'input',
      displayName: 'fixture.es3',
      size: input.length,
    },
    validationTime: '2026-08-26T00:00:00.000Z',
    trustSnapshotId: 'snapshot',
    trustSnapshotManifestSha256: '00',
  };
}

function dossier(
  options: {
    payload?: string;
    transforms?: string[];
    objref?: string;
    sourceSize?: number;
    profile?: string | null;
    extra?: string;
  } = {},
): Uint8Array {
  const payload = options.payload ?? Buffer.from('hello').toString('base64');
  const transforms = options.transforms ?? ['base64'];
  const transformXml = `<BaseTransform>${transforms
    .map(value => `<Transform Algorithm="${value}"/>`)
    .join('')}</BaseTransform>`;
  const profileAttribute =
    options.profile === null ? '' : ` Version="${options.profile ?? '1.2'}"`;
  return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<Dossier xmlns="https://www.microsec.hu/ds/e-szigno30#" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
<DossierProfile${profileAttribute} OBJREF="#documents"/><Documents Id="documents"><Document Id="document">
<DocumentProfile OBJREF="${
    options.objref ?? 'object'
  }"><Title>File</Title><Format><MIME-Type>text/plain</MIME-Type></Format>
<SourceSize sizeUnit="byte" sizeValue="${
    options.sourceSize ?? 5
  }"/>${transformXml}</DocumentProfile>
<ds:Object Id="object">${payload}</ds:Object></Document></Documents>${
    options.extra ?? ''
  }</Dossier>`);
}

async function verify(input: Uint8Array): Promise<VerifyDossierResponse> {
  return verifyAndExtractDossier(request(input), createIO(input));
}

test.each([
  ['DTD', dossier({ extra: '<!DOCTYPE bad>' }), 'xml-entity-forbidden'],
  [
    'wrong root',
    new TextEncoder().encode('<?xml version="1.0" encoding="UTF-8"?><Other/>'),
    'unsupported-dossier-root',
  ],
  [
    'unsupported profile',
    dossier({ profile: '1.20' }),
    'dossier-profile-unsupported',
  ],
])('aborts invalid global %s input', async (_name, input, code) => {
  const response = await verify(input);
  expect(response.aborted).toBe(true);
  expect(response.errors[0]?.code).toBe(code);
});

test('accepts the namespace-defined 1.2 profile shape without an optional Version marker', async () => {
  const response = await verify(dossier({ profile: null }));
  expect(response.aborted).toBe(false);
  expect(response.result?.metadata.profile).toBe('1.2');
});

test('rejects UTF-8 BOM with ISO-8859-2 declaration', async () => {
  const source = dossier();
  const changed = Buffer.from(
    new TextDecoder().decode(source).replace('UTF-8', 'ISO-8859-2'),
  );
  const conflict = new Uint8Array(changed.length + 3);
  conflict.set([0xef, 0xbb, 0xbf]);
  conflict.set(changed, 3);
  const response = await verify(conflict);
  expect(response.errors[0]?.code).toBe('xml-bom-conflict');
});

test.each([
  [
    'missing exact OBJREF',
    dossier({ objref: 'missing' }),
    'objref-target-missing',
  ],
  [
    'wrong transform order',
    dossier({ transforms: ['base64', 'zip'] }),
    'content-transform-order',
  ],
  ['source size mismatch', dossier({ sourceSize: 6 }), 'source-size-mismatch'],
])('contains %s as a component failure', async (_name, input, code) => {
  const response = await verify(input);
  expect(response.aborted).toBe(false);
  expect(response.result?.status).toBe('invalid');
  expect(response.result?.documents[0]?.extractionError).toBe(code);
});

test('extracts one safe ZIP entry and rejects traversal or multiple entries', async () => {
  const safe = zipSync({ 'safe.txt': new TextEncoder().encode('hello') });
  const safeResponse = await verify(
    dossier({
      payload: Buffer.from(safe).toString('base64'),
      transforms: ['zip', 'base64'],
    }),
  );
  expect(safeResponse.result?.documents[0]?.exportable).toBe(true);

  const traversal = zipSync({
    '../unsafe.txt': new TextEncoder().encode('hello'),
  });
  const traversalResponse = await verify(
    dossier({
      payload: Buffer.from(traversal).toString('base64'),
      transforms: ['zip', 'base64'],
    }),
  );
  expect(traversalResponse.result?.documents[0]?.extractionError).toBe(
    'archive-path-unsafe',
  );

  const multiple = zipSync({ a: new Uint8Array([1]), b: new Uint8Array([2]) });
  const multipleResponse = await verify(
    dossier({
      payload: Buffer.from(multiple).toString('base64'),
      transforms: ['zip', 'base64'],
      sourceSize: 1,
    }),
  );
  expect(multipleResponse.result?.documents[0]?.extractionError).toBe(
    'archive-multiple-files',
  );
});

test('exports encrypted transformed bytes as a locked p7m without inflating ZIP', async () => {
  const response = await verify(
    dossier({ transforms: ['zip', 'encrypt', 'base64'], sourceSize: 999 }),
  );
  expect(response.result?.documents[0]).toMatchObject({
    locked: true,
    extension: 'p7m',
    exportable: true,
  });
});

test('enforces input and transformed size gates before unsafe work', async () => {
  const io = createIO(new Uint8Array());
  await expect(
    readAllInput(io, 'input', MAX_ES3_BYTES + 1),
  ).rejects.toMatchObject({
    code: 'input-size-limit',
  });

  const invalidLength = 'A'.repeat(4 * Math.ceil((64 * 1024 * 1024 + 3) / 3));
  expect(() => Array.from(decodeEmbeddedBase64(invalidLength))).toThrow(
    ComponentExtractionError,
  );
});
test('decodes declared Central European HTML before sanitization', async () => {
  const io = createIO(new Uint8Array());
  const sink = await OutputSink.create(
    io,
    { totalExtracted: 0 },
    'session',
    'page.html',
    'text/html',
  );
  const prefix = Buffer.from('<meta charset="iso-8859-2"><p>', 'ascii');
  const suffix = Buffer.from('</p>', 'ascii');
  await sink.write(
    Uint8Array.from(
      Buffer.concat([
        prefix,
        Buffer.from([0xe1, 0x72, 0x76, 0xed, 0x7a]),
        suffix,
      ]),
    ),
  );
  const result = await sink.finish();
  expect(result.preview.text).toContain('árvíz');
});

test('enforces component, dossier, and preview limits with sequential writes', async () => {
  const io = createIO(new Uint8Array());
  const nearDossierBudget = { totalExtracted: MAX_TOTAL_EXTRACTED_BYTES - 1 };
  const dossierSink = await OutputSink.create(
    io,
    nearDossierBudget,
    'session',
    'file.bin',
    'application/octet-stream',
  );
  await expect(dossierSink.write(new Uint8Array(2))).rejects.toMatchObject({
    code: 'dossier-size-limit',
  });

  const previewIO = createIO(new Uint8Array());
  const previewSink = await OutputSink.create(
    previewIO,
    { totalExtracted: 0 },
    'session',
    'file.txt',
    'text/plain',
  );
  const previewChunk = new Uint8Array(MAX_TEXT_PREVIEW_BYTES + 1);
  await previewSink.write(previewChunk);
  const preview = await previewSink.finish();
  expect(preview.preview.truncated).toBe(true);
  expect(previewIO.maxConcurrentWrites).toBe(1);

  const componentIO = createIO(new Uint8Array(), false, true);
  const componentSink = await OutputSink.create(
    componentIO,
    { totalExtracted: 0 },
    'session',
    'large.bin',
    'application/octet-stream',
  );
  const chunk = new Uint8Array(16 * 1024 * 1024);
  for (let index = 0; index < MAX_COMPONENT_BYTES / chunk.length; index += 1)
    await componentSink.write(chunk);
  await expect(componentSink.write(new Uint8Array(1))).rejects.toMatchObject({
    code: 'component-size-limit',
  });
}, 60_000);

test('cancellation stops before extraction writes', async () => {
  const input = dossier();
  const response = await verifyAndExtractDossier(
    request(input),
    createIO(input, true),
  );
  expect(response.aborted).toBe(true);
  expect(response.errors[0]?.code).toBe('cancelled');
});
