import type { AppLanguage, TaskSnapshot } from '../../../shared/contracts';
import { translate } from '../../app-language';
import {
  computerPermissionWaitPresentation,
  isTaskSteerable,
  isTaskTerminal,
} from '../../task-execution';

import { formatLabel } from './task-presentation';

export function taskView(
  snapshot: TaskSnapshot | null,
  appLanguage: AppLanguage,
) {
  const t = (message: string) => translate(appLanguage, message);
  const pendingInteraction = snapshot?.pendingInteraction ?? null;

  const permissionWait =
    snapshot?.lifecycle?.waitingOn?.kind === 'permission'
      ? snapshot.lifecycle.waitingOn
      : null;

  const permissionPresentation = permissionWait
    ? computerPermissionWaitPresentation(permissionWait.requiredPermissions)
    : null;

  const pendingClarification =
    pendingInteraction?.kind === 'clarification' ? pendingInteraction : null;

  const isSteering = isTaskSteerable(snapshot);

  const taskPhase = snapshot
    ? formatLabel(snapshot.phase, appLanguage)
    : t('No active task');

  const isTerminalTask = isTaskTerminal(snapshot);

  const hasLiveTask = snapshot !== null && !isTerminalTask;

  const hero = pendingInteraction
    ? {
        state: 'interaction',
        eyebrow: t('Your move'),
        heading: t('A clarification is waiting.'),
        description: t(
          'Answer the question below so Tro can continue toward the goal.',
        ),
      }
    : hasLiveTask
      ? {
          state: 'active',
          eyebrow: t('In motion'),
          heading: t('Keep the outcome in view.'),
          description: t(
            'Follow the live signal, steer the next safe step, or stop the task at any time.',
          ),
        }
      : isTerminalTask
        ? {
            state: 'terminal',
            eyebrow: t('Outcome recorded'),
            heading: t('What should we do next?'),
            description: t(
              'The finished task is now in your session trail. Start another outcome whenever you are ready.',
            ),
          }
        : {
            state: 'empty',
            eyebrow: t('Outcome first'),
            heading: t('What should we accomplish?'),
            description: t(
              'Describe the finish line. Tro will choose the appropriate tools and verify the result.',
            ),
          };
  return {
    pendingInteraction,
    permissionWait,
    permissionPresentation,
    pendingClarification,
    isSteering,
    taskPhase,
    isTerminalTask,
    hasLiveTask,
    hero,
  };
}
