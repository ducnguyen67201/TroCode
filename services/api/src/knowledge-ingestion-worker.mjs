import { randomUUID } from 'node:crypto';
import { chunkExtractedPages, extractPdf, extractText, readBoundedBody, verifySha256 } from './knowledge-extractors.mjs';

export class KnowledgeIngestionWorker {
  constructor({ jobRepository, objectStore, sourceRepository, workerId = randomUUID() }) {
    this.jobRepository = jobRepository; this.objectStore = objectStore; this.sourceRepository = sourceRepository; this.workerId = workerId;
  }

  async runOnce() {
    const job = await this.jobRepository.claim({ leaseMs: 120_000, workerId: this.workerId });
    if (!job) return false;
    try {
      const source = await this.jobRepository.source(job.id, this.workerId);
      if (!source) return true;
      const object = await this.objectStore.get(source.objectKey);
      const buffer = await readBoundedBody(object.body, source.byteSize);
      if (!verifySha256(buffer, source.sha256)) throw Object.assign(new Error('Checksum mismatch.'), { code: 'object_checksum_mismatch', permanent: true });
      const extracted = source.mediaType === 'application/pdf' ? await extractPdf(buffer) : extractText(buffer);
      const chunks = chunkExtractedPages(extracted.pages);
      await this.sourceRepository.replaceChunks({ chunks, pageCount: extracted.pageCount, parserVersion: 'knowledge-extractor-v1', sourceVersionId: source.id });
    } catch (error) {
      const errorCode = typeof error?.code === 'string' ? error.code.slice(0, 80) : 'extraction_failed';
      if (error?.permanent || ['chunk_limit','encrypted_pdf_unsupported','scanned_pdf_unsupported','invalid_pdf','object_checksum_mismatch','object_too_large','extracted_text_too_large','pdf_page_limit'].includes(errorCode)) {
        await this.sourceRepository.markFailed(job.sourceVersionId, errorCode);
        await this.jobRepository.retry(job.id, this.workerId, errorCode, 12);
      } else await this.jobRepository.retry(job.id, this.workerId, errorCode, job.attemptCount);
    }
    return true;
  }
}
