import { z } from 'zod';

import { objectSchema } from '../../shared/agent-tool-contracts';
import { ProposedActionSchema } from '../../shared/contracts';

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

const ModelSurfaceCommandSchema = z.discriminatedUnion('kind', [
  z.object({
    deliveryMode: z.enum(['foreground', 'background']).nullish(),
    kind: z.literal('click_element'),
    ref: z.string().regex(/^e[1-9][0-9]{0,3}$/u),
    button: z.enum(['left', 'right']),
    count: z.number().int().min(1).max(2),
  }),
  z.object({
    deliveryMode: z.enum(['foreground', 'background']).nullish(),
    kind: z.literal('type_text'),
    ref: z.string().regex(/^e[1-9][0-9]{0,3}$/u),
    text: z.string().max(100_000),
    replace: z.boolean(),
  }),
  z.object({
    deliveryMode: z.enum(['foreground', 'background']).nullish(),
    kind: z.literal('press_key'),
    ref: z.string().regex(/^e[1-9][0-9]{0,3}$/u).nullable(),
    key: z.string().trim().min(1).max(40),
    modifiers: z.array(z.string().trim().min(1).max(40)).max(8),
  }),
  z.object({
    deliveryMode: z.enum(['foreground', 'background']).nullish(),
    kind: z.literal('scroll'),
    ref: z.string().regex(/^e[1-9][0-9]{0,3}$/u).nullable(),
    direction: z.enum(['up', 'down', 'left', 'right']),
    amount: z.number().int().min(1).max(20),
  }),
]);

const SurfaceControlInputSchema = z.object({
  observationId: z.string().uuid(),
  description: z.string().trim().min(1).max(2_000),
  target: z.string().trim().min(1).max(8_000).nullable(),
  command: ModelSurfaceCommandSchema,
});

const ObservationRegionSchema = z.object({
  x: z.number().int().min(0).max(999),
  y: z.number().int().min(0).max(999),
  width: z.number().int().min(1).max(1_000),
  height: z.number().int().min(1).max(1_000),
}).strict();

const ObserveContextInputSchema = z.object({
  operation: z.enum(['observe', 'inspect_surface_region']),
  scope: z.enum(['auto', 'desktop']).nullable(),
  reason: z.string().trim().min(1).max(500).nullable(),
  query: z.string().trim().min(1).max(500).nullable(),
  observationId: z.string().uuid().nullable(),
  region: ObservationRegionSchema.nullable(),
}).strict().superRefine((value, context) => {
  if (value.operation === 'observe') {
    if (!value.scope) {
      context.addIssue({
        code: 'custom',
        message: 'Context observation requires an auto or desktop scope.',
        path: ['scope'],
      });
    }
    if (!value.reason) {
      context.addIssue({
        code: 'custom',
        message: 'Context observation requires a reason.',
        path: ['reason'],
      });
    }
    if (value.observationId || value.region) {
      context.addIssue({
        code: 'custom',
        message: 'A fresh observation cannot include an observationId or region.',
      });
    }
    return;
  }
  if (!value.observationId || !value.region) {
    context.addIssue({
      code: 'custom',
      message: 'Image inspection requires observationId and region.',
    });
  }
  if (value.scope || value.query) {
    context.addIssue({
      code: 'custom',
      message: 'Image inspection requires null scope and query.',
    });
  }
});

const PrepareBrowserInputSchema = z.object({
  observationId: z.string().uuid(),
  reason: z.string().trim().min(1).max(2_000),
});

export interface ObserveContextToolInput {
  observationId: string | null;
  operation: 'inspect_surface_region' | 'observe';
  query: string | null;
  reason: string | null;
  region: { height: number; width: number; x: number; y: number } | null;
  scope: 'auto' | 'desktop' | null;
}

export interface SurfaceControlToolInput {
  command: SurfaceCommand;
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

const deliveryModeParameter = {
  anyOf: [{ type: 'string', enum: ['foreground', 'background'] }, { type: 'null' }],
  description: 'Native window input delivery. Null uses foreground. Observe an unverified result before deciding any next action; never blindly repeat it.',
};

const nullableRef = {
  anyOf: [
    { type: 'string', pattern: '^e[1-9][0-9]{0,3}$' },
    { type: 'null' },
  ],
};

const clickModelSchema = objectSchema(
  {
    deliveryMode: deliveryModeParameter,
    kind: { type: 'string', const: 'click_element' },
    ref: { type: 'string', pattern: '^e[1-9][0-9]{0,3}$' },
    button: { type: 'string', enum: ['left', 'right'] },
    count: { type: 'integer', minimum: 1, maximum: 2 },
  },
  ['deliveryMode', 'kind', 'ref', 'button', 'count'],
);
const typeModelSchema = objectSchema(
  {
    deliveryMode: deliveryModeParameter,
    kind: { type: 'string', const: 'type_text' },
    ref: { type: 'string', pattern: '^e[1-9][0-9]{0,3}$' },
    text: { type: 'string', maxLength: 100_000 },
    replace: { type: 'boolean' },
  },
  ['deliveryMode', 'kind', 'ref', 'text', 'replace'],
);
const keyModelSchema = objectSchema(
  {
    deliveryMode: deliveryModeParameter,
    kind: { type: 'string', const: 'press_key' },
    ref: nullableRef,
    key: { type: 'string', minLength: 1, maxLength: 40 },
    modifiers: {
      type: 'array',
      maxItems: 8,
      items: { type: 'string', minLength: 1, maxLength: 40 },
    },
  },
  ['deliveryMode', 'kind', 'ref', 'key', 'modifiers'],
);
const scrollModelSchema = objectSchema(
  {
    deliveryMode: deliveryModeParameter,
    kind: { type: 'string', const: 'scroll' },
    ref: nullableRef,
    direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
    amount: { type: 'integer', minimum: 1, maximum: 20 },
  },
  ['deliveryMode', 'kind', 'ref', 'direction', 'amount'],
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
          clickModelSchema,
          typeModelSchema,
          keyModelSchema,
          scrollModelSchema,
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

function normalizeCommand(
  command: z.infer<typeof ModelSurfaceCommandSchema>,
): SurfaceCommand {
  return SurfaceCommandSchema.parse({ ...command, deliveryMode: command.deliveryMode ?? undefined });
}

function actionParameters(
  observation: DesktopObservation,
  element: SurfaceElement | undefined,
  command: SurfaceCommand,
): Record<string, string | string[]> {
  const parameters: Record<string, string | string[]> = {
    command: command.kind,
    deliveryMode: command.deliveryMode ?? 'foreground',
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
  return parameters;
}

export function createCuaSemanticToolDefinitions(
  options: CuaSemanticToolOptions,
): RuntimeToolDefinition[] {
  const definitions: RuntimeToolDefinition[] = [
    {
      id: 'computer.observe',
      modelName: 'observe_context',
      description:
        'Observe visible context without bringing Tro forward. Use operation observe with scope auto to understand the current non-Tro application, or scope desktop when coordinate-space evidence is required. Use inspect_surface_region only to inspect a bounded region of the latest observation.',
      operations: ['observe', 'inspect_surface_region'],
      parameters: objectSchema(
        {
          operation: {
            type: 'string',
            enum: ['observe', 'inspect_surface_region'],
          },
          scope: {
            anyOf: [
              { type: 'string', enum: ['auto', 'desktop'] },
              { type: 'null' },
            ],
          },
          reason: {
            anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }],
          },
          query: {
            anyOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }],
          },
          observationId: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
          },
          region: {
            anyOf: [
              {
                type: 'object',
                properties: {
                  x: { type: 'integer', minimum: 0, maximum: 999 },
                  y: { type: 'integer', minimum: 0, maximum: 999 },
                  width: { type: 'integer', minimum: 1, maximum: 1000 },
                  height: { type: 'integer', minimum: 1, maximum: 1000 },
                },
                required: ['x', 'y', 'width', 'height'],
                additionalProperties: false,
              },
              { type: 'null' },
            ],
          },
        },
        ['operation', 'scope', 'reason', 'query', 'observationId', 'region'],
      ),
      parse: (value) => parseJson(ObserveContextInputSchema, value),
      normalize: (input: ObserveContextToolInput, call: AgentToolCall) => ({
        callId: call.callId,
        input,
        kind: 'observe',
        modelName: call.name,
        operation: input.operation,
        toolId: 'computer.observe',
      }),
    },
    {
      id: 'computer.control',
      modelName: 'control_surface',
      description:
        'Execute one exact click, type, key, or scroll action using an opaque ref from the latest observe_context result when its route is semantic or window-based. Set description to one concise user-facing sentence stating what will happen; the host shows it immediately before execution. Use desktop control when the observation route is desktop vision.',
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
        const command = normalizeCommand(input.command);
        const publicRef = 'ref' in command && command.ref ? command.ref : undefined;
        const element = elementFor(observation, publicRef);
        const action = ProposedActionSchema.parse({
          action: command.kind,
          toolId: 'computer.control',
          operation: command.kind,
          description: input.description,
          ...(input.target ? { target: input.target } : {}),
          parameters: actionParameters(observation, element, command),
        });
        return {
          action,
          callId: call.callId,
          input: {
            command,
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
        'Prepare CUA access to the exact current logged-in Chromium profile when observe_context reports that deeper browser access is ready to prepare.',
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
          observation.surface.deepAccess !== 'ready_to_prepare'
        ) {
          throw new Error(
            'The current observation is not ready for browser-profile preparation.',
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
  return definitions;
}
