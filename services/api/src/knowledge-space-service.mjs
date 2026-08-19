import { createHmac, randomBytes } from 'node:crypto';
import { assertSpaceRole } from './knowledge-space-policy.mjs';

function inviteDigest(code, hmacKey) { return createHmac('sha256', hmacKey).update(code.trim().toUpperCase()).digest(); }
function inviteCode() { return `TROSPACE-${randomBytes(12).toString('base64url').toUpperCase()}`; }

export class KnowledgeSpaceService {
  constructor({ hmacKey, sourceRepository, spaceRepository, uploadService }) {
    this.hmacKey = hmacKey; this.sourceRepository = sourceRepository; this.spaceRepository = spaceRepository; this.uploadService = uploadService;
  }
  async create(userId, input, limits = null) {
    if (limits && await this.spaceRepository.countOwned(userId) >= limits.spaceCount) {
      const error = new Error('This plan reached its Knowledge Space limit.');
      error.status = 409; error.code = 'space_quota_reached'; throw error;
    }
    return this.spaceRepository.create({ ...input, ownerUserId: userId });
  }
  list(userId) { return this.spaceRepository.listForUser(userId); }
  get(userId, spaceId) { return this.spaceRepository.get(spaceId, userId); }

  async role(userId, spaceId, operation) {
    const role = await this.spaceRepository.membership(spaceId, userId);
    if (!role) { const error = new Error('Space not found.'); error.status = 404; error.code = 'space_not_found'; throw error; }
    assertSpaceRole(role, operation); return role;
  }
  async listSources(userId, spaceId) { await this.role(userId, spaceId, 'space.read'); return this.sourceRepository.list(spaceId, userId); }
  async initiateUpload(userId, spaceId, input, limits = null) {
    await this.role(userId, spaceId, 'source.upload');
    if (limits) {
      if (input.files.length > limits.uploadFilesPerBatch) {
        const error = new Error('This upload has too many files for the current plan.');
        error.status = 409; error.code = 'upload_file_quota'; throw error;
      }
      const used = await this.sourceRepository.storageUsedByOwner(userId);
      const requested = input.files.reduce((total, file) => total + file.byteSize, 0);
      if (used + requested > limits.spaceStorageBytes) {
        const error = new Error('This plan reached its Knowledge Space storage limit.');
        error.status = 409; error.code = 'storage_quota_reached'; throw error;
      }
    }
    return this.uploadService.initiate({ ...input, spaceId, userId });
  }
  completeUpload(userId, input) {
    return this.uploadService.complete({ sourceVersionId: input.sourceVersionId, userId });
  }
  async createGroup(userId, spaceId, input) { await this.role(userId, spaceId, 'group.manage'); return this.spaceRepository.createGroup({ ...input, spaceId, userId }); }
  async listGroups(userId, spaceId) { await this.role(userId, spaceId, 'space.read'); return this.spaceRepository.listGroups(spaceId); }
  async listMembers(userId, spaceId) { await this.role(userId, spaceId, 'member.manage'); return this.spaceRepository.listMembers(spaceId); }
  async createInvite(userId, spaceId, input) {
    await this.role(userId, spaceId, 'member.manage');
    const code = inviteCode();
    const invite = await this.spaceRepository.createInvite({ ...input, codeDigest: inviteDigest(code, this.hmacKey), spaceId, userId });
    return { ...invite, code };
  }
  redeemInvite(userId, code) { return this.spaceRepository.redeemInvite({ codeDigest: inviteDigest(code, this.hmacKey), userId }); }
}
