import {
  createHash,
  createPublicKey,
  verify,
  type KeyObject,
} from 'node:crypto';

import { z } from 'zod';

import {
  MembershipStatusSchema,
  type AuthUser,
  type MembershipStatus,
} from '../../shared/contracts';

const REFERENCE_CODE_PATTERN = /^TRC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const CODE_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;

const MembershipActivationPayloadSchema = z
  .object({
    expiresAt: z.string().datetime(),
    issuedAt: z.string().datetime(),
    referenceCode: z.string().regex(REFERENCE_CODE_PATTERN),
    version: z.literal(1),
  })
  .strict()
  .superRefine((payload, context) => {
    if (Date.parse(payload.expiresAt) <= Date.parse(payload.issuedAt)) {
      context.addIssue({
        code: 'custom',
        message: 'Membership expiry must be after its issue time.',
        path: ['expiresAt'],
      });
    }
  });

type MembershipActivationPayload = z.infer<
  typeof MembershipActivationPayloadSchema
>;

export interface MembershipActivationStore {
  read(): Promise<string | null>;
  write(activationCode: string): Promise<void>;
}

interface MembershipServiceOptions {
  now?: () => Date;
  publicKey?: string;
  required: boolean;
  store: MembershipActivationStore;
}

type Inspection =
  | { kind: 'active'; payload: MembershipActivationPayload }
  | { kind: 'expired'; payload: MembershipActivationPayload }
  | { kind: 'invalid' }
  | { kind: 'not_yet_valid' }
  | { kind: 'wrong_account' };

export function membershipReferenceCode(user: AuthUser): string {
  const digest = createHash('sha256')
    .update('trocode-membership-v1\0')
    .update(user.id)
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
  return `TRC-${digest.slice(0, 4)}-${digest.slice(4, 8)}-${digest.slice(8, 12)}`;
}

function configuredPublicKey(value: string | undefined): KeyObject | null {
  const encoded = value?.trim();
  if (!encoded) return null;

  try {
    const key = createPublicKey({
      format: 'der',
      key: Buffer.from(encoded, 'base64'),
      type: 'spki',
    });
    return key.asymmetricKeyType === 'ed25519' ? key : null;
  } catch {
    return null;
  }
}

function status(
  input: Omit<MembershipStatus, 'summary'> & { summary: string },
): MembershipStatus {
  return MembershipStatusSchema.parse(input);
}

export class MembershipService {
  private readonly now: () => Date;
  private readonly publicKey: KeyObject | null;

  constructor(private readonly options: MembershipServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.publicKey = configuredPublicKey(options.publicKey);
  }

  async getStatus(user: AuthUser): Promise<MembershipStatus> {
    const referenceCode = membershipReferenceCode(user);
    if (!this.options.required) {
      return status({
        expiresAt: null,
        referenceCode,
        required: false,
        state: 'bypassed',
        summary: 'Membership checks are disabled in local development.',
      });
    }

    if (!this.publicKey) {
      return status({
        expiresAt: null,
        referenceCode,
        required: true,
        state: 'error',
        summary: 'Membership verification is not configured for this build.',
      });
    }

    let activationCode: string | null;
    try {
      activationCode = await this.options.store.read();
    } catch {
      return status({
        expiresAt: null,
        referenceCode,
        required: true,
        state: 'error',
        summary: 'The saved membership could not be read on this computer.',
      });
    }

    if (!activationCode) {
      return status({
        expiresAt: null,
        referenceCode,
        required: true,
        state: 'inactive',
        summary: 'Enter an activation code to continue.',
      });
    }

    const inspection = this.inspect(user, activationCode);
    if (inspection.kind === 'active') {
      return status({
        expiresAt: inspection.payload.expiresAt,
        referenceCode,
        required: true,
        state: 'active',
        summary: `Membership active until ${inspection.payload.expiresAt}.`,
      });
    }
    if (inspection.kind === 'expired') {
      return status({
        expiresAt: inspection.payload.expiresAt,
        referenceCode,
        required: true,
        state: 'expired',
        summary: 'This membership has expired. Enter a new activation code.',
      });
    }
    if (inspection.kind === 'wrong_account') {
      return status({
        expiresAt: null,
        referenceCode,
        required: true,
        state: 'inactive',
        summary: 'This Google account does not have an active membership yet.',
      });
    }

    return status({
      expiresAt: null,
      referenceCode,
      required: true,
      state: 'error',
      summary: 'The saved membership is invalid. Enter a new activation code.',
    });
  }

  async activate(user: AuthUser, activationCode: string): Promise<MembershipStatus> {
    if (!this.options.required) return this.getStatus(user);
    if (!this.publicKey) {
      throw new Error('Membership verification is not configured for this build.');
    }

    const normalizedCode = activationCode.trim();
    const inspection = this.inspect(user, normalizedCode);
    if (inspection.kind === 'wrong_account') {
      throw new Error('This activation code was issued for another account.');
    }
    if (inspection.kind === 'expired') {
      throw new Error('This activation code has expired.');
    }
    if (inspection.kind === 'not_yet_valid') {
      throw new Error('This activation code is not valid yet.');
    }
    if (inspection.kind === 'invalid') {
      throw new Error('This activation code is not valid.');
    }

    await this.options.store.write(normalizedCode);
    return this.getStatus(user);
  }

  async assertActive(user: AuthUser): Promise<void> {
    const currentStatus = await this.getStatus(user);
    if (
      currentStatus.state === 'active' ||
      currentStatus.state === 'bypassed'
    ) {
      return;
    }
    if (currentStatus.state === 'expired') {
      throw new Error('Your TroCode membership has expired.');
    }
    if (currentStatus.state === 'error') {
      throw new Error(currentStatus.summary);
    }
    throw new Error('An active membership is required to use TroCode.');
  }

  private inspect(user: AuthUser, activationCode: string): Inspection {
    if (!this.publicKey || activationCode.length > 4_096) {
      return { kind: 'invalid' };
    }

    const segments = activationCode.trim().split('.');
    const encodedPayload = segments[0];
    const encodedSignature = segments[1];
    if (
      segments.length !== 2 ||
      !encodedPayload ||
      !encodedSignature ||
      encodedPayload.length > 2_048 ||
      !CODE_SEGMENT_PATTERN.test(encodedPayload) ||
      !CODE_SEGMENT_PATTERN.test(encodedSignature)
    ) {
      return { kind: 'invalid' };
    }

    const signature = Buffer.from(encodedSignature, 'base64url');
    if (
      signature.length !== 64 ||
      !verify(
        null,
        Buffer.from(encodedPayload),
        this.publicKey,
        signature,
      )
    ) {
      return { kind: 'invalid' };
    }

    let payload: MembershipActivationPayload;
    try {
      payload = MembershipActivationPayloadSchema.parse(
        JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')),
      );
    } catch {
      return { kind: 'invalid' };
    }

    if (payload.referenceCode !== membershipReferenceCode(user)) {
      return { kind: 'wrong_account' };
    }

    const now = this.now().getTime();
    if (Date.parse(payload.issuedAt) > now + MAX_CLOCK_SKEW_MS) {
      return { kind: 'not_yet_valid' };
    }
    if (Date.parse(payload.expiresAt) <= now) {
      return { kind: 'expired', payload };
    }
    return { kind: 'active', payload };
  }
}
