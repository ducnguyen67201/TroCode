import { z } from 'zod';

import { RuntimeToolIdSchema } from '../../shared/contracts';

const CoordinateSchema = z.number().int().nonnegative().max(100_000);
const SpreadsheetRowsSchema = z
  .array(z.array(z.string().max(8_000)).min(1).max(50))
  .min(1)
  .max(200)
  .superRefine((rows, context) => {
    const columnCount = rows[0]?.length ?? 0;
    for (const [rowIndex, row] of rows.entries()) {
      if (row.length !== columnCount) {
        context.addIssue({
          code: 'custom',
          message: 'Every spreadsheet row must contain the same number of cells.',
          path: [rowIndex],
        });
      }
    }
    if (tableRowsToTsv(rows).length > 100_000) {
      context.addIssue({
        code: 'custom',
        message: 'Spreadsheet table data cannot exceed 100,000 characters.',
      });
    }
  });
const DirectToolInputSchema = z
  .record(
    z.string().min(1).max(100),
    z.union([
      z.string().max(100_000),
      z.array(z.string().max(8_000)).max(100),
    ]),
  )
  .refine((input) => Object.keys(input).length <= 64, {
    message: 'A direct tool call cannot contain more than 64 fields.',
  });

export const NORMALIZED_COORDINATE_MAX = 1_000;

const ScreenOriginSchema = z.number().int().min(-100_000).max(100_000);

export const DesktopCoordinateSpaceSchema = z.object({
  screenHeight: z.number().int().positive().max(100_000),
  screenWidth: z.number().int().positive().max(100_000),
  screenX: ScreenOriginSchema.optional(),
  screenY: ScreenOriginSchema.optional(),
  screenshotHeight: z.number().int().positive().max(100_000),
  screenshotWidth: z.number().int().positive().max(100_000),
});

export const ComputerObservationRouteSchema = z.enum([
  'browser_semantic',
  'window_accessibility',
  'window_vision',
  'desktop_vision',
]);

export const SurfaceBoundsSchema = z.object({
  x: z.number().int().min(-100_000).max(100_000),
  y: z.number().int().min(-100_000).max(100_000),
  width: z.number().int().positive().max(100_000),
  height: z.number().int().positive().max(100_000),
});

export const SurfaceDescriptorSchema = z.object({
  kind: z.enum(['browser', 'code_editor', 'native_app', 'desktop']),
  application: z.string().trim().min(1).max(120),
  title: z.string().max(500).optional(),
  url: z.string().max(8_000).optional(),
  bounds: SurfaceBoundsSchema.optional(),
  deepAccess: z.enum(['ready', 'available_requires_approval', 'unavailable']).optional(),
});

export const SurfaceElementSchema = z.object({
  ref: z.string().regex(/^e[1-9][0-9]{0,3}$/u),
  role: z.string().max(120),
  name: z.string().max(2_000),
  value: z.string().max(8_000).optional(),
  href: z.string().max(8_000).optional(),
  bounds: SurfaceBoundsSchema.optional(),
  disabled: z.boolean().optional(),
  selected: z.boolean().optional(),
});

export const DesktopObservationSchema = z.object({
  observationId: z.string().uuid(),
  taskId: z.string().uuid(),
  capturedAt: z.string().datetime(),
  text: z.string().max(100_000),
  structuredState: z.string().max(500_000).optional(),
  screenshot: z
    .object({
      mimeType: z.string().regex(/^image\//u),
      dataBase64: z.string().min(1).max(40_000_000),
    })
    .optional(),
  coordinateSpace: DesktopCoordinateSpaceSchema.optional(),
  route: ComputerObservationRouteSchema.default('desktop_vision'),
  surface: SurfaceDescriptorSchema.optional(),
  elements: z.array(SurfaceElementSchema).max(400).optional(),
  degraded: z.boolean(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
});

export const SurfaceCommandSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('click_element'),
    ref: z.string().regex(/^e[1-9][0-9]{0,3}$/u),
    button: z.enum(['left', 'right']).default('left'),
    count: z.number().int().min(1).max(2).default(1),
  }),
  z.object({
    kind: z.literal('type_text'),
    ref: z.string().regex(/^e[1-9][0-9]{0,3}$/u),
    text: z.string().max(100_000),
    replace: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal('press_key'),
    ref: z.string().regex(/^e[1-9][0-9]{0,3}$/u).nullable(),
    key: z.string().trim().min(1).max(40),
    modifiers: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
  }),
  z.object({
    kind: z.literal('scroll'),
    ref: z.string().regex(/^e[1-9][0-9]{0,3}$/u).nullable(),
    direction: z.enum(['up', 'down', 'left', 'right']),
    amount: z.number().int().min(1).max(20).default(3),
  }),
]);

export const SurfaceActionOutcomeSchema = z.object({
  status: z.enum(['confirmed', 'unknown', 'failed', 'not_executed']),
  summary: z.string().min(1).max(2_000),
  observation: z.lazy(() => DesktopObservationSchema).optional(),
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
    kind: z.literal('drag'),
    fromX: CoordinateSchema,
    fromY: CoordinateSchema,
    toX: CoordinateSchema,
    toY: CoordinateSchema,
    durationMs: z.number().int().min(50).max(10_000).default(500),
    button: z.enum(['left', 'right', 'middle']).default('left'),
  }),
  z.object({
    kind: z.literal('direct_tool'),
    toolId: RuntimeToolIdSchema,
    operation: z.string().trim().min(1).max(100),
    input: DirectToolInputSchema,
  }),
  z.object({
    kind: z.literal('type_text'),
    text: z.string().min(1).max(100_000),
  }),
  z.object({
    kind: z.literal('paste_table'),
    rows: SpreadsheetRowsSchema,
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

export const DesktopActionOutcomeSchema = z.object({
  status: z.enum(['confirmed', 'unknown', 'failed']),
  summary: z.string().min(1).max(2_000),
});

export type DesktopActionOutcome = z.infer<typeof DesktopActionOutcomeSchema>;
export type DesktopCommand = z.infer<typeof DesktopCommandSchema>;
export type DesktopCoordinateSpace = z.infer<
  typeof DesktopCoordinateSpaceSchema
>;
export type DesktopObservation = z.infer<typeof DesktopObservationSchema>;
export type ComputerObservationRoute = z.infer<
  typeof ComputerObservationRouteSchema
>;
export type SurfaceActionOutcome = z.infer<typeof SurfaceActionOutcomeSchema>;
export type SurfaceBounds = z.infer<typeof SurfaceBoundsSchema>;
export type SurfaceCommand = z.infer<typeof SurfaceCommandSchema>;
export type SurfaceDescriptor = z.infer<typeof SurfaceDescriptorSchema>;
export type SurfaceElement = z.infer<typeof SurfaceElementSchema>;

export function tableRowsToTsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((row) =>
      row.map((cell) => cell.replace(/[\t\r\n]+/gu, ' ')).join('\t'),
    )
    .join('\n');
}

export interface DesktopRegion {
  height: number;
  width: number;
  x: number;
  y: number;
}

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
    x:
      (coordinateSpace.screenX ?? 0) +
      mapScreenshotAxis(
        point.x,
        coordinateSpace.screenshotWidth,
        coordinateSpace.screenWidth,
      ),
    y:
      (coordinateSpace.screenY ?? 0) +
      mapScreenshotAxis(
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
      Math.max(0, Math.round((value / NORMALIZED_COORDINATE_MAX) * extent)),
    );

  return {
    x: mapAxis(point.x, coordinateSpace.screenshotWidth),
    y: mapAxis(point.y, coordinateSpace.screenshotHeight),
  };
}

function mapRegion(
  region: DesktopRegion,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): DesktopRegion {
  const x = mapScreenshotAxis(region.x, sourceWidth, targetWidth);
  const y = mapScreenshotAxis(region.y, sourceHeight, targetHeight);
  const width = Math.min(
    targetWidth - x,
    Math.max(1, Math.round((region.width / sourceWidth) * targetWidth)),
  );
  const height = Math.min(
    targetHeight - y,
    Math.max(1, Math.round((region.height / sourceHeight) * targetHeight)),
  );
  return { x, y, width, height };
}

export function mapNormalizedRegionToScreenshot(
  region: DesktopRegion,
  coordinateSpace: DesktopCoordinateSpace,
): DesktopRegion {
  return mapRegion(
    region,
    NORMALIZED_COORDINATE_MAX,
    NORMALIZED_COORDINATE_MAX,
    coordinateSpace.screenshotWidth,
    coordinateSpace.screenshotHeight,
  );
}

export function mapScreenshotRegionToDesktop(
  region: DesktopRegion,
  coordinateSpace: DesktopCoordinateSpace | undefined,
): DesktopRegion {
  if (!coordinateSpace) return { ...region };
  const mapped = mapRegion(
    region,
    coordinateSpace.screenshotWidth,
    coordinateSpace.screenshotHeight,
    coordinateSpace.screenWidth,
    coordinateSpace.screenHeight,
  );
  return {
    ...mapped,
    x: mapped.x + (coordinateSpace.screenX ?? 0),
    y: mapped.y + (coordinateSpace.screenY ?? 0),
  };
}
