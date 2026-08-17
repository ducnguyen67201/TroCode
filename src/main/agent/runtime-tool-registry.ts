import { z } from 'zod';

import {
  ProposedActionSchema,
  RuntimeToolIdSchema,
  type ProposedAction,
  type RuntimeToolId,
} from '../../shared/contracts';

import {
  type AgentToolCall,
  type ModelToolSpec,
  type ResolvedToolInvocation,
} from './agent-contracts';
import {
  DesktopCommandSchema,
  NORMALIZED_COORDINATE_MAX,
  mapNormalizedPointToScreenshot,
  type DesktopCommand,
  type DesktopObservation,
} from './execution-contracts';

type JsonSchema = Record<string, unknown>;

export interface ToolResolutionContext {
  latestObservation?: DesktopObservation;
  taskId: string;
}

export interface RuntimeToolDefinition<TInput = unknown> {
  available?: () => boolean;
  description: string;
  id: RuntimeToolId;
  modelName: string;
  normalize(
    input: TInput,
    call: AgentToolCall,
    context: ToolResolutionContext,
  ): ResolvedToolInvocation;
  operations: readonly string[];
  parameters: JsonSchema;
  parse(argumentsJson: string): TInput;
}

export interface ObserveDesktopToolInput {
  reason: string;
}

export interface DesktopControlToolInput {
  command: DesktopCommand;
  consequence: ProposedAction['action'];
  description: string;
  observationFingerprint: string;
  observationId: string;
  target?: string;
}

export interface GuidanceToolInput {
  description: string;
  observationFingerprint: string;
  observationId: string;
  target?: string;
  x: number;
  y: number;
}

export interface InteractionToolInput {
  choices?: string[];
  prompt: string;
}

export interface OpenUrlToolInput {
  reason: string;
  url: string;
}

const consequenceValues = [
  'answer',
  'guide',
  'observe_screen',
  'open_url',
  'click_element',
  'type_text',
  'press_key',
  'scroll',
  'drag',
  'read_file',
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

const normalizedPoint = z.object({
  x: z.number().int().min(0).max(NORMALIZED_COORDINATE_MAX),
  y: z.number().int().min(0).max(NORMALIZED_COORDINATE_MAX),
});

const normalizedCommand = z.discriminatedUnion('kind', [
  normalizedPoint.extend({
    kind: z.literal('click'),
    button: z.enum(['left', 'right', 'middle']).default('left'),
    count: z.number().int().min(1).max(2).default(1),
  }),
  z.object({
    kind: z.literal('drag'),
    fromX: z.number().int().min(0).max(NORMALIZED_COORDINATE_MAX),
    fromY: z.number().int().min(0).max(NORMALIZED_COORDINATE_MAX),
    toX: z.number().int().min(0).max(NORMALIZED_COORDINATE_MAX),
    toY: z.number().int().min(0).max(NORMALIZED_COORDINATE_MAX),
    durationMs: z.number().int().min(50).max(10_000).default(500),
    button: z.enum(['left', 'right', 'middle']).default('left'),
  }),
  z.object({
    kind: z.literal('type_text'),
    text: z.string().min(1).max(100_000),
  }),
  z.object({
    kind: z.literal('keypress'),
    keys: z.array(z.string().trim().min(1).max(40)).min(1).max(8),
  }),
  normalizedPoint.extend({
    kind: z.literal('scroll'),
    direction: z.enum(['up', 'down', 'left', 'right']),
    amount: z.number().int().min(1).max(20).default(3),
  }),
]);

const sendPayload = z.object({
  account: z.string().min(1).max(500),
  recipients: z.array(z.string().min(1).max(500)).min(1).max(50),
  subject: z.string().max(2_000),
  body: z.string().min(1).max(100_000),
  threadId: z
    .string()
    .min(1)
    .max(2_000)
    .nullish()
    .transform((value) => value ?? undefined),
  attachments: z
    .array(z.string().min(1).max(2_000))
    .max(50)
    .nullish()
    .transform((value) => value ?? undefined),
});

const controlInputSchema = z
  .object({
    observationId: z.string().uuid(),
    consequence: z.enum(consequenceValues),
    description: z.string().trim().min(1).max(2_000),
    target: z
      .string()
      .trim()
      .min(1)
      .max(8_000)
      .nullish()
      .transform((value) => value ?? undefined),
    sendPayload: sendPayload
      .nullish()
      .transform((value) => value ?? undefined),
    command: normalizedCommand,
  })
  .superRefine((input, context) => {
    if (input.consequence === 'send' && !input.sendPayload) {
      context.addIssue({
        code: 'custom',
        message: 'A send action requires exact account, recipients, subject, and body.',
        path: ['sendPayload'],
      });
    }
    const allowed =
      input.command.kind === 'click'
        ? input.consequence === 'click_element' ||
          [
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
          ].includes(input.consequence)
        : input.command.kind === 'type_text'
          ? input.consequence === 'type_text' ||
            ['login', 'send', 'submit', 'upload'].includes(input.consequence)
          : input.command.kind === 'keypress'
            ? input.consequence === 'press_key' ||
              ['login', 'send', 'submit', 'delete'].includes(input.consequence)
            : input.command.kind === 'scroll'
              ? input.consequence === 'scroll'
              : input.consequence === 'drag';
    if (!allowed) {
      context.addIssue({
        code: 'custom',
        message: 'The desktop command and declared consequence do not agree.',
        path: ['consequence'],
      });
    }
  });

function parseWith<T>(schema: z.ZodType<T>, argumentsJson: string): T {
  return schema.parse(JSON.parse(argumentsJson));
}

function requireObservation(
  context: ToolResolutionContext,
  observationId: string,
): DesktopObservation {
  const observation = context.latestObservation;
  if (!observation) {
    throw new Error('Observe the desktop before requesting a control action.');
  }
  if (observation.observationId !== observationId) {
    throw new Error('The desktop tool call references a stale observation.');
  }
  if (!observation.coordinateSpace) {
    throw new Error('The observation has no coordinate-space metadata.');
  }
  return observation;
}

function mapCommand(
  input: z.infer<typeof normalizedCommand>,
  observation: DesktopObservation,
): DesktopCommand {
  const coordinateSpace = observation.coordinateSpace;
  if (!coordinateSpace) {
    throw new Error('The observation has no coordinate-space metadata.');
  }
  if (input.kind === 'click' || input.kind === 'scroll') {
    return DesktopCommandSchema.parse({
      ...input,
      ...mapNormalizedPointToScreenshot(input, coordinateSpace),
    });
  }
  if (input.kind === 'drag') {
    const from = mapNormalizedPointToScreenshot(
      { x: input.fromX, y: input.fromY },
      coordinateSpace,
    );
    const to = mapNormalizedPointToScreenshot(
      { x: input.toX, y: input.toY },
      coordinateSpace,
    );
    return DesktopCommandSchema.parse({
      ...input,
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
    });
  }
  return DesktopCommandSchema.parse(input);
}

function commandParameters(
  command: DesktopCommand,
  observation: DesktopObservation,
): Record<string, string | string[]> {
  const evidence = {
    command: command.kind,
    observationFingerprint: observation.fingerprint,
    observationId: observation.observationId,
  };
  switch (command.kind) {
    case 'click':
      return {
        ...evidence,
        button: command.button,
        count: String(command.count),
        x: String(command.x),
        y: String(command.y),
      };
    case 'drag':
      return {
        ...evidence,
        button: command.button,
        durationMs: String(command.durationMs),
        fromX: String(command.fromX),
        fromY: String(command.fromY),
        toX: String(command.toX),
        toY: String(command.toY),
      };
    case 'type_text':
      return { ...evidence, text: command.text };
    case 'keypress':
      return { ...evidence, keys: command.keys };
    case 'scroll':
      return {
        ...evidence,
        amount: String(command.amount),
        direction: command.direction,
        x: String(command.x),
        y: String(command.y),
      };
    default:
      throw new Error('Unsupported desktop control command.');
  }
}

const functionSpec = (
  name: string,
  description: string,
  parameters: JsonSchema,
): ModelToolSpec => ({
  type: 'function',
  name,
  description,
  strict: true,
  parameters,
});

const objectSchema = (
  properties: Record<string, unknown>,
  required: string[],
): JsonSchema => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});

function assertStrictFunctionSchema(
  schema: unknown,
  path = 'parameters',
): void {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error('Model tool schema at ' + path + ' must be an object.');
  }
  const node = schema as Record<string, unknown>;
  if ('const' in node && typeof node.type !== 'string') {
    throw new Error(
      'Model tool schema at ' + path + ' uses const without an explicit type.',
    );
  }
  if (node.type === 'object') {
    if (node.additionalProperties !== false) {
      throw new Error(
        'Strict model tool object at ' +
          path +
          ' must set additionalProperties to false.',
      );
    }
    if (!node.properties || typeof node.properties !== 'object') {
      throw new Error(
        'Strict model tool object at ' + path + ' must define properties.',
      );
    }
    const properties = node.properties as Record<string, unknown>;
    const required = Array.isArray(node.required) ? node.required : [];
    for (const [name, propertySchema] of Object.entries(properties)) {
      if (!required.includes(name)) {
        throw new Error(
          'Strict model tool property ' + path + '.' + name + ' is not required.',
        );
      }
      assertStrictFunctionSchema(propertySchema, path + '.properties.' + name);
    }
  }
  for (const keyword of ['anyOf', 'oneOf', 'allOf'] as const) {
    const alternatives = node[keyword];
    if (!Array.isArray(alternatives)) continue;
    alternatives.forEach((alternative, index) =>
      assertStrictFunctionSchema(
        alternative,
        path + '.' + keyword + '[' + index + ']',
      ),
    );
  }
  if (node.items !== undefined) {
    assertStrictFunctionSchema(node.items, path + '.items');
  }
}

function defineTool<T>(
  definition: RuntimeToolDefinition<T>,
): RuntimeToolDefinition {
  return definition as RuntimeToolDefinition;
}

function defaultTools(): RuntimeToolDefinition[] {
  const observeSchema = z.object({
    reason: z.string().trim().min(1).max(500),
  });
  const openUrlSchema = z.object({
    url: z.string().url(),
    reason: z.string().trim().min(1).max(500),
  });
  const guidanceSchema = normalizedPoint.extend({
    observationId: z.string().uuid(),
    description: z.string().trim().min(1).max(2_000),
    target: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .nullish()
      .transform((value) => value ?? undefined),
  });
  const interactionSchema = z.object({
    prompt: z.string().trim().min(1).max(2_000),
    choices: z.array(z.string().trim().min(1).max(500)).max(12).optional(),
  });

  return [
    defineTool({
      id: 'desktop.observe',
      modelName: 'observe_desktop',
      description:
        'Capture the current desktop and return a fresh screenshot. Use before coordinate actions.',
      operations: ['observe'],
      parameters: objectSchema(
        {
          reason: {
            type: 'string',
            maxLength: 500,
            description: 'Why current visual state is needed.',
          },
        },
        ['reason'],
      ),
      parse: (value) => parseWith(observeSchema, value),
      normalize: (input, call) => ({
        callId: call.callId,
        input,
        kind: 'observe',
        modelName: call.name,
        operation: 'observe',
        toolId: 'desktop.observe',
      }),
    }),
    defineTool({
      id: 'desktop.control',
      modelName: 'control_desktop',
      description:
        'Execute one atomic action grounded in the latest desktop observation.',
      operations: ['click', 'drag', 'type_text', 'keypress', 'scroll'],
      parameters: objectSchema(
        {
          observationId: { type: 'string' },
          consequence: { type: 'string', enum: consequenceValues },
          description: { type: 'string', maxLength: 2_000 },
          target: {
            anyOf: [{ type: 'string', maxLength: 8_000 }, { type: 'null' }],
          },
          sendPayload: {
            anyOf: [
              {
                type: 'object',
                additionalProperties: false,
                properties: {
                  account: { type: 'string', maxLength: 500 },
                  recipients: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 50,
                    items: { type: 'string', maxLength: 500 },
                  },
                  subject: { type: 'string', maxLength: 2_000 },
                  body: { type: 'string', maxLength: 100_000 },
                  threadId: {
                    anyOf: [
                      { type: 'string', maxLength: 2_000 },
                      { type: 'null' },
                    ],
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
                required: [
                  'account',
                  'recipients',
                  'subject',
                  'body',
                  'threadId',
                  'attachments',
                ],
              },
              { type: 'null' },
            ],
          },
          command: {
            anyOf: [
              objectSchema(
                {
                  kind: { type: 'string', const: 'click' },
                  x: { type: 'integer', minimum: 0, maximum: 1_000 },
                  y: { type: 'integer', minimum: 0, maximum: 1_000 },
                  button: {
                    type: 'string',
                    enum: ['left', 'right', 'middle'],
                  },
                  count: { type: 'integer', minimum: 1, maximum: 2 },
                },
                ['kind', 'x', 'y', 'button', 'count'],
              ),
              objectSchema(
                {
                  kind: { type: 'string', const: 'drag' },
                  fromX: { type: 'integer', minimum: 0, maximum: 1_000 },
                  fromY: { type: 'integer', minimum: 0, maximum: 1_000 },
                  toX: { type: 'integer', minimum: 0, maximum: 1_000 },
                  toY: { type: 'integer', minimum: 0, maximum: 1_000 },
                  durationMs: {
                    type: 'integer',
                    minimum: 50,
                    maximum: 10_000,
                  },
                  button: {
                    type: 'string',
                    enum: ['left', 'right', 'middle'],
                  },
                },
                [
                  'kind',
                  'fromX',
                  'fromY',
                  'toX',
                  'toY',
                  'durationMs',
                  'button',
                ],
              ),
              objectSchema(
                {
                  kind: { type: 'string', const: 'type_text' },
                  text: { type: 'string', maxLength: 100_000 },
                },
                ['kind', 'text'],
              ),
              objectSchema(
                {
                  kind: { type: 'string', const: 'keypress' },
                  keys: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 8,
                    items: { type: 'string', maxLength: 40 },
                  },
                },
                ['kind', 'keys'],
              ),
              objectSchema(
                {
                  kind: { type: 'string', const: 'scroll' },
                  x: { type: 'integer', minimum: 0, maximum: 1_000 },
                  y: { type: 'integer', minimum: 0, maximum: 1_000 },
                  direction: {
                    type: 'string',
                    enum: ['up', 'down', 'left', 'right'],
                  },
                  amount: { type: 'integer', minimum: 1, maximum: 20 },
                },
                ['kind', 'x', 'y', 'direction', 'amount'],
              ),
            ],
          },
        },
        [
          'observationId',
          'consequence',
          'description',
          'target',
          'sendPayload',
          'command',
        ],
      ),
      parse: (value) => parseWith(controlInputSchema, value),
      normalize: (input, call, context) => {
        const observation = requireObservation(context, input.observationId);
        const command = mapCommand(input.command, observation);
        const sendParameters = input.sendPayload
          ? {
              account: input.sendPayload.account,
              recipients: input.sendPayload.recipients,
              subject: input.sendPayload.subject,
              body: input.sendPayload.body,
              ...(input.sendPayload.threadId
                ? { threadId: input.sendPayload.threadId }
                : {}),
              ...(input.sendPayload.attachments
                ? { attachments: input.sendPayload.attachments }
                : {}),
            }
          : {};
        const action = ProposedActionSchema.parse({
          action: input.consequence,
          toolId: 'desktop.control',
          operation: command.kind,
          description: input.description,
          ...(input.target ? { target: input.target } : {}),
          parameters: {
            ...commandParameters(command, observation),
            ...sendParameters,
          },
        });
        return {
          action,
          callId: call.callId,
          input: {
            ...input,
            command,
            observationFingerprint: observation.fingerprint,
          },
          kind: 'desktop',
          modelName: call.name,
          operation: command.kind,
          toolId: 'desktop.control',
        };
      },
    }),
    defineTool({
      id: 'browser.navigate',
      modelName: 'open_url',
      description: 'Open one public HTTPS URL in the user browser.',
      operations: ['open_url'],
      parameters: objectSchema(
        {
          url: { type: 'string', maxLength: 8_000 },
          reason: { type: 'string', maxLength: 500 },
        },
        ['url', 'reason'],
      ),
      parse: (value) => parseWith(openUrlSchema, value),
      normalize: (input, call) => ({
        action: ProposedActionSchema.parse({
          action: 'open_url',
          toolId: 'browser.navigate',
          operation: 'open_url',
          description: input.reason,
          target: input.url,
          parameters: { command: 'open_url', url: input.url },
        }),
        callId: call.callId,
        input,
        kind: 'direct',
        modelName: call.name,
        operation: 'open_url',
        toolId: 'browser.navigate',
      }),
    }),
    defineTool({
      id: 'task.guidance',
      modelName: 'show_guidance',
      description:
        'Point at one visible target and explain it without clicking or changing the application.',
      operations: ['show'],
      parameters: objectSchema(
        {
          observationId: { type: 'string' },
          description: { type: 'string', maxLength: 2_000 },
          target: {
            anyOf: [{ type: 'string', maxLength: 80 }, { type: 'null' }],
          },
          x: { type: 'integer', minimum: 0, maximum: 1_000 },
          y: { type: 'integer', minimum: 0, maximum: 1_000 },
        },
        ['observationId', 'description', 'target', 'x', 'y'],
      ),
      parse: (value) => parseWith(guidanceSchema, value),
      normalize: (input, call, context) => {
        const observation = requireObservation(context, input.observationId);
        const coordinateSpace = observation.coordinateSpace;
        if (!coordinateSpace) {
          throw new Error('The observation has no coordinate-space metadata.');
        }
        const point = mapNormalizedPointToScreenshot(input, coordinateSpace);
        const action = ProposedActionSchema.parse({
          action: 'guide',
          toolId: 'task.guidance',
          operation: 'show',
          description: input.description,
          ...(input.target ? { target: input.target } : {}),
          parameters: {
            command: 'point',
            observationFingerprint: observation.fingerprint,
            observationId: observation.observationId,
            x: String(point.x),
            y: String(point.y),
          },
        });
        return {
          action,
          callId: call.callId,
          input: {
            ...input,
            x: point.x,
            y: point.y,
            observationFingerprint: observation.fingerprint,
          },
          kind: 'guidance',
          modelName: call.name,
          operation: 'show',
          toolId: 'task.guidance',
        };
      },
    }),
    defineTool({
      id: 'task.interaction',
      modelName: 'request_user_input',
      description:
        'Ask one concise question when a material choice is missing.',
      operations: ['request'],
      parameters: objectSchema(
        {
          prompt: { type: 'string', maxLength: 2_000 },
          choices: {
            type: 'array',
            maxItems: 12,
            items: { type: 'string', maxLength: 500 },
          },
        },
        ['prompt', 'choices'],
      ),
      parse: (value) => parseWith(interactionSchema, value),
      normalize: (input, call) => ({
        callId: call.callId,
        input,
        kind: 'interaction',
        modelName: call.name,
        operation: 'request',
        toolId: 'task.interaction',
      }),
    }),
  ];
}

export function toolIdentityForAction(action: ProposedAction): {
  toolId: RuntimeToolId;
  operation: string;
} {
  if (action.toolId && action.operation) {
    return { toolId: action.toolId, operation: action.operation };
  }
  const command = action.parameters?.command;
  const operation = typeof command === 'string' ? command : action.action;
  if (action.action === 'open_url' || operation === 'open_url') {
    return { toolId: 'browser.navigate', operation: 'open_url' };
  }
  if (action.action === 'observe_screen') {
    return { toolId: 'desktop.observe', operation: 'observe' };
  }
  if (action.action === 'answer' || action.action === 'guide') {
    return { toolId: 'task.guidance', operation: 'show' };
  }
  return { toolId: 'desktop.control', operation };
}

export class RuntimeToolRegistry {
  private readonly toolsById = new Map<RuntimeToolId, RuntimeToolDefinition>();

  private readonly toolsByModelName = new Map<string, RuntimeToolDefinition>();

  private readonly resolvedCallIds = new Set<string>();

  constructor(definitions: readonly RuntimeToolDefinition[] = defaultTools()) {
    for (const definition of definitions) {
      const id = RuntimeToolIdSchema.parse(definition.id);
      if (this.toolsById.has(id)) {
        throw new Error('Runtime tool ' + id + ' is already registered.');
      }
      if (this.toolsByModelName.has(definition.modelName)) {
        throw new Error(
          'Model tool ' + definition.modelName + ' is already registered.',
        );
      }
      this.toolsById.set(id, definition);
      this.toolsByModelName.set(definition.modelName, definition);
    }
  }

  list(): RuntimeToolDefinition[] {
    return [...this.toolsById.values()].filter(
      (definition) => definition.available?.() !== false,
    );
  }

  modelVisibleSpecs(): ModelToolSpec[] {
    return this.list().map((definition) => {
      assertStrictFunctionSchema(definition.parameters);
      return functionSpec(
        definition.modelName,
        definition.description,
        definition.parameters,
      );
    });
  }

  endTask(taskId: string): void {
    const prefix = taskId + ':';
    for (const callKey of this.resolvedCallIds) {
      if (callKey.startsWith(prefix)) this.resolvedCallIds.delete(callKey);
    }
  }

  resolve(
    call: AgentToolCall,
    context: ToolResolutionContext,
  ): ResolvedToolInvocation {
    const callKey = context.taskId + ':' + call.callId;
    if (this.resolvedCallIds.has(callKey)) {
      throw new Error('Model function call ' + call.callId + ' was already resolved.');
    }
    const definition = this.toolsByModelName.get(call.name);
    if (!definition || definition.available?.() === false) {
      throw new Error('Runtime model tool ' + call.name + ' is unavailable.');
    }
    const input = definition.parse(call.arguments);
    const invocation = definition.normalize(input, call, context);
    this.resolvedCallIds.add(callKey);
    return invocation;
  }

  supports(action: ProposedAction): boolean {
    const identity = toolIdentityForAction(action);
    const definition = this.list().find((tool) => tool.id === identity.toolId);
    return Boolean(definition?.operations.includes(identity.operation));
  }
}

export const defaultRuntimeToolRegistry = new RuntimeToolRegistry();
