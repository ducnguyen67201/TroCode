import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  chunkExtractedPages,
  extractPdf,
  extractText,
  readBoundedBody,
  verifySha256,
} from '../src/knowledge-extractors.mjs';
import { KnowledgeIngestionWorker } from '../src/knowledge-ingestion-worker.mjs';
import { KnowledgeUploadService } from '../src/knowledge-upload-service.mjs';

test('text extraction and chunking stay bounded and preserve locators', async () => {
  const body = Buffer.from(`first line\n${'loop '.repeat(1_000)}`);
  const extracted = extractText(body);
  const chunks = chunkExtractedPages(extracted.pages, { maxChars: 200, overlapChars: 20 });
  assert.ok(chunks.length > 1);
  assert.deepEqual(chunks[0].locator, { page: 1, startCharacter: 0 });
  assert.ok(chunks.every((chunk) => chunk.body.length <= 200));
  assert.equal(verifySha256(body, createHash('sha256').update(body).digest('hex')), true);
  await assert.rejects(
    readBoundedBody(Readable.from([Buffer.alloc(11)]), 11, 10),
    { code: 'object_too_large' },
  );
  await assert.rejects(extractPdf(Buffer.from('not a PDF')), { code: 'invalid_pdf' });
});

test('upload completion HEAD-verifies exact size, media type, and checksum', async () => {
  const sha256 = createHash('sha256').update('hello').digest('hex');
  const sourceRepository = {
    createPendingBatch: async ({ files }) => [{
      file: files[0], newlyCreated: true, objectKey: 'private/object',
      sourceId: 'source', sourceVersionId: 'version', state: 'pending_upload',
    }],
    markUploadedAndQueue: async () => ({ id: 'version', state: 'processing' }),
    uploadAuthority: async () => ({
      byteSize: 5, id: 'version', mediaType: 'text/plain', objectKey: 'private/object',
      sha256, spaceId: 'space', state: 'pending_upload',
    }),
  };
  const objectStore = {
    createPutTicket: async () => ({ expiresInSeconds: 300, headers: {}, url: 'https://objects.example/upload' }),
    head: async () => ({
      byteSize: 5,
      checksumBase64: Buffer.from(sha256, 'hex').toString('base64'),
      mediaType: 'text/plain',
    }),
  };
  const service = new KnowledgeUploadService({ objectStore, sourceRepository });
  const [upload] = await service.initiate({
    files: [{ byteSize: 5, mediaType: 'text/plain', sha256 }],
    spaceId: 'space', userId: 'user',
  });
  assert.equal(upload.upload.url, 'https://objects.example/upload');
  assert.deepEqual(await service.complete({ sourceVersionId: 'version', userId: 'user' }), {
    id: 'version', state: 'processing',
  });
  objectStore.head = async () => ({ byteSize: 6, checksumBase64: null, mediaType: 'text/plain' });
  await assert.rejects(
    service.complete({ sourceVersionId: 'version', userId: 'user' }),
    { code: 'upload_integrity_mismatch' },
  );
});

test('two workers cannot finalize a job twice when the repository leases once', async () => {
  const body = Buffer.from('safe source text');
  let claimed = false;
  let finalized = 0;
  const jobRepository = {
    claim: async () => {
      if (claimed) return null;
      claimed = true;
      return { id: 'job', sourceVersionId: 'version', attemptCount: 1 };
    },
    source: async () => ({
      byteSize: body.byteLength, id: 'version', mediaType: 'text/plain', objectKey: 'object',
      sha256: createHash('sha256').update(body).digest('hex'),
    }),
    retry: async () => undefined,
  };
  const options = {
    jobRepository,
    objectStore: { get: async () => ({ body: Readable.from([body]) }) },
    sourceRepository: {
      markFailed: async () => undefined,
      replaceChunks: async () => { finalized += 1; },
    },
  };
  await Promise.all([
    new KnowledgeIngestionWorker(options).runOnce(),
    new KnowledgeIngestionWorker(options).runOnce(),
  ]);
  assert.equal(finalized, 1);
});
