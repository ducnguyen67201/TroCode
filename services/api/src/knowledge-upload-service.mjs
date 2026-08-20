import { randomUUID } from 'node:crypto';

function checksumBase64(hex) { return Buffer.from(hex, 'hex').toString('base64'); }

export class KnowledgeUploadService {
  constructor({ objectStore, sourceRepository }) {
    this.objectStore = objectStore;
    this.sourceRepository = sourceRepository;
  }

  async initiate({ files, spaceId, userId }) {
    const pending = await this.sourceRepository.createPendingBatch({
      files, spaceId, userId, objectKeyFor: () => `spaces/${spaceId}/${randomUUID()}`,
    });
    return this.tickets(pending);
  }

  async initiateSubmission({ attemptId, files, spaceId, userId }) {
    const submissionFiles = files.map((file) => ({ ...file, role: 'submission' }));
    const pending = await this.sourceRepository.createPendingBatch({
      files: submissionFiles,
      spaceId,
      userId,
      objectKeyFor: () => `spaces/${spaceId}/${randomUUID()}`,
    });
    if (!await this.sourceRepository.linkSubmissionArtifacts({ attemptId, items: pending, userId })) {
      return null;
    }
    return this.tickets(pending);
  }

  async tickets(pending) {
    const uploads = [];
    for (const item of pending) {
      if (item.state !== 'pending_upload') {
        uploads.push({ sourceId: item.sourceId, sourceVersionId: item.sourceVersionId, state: item.state, upload: null });
        continue;
      }
      const upload = await this.objectStore.createPutTicket({
        byteSize: item.file.byteSize,
        checksumBase64: checksumBase64(item.file.sha256),
        mediaType: item.file.mediaType,
        objectKey: item.objectKey,
      });
      uploads.push({ sourceId: item.sourceId, sourceVersionId: item.sourceVersionId, state: item.state, upload });
    }
    return uploads;
  }

  async complete({ sourceVersionId, userId }) {
    const authority = await this.sourceRepository.uploadAuthority(sourceVersionId, userId);
    if (!authority) return null;
    if (authority.state === 'ready' || authority.state === 'processing') return { id: authority.id, state: authority.state };
    const head = await this.objectStore.head(authority.objectKey);
    if (
      head.byteSize !== authority.byteSize ||
      head.mediaType !== authority.mediaType ||
      head.checksumBase64 !== checksumBase64(authority.sha256)
    ) {
      const error = new Error('Uploaded object does not match the reviewed file.');
      error.status = 422; error.code = 'upload_integrity_mismatch'; throw error;
    }
    return this.sourceRepository.markUploadedAndQueue(sourceVersionId);
  }
}
