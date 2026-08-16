import { z } from 'zod';

import {
  CapabilitySchema,
  ProposedActionSchema,
  type ProposedAction,
} from '../../shared/contracts';

const CoordinateSchema = z.number().int().nonnegative().max(100_000);
export const MAX_GUIDANCE_SEQUENCE_LENGTH = 20;
export const PLANNER_COORDINATE_MAX = 1_000;

export const DesktopCoordinateSpaceSchema = z.object({
  screenHeight: z.number().int().positive().max(100_000),
  screenWidth: z.number().int().positive().max(100_000),
  screenshotHeight: z.number().int().positive().max(100_000),
  screenshotWidth: z.number().int().positive().max(100_000),
});

export const DesktopObservationSchema = z.object({
  observationId: z.string().uuid(),
  taskId: z.string().uuid(),
  capturedAt: z.string().datetime(),
  text: z.string().max(100_000),
  structuredState: z.string().max(500_000).optional(),
  screenshot: z
    .object({
      mimeType: z.string().regex(/^image\//),
      dataBase64: z.string().min(1).max(40_000_000),
    })
    .optional(),
  coordinateSpace: DesktopCoordinateSpaceSchema.optional(),
  degraded: z.boolean(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});

export const DesktopCommandSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('open_url'),
    url: z.string().url().refine((value) => new URL(value).protocol === 'https:', {
      message: 'Only HTTPS URLs may be opened.',
    }),
  }),
  z.object({
    kind: z.literal('click'),
    x: CoordinateSchema,
    y: CoordinateSchema,
    button: z.enum(['left', 'right', 'middle']).default('left'),
    count: z.number().int().min(1).max(2).default(1),
  }),
  z.object({
    kind: z.literal('point'),
    x: CoordinateSchema,
    y: CoordinateSchema,
  }),
  z.object({
    kind: z.literal('type_text'),
    text: z.string().min(1).max(100_000),
  }),
  z.object({
    kind: z.literal('keypress'),
    keys: z.array(z.string().trim().min(1).max(40)).min(1).max(8),
  }),
  z.object({
    kind: z.literal('scroll'),
    x: CoordinateSchema,
    y: CoordinateSchema,
    direction: z.enum(['up', 'down', 'left', 'right']),
    amount: z.number().int().min(1).max(20).default(3),
  }),
]);

const ActionIntentSchema = ProposedActionSchema.shape.action;

const EmailSendPayloadSchema = z.object({
  account: z.string().min(1).max(500),
  recipients: z.array(z.string().min(1).max(500)).min(1).max(50),
  subject: z.string().max(2_000),
  body: z.string().min(1).max(100_000),
  threadId: z.string().min(1).max(2_000).optional(),
  attachments: z.array(z.string().min(1).max(2_000)).max(50).optional(),
});

const GuidanceSequenceSchema = z.object({
  index: z.number().int().min(1).max(MAX_GUIDANCE_SEQUENCE_LENGTH),
  total: z.number().int().min(1).max(MAX_GUIDANCE_SEQUENCE_LENGTH),
}).refine((sequence) => sequence.index <= sequence.total, {
  message: 'The guidance sequence index cannot exceed its total.',
  path: ['index'],
});

const SENSITIVE_POINTER_INTENTS = new Set([
  'delete',
  'download',
  'install',
  'login',
  'purchase',
  'run_command',
  'send',
  'submit',
  'upload',
  'write_file',
]);

export const DesktopActionDecisionSchema = z
  .object({
    kind: z.literal('action'),
    observationId: z.string().uuid(),
    intent: ActionIntentSchema,
    capability: CapabilitySchema,
    description: z.string().min(1).max(2_000),
    target: z.string().max(8_000).optional(),
    guidanceSequence: GuidanceSequenceSchema.optional(),
    sendPayload: EmailSendPayloadSchema.optional(),
    command: DesktopCommandSchema,
  })
  .superRefine((decision, context) => {
    if (decision.intent === 'send' && !decision.sendPayload) {
      context.addIssue({
        code: 'custom',
        message:
          'Sending email requires the exact account, recipients, subject, and body.',
        path: ['sendPayload'],
      });
    }
    if (decision.intent !== 'send' && decision.sendPayload) {
      context.addIssue({
        code: 'custom',
        message: 'Email send details are valid only for a send action.',
        path: ['sendPayload'],
      });
    }
    if (decision.command.kind === 'point' && !decision.guidanceSequence) {
      context.addIssue({
        code: 'custom',
        message: 'Visual guidance points require an ordered sequence.',
        path: ['guidanceSequence'],
      });
    }
    if (decision.command.kind !== 'point' && decision.guidanceSequence) {
      context.addIssue({
        code: 'custom',
        message: 'Only visual guidance points may declare a sequence.',
        path: ['guidanceSequence'],
      });
    }

    const allowed = (() => {
      switch (decision.command.kind) {
        case 'open_url':
          return decision.intent === 'open_url' && decision.capability === 'browser';
        case 'type_text':
          return decision.intent === 'type_text';
        case 'point':
          return (
            decision.intent === 'guide' &&
            decision.capability === 'computer_use'
          );
        case 'scroll':
          return decision.intent === 'scroll';
        case 'click':
          return (
            decision.intent === 'click_element' ||
            SENSITIVE_POINTER_INTENTS.has(decision.intent)
          );
        case 'keypress':
          return (
            decision.intent === 'press_key' ||
            SENSITIVE_POINTER_INTENTS.has(decision.intent)
          );
      }
    })();

    if (!allowed) {
      context.addIssue({
        code: 'custom',
        message: 'The command, semantic intent, and capability do not agree.',
        path: ['intent'],
      });
    }
  });

export const DesktopStepDecisionSchema = z.discriminatedUnion('kind', [
  DesktopActionDecisionSchema,
  z.object({
    kind: z.literal('ask_user'),
    prompt: z.string().min(1).max(2_000),
    choices: z.array(z.string().min(1).max(500)).max(12).optional(),
  }),
  z.object({
    kind: z.literal('complete'),
    summary: z.string().min(1).max(8_000),
  }),
  z.object({
    kind: z.literal('blocked'),
    reason: z.string().min(1).max(2_000),
  }),
]);

export const DesktopActionOutcomeSchema = z.object({
  status: z.enum(['confirmed', 'unknown', 'failed']),
  summary: z.string().min(1).max(2_000),
});

export type DesktopActionDecision = z.infer<
  typeof DesktopActionDecisionSchema
>;
export type DesktopActionOutcome = z.infer<typeof DesktopActionOutcomeSchema>;
export type DesktopCommand = z.infer<typeof DesktopCommandSchema>;
export type DesktopCoordinateSpace = z.infer<
  typeof DesktopCoordinateSpaceSchema
>;
export type DesktopObservation = z.infer<typeof DesktopObservationSchema>;
export type DesktopStepDecision = z.infer<typeof DesktopStepDecisionSchema>;

function mapScreenshotAxis(
  value: number,
  screenshotExtent: number,
  screenExtent: number,
): number {
  return Math.min(
    screenExtent - 1,
    Math.max(0, Math.round((value / screenshotExtent) * screenExtent)),
  );
}

export function mapScreenshotPointToDesktop(
  point: { x: number; y: number },
  coordinateSpace: DesktopCoordinateSpace | undefined,
): { x: number; y: number } {
  if (!coordinateSpace) return { x: point.x, y: point.y };

  return {
    x: mapScreenshotAxis(
      point.x,
      coordinateSpace.screenshotWidth,
      coordinateSpace.screenWidth,
    ),
    y: mapScreenshotAxis(
      point.y,
      coordinateSpace.screenshotHeight,
      coordinateSpace.screenHeight,
    ),
  };
}

export function mapNormalizedPointToScreenshot(
  point: { x: number; y: number },
  coordinateSpace: DesktopCoordinateSpace,
): { x: number; y: number } {
  const mapAxis = (value: number, extent: number): number =>
    Math.min(
      extent - 1,
      Math.max(
        0,
        Math.round((value / PLANNER_COORDINATE_MAX) * extent),
      ),
    );

  return {
    x: mapAxis(point.x, coordinateSpace.screenshotWidth),
    y: mapAxis(point.y, coordinateSpace.screenshotHeight),
  };
}

function commandParameters(
  command: DesktopCommand,
): Record<string, string | string[]> {
  switch (command.kind) {
    case 'open_url':
      return { command: command.kind, url: command.url };
    case 'click':
      return {
        button: command.button,
        command: command.kind,
        count: String(command.count),
        x: String(command.x),
        y: String(command.y),
      };
    case 'point':
      return {
        command: command.kind,
        x: String(command.x),
        y: String(command.y),
      };
    case 'type_text':
      return { command: command.kind, text: command.text };
    case 'keypress':
      return { command: command.kind, keys: command.keys };
    case 'scroll':
      return {
        amount: String(command.amount),
        command: command.kind,
        direction: command.direction,
        x: String(command.x),
        y: String(command.y),
      };
  }
}

function sendParameters(
  payload: z.infer<typeof EmailSendPayloadSchema> | undefined,
): Record<string, string | string[]> {
  if (!payload) return {};

  return {
    account: payload.account,
    recipients: payload.recipients,
    subject: payload.subject,
    body: payload.body,
    ...(payload.threadId ? { threadId: payload.threadId } : {}),
    ...(payload.attachments ? { attachments: payload.attachments } : {}),
  };
}

export function proposedActionForDecision(
  decision: DesktopActionDecision,
): ProposedAction {
  const target =
    decision.command.kind === 'open_url'
      ? decision.command.url
      : decision.target;

  return ProposedActionSchema.parse({
    action: decision.intent,
    capability: decision.capability,
    description: decision.description,
    ...(target ? { target } : {}),
    parameters: {
      ...sendParameters(decision.sendPayload),
      ...commandParameters(decision.command),
    },
  });
}
