import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import { KnowledgeIngestionWorker } from '../src/knowledge-ingestion-worker.mjs';

const body = Buffer.from('Loops repeat a bounded block while a condition remains true.');
let completed = false;
const sourceVersionId = randomUUID();
const worker = new KnowledgeIngestionWorker({
  jobRepository: {
    claim: async () => ({ id: randomUUID(), sourceVersionId, attemptCount: 1 }),
    source: async () => ({
      byteSize: body.byteLength,
      id: sourceVersionId,
      mediaType: 'text/plain',
      objectKey: 'smoke/source',
      sha256: createHash('sha256').update(body).digest('hex'),
    }),
    retry: async () => {
      throw new Error('The worker smoke fixture must not retry.');
    },
  },
  objectStore: {
    get: async () => ({ body: Readable.from([body]), byteSize: body.byteLength }),
  },
  sourceRepository: {
    markFailed: async () => {
      throw new Error('The worker smoke fixture must not fail.');
    },
    replaceChunks: async ({ chunks }) => {
      if (chunks.length !== 1 || !chunks[0].body.includes('Loops repeat')) {
        throw new Error('The worker produced an unexpected chunk set.');
      }
      completed = true;
    },
  },
});

await worker.runOnce();
if (!completed) throw new Error('The worker did not finalize the source.');
console.info(JSON.stringify({ event: 'knowledge.worker_smoke_passed' }));
