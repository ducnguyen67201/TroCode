import { z } from 'zod';

import { RuntimeToolIdSchema } from '../../shared/contracts';

const CoordinateSchema = z.number().int().nonnegative().max(100_000);
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
      mimeType: z.string().regex(/^image\//u),
      dataBase64: z.string().min(1).max(40_000_000),
    })
    .optional(),
  coordinateSpace: DesktopCoordinateSpaceSchema.optional(),
  degraded: z.boolean(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
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
      Math.max(0, Math.round((value / NORMALIZED_COORDINATE_MAX) * extent)),
    );

  return {
    x: mapAxis(point.x, coordinateSpace.screenshotWidth),
    y: mapAxis(point.y, coordinateSpace.screenshotHeight),
  };
}
