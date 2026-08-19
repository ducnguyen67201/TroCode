import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import http from 'node:http';
import https from 'node:https';

import type { KnowledgeUploadResult } from '../../shared/contracts';

import type { FileSelectionService, TrustedKnowledgeFile } from './file-selection-service';
import type { KnowledgeSpaceClient } from './knowledge-space-client';

async function hashFile(file: TrustedKnowledgeFile): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file.absolutePath)) digest.update(chunk);
  return digest.digest('hex');
}

function uploadMetadata(
  file: TrustedKnowledgeFile & { role: string; sha256: string },
) {
  return {
    byteSize: file.byteSize,
    clientId: file.clientId,
    displayName: file.displayName,
    mediaType: file.mediaType,
    relativePath: file.relativePath,
    role: file.role,
    sha256: file.sha256,
  };
}

function putFile(urlString: string, headers: Record<string, string>, file: TrustedKnowledgeFile): Promise<'confirmed' | 'unknown'> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    if (
      url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['127.0.0.1', '::1', 'localhost'].includes(url.hostname))
    ) {
      reject(new Error('Object upload requires HTTPS.'));
      return;
    }
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(url, { method: 'PUT', headers }, (response) => {
      response.resume();
      response.once('end', () => {
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) resolve('confirmed');
        else reject(new Error(`Object upload returned HTTP ${response.statusCode ?? 0}.`));
      });
    });
    request.once('error', () => resolve('unknown'));
    const stream = createReadStream(file.absolutePath);
    stream.once('error', reject);
    stream.pipe(request);
  });
}

export class KnowledgeUploadOrchestrator {
  constructor(private readonly fileSelections: FileSelectionService, private readonly client: KnowledgeSpaceClient) {}

  async upload(spaceId: string, selectionId: string): Promise<KnowledgeUploadResult> {
    return this.uploadSelection(selectionId, (input) => this.client.initiateUpload(spaceId, input));
  }

  async submit(attemptId: string, selectionId: string): Promise<KnowledgeUploadResult> {
    const result = await this.uploadSelection(selectionId, (input) => this.client.initiateSubmission(attemptId, input));
    await this.client.commitSubmission(attemptId, randomUUID());
    return result;
  }

  private async uploadSelection(
    selectionId: string,
    initiate: (input: unknown) => ReturnType<KnowledgeSpaceClient['initiateUpload']>,
  ): Promise<KnowledgeUploadResult> {
    const selection = await this.fileSelections.resolve(selectionId);
    const files = await Promise.all(selection.files.map(async (file) => ({
      ...file, sha256: await hashFile(file), role: selection.preview.role,
    })));
    const initiated = await initiate({
      files: files.map(uploadMetadata),
    });
    if (initiated.uploads.length !== files.length) {
      throw new Error('The upload service returned an incomplete file batch.');
    }
    const queue = initiated.uploads.map((upload, index) => {
      const file = files[index];
      if (!file) throw new Error('The upload service returned an invalid file batch.');
      return { upload, file };
    });
    let uploaded = 0; let processing = 0;
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length) {
        const item = queue.shift(); if (!item) return;
        if (!item.upload.upload) { processing += 1; continue; }
        const outcome = await putFile(item.upload.upload.url, item.upload.upload.headers, item.file);
        // Complete performs an exact HEAD reconciliation, including when PUT admission is unknown.
        const completed = await this.client.completeUpload({ clientId: randomUUID(), sourceVersionId: item.upload.sourceVersionId });
        if (outcome === 'confirmed') uploaded += 1;
        if (completed.state === 'processing' || completed.state === 'ready') processing += 1;
      }
    });
    try { await Promise.all(workers); return { uploaded, processing, cancelled: false }; }
    finally { this.fileSelections.consume(selectionId); }
  }
}
