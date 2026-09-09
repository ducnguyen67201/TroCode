import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  assertStrictFunctionSchema,
  jsonSchemaHasType,
  type JsonSchema,
  type StrictJsonObjectSchema,
} from '../../shared/agent-tool-contracts';

const NullableIntegerSchema = z.number().int().nullable();
const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const CuaDriverToolSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/u),
  modelName: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/u),
  description: z.string().trim().min(1).max(20_000),
  inputSchema: z.record(z.string().min(1).max(200), z.unknown()),
  driverInputSchema: z.record(z.string().min(1).max(200), z.unknown()),
  injectSession: z.boolean(),
  schemaAdaptation: z.enum(['none', 'legacy-v1']),
  schemaDialect: z.string().trim().min(1).max(200),
  schemaVersion: z.string().trim().min(1).max(100),
}).strict();

export const CuaDriverCatalogSchema = z.object({
  driverVersion: z.string().trim().min(1).max(100),
  contractVersion: z.string().trim().min(1).max(100),
  toolsListSchemaVersion: z.enum(['1', '2']),
  capabilityVersion: z.string().trim().min(1).max(100),
  driverCatalogDigest: DigestSchema,
  requiredTools: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,99}$/u)).max(128),
  tools: z.array(CuaDriverToolSchema).max(128),
}).strict();

export type CuaDriverCatalog = z.infer<typeof CuaDriverCatalogSchema>;

export const CuaDriverMetadataSchema = z.object({
  driverVersion: z.string().trim().min(1).max(100),
  contractVersion: z.string().trim().min(1).max(100),
  toolsListSchemaVersion: z.string().trim().min(1).max(100),
  capabilityVersion: z.string().trim().min(1).max(100),
}).passthrough();

const CuaToolInventoryEnvelopeSchema = z.object({
  capability_version: z.string().min(1).max(100),
  schema_version: z.string().min(1).max(100),
  tools: z.array(z.unknown()).max(128),
  requiredTools: z
    .array(z.string().regex(/^[a-z][a-z0-9_]{0,99}$/u))
    .max(128)
    .optional(),
}).passthrough();

export const CuaToolInventorySchema = CuaToolInventoryEnvelopeSchema;

const CuaLegacyToolSchema = z.object({
  capabilities: z.array(z.string().min(1).max(200)).max(100).default([]),
  description: z.string().min(1).max(100_000),
  inputSchema: z.record(z.string().min(1).max(200), z.unknown()),
  name: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/u),
}).passthrough();

const CuaDeclaredToolSchema = CuaLegacyToolSchema.extend({
  audience: z.enum(['host', 'model']),
  schemaDialect: z.string().trim().min(1).max(200),
  schemaVersion: z.string().trim().min(1).max(100),
  injectSession: z.boolean().optional().default(false),
  modelInputSchema: z
    .record(z.string().min(1).max(200), z.unknown())
    .optional(),
}).passthrough();

const CuaSemanticToolInventorySchema = z.object({
  capability_version: z.string().min(1).max(100),
  tools: z.array(
    z.object({
      name: z.string().min(1).max(200),
    }).passthrough(),
  ).max(128),
}).passthrough();

const HOST_OWNED_CAPABILITY_PREFIXES = [
  'session.lifecycle.',
  'system.config.',
] as const;

const RESERVED_HOST_TOOL_NAMES = new Set(['set_config']);

export const CUA_MODEL_SCHEMA_DIALECT = 'openai.function.strict' as const;
export const CUA_MODEL_SCHEMA_VERSION = '1' as const;

export interface CuaModelSchemaValidator {
  readonly dialect: string;
  readonly version: string;
  validate(schema: Record<string, unknown>): void;
}

export interface CuaCatalogToolDiagnostic {
  readonly code:
    | 'invalid_tool_contract'
    | 'invalid_model_schema'
    | 'reserved_host_tool'
    | 'unsupported_schema_dialect';
  readonly message: string;
  readonly name: string;
}

export interface CuaRequiredToolFailure {
  readonly code: 'incompatible_required_tool' | 'missing_required_tool';
  readonly message: string;
  readonly name: string;
}

export interface CuaDriverCatalogReport {
  readonly compatibilityMessages: string[];
  readonly hostOwnedTools: string[];
  readonly inventorySchemaVersion: string;
  readonly quarantinedTools: CuaCatalogToolDiagnostic[];
  readonly requiredToolFailures: CuaRequiredToolFailure[];
  readonly state: 'ready' | 'degraded' | 'unavailable';
}

export interface CuaDriverCatalogLoadResult {
  readonly catalog: CuaDriverCatalog | null;
  readonly report: CuaDriverCatalogReport;
}

export interface CuaDriverCatalogLoadOptions {
  readonly schemaValidators?: readonly CuaModelSchemaValidator[];
}

const OpenAiStrictFunctionSchemaValidator: CuaModelSchemaValidator = {
  dialect: CUA_MODEL_SCHEMA_DIALECT,
  version: CUA_MODEL_SCHEMA_VERSION,
  validate(schema) {
    assertStrictFunctionSchema(schema);
  },
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function modelNameForCuaTool(name: string): string {
  if (name.length <= 64) return name;
  const suffix = createHash('sha256').update(name).digest('hex').slice(0, 8);
  return `${name.slice(0, 55)}_${suffix}`;
}

function projectedInputSchema(
  value: Record<string, unknown>,
): { injectSession: boolean; schema: Record<string, unknown> } {
  if (value.type !== 'object' || !value.properties || Array.isArray(value.properties)) {
    throw new Error('CUA tool input schemas must be JSON object schemas.');
  }
  const schema = structuredClone(value);
  const properties = schema.properties as Record<string, unknown>;
  const injectSession = Object.hasOwn(properties, 'session');
  if (injectSession) {
    delete properties.session;
    if (Array.isArray(schema.required)) {
      schema.required = schema.required.filter((name) => name !== 'session');
    }
  }
  assertModelSchemaSize(schema);
  return { injectSession, schema };
}

function assertModelSchemaSize(schema: Record<string, unknown>): void {
  if (Buffer.byteLength(stableJson(schema), 'utf8') > 100_000) {
    throw new Error('CUA tool input schema exceeds the runtime catalog limit.');
  }
}

function legacyStrictify(input: Record<string, unknown>): StrictJsonObjectSchema {
  const cloned = legacyStrictNode(structuredClone(input));
  if (
    cloned.type !== 'object' ||
    !cloned.properties ||
    Array.isArray(cloned.properties)
  ) {
    throw new Error('CUA tool schemas must be JSON object schemas.');
  }
  assertStrictFunctionSchema(cloned);
  return cloned as StrictJsonObjectSchema;
}

function legacyStrictNode(input: unknown): JsonSchema {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const node = input as Record<string, unknown>;
  if (jsonSchemaHasType(node, 'object')) {
    const properties =
      node.properties &&
      typeof node.properties === 'object' &&
      !Array.isArray(node.properties)
        ? (node.properties as Record<string, unknown>)
        : {};
    const originallyRequired = new Set(
      Array.isArray(node.required)
        ? node.required.filter(
            (name): name is string => typeof name === 'string',
          )
        : [],
    );
    node.properties = Object.fromEntries(
      Object.entries(properties).map(([name, value]) => {
        const strict = legacyStrictNode(value);
        return [name, originallyRequired.has(name) ? strict : nullable(strict)];
      }),
    );
    node.required = Object.keys(properties);
    node.additionalProperties = false;
  }
  if (Array.isArray(node.items)) {
    node.items = node.items.map(legacyStrictNode);
  } else if (node.items) {
    node.items = legacyStrictNode(node.items);
  }
  for (const keyword of ['anyOf', 'oneOf', 'allOf'] as const) {
    if (Array.isArray(node[keyword])) {
      node[keyword] = node[keyword].map(legacyStrictNode);
    }
  }
  for (const keyword of ['$defs', 'definitions'] as const) {
    const definitions = node[keyword];
    if (
      !definitions ||
      typeof definitions !== 'object' ||
      Array.isArray(definitions)
    ) {
      continue;
    }
    node[keyword] = Object.fromEntries(
      Object.entries(definitions).map(([name, definition]) => [
        name,
        legacyStrictNode(definition),
      ]),
    );
  }
  if (
    node.additionalProperties &&
    typeof node.additionalProperties === 'object' &&
    !Array.isArray(node.additionalProperties)
  ) {
    node.additionalProperties = legacyStrictNode(node.additionalProperties);
  }
  return node;
}

function nullable(schema: JsonSchema): JsonSchema {
  if (jsonSchemaHasType(schema, 'null')) return schema;
  if (
    Array.isArray(schema.anyOf) &&
    schema.anyOf.some(
      (candidate) =>
        candidate &&
        typeof candidate === 'object' &&
        !Array.isArray(candidate) &&
        jsonSchemaHasType(candidate as Record<string, unknown>, 'null'),
    )
  ) {
    return schema;
  }
  return { anyOf: [schema, { type: 'null' }] };
}

function diagnosticName(value: unknown, index: number): string {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).name === 'string'
  ) {
    return String((value as Record<string, unknown>).name).slice(0, 100);
  }
  return `<tool:${index}>`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown catalog error.';
}

function unavailableCatalogResult(
  inventorySchemaVersion: string,
  message: string,
): CuaDriverCatalogLoadResult {
  return {
    catalog: null,
    report: {
      compatibilityMessages: [message],
      hostOwnedTools: [],
      inventorySchemaVersion,
      quarantinedTools: [],
      requiredToolFailures: [],
      state: 'unavailable',
    },
  };
}

export function loadCuaDriverCatalog(
  metadataValue: unknown,
  inventoryValue: unknown,
  options: CuaDriverCatalogLoadOptions = {},
): CuaDriverCatalogLoadResult {
  const metadataResult = CuaDriverMetadataSchema.safeParse(metadataValue);
  if (!metadataResult.success) {
    return unavailableCatalogResult(
      'unknown',
      'CUA driver metadata is not compatible with this TroCode build.',
    );
  }
  const inventoryResult = CuaToolInventoryEnvelopeSchema.safeParse(inventoryValue);
  if (!inventoryResult.success) {
    return unavailableCatalogResult(
      'unknown',
      'CUA tool inventory is malformed and cannot be admitted.',
    );
  }
  const metadata = metadataResult.data;
  const inventory = inventoryResult.data;
  if (!['1', '2'].includes(metadata.toolsListSchemaVersion)) {
    return unavailableCatalogResult(
      metadata.toolsListSchemaVersion,
      `CUA tool inventory schema ${metadata.toolsListSchemaVersion} is unsupported; TroCode supports schemas 1 and 2.`,
    );
  }
  if (
    inventory.schema_version !== metadata.toolsListSchemaVersion ||
    inventory.capability_version !== metadata.capabilityVersion
  ) {
    return unavailableCatalogResult(
      inventory.schema_version,
      'CUA tool inventory metadata does not match the driver contract.',
    );
  }
  if (inventory.schema_version === '2' && !inventory.requiredTools) {
    return unavailableCatalogResult(
      inventory.schema_version,
      'CUA tool inventory schema 2 must declare requiredTools explicitly.',
    );
  }
  const requiredTools = inventory.requiredTools ?? [];

  const validators = new Map<string, CuaModelSchemaValidator>();
  for (const validator of options.schemaValidators ?? [OpenAiStrictFunctionSchemaValidator]) {
    validators.set(`${validator.dialect}@${validator.version}`, validator);
  }
  const legacy = inventory.schema_version === '1';
  const compatibilityMessages = legacy
    ? [
        'CUA inventory schema 1 uses the reported legacy schema adapter; upgrade CUA Core to schema 2 for exact provider schemas.',
      ]
    : [];
  const hostOwnedTools: string[] = [];
  const quarantinedTools: CuaCatalogToolDiagnostic[] = [];
  const admittedTools: Array<z.infer<typeof CuaDriverToolSchema>> = [];
  const admittedNames = new Set<string>();
  const admittedModelNames = new Set<string>();
  const rawNames = new Set<string>();

  inventory.tools.forEach((rawTool, index) => {
    const name = diagnosticName(rawTool, index);
    const parsed = legacy
      ? CuaLegacyToolSchema.safeParse(rawTool)
      : CuaDeclaredToolSchema.safeParse(rawTool);
    if (!parsed.success) {
      quarantinedTools.push({
        code: 'invalid_tool_contract',
        message: `CUA tool ${name} has an invalid inventory contract.`,
        name,
      });
      return;
    }
    const tool = parsed.data;
    const declaredTool = legacy
      ? null
      : CuaDeclaredToolSchema.parse(rawTool);
    if (rawNames.has(tool.name)) {
      quarantinedTools.push({
        code: 'invalid_tool_contract',
        message: `CUA tool ${tool.name} is duplicated in the inventory.`,
        name: tool.name,
      });
      return;
    }
    rawNames.add(tool.name);

    const hostOwned = legacy
      ? tool.capabilities.some((capability) =>
          HOST_OWNED_CAPABILITY_PREFIXES.some((prefix) =>
            capability.startsWith(prefix),
          ),
        )
      : declaredTool?.audience === 'host';
    if (hostOwned) {
      hostOwnedTools.push(tool.name);
      return;
    }
    if (RESERVED_HOST_TOOL_NAMES.has(tool.name)) {
      hostOwnedTools.push(tool.name);
      quarantinedTools.push({
        code: 'reserved_host_tool',
        message: `CUA tool ${tool.name} is reserved for the host and cannot be exposed to the model.`,
        name: tool.name,
      });
      return;
    }

    try {
      const projected = legacy
        ? (() => {
            const projection = projectedInputSchema(tool.inputSchema);
            return { ...projection, driverSchema: projection.schema };
          })()
        : (() => {
            if (!declaredTool?.modelInputSchema) {
              throw new Error(
                'Schema-2 model tools must declare modelInputSchema.',
              );
            }
            return {
              driverSchema: structuredClone(tool.inputSchema),
              injectSession: declaredTool.injectSession,
              schema: structuredClone(declaredTool.modelInputSchema),
            };
          })();
      assertModelSchemaSize(projected.schema);
      assertModelSchemaSize(projected.driverSchema);
      if (
        !legacy &&
        projected.injectSession &&
        projected.schema.properties &&
        typeof projected.schema.properties === 'object' &&
        !Array.isArray(projected.schema.properties) &&
        Object.hasOwn(projected.schema.properties, 'session')
      ) {
        throw new Error(
          'Schema-2 model tools with injectSession must not expose the host-owned session property.',
        );
      }
      if (
        !legacy &&
        projected.injectSession &&
        (!projected.driverSchema.properties ||
          typeof projected.driverSchema.properties !== 'object' ||
          Array.isArray(projected.driverSchema.properties) ||
          !Object.hasOwn(projected.driverSchema.properties, 'session'))
      ) {
        throw new Error(
          'Schema-2 driver inputSchema must declare session when injectSession is enabled.',
        );
      }
      const schemaDialect = legacy
        ? CUA_MODEL_SCHEMA_DIALECT
        : (declaredTool?.schemaDialect ?? 'missing');
      const schemaVersion = legacy
        ? CUA_MODEL_SCHEMA_VERSION
        : (declaredTool?.schemaVersion ?? 'missing');
      const validator = validators.get(`${schemaDialect}@${schemaVersion}`);
      if (!validator) {
        quarantinedTools.push({
          code: 'unsupported_schema_dialect',
          message: `CUA tool ${tool.name} uses unsupported model schema ${schemaDialect}@${schemaVersion}.`,
          name: tool.name,
        });
        return;
      }
      const inputSchema = (() => {
        if (legacy) return legacyStrictify(projected.schema);
        const exact = structuredClone(projected.schema);
        const beforeValidation = stableJson(exact);
        validator.validate(exact);
        if (stableJson(exact) !== beforeValidation) {
          throw new Error('Model schema validators must not mutate schemas.');
        }
        assertStrictFunctionSchema(exact);
        return exact;
      })();
      const modelName = modelNameForCuaTool(tool.name);
      if (admittedNames.has(tool.name) || admittedModelNames.has(modelName)) {
        quarantinedTools.push({
          code: 'invalid_tool_contract',
          message: `CUA tool ${tool.name} collides with another admitted model tool.`,
          name: tool.name,
        });
        return;
      }
      admittedNames.add(tool.name);
      admittedModelNames.add(modelName);
      admittedTools.push({
        name: tool.name,
        modelName,
        description: tool.description.trim().slice(0, 20_000),
        driverInputSchema: projected.driverSchema,
        inputSchema,
        injectSession: projected.injectSession,
        schemaAdaptation: legacy ? 'legacy-v1' : 'none',
        schemaDialect,
        schemaVersion,
      });
    } catch (error) {
      quarantinedTools.push({
        code: 'invalid_model_schema',
        message: `CUA tool ${tool.name} has an invalid ${legacy ? 'legacy-adapted' : 'declared'} model schema: ${errorMessage(error)}`,
        name: tool.name,
      });
    }
  });

  const requiredToolFailures = requiredTools.flatMap(
    (name): CuaRequiredToolFailure[] => {
      if (admittedNames.has(name)) return [];
      const quarantined = quarantinedTools.find((tool) => tool.name === name);
      return [
        {
          code: quarantined
            ? 'incompatible_required_tool'
            : 'missing_required_tool',
          message: quarantined
            ? `Required CUA model tool ${name} is incompatible: ${quarantined.message}`
            : `Required CUA model tool ${name} is missing from the inventory.`,
          name,
        },
      ];
    },
  );
  const state =
    requiredToolFailures.length > 0
      ? 'unavailable'
      : compatibilityMessages.length > 0 || quarantinedTools.length > 0
        ? 'degraded'
        : 'ready';
  const report: CuaDriverCatalogReport = {
    compatibilityMessages,
    hostOwnedTools,
    inventorySchemaVersion: inventory.schema_version,
    quarantinedTools,
    requiredToolFailures,
    state,
  };
  if (state === 'unavailable') return { catalog: null, report };

  const digestPayload = {
    driverVersion: metadata.driverVersion,
    contractVersion: metadata.contractVersion,
    toolsListSchemaVersion: metadata.toolsListSchemaVersion,
    capabilityVersion: metadata.capabilityVersion,
    requiredTools,
    tools: admittedTools,
  };
  return {
    catalog: CuaDriverCatalogSchema.parse({
      ...digestPayload,
      driverCatalogDigest: createHash('sha256')
        .update(stableJson(digestPayload))
        .digest('hex'),
    }),
    report,
  };
}

export function createCuaDriverCatalog(
  metadataValue: unknown,
  inventoryValue: unknown,
): CuaDriverCatalog {
  const result = loadCuaDriverCatalog(metadataValue, inventoryValue);
  if (result.catalog) return result.catalog;
  const message =
    result.report.requiredToolFailures[0]?.message ??
    result.report.compatibilityMessages[0] ??
    'CUA tool catalog is unavailable.';
  throw new Error(message);
}

const WINDOW_DISCOVERY_TOOLS = ['list_windows', 'get_window_state'] as const;
const WINDOW_ACTION_TOOLS = ['click', 'type_text', 'press_key', 'scroll'] as const;
const BROWSER_STATE_TOOLS = ['get_browser_state'] as const;
const BROWSER_ACTION_TOOLS = [
  'browser_click',
  'browser_type',
  'browser_pointer',
] as const;

export const CuaSemanticCapabilitiesSchema = z.object({
  browserActions: z.boolean(),
  browserPrepare: z.boolean(),
  browserState: z.boolean(),
  capabilityVersion: z.string().max(100),
  verification: z.boolean(),
  windowActions: z.boolean(),
  windowState: z.boolean(),
});

export type CuaSemanticCapabilities = z.infer<
  typeof CuaSemanticCapabilitiesSchema
>;

export function deriveCuaSemanticCapabilities(
  inventoryValue: unknown,
): CuaSemanticCapabilities {
  const inventory = CuaSemanticToolInventorySchema.parse(inventoryValue);
  const names = new Set(inventory.tools.map((tool) => tool.name));
  const hasAll = (required: readonly string[]): boolean =>
    required.every((name) => names.has(name));

  return CuaSemanticCapabilitiesSchema.parse({
    browserActions: hasAll(BROWSER_ACTION_TOOLS),
    browserPrepare: names.has('browser_prepare'),
    browserState: hasAll(BROWSER_STATE_TOOLS),
    capabilityVersion: inventory.capability_version,
    verification: names.has('verify_state'),
    windowActions: hasAll(WINDOW_ACTION_TOOLS),
    windowState: hasAll(WINDOW_DISCOVERY_TOOLS),
  });
}
// Native discovery can include zero-size windows; selection excludes them before observation or input.
export const CuaBoundsSchema = z.object({
  x: z.number().finite().min(-100_000).max(100_000),
  y: z.number().finite().min(-100_000).max(100_000),
  width: z.number().finite().nonnegative().max(100_000),
  height: z.number().finite().nonnegative().max(100_000),
}).passthrough();

export const CuaWindowSchema = z.object({
  window_id: z.number().int().nonnegative(),
  pid: z.number().int().positive(),
  app_name: z.string().max(500).default('Application'),
  title: z.string().max(8_000).default(''),
  bounds: CuaBoundsSchema,
  z_index: NullableIntegerSchema.optional().default(null),
  is_on_screen: z.boolean().optional().default(true),
  on_current_space: z.boolean().optional().default(true),
}).passthrough();

export const CuaWindowListSchema = z.object({
  windows: z.array(CuaWindowSchema).max(2_000),
}).passthrough();

const ElementFrameSchema = z.object({
  x: z.number().finite().min(-100_000).max(100_000),
  y: z.number().finite().min(-100_000).max(100_000),
  w: z.number().finite().min(0).max(100_000),
  h: z.number().finite().min(0).max(100_000),
}).passthrough();

export const CuaWindowElementSchema = z.object({
  element_index: z.number().int().nonnegative(),
  element_token: z.string().min(1).max(4_000).optional(),
  role: z.string().max(500).default('element'),
  label: z.string().max(8_000).nullish(),
  name: z.string().max(8_000).nullish(),
  value: z.union([z.string().max(100_000), z.number(), z.boolean()]).nullish(),
  frame: ElementFrameSchema.optional(),
  parent_index: NullableIntegerSchema.optional(),
  depth: z.number().int().nonnegative().max(100).optional(),
  enabled: z.boolean().optional(),
  disabled: z.boolean().optional(),
  selected: z.boolean().optional(),
}).passthrough();

export const CuaWindowStateSchema = z.object({
  snapshot_id: z.string().min(1).max(200),
  tree_markdown: z.string().max(500_000).default(''),
  elements: z.array(CuaWindowElementSchema).max(2_000).default([]),
  element_count: z.number().int().nonnegative().optional(),
  filtered_element_count: z.number().int().nonnegative().optional(),
  degraded_reason: z.string().max(500).nullish(),
}).passthrough();

const BrowserBoundsSchema = z.object({
  x: z.number().finite().min(-100_000).max(100_000),
  y: z.number().finite().min(-100_000).max(100_000),
  width: z.number().finite().min(0).max(100_000),
  height: z.number().finite().min(0).max(100_000),
}).passthrough();

export const CuaBrowserElementSchema = z.object({
  ref: z.string().min(1).max(4_000),
  role: z.string().max(500).default('element'),
  name: z.string().max(8_000).nullish(),
  label: z.string().max(8_000).nullish(),
  text: z.string().max(100_000).nullish(),
  value: z.union([z.string().max(100_000), z.number(), z.boolean()]).nullish(),
  href: z.string().max(8_000).nullish(),
  bounds: BrowserBoundsSchema.optional(),
  disabled: z.boolean().optional(),
  selected: z.boolean().optional(),
  capabilities: z.array(z.string().max(100)).max(50).optional(),
}).passthrough();

/**
 * CUA 0.19.3 keeps browser semantic output intentionally extensible. These
 * aliases cover the released names while preserving strict bounds on values
 * Tro consumes.
 */
export const CuaBrowserStateSchema = z.object({
  target_id: z.string().min(1).max(4_000),
  tab_id: z.string().min(1).max(4_000),
  snapshot_id: z.string().min(1).max(500).optional(),
  state_version: z.string().min(1).max(500).optional(),
  url: z.string().max(8_000).optional(),
  title: z.string().max(8_000).optional(),
  text: z.string().max(500_000).optional(),
  tree_markdown: z.string().max(500_000).optional(),
  elements: z.array(CuaBrowserElementSchema).max(2_000).optional(),
  refs: z.array(CuaBrowserElementSchema).max(2_000).optional(),
  degraded_reason: z.string().max(500).nullish(),
  continuation: z.string().max(8_000).nullish(),
}).passthrough();

export const CuaActionStructuredSchema = z.object({
  effect: z.enum([
    'confirmed',
    'partial',
    'unverifiable',
    'suspected_noop',
    'refused',
  ]).optional(),
  route: z.string().max(100).optional(),
  code: z.string().max(500).optional(),
  status: z.string().max(500).optional(),
  refusal: z.union([
    z.string().max(2_000),
    z.object({
      code: z.string().max(500).optional(),
      reason: z.string().max(2_000).optional(),
    }).passthrough(),
  ]).optional(),
}).passthrough();

export interface CuaOpenToolResult {
  action?: { effect: number; route: number };
  degraded: boolean;
  errorCode?: string;
  images: Array<{ dataBase64: string; mimeType: string }>;
  isError: boolean;
  rawJson: string;
  structuredJson?: string;
  text: string;
}

export type NormalizedCuaActionEffect =
  | 'confirmed'
  | 'partial'
  | 'unverifiable'
  | 'suspected_noop'
  | 'refused';

export function normalizedCuaActionEffect(
  result: CuaOpenToolResult,
): NormalizedCuaActionEffect | undefined {
  if (result.structuredJson || result.rawJson) {
    try {
      const effect = parseCuaStructuredResult(
        result,
        CuaActionStructuredSchema,
      ).effect;
      if (effect) return effect;
    } catch {
      // Fall through to the generated numeric ActionEffect contract.
    }
  }
  return result.action?.effect === 0
    ? 'confirmed'
    : result.action?.effect === 1
      ? 'partial'
      : result.action?.effect === 2
        ? 'unverifiable'
        : result.action?.effect === 3
          ? 'suspected_noop'
          : result.action?.effect === 4
            ? 'refused'
            : undefined;
}

export function parseCuaStructuredResult<T>(
  result: Pick<CuaOpenToolResult, 'rawJson' | 'structuredJson'>,
  schema: z.ZodType<T>,
): T {
  const source = result.structuredJson ?? result.rawJson;
  if (Buffer.byteLength(source, 'utf8') > 2_000_000) {
    throw new Error('CUA returned structured JSON above the 2 MB boundary.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error('CUA returned malformed structured JSON.');
  }
  return schema.parse(parsed);
}

export type CuaBrowserElement = z.infer<typeof CuaBrowserElementSchema>;
export type CuaBrowserState = z.infer<typeof CuaBrowserStateSchema>;
export type CuaWindow = z.infer<typeof CuaWindowSchema>;
export type CuaWindowElement = z.infer<typeof CuaWindowElementSchema>;
export type CuaWindowState = z.infer<typeof CuaWindowStateSchema>;

export type TrustedApplicationIdentity = 'chrome';

export interface VisibleApplicationSurface {
  application: TrustedApplicationIdentity;
  observationFingerprint: string;
  observationId: string;
  observedAt: string;
}
