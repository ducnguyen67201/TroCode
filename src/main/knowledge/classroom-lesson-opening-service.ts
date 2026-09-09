import { setTimeout as delay } from 'node:timers/promises';

import type { LessonLocalState } from '../../shared/classroom-lesson-contracts';
import type { CuaService } from '../cua/cua-service';

import { LessonBlockedError } from './classroom-lesson-errors';
import type { ClassroomLessonSurfaceService } from './classroom-lesson-surface-service';
import { isMaterialAppChooser, materialChooserAction } from './classroom-material-chooser-policy';

/** Computer-use continuation of a host-authorized open; it cannot launch another file. */
export class ClassroomLessonOpeningService {
  constructor(private readonly options: {
    surfaces: Pick<ClassroomLessonSurfaceService, 'inspectOpening'>;
    cua: Pick<CuaService, 'executeSurfaceCommand'>;
    authorize(): Promise<void>;
    consume(kind: 'action' | 'observation'): Promise<void>;
    wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  }) {}

  async complete(state: LessonLocalState, filename: string | undefined, signal: AbortSignal,
    recordEffect: (effect: LessonLocalState['effect']) => Promise<void>) {
    let selectedApp: string | undefined;
    let chooserSeen = false;
    let lastStage = '';
    const delivered = new Set<string>();
    const wait = this.options.wait ?? ((ms, abort) => delay(ms, undefined, { signal: abort }));
    // Leave observations available for the explanation; waiting does not consume model turns.
    for (let attempt = 0; attempt < 8; attempt++) {
      signal.throwIfAborted();
      await this.options.authorize();
      await this.options.consume('observation');
      const probe = await this.options.surfaces.inspectOpening(state, state.envelope.lessonId, signal);
      const stage = probe.ready ? 'document_verified' : probe.observation && isMaterialAppChooser(probe.observation) ? 'app_chooser' : 'waiting_for_document';
      if (stage !== lastStage) console.info('[classroom:material] opening', { lessonId: state.envelope.lessonId, stage });
      lastStage = stage;
      if (probe.ready) return;
      const observation = probe.observation;
      chooserSeen ||= Boolean(observation && isMaterialAppChooser(observation));
      const action = filename && observation ? materialChooserAction(observation, filename, selectedApp) : undefined;
      const key = action ? `${action.kind}:${action.element.name}` : '';
      const dispatch = action && observation && !delivered.has(key);
      if (dispatch && action && observation) {
        signal.throwIfAborted();
        await this.options.authorize();
        await this.options.consume('action');
        await recordEffect('dispatching');
        signal.throwIfAborted();
        await this.options.authorize();
        let result;
        try {
          result = await this.options.cua.executeSurfaceCommand(state.envelope.lessonId, observation.observationId,
            { kind: 'click_element', ref: action.element.ref, button: 'left', count: 1 }, signal, 'opening');
        } catch {
          await recordEffect('unknown');
          throw new Error('Application selection has an uncertain outcome. Inspect the screen; Tro will not repeat it.');
        }
        if (result.status === 'unknown') {
          await recordEffect('unknown');
          throw new Error('Application selection has an uncertain outcome. Inspect the screen; Tro will not repeat it.');
        }
        await recordEffect(result.status === 'confirmed' ? 'confirmed' : 'none');
        if (result.status === 'confirmed') {
          delivered.add(key);
          if (action.kind === 'select_app') selectedApp = action.app;
        }
        if (result.status === 'failed') throw new LessonBlockedError('surface_unverified', 'Tro could not select the application. Choose an app, then Resume.');
        console.info('[classroom:material] opening', { lessonId: state.envelope.lessonId, action: action.kind, outcome: result.status });
      }
      if (attempt < 7) await wait(dispatch ? 350 : Math.min(500 * (attempt + 1), 2000), signal);
    }
    throw new LessonBlockedError('surface_unverified', chooserSeen
      ? 'Choose an installed app in the Open with dialog, then Resume. Tro could not verify a supported one-time opening control.'
      : 'The document is not visible yet. Bring it forward, then Resume or choose its window.');
  }
}
