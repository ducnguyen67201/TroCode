import { z } from 'zod';

const NullableIntegerSchema = z.number().int().nullable();

export const CuaDriverMetadataSchema = z.object({
  driverVersion: z.string().min(1).max(100),
  contractVersion: z.string().min(1).max(100),
  toolsListSchemaVersion: z.string().min(1).max(100),
  capabilityVersion: z.string().min(1).max(100),
}).passthrough();

export const CuaToolInventorySchema = z.object({
  capability_version: z.string().min(1).max(100),
  schema_version: z.string().min(1).max(100),
  tools: z.array(
    z.object({
      name: z.string().min(1).max(200),
    }).passthrough(),
  ).max(500),
}).passthrough();

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
  const inventory = CuaToolInventorySchema.parse(inventoryValue);
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

export const CuaBoundsSchema = z.object({
  x: z.number().finite().min(-100_000).max(100_000),
  y: z.number().finite().min(-100_000).max(100_000),
  width: z.number().finite().positive().max(100_000),
  height: z.number().finite().positive().max(100_000),
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
