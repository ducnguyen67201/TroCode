export const COACH_GENERATED_COPY_LIMITS = {
  hook: 36,
  instruction: 76,
  reason: 46,
} as const;

export function coachDecisionJsonSchema(maxSteps: number): Record<string, unknown> {
  const closed = (properties: Record<string, unknown>, required: string[]) => ({
    type: 'object',
    additionalProperties: false,
    properties,
    required,
  });
  const point = closed(
    {
      x: { type: 'integer', minimum: 0, maximum: 1_000 },
      y: { type: 'integer', minimum: 0, maximum: 1_000 },
    },
    ['x', 'y'],
  );
  const nullable = (schema: Record<string, unknown>) => ({
    anyOf: [schema, { type: 'null' }],
  });
  const sequenceStep = closed(
    {
      hook: { type: 'string', maxLength: COACH_GENERATED_COPY_LIMITS.hook },
      instruction: { type: 'string', maxLength: COACH_GENERATED_COPY_LIMITS.instruction },
      reason: { type: 'string', maxLength: COACH_GENERATED_COPY_LIMITS.reason },
      expectedOutcome: { type: 'string', maxLength: 160 },
      target: { type: 'string', maxLength: 80 },
      point,
    },
    ['hook', 'instruction', 'reason', 'expectedOutcome', 'target', 'point'],
  );
  const properties = {
    kind: { type: 'string', enum: ['answer', 'coach_sequence', 'complete'] },
    text: nullable({ type: 'string', maxLength: 1_200 }),
    language: nullable({ type: 'string', enum: ['en', 'vi'] }),
    observationId: nullable({
      type: 'string',
      pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    }),
    observationFingerprint: nullable({ type: 'string', pattern: '^[a-f0-9]{64}$' }),
    steps: nullable({
      type: 'array',
      items: sequenceStep,
      minItems: 1,
      maxItems: maxSteps,
    }),
    recap: nullable({ type: 'string', maxLength: 240 }),
  };
  return closed(properties, Object.keys(properties));
}
