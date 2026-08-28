import { DOMParser } from '@xmldom/xmldom';
import { verifyAndExtractDossier } from '../verifyAndExtractDossier';
import type { VerifierIO, VerifyDossierRequest } from '../types';

Object.defineProperty(globalThis, 'DOMParser', {
  value: DOMParser,
  configurable: true,
});

function transportBase64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64');
}

function testXml(extra = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Dossier xmlns="https://www.microsec.hu/ds/e-szigno30#" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="dossier">
  <DossierProfile Version="1.2"><Title>Example</Title></DossierProfile>
  <Documents>
    <Document Id="primary">
      <DocumentProfile OBJREF="#primary-object">
        <Title>Primary</Title><Format><MIME-Type>text/plain</MIME-Type></Format><SourceSize sizeUnit="byte" sizeValue="5"/>
        <BaseTransform><Transform Algorithm="base64"/></BaseTransform>
      </DocumentProfile>
      <ds:Object Id="primary-object">aGVsbG8=</ds:Object>
      <ds:Signature Id="signature-one">
        <ds:Object Id="signature-profile-object"><SignatureProfile><Comment><Document Id="attachment">
          <DocumentProfile OBJREF="attachment-object">
            <Title>Attachment</Title><Format><MIME-Type>text/plain</MIME-Type></Format><SourceSize sizeUnit="byte" sizeValue="5"/>
            <BaseTransform><Transform Algorithm="base64"/></BaseTransform>
          </DocumentProfile>
          <ds:Object Id="attachment-object">d29ybGQ=</ds:Object>
        </Document></Comment></SignatureProfile></ds:Object>
      </ds:Signature>
    </Document>
  </Documents>
  ${extra}
</Dossier>`;
}

function createIO(input: Uint8Array): {
  io: VerifierIO;
  outputs: Map<string, Uint8Array[]>;
} {
  const outputs = new Map<string, Uint8Array[]>();
  let outputSequence = 0;
  const io: VerifierIO = {
    isCancelled: () => false,
    async readResource(request) {
      const data = input.slice(request.offset, request.offset + request.length);
      return {
        dataBase64: transportBase64(data),
        eof: request.offset + data.length >= input.length,
        sequence: Math.floor(request.offset / (768 * 1024)),
      };
    },
    async beginOutput() {
      const token = `output-${outputSequence++}`;
      outputs.set(token, []);
      return { outputToken: token, previewPath: `/temporary/${token}` };
    },
    async appendOutput(token, sequence, dataBase64) {
      const chunks = outputs.get(token);
      if (!chunks || sequence !== chunks.length) throw new Error('sequence');
      chunks.push(Uint8Array.from(Buffer.from(dataBase64, 'base64')));
    },
    async finishOutput(token) {
      if (!outputs.has(token)) throw new Error('missing-output');
      return { previewPath: `/temporary/${token}` };
    },
  };
  return { io, outputs };
}

function requestFor(input: Uint8Array): VerifyDossierRequest {
  return {
    requestId: 'test-request',
    input: {
      sessionId: 'test-session',
      inputToken: 'test-input',
      displayName: 'test.es3',
      size: input.length,
    },
    validationTime: '2026-08-26T00:00:00.000Z',
    trustSnapshotId: 'test-snapshot',
    trustSnapshotManifestSha256: '00',
  };
}

test('extracts primary and signature attachment documents', async () => {
  const input = new TextEncoder().encode(testXml());
  const { io, outputs } = createIO(input);
  const response = await verifyAndExtractDossier(requestFor(input), io);
  expect(response.aborted).toBe(false);
  expect(response.result?.documents.map(document => document.kind)).toEqual([
    'primary',
    'signature-attachment',
  ]);
  expect(
    response.result?.documents.every(document => document.exportable),
  ).toBe(true);
  const contents = Array.from(outputs.values(), chunks =>
    Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8'),
  );
  expect(contents).toEqual(['hello', 'world']);
});

test('aborts on duplicate XML Id values', async () => {
  const input = new TextEncoder().encode(
    testXml('<ds:Object Id="primary-object"/>'),
  );
  const { io } = createIO(input);
  const response = await verifyAndExtractDossier(requestFor(input), io);
  expect(response.aborted).toBe(true);
  expect(response.errors[0]?.code).toBe('duplicate-or-empty-id');
});
