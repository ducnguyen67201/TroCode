import { z } from 'zod';

import {
  ProposedActionSchema,
  type ProposedAction,
} from '../../shared/contracts';

import type {
  AgentToolCall,
  ResolvedToolInvocation,
  StrictJsonObjectSchema,
} from './agent-contracts';
import {
  SurfaceCommandSchema,
  type DesktopObservation,
  type SurfaceCommand,
  type SurfaceElement,
} from './execution-contracts';
import type {
  RuntimeToolDefinition,
  ToolResolutionContext,
} from './runtime-tool-registry';

const CONSEQUENCES = [
  'click_element',
  'type_text',
  'press_key',
  'scroll',
  'login',
  'send',
  'submit',
  'upload',
  'download',
  'delete',
  'purchase',
  'install',
  'run_command',
  'write_file',
] as const;

const SENSITIVE_CLICK_CONSEQUENCES = [
  'login',
  'send',
  'submit',
  'upload',
  'download',
  'delete',
  'purchase',
  'install',
  'run_command',
  'write_file',
] as const;

const SendPayloadSchema = z.object({
  account: z.string().min(1).max(500),
  recipients: z.array(z.string().min(1).max(500)).min(1).max(50),
  subject: z.string().max(2_000),
  body: z.string().min(1).max(100_000),
  threadId: z.string().min(1).max(2_000).nullable(),
  attachments: z.array(z.string().min(1).max(2_000)).max(50).nullable(),
});

const ModelSurfaceCommandSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('click_element'),
    ref: z.string().regex(/^e[1-9][0-9]{0,3}$/u),
    button: z.enum(['left', 'right']),
    count: z.number().int().min(1).max(2),
    consequence: z.enum(CONSEQUENCES),
    sendPayload: SendPayloadSchema.nullable(),
  }),
  z.object({
    kind: z.literal('type_text'),
    ref: z.string().regex(/^e[1-9][0-9]{0,3}$/u),
    text: z.string().max(100_000),
    replace: z.boolean(),
    consequence: z.enum(CONSEQUENCES),
    sendPayload: SendPayloadSchema.nullable(),
  }),
  z.object({
    kind: z.literal('press_key'),
    ref: z.string().regex(/^e[1-9][0-9]{0,3}$/u).nullable(),
    key: z.string().trim().min(1).max(40),
    modifiers: z.array(z.string().trim().min(1).max(40)).max(8),
    consequence: z.enum(CONSEQUENCES),
    sendPayload: SendPayloadSchema.nullable(),
  }),
  z.object({
    kind: z.literal('scroll'),
    ref: z.string().regex(/^e[1-9][0-9]{0,3}$/u).nullable(),
    direction: z.enum(['up', 'down', 'left', 'right']),
    amount: z.number().int().min(1).max(20),
    consequence: z.enum(CONSEQUENCES),
    sendPayload: SendPayloadSchema.nullable(),
  }),
]).superRefine((command, context) => {
  const allowed =
    command.kind === 'click_element'
      ? command.consequence === 'click_element' ||
        SENSITIVE_CLICK_CONSEQUENCES.includes(
          command.consequence as (typeof SENSITIVE_CLICK_CONSEQUENCES)[number],
        )
      : command.kind === 'type_text'
        ? ['type_text', 'login', 'send', 'submit', 'upload'].includes(
            command.consequence,
          )
        : command.kind === 'press_key'
          ? ['press_key', 'login', 'send', 'submit', 'delete'].includes(
              command.consequence,
            )
          : command.consequence === 'scroll';
  if (!allowed) {
    context.addIssue({
      code: 'custom',
      message: 'The semantic command and declared consequence do not agree.',
      path: ['consequence'],
    });
  }
  if (command.consequence === 'send' && !command.sendPayload) {
    context.addIssue({
      code: 'custom',
      message: 'A send action requires its exact account, recipients, subject, and body.',
      path: ['sendPayload'],
    });
  }
  if (command.consequence !== 'send' && command.sendPayload) {
    context.addIssue({
      code: 'custom',
      message: 'Only a send action may include an exact send payload.',
      path: ['sendPayload'],
    });
  }
});

const SurfaceControlInputSchema = z.object({
  observationId: z.string().uuid(),
  description: z.string().trim().min(1).max(2_000),
  target: z.string().trim().min(1).max(8_000).nullable(),
  command: ModelSurfaceCommandSchema,
});

const ObserveSurfaceInputSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  query: z.string().trim().min(1).max(500).nullable(),
});

const PrepareBrowserInputSchema = z.object({
  observationId: z.string().uuid(),
  reason: z.string().trim().min(1).max(2_000),
});

export interface ObserveSurfaceToolInput {
  query?: string;
  reason: string;
}

export interface SurfaceControlToolInput {
  command: SurfaceCommand;
  consequence: ProposedAction['action'];
  description: string;
  observationFingerprint: string;
  observationId: string;
  publicRef?: string;
  target?: string;
}

export interface PrepareBrowserAccessToolInput {
  observationFingerprint: string;
  observationId: string;
  reason: string;
}

export interface CuaSemanticToolOptions {
  browserPrepareAvailable: () => boolean;
  semanticAvailable: () => boolean;
}

function objectSchema(
  properties: Record<string, Record<string, unknown>>,
  required: string[],
): StrictJsonObjectSchema {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required,
  };
}

const nullableRef = {
  anyOf: [
    { type: 'string', pattern: '^e[1-9][0-9]{0,3}$' },
    { type: 'null' },
  ],
};

const sendPayloadModelSchema = objectSchema(
  {
    account: { type: 'string', maxLength: 500 },
    recipients: {
      type: 'array',
      minItems: 1,
      maxItems: 50,
      items: { type: 'string', maxLength: 500 },
    },
    subject: { type: 'string', maxLength: 2_000 },
    body: { type: 'string', minLength: 1, maxLength: 100_000 },
    threadId: {
      anyOf: [{ type: 'string', maxLength: 2_000 }, { type: 'null' }],
    },
    attachments: {
      anyOf: [
        {
          type: 'array',
          maxItems: 50,
          items: { type: 'string', maxLength: 2_000 },
        },
        { type: 'null' },
      ],
    },
  },
  ['account', 'recipients', 'subject', 'body', 'threadId', 'attachments'],
);

function commandVariant(
  base: StrictJsonObjectSchema,
  consequences: readonly string[],
  send = false,
): StrictJsonObjectSchema {
  return objectSchema(
    {
      ...base.properties,
      consequence:
        consequences.length === 1
          ? { type: 'string', const: consequences[0] }
          : { type: 'string', enum: [...consequences] },
      sendPayload: send
        ? (sendPayloadModelSchema as unknown as Record<string, unknown>)
        : { type: 'null' },
    },
    [...base.required, 'consequence', 'sendPayload'],
  );
}

const clickModelSchema = objectSchema(
  {
    kind: { type: 'string', const: 'click_element' },
    ref: { type: 'string', pattern: '^e[1-9][0-9]{0,3}$' },
    button: { type: 'string', enum: ['left', 'right'] },
    count: { type: 'integer', minimum: 1, maximum: 2 },
  },
  ['kind', 'ref', 'button', 'count'],
);
const typeModelSchema = objectSchema(
  {
    kind: { type: 'string', const: 'type_text' },
    ref: { type: 'string', pattern: '^e[1-9][0-9]{0,3}$' },
    text: { type: 'string', maxLength: 100_000 },
    replace: { type: 'boolean' },
  },
  ['kind', 'ref', 'text', 'replace'],
);
const keyModelSchema = objectSchema(
  {
    kind: { type: 'string', const: 'press_key' },
    ref: nullableRef,
    key: { type: 'string', minLength: 1, maxLength: 40 },
    modifiers: {
      type: 'array',
      maxItems: 8,
      items: { type: 'string', minLength: 1, maxLength: 40 },
    },
  },
  ['kind', 'ref', 'key', 'modifiers'],
);
const scrollModelSchema = objectSchema(
  {
    kind: { type: 'string', const: 'scroll' },
    ref: nullableRef,
    direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
    amount: { type: 'integer', minimum: 1, maximum: 20 },
  },
  ['kind', 'ref', 'direction', 'amount'],
);

function controlParameters(): StrictJsonObjectSchema {
  return objectSchema(
    {
      observationId: { type: 'string' },
      description: { type: 'string', maxLength: 2_000 },
      target: {
        anyOf: [{ type: 'string', maxLength: 8_000 }, { type: 'null' }],
      },
      command: {
        anyOf: [
          commandVariant(clickModelSchema, [
            'click_element',
            ...SENSITIVE_CLICK_CONSEQUENCES.filter((value) => value !== 'send'),
          ]),
          commandVariant(clickModelSchema, ['send'], true),
          commandVariant(typeModelSchema, ['type_text', 'login', 'submit', 'upload']),
          commandVariant(typeModelSchema, ['send'], true),
          commandVariant(keyModelSchema, ['press_key', 'login', 'submit', 'delete']),
          commandVariant(keyModelSchema, ['send'], true),
          commandVariant(scrollModelSchema, ['scroll']),
        ],
      },
    },
    ['observationId', 'description', 'target', 'command'],
  );
}

function parseJson<T>(schema: z.ZodType<T>, value: string): T {
  return schema.parse(JSON.parse(value));
}

function requireSemanticObservation(
  context: ToolResolutionContext,
  observationId: string,
): DesktopObservation {
  const observation = context.latestObservation;
  if (!observation) {
    throw new Error('Observe the current surface before requesting a semantic action.');
  }
  if (observation.observationId !== observationId) {
    throw new Error('The semantic tool call references a stale observation.');
  }
  if (
    observation.route !== 'browser_semantic' &&
    observation.route !== 'window_accessibility' &&
    observation.route !== 'window_vision'
  ) {
    throw new Error('The latest observation requires desktop control instead.');
  }
  return observation;
}

function elementFor(
  observation: DesktopObservation,
  publicRef: string | undefined,
): SurfaceElement | undefined {
  if (!publicRef) return undefined;
  const element = observation.elements?.find((candidate) => candidate.ref === publicRef);
  if (!element) throw new Error('The semantic element reference is unavailable.');
  return element;
}

function trustedActionForCommand(command: SurfaceCommand): ProposedAction['action'] {
  return command.kind;
}

function commandWithoutPolicy(
  command: z.infer<typeof ModelSurfaceCommandSchema>,
): SurfaceCommand {
  switch (command.kind) {
    case 'click_element':
      return SurfaceCommandSchema.parse({
        kind: command.kind,
        ref: command.ref,
        button: command.button,
        count: command.count,
      });
    case 'type_text':
      return SurfaceCommandSchema.parse({
        kind: command.kind,
        ref: command.ref,
        text: command.text,
        replace: command.replace,
      });
    case 'press_key':
      return SurfaceCommandSchema.parse({
        kind: command.kind,
        ref: command.ref,
        key: command.key,
        modifiers: command.modifiers,
      });
    case 'scroll':
      return SurfaceCommandSchema.parse({
        kind: command.kind,
        ref: command.ref,
        direction: command.direction,
        amount: command.amount,
      });
  }
}

function actionParameters(
  observation: DesktopObservation,
  element: SurfaceElement | undefined,
  command: SurfaceCommand,
  consequence: string,
  sendPayload: z.infer<typeof SendPayloadSchema> | null,
): Record<string, string | string[]> {
  const parameters: Record<string, string | string[]> = {
    command: command.kind,
    declaredConsequence: consequence,
    application: observation.surface?.application ?? 'Unknown application',
    observationFingerprint: observation.fingerprint,
    observationId: observation.observationId,
    surfaceKind: observation.surface?.kind ?? 'native_app',
    ...(element
      ? {
          publicRef: element.ref,
          role: element.role,
          ariaLabel: element.name,
          visibleText: element.name,
          ...(element.value ? { controlValue: element.value } : {}),
          ...(element.href ? { href: element.href } : {}),
          ...(element.disabled !== undefined
            ? { disabled: String(element.disabled) }
            : {}),
          ...(element.selected !== undefined
            ? { selected: String(element.selected) }
            : {}),
        }
      : {}),
  };
  if (command.kind === 'type_text') parameters.text = command.text;
  if (command.kind === 'press_key') {
    parameters.key = command.key;
    parameters.modifiers = command.modifiers;
  }
  if (command.kind === 'scroll') {
    parameters.direction = command.direction;
    parameters.amount = String(command.amount);
  }
  if (sendPayload) {
    parameters.account = sendPayload.account;
    parameters.recipients = sendPayload.recipients;
    parameters.subject = sendPayload.subject;
    parameters.body = sendPayload.body;
    if (sendPayload.threadId) parameters.threadId = sendPayload.threadId;
    if (sendPayload.attachments) parameters.attachments = sendPayload.attachments;
  }
  return parameters;
}

export function createCuaSemanticToolDefinitions(
  options: CuaSemanticToolOptions,
): RuntimeToolDefinition[] {
  return [
    {
      id: 'computer.observe',
      modelName: 'observe_surface',
      description:
        'Read the current non-Tro browser tab or application window using structured semantics first. It returns opaque element references and falls back to vision when needed.',
      operations: ['observe'],
      available: options.semanticAvailable,
      parameters: objectSchema(
        {
          reason: { type: 'string', maxLength: 500 },
          query: {
            anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }],
          },
        },
        ['reason', 'query'],
      ),
      parse: (value) => {
        const parsed = parseJson(ObserveSurfaceInputSchema, value);
        return {
          reason: parsed.reason,
          ...(parsed.query ? { query: parsed.query } : {}),
        } satisfies ObserveSurfaceToolInput;
      },
      normalize: (input: ObserveSurfaceToolInput, call: AgentToolCall) => ({
        callId: call.callId,
        input,
        kind: 'observe',
        modelName: call.name,
        operation: 'observe',
        toolId: 'computer.observe',
      }),
    },
    {
      id: 'computer.control',
      modelName: 'control_surface',
      description:
        'Execute one exact click, type, key, or scroll action using an opaque ref from the latest observe_surface result. Set description to one concise user-facing sentence stating what will happen; the host shows it immediately before execution. Use desktop control only when the observation route is desktop vision.',
      operations: ['click_element', 'type_text', 'press_key', 'scroll'],
      available: options.semanticAvailable,
      parameters: controlParameters(),
      parse: (value) => parseJson(SurfaceControlInputSchema, value),
      normalize: (
        input: z.infer<typeof SurfaceControlInputSchema>,
        call: AgentToolCall,
        context: ToolResolutionContext,
      ): ResolvedToolInvocation => {
        const observation = requireSemanticObservation(context, input.observationId);
        const command = commandWithoutPolicy(input.command);
        const publicRef = 'ref' in command && command.ref ? command.ref : undefined;
        const element = elementFor(observation, publicRef);
        const consequence = input.command.consequence;
        const action = ProposedActionSchema.parse({
          action: trustedActionForCommand(command),
          toolId: 'computer.control',
          operation: command.kind,
          description: input.description,
          ...(input.target ? { target: input.target } : {}),
          parameters: actionParameters(
            observation,
            element,
            command,
            consequence,
            input.command.sendPayload,
          ),
        });
        return {
          action,
          callId: call.callId,
          input: {
            command,
            consequence,
            description: input.description,
            observationFingerprint: observation.fingerprint,
            observationId: observation.observationId,
            ...(publicRef ? { publicRef } : {}),
            ...(input.target ? { target: input.target } : {}),
          } satisfies SurfaceControlToolInput,
          kind: 'surface',
          modelName: call.name,
          operation: command.kind,
          toolId: 'computer.control',
        };
      },
    },
    {
      id: 'browser.prepare',
      modelName: 'prepare_browser_access',
      description:
        'Request explicit permission to attach CUA to the exact current logged-in Chromium profile when observe_surface says deeper browser access requires approval.',
      operations: ['attach_existing_profile'],
      available: () =>
        options.semanticAvailable() && options.browserPrepareAvailable(),
      parameters: objectSchema(
        {
          observationId: { type: 'string' },
          reason: { type: 'string', maxLength: 2_000 },
        },
        ['observationId', 'reason'],
      ),
      parse: (value) => parseJson(PrepareBrowserInputSchema, value),
      normalize: (
        input: z.infer<typeof PrepareBrowserInputSchema>,
        call: AgentToolCall,
        context: ToolResolutionContext,
      ) => {
        const observation = requireSemanticObservation(context, input.observationId);
        if (
          observation.surface?.kind !== 'browser' ||
          observation.surface.deepAccess !== 'available_requires_approval'
        ) {
          throw new Error(
            'The current observation does not require browser-profile preparation.',
          );
        }
        return {
          action: ProposedActionSchema.parse({
            action: 'system_permission',
            toolId: 'browser.prepare',
            operation: 'attach_existing_profile',
            description: input.reason,
            target: observation.surface.application,
            parameters: {
              observationId: observation.observationId,
              observationFingerprint: observation.fingerprint,
              surfaceKind: observation.surface.kind,
              declaredConsequence: 'system_permission',
            },
          }),
          callId: call.callId,
          input: {
            observationId: observation.observationId,
            observationFingerprint: observation.fingerprint,
            reason: input.reason,
          } satisfies PrepareBrowserAccessToolInput,
          kind: 'surface' as const,
          modelName: call.name,
          operation: 'attach_existing_profile',
          toolId: 'browser.prepare',
        };
      },
    },
  ];
}
