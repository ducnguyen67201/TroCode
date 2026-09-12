import { DesktopActionOutcomeSchema, type DesktopActionOutcome } from '../agent/execution-contracts';

export function desktopActionOutcome(kind: string, result: { isError: boolean; text?: string; errorCode?: string | null; action?: { effect: number } | null }): DesktopActionOutcome {
    let outcome: DesktopActionOutcome;
    if (result.isError) {
      outcome = DesktopActionOutcomeSchema.parse({
        status: 'failed',
        summary:
          result.text || result.errorCode || 'The desktop action was refused.',
      });
    } else if (result.action?.effect === 0) {
      outcome = DesktopActionOutcomeSchema.parse({
        status: 'confirmed',
        summary: result.text || 'CUA confirmed the desktop action.',
      });
    } else if (result.action?.effect === 4) {
      outcome = DesktopActionOutcomeSchema.parse({
        status: 'failed',
        summary: result.text || 'CUA refused the desktop action.',
      });
    } else if (kind === 'point') {
      outcome = DesktopActionOutcomeSchema.parse({
        status: 'confirmed',
        summary:
          result.text || 'CUA delivered the non-clicking pointer guidance.',
      });
    } else {
      outcome = DesktopActionOutcomeSchema.parse({
        status: 'unknown',
        ...(['click', 'keypress', 'scroll'].includes(kind) &&
          (result.action?.effect === 2 || result.action?.effect === 3) ? { recovery: 'observe' as const } : {}),
        summary:
          result.text ||
          'CUA could not confirm whether the desktop action changed the screen.',
      });
    }
    return outcome;
}
